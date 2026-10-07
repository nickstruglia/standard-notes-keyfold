// Small byte helpers shared by the validators and the vault encryption.
// Everything here runs locally; nothing is sent anywhere.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const utf8 = (text: string): Uint8Array => encoder.encode(text)
export const fromUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes)

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

export const fromHex = (hex: string): Uint8Array => {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error('Invalid hex')
  }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export const fromBase64 = (b64: string): Uint8Array => {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** WebCrypto is only exposed in secure contexts (https, localhost). */
export const hasSubtleCrypto = (): boolean =>
  typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.subtle !== 'undefined'

// TS 6 types WebCrypto inputs as ArrayBuffer-backed views; our arrays always are.
export const buf = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => bytes as Uint8Array<ArrayBuffer>

export const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', buf(bytes)))

export const hmacSha512 = async (key: Uint8Array, message: Uint8Array): Promise<Uint8Array> => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    buf(key),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, buf(message)))
}

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export const randomBytes = (length: number): Uint8Array => {
  const out = new Uint8Array(length)
  crypto.getRandomValues(out)
  return out
}

export const newId = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return toHex(randomBytes(16))
}
