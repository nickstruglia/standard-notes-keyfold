import { describe, expect, it } from 'vitest'
import { KINDS, KIND_INFO, isCrypto } from '../src/lib/kinds'
import { createEntry, daysUntilExpiry, emptyVault, isBackupDue, isExpiringSoon, normalizeEntry, previewText } from '../src/lib/vault'
import { visibleEntries } from '../src/ui/EntryList'

describe('entry kinds', () => {
  it('lists crypto first', () => {
    expect(KINDS.slice(0, 2)).toEqual(['mnemonic', 'privateKey'])
    expect(KINDS.filter(isCrypto)).toEqual(['mnemonic', 'privateKey'])
  })

  it('keeps every kind when normalizing and falls back to "other" for unknown ones', () => {
    for (const kind of KINDS) expect(normalizeEntry({ kind }).kind).toBe(kind)
    expect(normalizeEntry({ kind: 'nonsense' }).kind).toBe('other')
  })

  it('counts each kind in the note preview', () => {
    const vault = emptyVault()
    vault.entries = KINDS.map((kind) => createEntry(kind))
    expect(previewText(vault)).toBe(
      'Keyfold: 1 seed phrase, 1 wallet key, 1 SSH key, 1 PGP key, 1 API key, 1 other key, 1 set of recovery codes, 1 other secret',
    )
    vault.entries.push(createEntry('sshKey'))
    expect(previewText(vault)).toContain('2 SSH keys')
  })

  it('only nags about backups where offline backups matter', () => {
    const due = KINDS.filter((kind) => isBackupDue(createEntry(kind), 12))
    expect(due).toEqual(KINDS.filter((kind) => KIND_INFO[kind].backupReminders))
    expect(due).toContain('mnemonic')
    expect(due).not.toContain('apiKey')
  })
})

describe('expiry', () => {
  const now = new Date('2026-10-08T15:00:00')
  it('counts days to expiry for kinds that expire', () => {
    expect(daysUntilExpiry(createEntry('apiKey', { expiresOn: '2026-10-20' }), now)).toBe(12)
    expect(daysUntilExpiry(createEntry('sshKey', { expiresOn: '2026-10-01' }), now)).toBe(-7)
    expect(daysUntilExpiry(createEntry('mnemonic', { expiresOn: '2026-10-20' }), now)).toBeNull()
    expect(daysUntilExpiry(createEntry('apiKey'), now)).toBeNull()
  })

  it('flags keys within 30 days or past expiry, and filters them', () => {
    const soon = createEntry('apiKey', { label: 'soon', expiresOn: '2026-10-20' })
    const later = createEntry('apiKey', { label: 'later', expiresOn: '2027-06-01' })
    const past = createEntry('pgpKey', { label: 'past', expiresOn: '2026-01-01' })
    expect(isExpiringSoon(soon, now)).toBe(true)
    expect(isExpiringSoon(later, now)).toBe(false)
    expect(isExpiringSoon(past, now)).toBe(true)
    const shown = visibleEntries([soon, later, past], 'expiring', 'label', '', 0).map((e) => e.label)
    expect(shown.sort()).toEqual(['past', 'soon'])
  })

  it('filters crypto entries together', () => {
    const list = [createEntry('mnemonic', { label: 'a' }), createEntry('privateKey', { label: 'b' }), createEntry('sshKey', { label: 'c' })]
    expect(visibleEntries(list, 'crypto', 'label', '', 0).map((e) => e.label)).toEqual(['a', 'b'])
  })
})
