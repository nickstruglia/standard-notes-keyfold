import { bytesEqual, fromBase64, fromHex, fromUtf8, hasSubtleCrypto, sha256 } from './encoding'

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
/** Prefixes of keys and addresses Keyfold knows, for typo detection. */
const BECH32_KNOWN = /^(nsec|npub|bc|tb|ltc|age|age-secret-key-)$|_x?[sv]k$|xprv|xpub|^addr|^stake/

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
        detail: 'Store its password in the keystore password field.',
      }
    }
    if (obj.type === 'service_account' && typeof obj.private_key === 'string') {
      return { level: 'ok', label: 'Google Cloud service account key', detail: 'JSON key file with a private key.' }
    }
    // A key set counts as private if any of its keys is.
    const set = Array.isArray(obj.keys) ? (obj.keys as Record<string, unknown>[]).filter((k) => k && typeof k === 'object') : [obj]
    const jwk = set.find((k) => 'd' in k || 'k' in k) ?? set[0]
    if (jwk && typeof jwk.kty === 'string') {
      return 'd' in jwk || 'k' in jwk
        ? { level: 'ok', label: `JSON Web Key (${jwk.kty}, private)` }
        : { level: 'warn', label: `JSON Web Key (${jwk.kty}, public)`, detail: PUBLIC_WARNING }
    }
    return { level: 'info', label: 'JSON document' }
  }
  return null
}

const SSH_KEY_TYPES: Record<string, string> = {
  'ssh-ed25519': 'Ed25519',
  'ssh-rsa': 'RSA',
  'ssh-dss': 'DSA',
  'ecdsa-sha2-nistp256': 'ECDSA P-256',
  'ecdsa-sha2-nistp384': 'ECDSA P-384',
  'ecdsa-sha2-nistp521': 'ECDSA P-521',
  'sk-ssh-ed25519@openssh.com': 'Ed25519 security key',
  'sk-ecdsa-sha2-nistp256@openssh.com': 'ECDSA security key',
}

/** Reads the key type and cipher from an OpenSSH private key (openssh-key-v1 format). */
export const readOpenSshKey = (base64Body: string): { keyType: string; encrypted: boolean } | null => {
  let bytes: Uint8Array
  try {
    bytes = fromBase64(base64Body.replace(/\s+/g, ''))
  } catch {
    return null
  }
  const magic = 'openssh-key-v1\0'
  if (fromUtf8(bytes.slice(0, magic.length)) !== magic) return null
  let offset = magic.length
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const readBytes = (): Uint8Array => {
    if (offset + 4 > bytes.length) throw new Error('truncated')
    const length = view.getUint32(offset)
    offset += 4
    if (offset + length > bytes.length) throw new Error('truncated')
    const out = bytes.slice(offset, offset + length)
    offset += length
    return out
  }
  try {
    const cipher = fromUtf8(readBytes())
    readBytes() // kdf name
    readBytes() // kdf options
    offset += 4 // number of keys
    const publicKey = readBytes()
    // The private section must be complete; a short read means part of the key was not copied.
    readBytes()
    const typeLength = new DataView(publicKey.buffer, publicKey.byteOffset).getUint32(0)
    const keyType = fromUtf8(publicKey.slice(4, 4 + typeLength))
    return { keyType, encrypted: cipher !== 'none' }
  } catch {
    return null
  }
}

/** OpenPGP ASCII-armor checksum (CRC-24, RFC 4880). */
const crc24 = (bytes: Uint8Array): number => {
  let crc = 0xb704ce
  for (const byte of bytes) {
    crc ^= byte << 16
    for (let i = 0; i < 8; i++) {
      crc <<= 1
      if (crc & 0x1000000) crc ^= 0x1864cfb
    }
  }
  return crc & 0xffffff
}

/** null when the armor has no checksum line (allowed since RFC 9580), else whether it matches. */
const pgpChecksumOk = (armor: string): boolean | null => {
  const lines = armor.split(/\r?\n/).map((l) => l.trim())
  const blank = lines.indexOf('')
  const body = lines.slice(blank === -1 ? 1 : blank + 1).filter((l) => l && !l.startsWith('-----'))
  const checksumLine = body.findIndex((l) => /^=[A-Za-z0-9+/]{4}$/.test(l))
  if (checksumLine === -1) return null
  try {
    const data = fromBase64(body.slice(0, checksumLine).join(''))
    const expected = fromBase64(body[checksumLine].slice(1))
    return crc24(data) === ((expected[0] << 16) | (expected[1] << 8) | expected[2])
  } catch {
    return false
  }
}

const PUBLIC_PEM: Record<string, string> = {
  'PUBLIC KEY': 'PEM public key',
  'RSA PUBLIC KEY': 'PEM RSA public key',
  CERTIFICATE: 'Certificate',
  'PGP PUBLIC KEY BLOCK': 'PGP public key block',
}

const NOT_KEYS: Record<string, string> = {
  'PGP MESSAGE': 'PGP message',
  'PGP SIGNATURE': 'PGP signature',
  'PGP SIGNED MESSAGE': 'PGP signed message',
}

/** One PEM block on its own. */
const classifyPemBlock = (type: string, body: string, block: string): KeyFormat => {
  const encrypted = /Proc-Type:\s*4,ENCRYPTED/i.test(body)
  if (NOT_KEYS[type]) return { level: 'warn', label: NOT_KEYS[type], detail: 'This is not a key.' }
  if (PUBLIC_PEM[type]) return { level: 'warn', label: PUBLIC_PEM[type], detail: PUBLIC_WARNING }
  switch (type) {
    case 'OPENSSH PRIVATE KEY': {
      const key = readOpenSshKey(body)
      if (!key) return { level: 'error', label: 'OpenSSH private key, but it could not be read', detail: 'Check that it was copied completely.' }
      const name = SSH_KEY_TYPES[key.keyType] ?? key.keyType
      return {
        level: 'ok',
        label: `OpenSSH private key (${name})`,
        detail: key.encrypted ? 'Protected by a passphrase.' : 'Not passphrase-protected.',
      }
    }
    case 'PGP PRIVATE KEY BLOCK': {
      const checksum = pgpChecksumOk(block)
      if (checksum === false) return { level: 'error', label: 'PGP private key, but the checksum fails', detail: 'Check for a typo or missing line.' }
      return { level: 'ok', label: 'PGP private key block', detail: checksum ? 'Checksum OK.' : undefined }
    }
    case 'RSA PRIVATE KEY':
      return { level: 'ok', label: 'PEM RSA private key (PKCS#1)', detail: encrypted ? 'Protected by a passphrase.' : undefined }
    case 'EC PRIVATE KEY':
      return { level: 'ok', label: 'PEM EC private key (SEC1)', detail: encrypted ? 'Protected by a passphrase.' : undefined }
    case 'DSA PRIVATE KEY':
      return { level: 'ok', label: 'PEM DSA private key', detail: encrypted ? 'Protected by a passphrase.' : undefined }
    case 'PRIVATE KEY':
      return { level: 'ok', label: 'PEM private key (PKCS#8)' }
    case 'ENCRYPTED PRIVATE KEY':
      return { level: 'ok', label: 'PEM private key (PKCS#8)', detail: 'Protected by a passphrase.' }
    default:
      return { level: 'info', label: `PEM block (${type.toLowerCase()})` }
  }
}

const isPrivateBlock = (type: string) => /PRIVATE KEY/.test(type)

/**
 * Reads every PEM block (a TLS bundle has a certificate and a key; openssl
 * ecparam writes parameters then the key) and reports the most important:
 * a private key, then an incomplete block, then public data.
 */
const detectPem = (text: string): KeyFormat | null => {
  const blocks = [...text.matchAll(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g)]
  const begins = (text.match(/-----BEGIN [A-Z0-9 ]+-----/g) ?? []).length
  const incomplete: KeyFormat = { level: 'error', label: 'Key block is incomplete', detail: 'The matching -----END ...----- line is missing.' }
  const privateBlock = blocks.find((m) => isPrivateBlock(m[1]))
  if (privateBlock) return classifyPemBlock(privateBlock[1], privateBlock[2], privateBlock[0])
  // A signed PGP message has no END line of its own: it is not a key either.
  const notKey = /-----BEGIN (PGP MESSAGE|PGP SIGNATURE|PGP SIGNED MESSAGE)-----/.exec(text)
  if (notKey) return { level: 'warn', label: NOT_KEYS[notKey[1]], detail: 'This is not a key.' }
  if (begins > blocks.length) return incomplete
  if (!blocks.length) return null
  const results = blocks.map((m) => classifyPemBlock(m[1], m[2], m[0]))
  return results.find((r) => r.level === 'warn') ?? results[0]
}

const TOKENS: { pattern: RegExp; label: string; level?: KeyFormatLevel; detail?: string }[] = [
  { pattern: /^gh[pousr]_[A-Za-z0-9]{36,}$/, label: 'GitHub token' },
  { pattern: /^github_pat_\w{50,}$/, label: 'GitHub fine-grained token' },
  { pattern: /^glpat-[\w-]{20,}$/, label: 'GitLab access token' },
  { pattern: /^npm_[A-Za-z0-9]{36}$/, label: 'npm access token' },
  { pattern: /^(sk|rk)_(live|test)_[A-Za-z0-9]{16,}$/, label: 'Stripe secret key' },
  { pattern: /^pk_(live|test)_[A-Za-z0-9]{16,}$/, label: 'Stripe publishable key', level: 'warn', detail: PUBLIC_WARNING },
  { pattern: /^xox[abposr]-[A-Za-z0-9-]{10,}$/, label: 'Slack token' },
  { pattern: /^AIza[\w-]{35}$/, label: 'Google API key' },
  {
    pattern: /^(AKIA|ASIA)[0-9A-Z]{16}$/,
    label: 'AWS access key ID',
    level: 'info',
    detail: 'The 40-character secret access key is a separate value; store it as well.',
  },
  { pattern: /^SG\.[\w-]{22}\.[\w-]{43}$/, label: 'SendGrid API key' },
  { pattern: /^dop_v1_[a-f0-9]{64}$/, label: 'DigitalOcean token' },
  { pattern: /^sk-[\w-]{20,}$/, label: 'API secret key (sk-…)' },
  { pattern: /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/, label: 'JSON Web Token', level: 'info', detail: 'Tokens like this usually expire.' },
]

export const detectKeyFormat = async (input: string): Promise<KeyFormat | null> => {
  const text = input.trim()
  if (!text) return null

  if (text.startsWith('{') || text.startsWith('[')) {
    return detectJson(text) ?? { level: 'warn', label: 'Looks like JSON, but it does not parse.' }
  }

  if (/^---- BEGIN SSH2 PUBLIC KEY ----/m.test(text)) {
    return { level: 'warn', label: 'SSH public key (SSH2 format)', detail: PUBLIC_WARNING }
  }

  const pem = detectPem(text)
  if (pem) return pem

  const putty = /^PuTTY-User-Key-File-\d+:\s*(\S+)/.exec(text)
  if (putty) {
    const encrypted = !/^Encryption:\s*none/m.test(text)
    return {
      level: 'ok',
      label: `PuTTY private key (${SSH_KEY_TYPES[putty[1]] ?? putty[1]})`,
      detail: encrypted ? 'Protected by a passphrase.' : 'Not passphrase-protected.',
    }
  }

  const sshPublic = /^(ssh-ed25519|ssh-rsa|ssh-dss|ecdsa-sha2-nistp\d+|sk-[\w.@-]+)\s+AAAA[A-Za-z0-9+/]+=*(\s|$)/.exec(text)
  if (sshPublic) {
    return { level: 'warn', label: `SSH public key (${SSH_KEY_TYPES[sshPublic[1]] ?? sshPublic[1]})`, detail: PUBLIC_WARNING }
  }

  const token = TOKENS.find((t) => t.pattern.test(text))
  if (token) return { level: token.level ?? 'ok', label: token.label, detail: token.detail }

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
      case 'age-secret-key-':
        return data?.length === 32
          ? { level: 'ok', label: 'age secret key', detail: 'Checksum OK.' }
          : { level: 'error', label: 'age secret key with unexpected length', detail: 'Check that it was copied completely.' }
      case 'age':
        return { level: 'warn', label: 'age recipient (public key)', detail: PUBLIC_WARNING }
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
  {
    // A known Bech32 prefix whose checksum fails is a typo, not an unknown format.
    const lower = text.toLowerCase()
    const shape = /^([a-z0-9_-]+)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,}$/.exec(lower)
    if (shape && (text === lower || text === text.toUpperCase()) && BECH32_KNOWN.test(shape[1])) {
      return { level: 'error', label: 'Bech32 checksum fails', detail: 'Check for a typo.' }
    }
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(text) && text.length % 4 === 0 && /[+/=]/.test(text)) {
    try {
      const bytes = fromBase64(text)
      return bytes.length === 32
        ? { level: 'ok', label: 'Base64, 32 bytes', detail: 'The format of WireGuard keys and many other 256-bit keys.' }
        : { level: 'info', label: `Base64, ${bytes.length} bytes` }
    } catch {
      // not base64 after all
    }
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
      const decoded = base58Decode(text)
      // WIF for Bitcoin, Litecoin, Dogecoin, Dash and testnets: version byte + 32-byte key (+ 1) + 4-byte checksum.
      if (decoded && (decoded.length === 37 || decoded.length === 38) && WIF_VERSIONS[decoded[0]]) {
        return { level: 'error', label: 'Looks like WIF, but the checksum fails', detail: 'Check for a typo.' }
      }
      if (/^[xyztuvYZUV](prv|pub)/.test(text)) {
        if (text.length === 111) return { level: 'error', label: 'Looks like an extended key, but the checksum fails', detail: 'Check for a typo.' }
        if (text.length === 110 || text.length === 112) {
          return { level: 'error', label: 'Looks like an extended key, but a character may be missing or extra', detail: 'Extended keys are 111 characters.' }
        }
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

/**
 * Looks for private key material in text meant to be public (addresses,
 * public keys, fingerprints): the whole text and each long token. Returns
 * the kind of key found, or null. Hex and base64 are not counted, because
 * 32-byte public data (Nostr pubkeys, txids, WireGuard public keys) looks the same.
 */
export const findPrivateMaterial = async (input: string): Promise<string | null> => {
  const text = input.trim()
  if (!text) return null
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----/.test(text)) return 'a private key block'
  const tokens = text
    .split(/[\s,;()[\]]+/)
    .map((t) => t.split('/')[0])
    .filter((t) => t.length >= 40)
  for (const candidate of [text, ...tokens]) {
    const format = await detectKeyFormat(candidate)
    if (format?.level === 'ok' && !/^(Hex|Base64)/.test(format.label)) return format.label
  }
  return null
}

