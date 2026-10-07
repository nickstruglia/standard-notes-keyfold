import { buf, fromBase64, fromUtf8, hasSubtleCrypto, randomBytes, toBase64, utf8 } from './encoding'
import { APP_ID, FORMAT_VERSION, type EncryptedBlob, type VaultData, normalizeVault } from './vault'

// Optional second layer on top of Standard Notes' own end-to-end encryption:
// PBKDF2-SHA256 derives an AES-256-GCM key from a vault password. The key is
// non-extractable and only lives in memory while the vault is unlocked.

/** OWASP's 2023 recommendation for PBKDF2-HMAC-SHA256. */
export const DEFAULT_ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12

export interface VaultKey {
  key: CryptoKey
  salt: Uint8Array
  iterations: number
}

export const encryptionAvailable = hasSubtleCrypto

/** Binds the parameters to the ciphertext so they cannot be swapped unnoticed. */
const additionalData = (iterations: number) =>
  utf8(`${APP_ID}|${FORMAT_VERSION}|PBKDF2-SHA256|${iterations}|AES-256-GCM`)

export const deriveKey = async (
  password: string,
  salt: Uint8Array = randomBytes(SALT_BYTES),
  iterations = DEFAULT_ITERATIONS,
): Promise<VaultKey> => {
  const material = await crypto.subtle.importKey('raw', buf(utf8(password.normalize('NFC'))), 'PBKDF2', false, [
    'deriveKey',
  ])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return { key, salt, iterations }
}

export const encryptVault = async (vault: VaultData, vaultKey: VaultKey): Promise<EncryptedBlob> => {
  // A fresh random IV for every save; GCM must never reuse an IV with the same key.
  const iv = randomBytes(IV_BYTES)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv), additionalData: buf(additionalData(vaultKey.iterations)) },
    vaultKey.key,
    buf(utf8(JSON.stringify(vault))),
  )
  return {
    kdf: 'PBKDF2-SHA256',
    iterations: vaultKey.iterations,
    salt: toBase64(vaultKey.salt),
    cipher: 'AES-256-GCM',
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password, or the vault data is damaged.')
  }
}

export const decryptVault = async (blob: EncryptedBlob, vaultKey: VaultKey): Promise<VaultData> => {
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(fromBase64(blob.iv)), additionalData: buf(additionalData(blob.iterations)) },
      vaultKey.key,
      buf(fromBase64(blob.ciphertext)),
    )
  } catch {
    throw new WrongPasswordError()
  }
  return normalizeVault(JSON.parse(fromUtf8(new Uint8Array(plaintext))))
}

/** Derives the key from the blob's own salt and iterations, then decrypts. */
export const unlockVault = async (
  blob: EncryptedBlob,
  password: string,
): Promise<{ vault: VaultData; vaultKey: VaultKey }> => {
  const vaultKey = await deriveKey(password, fromBase64(blob.salt), blob.iterations)
  const vault = await decryptVault(blob, vaultKey)
  return { vault, vaultKey }
}

export const sameSalt = (blob: EncryptedBlob, vaultKey: VaultKey): boolean =>
  blob.salt === toBase64(vaultKey.salt) && blob.iterations === vaultKey.iterations
