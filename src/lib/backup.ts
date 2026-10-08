import { APP_ID, FORMAT_VERSION, type VaultData, encryptionReadme, today } from './vault'
import { DEFAULT_ITERATIONS, deriveKey, encryptVault } from './vaultCrypto'

// An encrypted backup file has the same shape as an encrypted note, plus the
// time it was made, so everything that opens a note opens a backup too: the
// editor (paste it into a note), the recovery viewer and the readme's recipe.

export const VIEWER_FILE = 'keyfold-viewer.html'

export const README_BACKUP =
  'Encrypted backup of a Keyfold vault (https://github.com/nickstruglia/standard-notes-keyfold). ' +
  `To read it without Standard Notes, open ${VIEWER_FILE} (keep a copy next to this file; it is also at ${__SITE_URL__}${VIEWER_FILE}) ` +
  'in a browser and choose this file; it works offline. To restore it, paste the whole text of this file into a new ' +
  'Standard Notes note, change the note type to Keyfold and unlock it with the backup password. ' +
  encryptionReadme('the password chosen when the backup was made')

export interface Backup {
  text: string
  fileName: string
  exportedAt: string
  entries: number
}

export const backupFileName = (date = today()): string => `keyfold-backup-${date}.json`

/** Encrypts a copy of the vault with its own password (new salt, full iteration count). */
export const createBackup = async (vault: VaultData, password: string, iterations = DEFAULT_ITERATIONS): Promise<Backup> => {
  const exportedAt = new Date().toISOString()
  // The copy records its own export, so a restored vault knows how old it is.
  const copy: VaultData = { ...vault, settings: { ...vault.settings, lastExportedAt: exportedAt } }
  const encryption = await encryptVault(copy, await deriveKey(password, undefined, iterations))
  const text = JSON.stringify({ app: APP_ID, version: FORMAT_VERSION, readme: README_BACKUP, exportedAt, encryption }, null, 1) + '\n'
  return { text, fileName: backupFileName(), exportedAt, entries: vault.entries.length }
}

/** Entries added or edited after the last backup (deleted ones cannot be counted). */
export const changedSinceBackup = (vault: VaultData): number => {
  const since = vault.settings.lastExportedAt
  if (!since) return vault.entries.length
  return vault.entries.filter((e) => e.updatedAt > since || e.addedAt > since).length
}
