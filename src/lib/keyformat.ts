import { bytesEqual, fromHex, hasSubtleCrypto, sha256 } from './encoding'

// Recognizes common private key encodings so typos and mix-ups
// (pasting an address or xpub instead of a key) are caught early.

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE58_MAP = new Map([...BASE58_ALPHABET].map((c, i) => [c, BigInt(i)]))

export const base58Decode = (text: string): Uint8Array | null => {
  let value = 0n
  for (const char of text) {
    const digit = BASE58_MAP.get(char)
    if (digit === undefined) return null
    value = value * 58n + digit
  }
  const bytes: number[] = []
  while (value > 0n) {
    bytes.unshift(Number(value % 256n))
    value /= 256n
  }
  let leadingZeros = 0
  while (leadingZeros < text.length && text[leadingZeros] === '1') leadingZeros++
  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes])
}

/** Returns the payload when the trailing 4-byte double-SHA256 checksum matches. */
export const base58CheckDecode = async (text: string): Promise<Uint8Array | null> => {
  const raw = base58Decode(text)
  if (!raw || raw.length < 5) return null
  const payload = raw.slice(0, -4)
  const checksum = (await sha256(await sha256(payload))).slice(0, 4)
  return bytesEqual(checksum, raw.slice(-4)) ? payload : null
}

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const BECH32_CONST = 1
const BECH32M_CONST = 0x2bc830a3

const bech32Polymod = (values: number[]): number => {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const top = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]
  }
  return chk >>> 0
}

const hrpExpand = (hrp: string): number[] => [
  ...[...hrp].map((c) => c.charCodeAt(0) >> 5),
  0,
  ...[...hrp].map((c) => c.charCodeAt(0) & 31),
]

export interface Bech32Decoded {
  hrp: string
  variant: 'bech32' | 'bech32m'
  /** 5-bit groups, checksum removed. */
  words: number[]
}

/** Decodes bech32/bech32m without the 90-character limit (Cardano keys are longer). */
export const bech32Decode = (input: string): Bech32Decoded | null => {
  if (input !== input.toLowerCase() && input !== input.toUpperCase()) return null
  const text = input.toLowerCase()
  const sep = text.lastIndexOf('1')
  if (sep < 1 || sep + 7 > text.length) return null
  const hrp = text.slice(0, sep)
  const data: number[] = []
  for (const char of text.slice(sep + 1)) {
    const v = BECH32_CHARSET.indexOf(char)
    if (v === -1) return null
    data.push(v)
  }
  const check = bech32Polymod([...hrpExpand(hrp), ...data])
  const variant = check === BECH32_CONST ? 'bech32' : check === BECH32M_CONST ? 'bech32m' : null
  if (!variant) return null
  return { hrp, variant, words: data.slice(0, -6) }
}

export const fromWords = (words: number[]): Uint8Array | null => {
  let acc = 0
  let bits = 0
  const out: number[] = []
  for (const w of words) {
    acc = (acc << 5) | w
    bits += 5
    while (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 0xff)
    }
  }
  if (bits >= 5 || (acc & ((1 << bits) - 1)) !== 0) return null
  return new Uint8Array(out)
}

const EXTENDED_KEY_VERSIONS: Record<string, { name: string; private: boolean; note: string }> = {
  '0488ade4': { name: 'xprv', private: true, note: 'BIP32/BIP44' },
  '0488b21e': { name: 'xpub', private: false, note: 'BIP32/BIP44' },
  '049d7878': { name: 'yprv', private: true, note: 'BIP49 nested SegWit' },
  '049d7cb2': { name: 'ypub', private: false, note: 'BIP49 nested SegWit' },
  '04b2430c': { name: 'zprv', private: true, note: 'BIP84 native SegWit' },
  '04b24746': { name: 'zpub', private: false, note: 'BIP84 native SegWit' },
  '0295b005': { name: 'Yprv', private: true, note: 'multisig nested SegWit' },
  '0295b43f': { name: 'Ypub', private: false, note: 'multisig nested SegWit' },
  '02aa7a99': { name: 'Zprv', private: true, note: 'multisig native SegWit' },
  '02aa7ed3': { name: 'Zpub', private: false, note: 'multisig native SegWit' },
  '04358394': { name: 'tprv', private: true, note: 'testnet' },
  '043587cf': { name: 'tpub', private: false, note: 'testnet' },
  '044a4e28': { name: 'uprv', private: true, note: 'testnet BIP49' },
  '044a5262': { name: 'upub', private: false, note: 'testnet BIP49' },
  '045f18bc': { name: 'vprv', private: true, note: 'testnet BIP84' },
  '045f1cf6': { name: 'vpub', private: false, note: 'testnet BIP84' },
}

const WIF_VERSIONS: Record<number, string> = {
  0x80: 'Bitcoin mainnet',
  0xef: 'Bitcoin testnet',
  0xb0: 'Litecoin',
  0x9e: 'Dogecoin',
  0xcc: 'Dash',
}

export type KeyFormatLevel = 'ok' | 'info' | 'warn' | 'error'

export interface KeyFormat {
  level: KeyFormatLevel
  label: string
  detail?: string
}

const PUBLIC_WARNING = 'This looks like public information, not a private key.'

const hexOf = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

const detectJson = (text: string): KeyFormat | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (Array.isArray(parsed) && parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return parsed.length === 64
      ? { level: 'ok', label: 'Byte array, 64 bytes', detail: 'Solana CLI keypair file format.' }
      : { level: 'info', label: `Byte array, ${parsed.length} bytes` }
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    if ((obj.crypto || obj.Crypto) && Number(obj.version) === 3) {
      return {
        level: 'ok',
        label: 'Encrypted keystore (Web3 Secret Storage v3)',
        detail: 'Store its password in a separate hidden field.',
      }
    }
    return { level: 'info', label: 'JSON document' }
  }
  return null
}

export const detectKeyFormat = async (input: string): Promise<KeyFormat | null> => {
  const text = input.trim()
  if (!text) return null

  if (text.startsWith('{') || text.startsWith('[')) {
    return detectJson(text) ?? { level: 'warn', label: 'Looks like JSON, but it does not parse.' }
  }

  const words = text.split(/\s+/)
  if (words.length >= 12 && words.every((w) => /^[a-z]+$/i.test(w))) {
    return {
      level: 'warn',
      label: `Looks like a ${words.length}-word seed phrase`,
      detail: 'Use a "Seed phrase" entry to get word-by-word checks.',
    }
  }

  if (/^(0x)?[0-9a-fA-F]+$/.test(text) && text.replace(/^0x/, '').length % 2 === 0) {
    const bytes = fromHex(text)
    const evm = text.startsWith('0x')
    if (bytes.length === 32) {
      return {
        level: 'ok',
        label: `Hex, 32 bytes${evm ? ' (0x-prefixed)' : ''}`,
        detail: 'Raw 256-bit private key (Ethereum/EVM, Bitcoin, Cosmos and others).',
      }
    }
    if (bytes.length === 20) return { level: 'warn', label: 'Hex, 20 bytes', detail: PUBLIC_WARNING + ' (EVM address length)' }
    if (bytes.length === 33 || bytes.length === 65) {
      return { level: 'warn', label: `Hex, ${bytes.length} bytes`, detail: PUBLIC_WARNING + ' (public key length)' }
    }
    return { level: 'info', label: `Hex, ${bytes.length} bytes` }
  }

  const bech = bech32Decode(text)
  if (bech) {
    const data = bech.variant === 'bech32' ? fromWords(bech.words) : null
    switch (bech.hrp) {
      case 'nsec':
        return data?.length === 32
          ? { level: 'ok', label: 'Nostr private key (nsec)', detail: 'Checksum OK.' }
          : { level: 'error', label: 'nsec with unexpected length' }
      case 'npub':
        return { level: 'warn', label: 'Nostr public key (npub)', detail: PUBLIC_WARNING }
      case 'bc':
      case 'tb':
      case 'ltc':
        return { level: 'warn', label: 'Address (bech32)', detail: PUBLIC_WARNING }
      default:
        // Cardano: addr_xsk, root_xsk, acct_xsk, ed25519_sk, ed25519e_sk... Check before the addr prefix.
        if (/_x?sk$/.test(bech.hrp) || bech.hrp.includes('xprv')) {
          return { level: 'ok', label: `Bech32 secret key (${bech.hrp})`, detail: 'Checksum OK.' }
        }
        if (/_x?vk$/.test(bech.hrp) || bech.hrp.includes('xpub') || bech.hrp.startsWith('addr') || bech.hrp.startsWith('stake')) {
          return { level: 'warn', label: `Bech32 (${bech.hrp})`, detail: PUBLIC_WARNING }
        }
        return { level: 'info', label: `Bech32 data (${bech.hrp})`, detail: 'Checksum OK.' }
    }
  }
  if (/^[a-z0-9]+1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,}$/.test(text) && /^(nsec|npub|bc|tb)1/.test(text)) {
    return { level: 'error', label: 'Bech32 checksum fails', detail: 'Check for a typo.' }
  }

  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(text)) {
    if (hasSubtleCrypto()) {
      const payload = await base58CheckDecode(text)
      if (payload) {
        if (payload.length === 78) {
          const version = EXTENDED_KEY_VERSIONS[hexOf(payload.slice(0, 4))]
          if (version) {
            return version.private
              ? { level: 'ok', label: `Extended private key (${version.name})`, detail: `${version.note}. Checksum OK.` }
              : { level: 'warn', label: `Extended public key (${version.name})`, detail: PUBLIC_WARNING }
          }
          return { level: 'info', label: 'Extended key (unknown version)', detail: 'Checksum OK.' }
        }
        const network = WIF_VERSIONS[payload[0]]
        if (network && (payload.length === 33 || (payload.length === 34 && payload[33] === 1))) {
          return {
            level: 'ok',
            label: `WIF private key (${network}, ${payload.length === 34 ? 'compressed' : 'uncompressed'})`,
            detail: 'Checksum OK.',
          }
        }
        if (payload.length === 21) return { level: 'warn', label: 'Address (Base58Check)', detail: PUBLIC_WARNING }
        return { level: 'info', label: `Base58Check, ${payload.length} bytes`, detail: 'Checksum OK.' }
      }
      if (/^[5KLc9]/.test(text) && (text.length === 51 || text.length === 52)) {
        return { level: 'error', label: 'Looks like WIF, but the checksum fails', detail: 'Check for a typo.' }
      }
      if (/^[xyztuvYZ](prv|pub)/.test(text) && text.length === 111) {
        return { level: 'error', label: 'Looks like an extended key, but the checksum fails', detail: 'Check for a typo.' }
      }
    }
    const raw = base58Decode(text)
    if (raw?.length === 64) {
      return { level: 'ok', label: 'Base58, 64 bytes', detail: 'Solana-style keypair (Phantom/Solflare export).' }
    }
    if (raw?.length === 32) {
      return { level: 'info', label: 'Base58, 32 bytes', detail: 'Could be an ed25519 secret seed, or a Solana address.' }
    }
    if (raw) return { level: 'info', label: `Base58, ${raw.length} bytes` }
  }

  return { level: 'info', label: 'Unrecognized format', detail: 'Stored as typed.' }
}
