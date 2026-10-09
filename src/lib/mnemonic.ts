import { BIP39_ENGLISH } from './wordlist'
import { hasSubtleCrypto, hmacSha512, sha256, toHex, utf8 } from './encoding'

export type MnemonicScheme = 'bip39' | 'electrum' | 'aezeed' | 'slip39' | 'monero' | 'other'

export const SCHEMES: { id: MnemonicScheme; label: string; counts: number[] }[] = [
  { id: 'bip39', label: 'BIP39 (English)', counts: [12, 15, 18, 21, 24] },
  { id: 'electrum', label: 'Electrum', counts: [12] },
  { id: 'aezeed', label: 'Aezeed (LND)', counts: [24] },
  { id: 'slip39', label: 'SLIP-39 share (Shamir)', counts: [20, 33] },
  { id: 'monero', label: 'Monero', counts: [25, 13, 16] },
  { id: 'other', label: 'Other', counts: [] },
]

export const COMMON_WORD_COUNTS = [12, 13, 15, 16, 18, 20, 21, 24, 25, 33]
export const MAX_WORDS = 48

/** Schemes whose words come from the BIP39 English list. */
export const usesBip39Wordlist = (scheme: MnemonicScheme): boolean =>
  scheme === 'bip39' || scheme === 'electrum' || scheme === 'aezeed'

const WORD_INDEX = new Map(BIP39_ENGLISH.map((w, i) => [w, i]))

export const normalizeWord = (word: string): string => word.normalize('NFKD').trim().toLowerCase()

export const isBip39Word = (word: string): boolean => WORD_INDEX.has(normalizeWord(word))

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g
const EDGE_PUNCTUATION = /^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu

export interface ParsedPhrase {
  words: string[]
  /** Set when every word carried its own number ("1. abandon", "#2 ability"): the first number. */
  firstNumber?: number
  /** The words were reordered by their numbers (e.g. copied from a sheet with several columns). */
  reordered: boolean
}

/**
 * Splits pasted text into words. Number markers ("1.", "2)", "(3)", "#4",
 * "5 -") and punctuation are dropped. When every word has a distinct number
 * and the numbers form a run, words are placed by number, so phrases copied
 * row by row from a sheet with several columns come out in the right order.
 */
export const parsePhrase = (text: string): ParsedPhrase => {
  const tokens = text
    .replace(ZERO_WIDTH, ' ')
    // "1.abandon", "1-legal", "#1abandon": separate the marker from the word.
    // (?<!\d) keeps this linear: without it, long runs of digits backtrack quadratically.
    .replace(/(?<!\d)(\d+)[.):\-]*(?=\p{L})/gu, '$1 ')
    .split(/[\s,;|]+/)
  const numbered: { n: number; word: string }[] = []
  const words: string[] = []
  let pending: number | null = null
  let allNumbered = true
  for (const token of tokens) {
    // "a)" and "b." are list markers, not words.
    if (/^\p{L}[.)]$/u.test(token)) continue
    const trimmed = token.replace(EDGE_PUNCTUATION, '')
    if (!trimmed) continue
    if (/^\d+$/.test(trimmed)) {
      pending = Number(trimmed)
      continue
    }
    if (!/\p{L}/u.test(trimmed)) continue
    const word = normalizeWord(trimmed)
    words.push(word)
    if (pending === null) allNumbered = false
    else numbered.push({ n: pending, word })
    pending = null
  }
  if (allNumbered && words.length > 1) {
    const sorted = [...numbered].sort((a, b) => a.n - b.n)
    const contiguous = sorted.every((x, i) => x.n === sorted[0].n + i)
    if (contiguous && sorted[0].n >= 1) {
      return {
        words: sorted.map((x) => x.word),
        firstNumber: sorted[0].n,
        reordered: sorted.some((x, i) => x !== numbered[i]),
      }
    }
  }
  return { words, reordered: false }
}

/** Split pasted text ("1. abandon 2. ability", newlines, commas...) into words. */
export const splitPhrase = (text: string): string[] => parsePhrase(text).words

/**
 * BIP39 words are unique in their first four letters, so a 4+ letter
 * prefix that matches exactly one word can be expanded. Only on request:
 * words from other wordlists can look like English prefixes (acto, arte).
 */
export const expandPrefix = (word: string): string => {
  const w = normalizeWord(word)
  if (w.length < 4 || WORD_INDEX.has(w)) return w
  const matches = BIP39_ENGLISH.filter((candidate) => candidate.startsWith(w))
  return matches.length === 1 ? matches[0] : w
}

const editDistance = (a: string, b: string): number => {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = temp
    }
  }
  return prev[b.length]
}

/** Closest wordlist entries for a misspelled word. */
export const suggestWords = (word: string, limit = 3): string[] => {
  const w = normalizeWord(word)
  // BIP39 words have at most 8 letters; long input is not a typo of one (and is slow to compare).
  if (!w || w.length > 10) return []
  const byPrefix = BIP39_ENGLISH.filter((c) => c.startsWith(w.slice(0, 4)))
  if (byPrefix.length > 0 && byPrefix.length <= limit) return byPrefix
  return BIP39_ENGLISH.map((c) => [c, editDistance(w, c)] as const)
    .filter(([, d]) => d <= 2)
    .sort((x, y) => x[1] - y[1])
    .slice(0, limit)
    .map(([c]) => c)
}

export type CheckStatus = 'valid' | 'invalid' | 'incomplete' | 'unchecked'

export interface MnemonicCheck {
  status: CheckStatus
  message: string
  /** 0-based positions of words that are not in the wordlist. */
  unknownWords: number[]
}

const bip39Checksum = async (indices: number[]): Promise<boolean> => {
  const totalBits = indices.length * 11
  const checksumBits = totalBits / 33
  const entropyBits = totalBits - checksumBits
  const bits = indices.map((i) => i.toString(2).padStart(11, '0')).join('')
  const entropy = new Uint8Array(entropyBits / 8)
  for (let i = 0; i < entropy.length; i++) {
    entropy[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  }
  const hash = await sha256(entropy)
  const hashBits = Array.from(hash, (b) => b.toString(2).padStart(8, '0')).join('')
  return bits.slice(entropyBits) === hashBits.slice(0, checksumBits)
}

export type ElectrumSeedType = 'standard' | 'segwit' | '2fa' | '2fa-segwit'

const ELECTRUM_PREFIXES: [string, ElectrumSeedType][] = [
  ['01', 'standard'],
  ['100', 'segwit'],
  ['101', '2fa'],
  ['102', '2fa-segwit'],
]

/** Electrum "new style" seeds carry their version in HMAC-SHA512("Seed version", seed). */
export const electrumSeedType = async (words: string[]): Promise<ElectrumSeedType | null> => {
  const normalized = words
    .map((w) => normalizeWord(w).replace(/[̀-ͯ]/g, ''))
    .join(' ')
  const hex = toHex(await hmacSha512(utf8('Seed version'), utf8(normalized)))
  return ELECTRUM_PREFIXES.find(([prefix]) => hex.startsWith(prefix))?.[1] ?? null
}

export const checkMnemonic = async (scheme: MnemonicScheme, rawWords: string[]): Promise<MnemonicCheck> => {
  const words = rawWords.map(normalizeWord)
  const filled = words.filter(Boolean).length
  const unknownWords = usesBip39Wordlist(scheme)
    ? words.flatMap((w, i) => (w && !WORD_INDEX.has(w) ? [i] : []))
    : []

  if (filled === 0) {
    return { status: 'incomplete', message: 'No words entered yet.', unknownWords }
  }
  if (filled < words.length) {
    return {
      status: 'incomplete',
      message: `${filled} of ${words.length} words entered.`,
      unknownWords,
    }
  }
  if (unknownWords.length > 0) {
    const list = unknownWords.map((i) => `#${i + 1}`).join(', ')
    return {
      status: 'invalid',
      message: `Not in the English BIP39 wordlist: ${list}. For other languages or old Electrum seeds, choose Other.`,
      unknownWords,
    }
  }
  if (!hasSubtleCrypto() && (scheme === 'bip39' || scheme === 'electrum')) {
    return { status: 'unchecked', message: 'Checksum check needs a secure (https) context.', unknownWords }
  }

  switch (scheme) {
    case 'bip39': {
      if (![12, 15, 18, 21, 24].includes(words.length)) {
        return {
          status: 'invalid',
          message: `BIP39 phrases have 12, 15, 18, 21 or 24 words (this has ${words.length}).`,
          unknownWords,
        }
      }
      const ok = await bip39Checksum(words.map((w) => WORD_INDEX.get(w)!))
      if (ok) return { status: 'valid', message: `Valid BIP39 checksum (${words.length} words).`, unknownWords }
      // Electrum and aezeed seeds use the same words but their own checksums.
      const electrum = words.length === 12 ? await electrumSeedType(words) : null
      const aezeed = words.length === 24 && aezeedCheck(words.map((w) => WORD_INDEX.get(w)!)) === 'valid'
      return {
        status: 'invalid',
        message: electrum
          ? `Not a BIP39 phrase, but these words are a valid Electrum seed (${electrum}). Choose the Electrum scheme.`
          : aezeed
            ? 'Not a BIP39 phrase, but these words are a valid aezeed seed. Choose the Aezeed (LND) scheme.'
            : 'Checksum mismatch. Check the spelling and order of every word.',
        unknownWords,
      }
    }
    case 'electrum': {
      const type = await electrumSeedType(words)
      return type
        ? { status: 'valid', message: `Valid Electrum seed (${type}).`, unknownWords }
        : {
            status: 'invalid',
            message: 'Not a valid Electrum 2.0+ seed. Check the words, or pick another scheme.',
            unknownWords,
          }
    }
    case 'monero': {
      if (words.length !== 25 && words.length !== 13) break
      const ok = moneroChecksumOk(words)
      return ok
        ? { status: 'valid', message: `Monero checksum word OK (${words.length} words).`, unknownWords }
        : {
            status: 'invalid',
            message: 'The last word does not match the Monero checksum. Check the spelling and order of every word.',
            unknownWords,
          }
    }
    case 'aezeed': {
      if (words.length !== 24) {
        return {
          status: 'invalid',
          message: `Aezeed seeds have 24 words (this has ${words.length}).`,
          unknownWords,
        }
      }
      const indices = words.map((w) => WORD_INDEX.get(w)!)
      const result = aezeedCheck(indices)
      if (result === 'valid') {
        return {
          status: 'valid',
          message: 'Valid aezeed checksum. A seed password, if it has one, is not checked.',
          unknownWords,
        }
      }
      const bip39 = hasSubtleCrypto() && (await bip39Checksum(indices))
      return {
        status: 'invalid',
        message: bip39
          ? 'Not an aezeed seed, but these words pass the BIP39 checksum. Choose the BIP39 scheme.'
          : result === 'version'
            ? 'The first word does not match a known aezeed version. Check it, or pick another scheme.'
            : 'Checksum mismatch. Check the spelling and order of every word.',
        unknownWords,
      }
    }
  }
  return {
    status: 'unchecked',
    message: `${words.length} words. Checksums for this scheme are not checked here.`,
    unknownWords,
  }
}

const CRC32_IEEE = 0xedb88320
const CRC32_CASTAGNOLI = 0x82f63b78

/** CRC-32: IEEE for Monero's checksum word, Castagnoli (CRC-32C) for aezeed. */
const crc32 = (bytes: Uint8Array, polynomial = CRC32_IEEE): number => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    let c = (crc ^ byte) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ polynomial : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * aezeed (LND): 24 words carry 33 bytes, a version byte, the enciphered seed
 * and its salt (29 bytes together), then a big-endian CRC-32C of those 29.
 * Checking it needs no password: the password only protects the seed inside.
 */
export const aezeedCheck = (indices: number[]): 'valid' | 'version' | 'checksum' => {
  const bytes = new Uint8Array(33)
  let acc = 0
  let bits = 0
  let n = 0
  for (const index of indices) {
    acc = (acc << 11) | index
    bits += 11
    while (bits >= 8) {
      bits -= 8
      bytes[n++] = (acc >>> bits) & 0xff
    }
    acc &= (1 << bits) - 1
  }
  if (bytes[0] !== 0) return 'version'
  const stored = new DataView(bytes.buffer).getUint32(29)
  return crc32(bytes.subarray(0, 29), CRC32_CASTAGNOLI) === stored ? 'valid' : 'checksum'
}

/**
 * Monero (25 words, or 13 for MyMonero): the last word repeats one of the
 * others, chosen by a CRC-32 of each word's first letters. English and most
 * languages use 3-letter prefixes; some use 4, Chinese 1, so all are tried.
 */
export const moneroChecksumOk = (words: string[]): boolean => {
  const body = words.slice(0, -1).map((w) => w.normalize('NFC'))
  const last = words[words.length - 1].normalize('NFC')
  return [3, 4, 1].some((length) => {
    const prefixes = body.map((w) => [...w].slice(0, length).join('')).join('')
    return body[crc32(utf8(prefixes)) % body.length] === last
  })
}
