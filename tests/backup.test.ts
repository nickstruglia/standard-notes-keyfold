import { describe, expect, it } from 'vitest'
import { README_BACKUP, VIEWER_FILE, backupFileName, changedSinceBackup, createBackup } from '../src/lib/backup'
import { createEntry, emptyVault, normalizeVault, parseNote, serializePlain } from '../src/lib/vault'
import { DEFAULT_ITERATIONS, WrongPasswordError, unlockVault } from '../src/lib/vaultCrypto'

const sampleVault = () => {
  const vault = emptyVault()
  vault.entries.push(
    createEntry('mnemonic', { label: 'Cold storage', words: ['abandon', 'ability'], passphrase: 'p' }),
    createEntry('sshKey', { label: 'Server', secret: '-----BEGIN OPENSSH PRIVATE KEY-----' }),
  )
  return vault
}

describe('createBackup', () => {
  it('makes a file every note reader opens, encrypted with its own password', async () => {
    const vault = sampleVault()
    const backup = await createBackup(vault, 'backup password 1', 1000)
    expect(backup.entries).toBe(2)
    expect(backup.fileName).toMatch(/^keyfold-backup-\d{4}-\d{2}-\d{2}\.json$/)

    // Nothing readable in the file but the readme.
    expect(backup.text).not.toContain('Cold storage')
    expect(backup.text).not.toContain('abandon')
    expect(backup.text).not.toContain('OPENSSH')
    const doc = JSON.parse(backup.text)
    expect(doc.readme).toBe(README_BACKUP)
    expect(doc.exportedAt).toBe(backup.exportedAt)

    const parsed = parseNote(backup.text)
    expect(parsed.kind).toBe('encrypted')
    if (parsed.kind !== 'encrypted') return
    await expect(unlockVault(parsed.blob, 'wrong password')).rejects.toBeInstanceOf(WrongPasswordError)
    const { vault: opened } = await unlockVault(parsed.blob, 'backup password 1')
    expect(opened.entries).toEqual(vault.entries)
    // The copy records its own export; the vault itself is left alone.
    expect(opened.settings.lastExportedAt).toBe(backup.exportedAt)
    expect(vault.settings.lastExportedAt).toBe('')
  })

  it('uses the full iteration count and a fresh salt every time', async () => {
    const vault = sampleVault()
    const [a, b] = await Promise.all([createBackup(vault, 'same password'), createBackup(vault, 'same password')])
    const blobA = JSON.parse(a.text).encryption
    const blobB = JSON.parse(b.text).encryption
    expect(blobA.iterations).toBe(DEFAULT_ITERATIONS)
    expect(blobA.salt).not.toBe(blobB.salt)
    expect(blobA.iv).not.toBe(blobB.iv)
  })

  it('tells whoever finds the file how to open and restore it', () => {
    expect(README_BACKUP).toContain(VIEWER_FILE)
    expect(README_BACKUP).toContain('PBKDF2-SHA256')
    expect(README_BACKUP).toContain('change the note type to Keyfold')
    expect(backupFileName('2026-01-02')).toBe('keyfold-backup-2026-01-02.json')
  })
})

describe('changedSinceBackup', () => {
  it('counts entries added or edited after the last backup', () => {
    const vault = sampleVault()
    vault.entries[0].updatedAt = '2026-01-01T00:00:00.000Z'
    vault.entries[0].addedAt = '2026-01-01T00:00:00.000Z'
    vault.entries[1].addedAt = '2026-03-01T00:00:00.000Z'
    vault.entries[1].updatedAt = '2026-03-01T00:00:00.000Z'
    expect(changedSinceBackup(vault)).toBe(2)
    vault.settings.lastExportedAt = '2026-02-01T00:00:00.000Z'
    expect(changedSinceBackup(vault)).toBe(1)
    vault.settings.lastExportedAt = '2026-04-01T00:00:00.000Z'
    expect(changedSinceBackup(vault)).toBe(0)
  })

  it('keeps the export time through a save, and drops a wrong type', () => {
    const vault = sampleVault()
    vault.settings.lastExportedAt = '2026-02-01T00:00:00.000Z'
    const parsed = parseNote(serializePlain(vault))
    expect(parsed.kind === 'plain' && parsed.vault.settings.lastExportedAt).toBe('2026-02-01T00:00:00.000Z')
    expect(normalizeVault({ settings: { lastExportedAt: 5 } }).settings.lastExportedAt).toBe('')
  })
})
