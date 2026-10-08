import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  APP_ID,
  createEntry,
  emptyVault,
  isBackupDue,
  parseNote,
  previewText,
  serializeEncrypted,
  serializePlain,
} from '../src/lib/vault'
import { DamagedVaultError, WrongPasswordError, decryptVault, deriveKey, encryptVault, unlockVault } from '../src/lib/vaultCrypto'

const sampleVault = () => {
  const vault = emptyVault()
  vault.entries.push(
    createEntry('mnemonic', { label: 'Cold storage', words: ['abandon', 'ability'], passphrase: 'p' }),
    createEntry('privateKey', { label: 'Hot key', secret: 'deadbeef' }),
    createEntry('other', { label: 'Old', archived: true }),
  )
  return vault
}

describe('parseNote', () => {
  it('classifies empty, foreign, plain and newer notes', () => {
    expect(parseNote('').kind).toBe('empty')
    expect(parseNote('   ').kind).toBe('empty')
    expect(parseNote('my old shopping list')).toEqual({ kind: 'foreign', text: 'my old shopping list' })
    expect(parseNote('{"some":"json"}').kind).toBe('foreign')
    expect(parseNote(JSON.stringify({ app: APP_ID, version: 99 }))).toEqual({ kind: 'newer', version: 99 })

    const vault = sampleVault()
    const parsed = parseNote(serializePlain(vault))
    expect(parsed.kind).toBe('plain')
    if (parsed.kind === 'plain') expect(parsed.vault).toEqual(vault)
  })

  it('fills in missing fields and keeps unknown ones', () => {
    const text = JSON.stringify({
      app: APP_ID,
      version: 1,
      vault: { entries: [{ id: 'a', kind: 'mnemonic', label: 'x', futureField: 42 }], settings: { autoHideSeconds: 5 } },
    })
    const parsed = parseNote(text)
    if (parsed.kind !== 'plain') throw new Error('expected plain')
    const entry = parsed.vault.entries[0] as unknown as Record<string, unknown>
    expect(entry.futureField).toBe(42)
    expect(parsed.vault.entries[0].words).toEqual([])
    expect(parsed.vault.settings.autoHideSeconds).toBe(5)
    expect(parsed.vault.settings.clipboardClearSeconds).toBe(30)
  })
})

describe('previewText', () => {
  it('summarizes counts without leaking labels or secrets', () => {
    const preview = previewText(sampleVault())
    expect(preview).toBe('Keyfold: 1 seed phrase, 1 wallet key')
    expect(preview).not.toContain('Cold')
    expect(previewText(null)).toBe('Keyfold (password protected)')
    expect(previewText(emptyVault())).toBe('Keyfold: empty')
  })
})

describe('vault encryption', () => {
  it('round-trips and never stores plaintext', async () => {
    const vault = sampleVault()
    const key = await deriveKey('correct horse battery staple', undefined, 1000)
    const blob = await encryptVault(vault, key)
    const text = serializeEncrypted(blob)
    expect(text).not.toContain('abandon')
    expect(text).not.toContain('Cold storage')

    const parsed = parseNote(text)
    if (parsed.kind !== 'encrypted') throw new Error('expected encrypted')
    const { vault: back } = await unlockVault(parsed.blob, 'correct horse battery staple')
    expect(back).toEqual(vault)
  })

  it('uses a fresh IV for every save', async () => {
    const key = await deriveKey('pw', undefined, 1000)
    const a = await encryptVault(emptyVault(), key)
    const b = await encryptVault(emptyVault(), key)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('rejects a wrong password and tampered parameters', async () => {
    const key = await deriveKey('right', undefined, 1000)
    const blob = await encryptVault(sampleVault(), key)
    await expect(unlockVault(blob, 'wrong')).rejects.toBeInstanceOf(WrongPasswordError)
    await expect(decryptVault({ ...blob, iterations: 1001 }, key)).rejects.toBeInstanceOf(WrongPasswordError)
  })
})

describe('isBackupDue', () => {
  const now = new Date('2026-10-07T12:00:00')
  it('is due when never verified or verified too long ago', () => {
    const entry = createEntry('mnemonic')
    expect(isBackupDue(entry, 12, now)).toBe(true)
    entry.backups = [{ id: '1', location: 'Safe', verifiedOn: '2025-09-01' }]
    expect(isBackupDue(entry, 12, now)).toBe(true)
    entry.backups.push({ id: '2', location: 'Bank', verifiedOn: '2026-03-01' })
    expect(isBackupDue(entry, 12, now)).toBe(false)
    expect(isBackupDue(entry, 6, now)).toBe(true)
    expect(isBackupDue(entry, 0, now)).toBe(false)
  })
})

describe('stored format', () => {
  it('decrypts a vault saved by format version 1 (known answer)', async () => {
    // Checked in so that a change to the key derivation or the associated
    // data can never silently lock users out of existing vaults.
    const blob = JSON.parse(readFileSync(new URL('./fixtures/known-answer-v1.json', import.meta.url), 'utf8'))
    const { vault } = await unlockVault(blob, 'correct horse battery staple')
    expect(vault.entries[0].label).toBe('Known answer')
    expect(vault.entries[0].words.join(' ')).toBe('legal winner thank year wave sausage worth useful legal winner thank yellow')
  })

  it('reports an encryption block it cannot read as unsupported, not foreign', () => {
    const text = JSON.stringify({ app: APP_ID, version: 1, encryption: { kdf: 'scrypt', iterations: 1 } })
    expect(parseNote(text).kind).toBe('unsupported')
  })

  it('reports damaged base64 as damaged data, not a wrong password', async () => {
    const blob = JSON.parse(readFileSync(new URL('./fixtures/known-answer-v1.json', import.meta.url), 'utf8'))
    await expect(unlockVault({ ...blob, salt: '%%%' }, 'x')).rejects.toBeInstanceOf(DamagedVaultError)
  })

  it('keeps line breaks in custom fields and marks them multi-line', () => {
    const text = JSON.stringify({
      app: APP_ID,
      version: 1,
      vault: { entries: [{ id: 'a', kind: 'other', customFields: [{ id: 'f', label: 'x', value: 'line 1\nline 2' }] }] },
    })
    const parsed = parseNote(text)
    expect(parsed.kind === 'plain' && parsed.vault.entries[0].customFields[0]).toMatchObject({ value: 'line 1\nline 2', multiline: true })
  })
})
