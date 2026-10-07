import type { MnemonicScheme } from './mnemonic'
import { newId } from './encoding'

// The note text is a JSON document in one of two shapes:
//   plain:     { app, version, vault: VaultData }
//   encrypted: { app, version, encryption: EncryptedBlob }  (see vaultCrypto.ts)

export const APP_ID = 'sn-crypto-vault'
export const FORMAT_VERSION = 1
export const README_NOTE =
  'Managed by the Crypto Vault editor for Standard Notes (https://github.com/nickstruglia/sn-crypto). ' +
  'Edit this note with that editor so the JSON stays valid.'

export type EntryKind = 'mnemonic' | 'privateKey' | 'other'

export interface CustomField {
  id: string
  label: string
  value: string
  hidden: boolean
}

export interface BackupLocation {
  id: string
  location: string
  /** YYYY-MM-DD of the last time this backup was checked. */
  verifiedOn: string
}

export interface Entry {
  id: string
  kind: EntryKind
  label: string
  description: string
  chain: string
  wallet: string
  /** YYYY-MM-DD the wallet or key was created. */
  createdOn: string
  tags: string[]
  favorite: boolean
  archived: boolean

  scheme: MnemonicScheme
  words: string[]
  passphrase: string
  passphraseHint: string

  privateKey: string

  derivationPath: string
  fingerprint: string
  publicInfo: string

  backups: BackupLocation[]
  customFields: CustomField[]
  notes: string

  /** ISO timestamps maintained automatically. */
  addedAt: string
  updatedAt: string
}

export interface VaultSettings {
  /** Seconds before a revealed secret hides itself again. 0 = never. */
  autoHideSeconds: number
  /** Seconds before a copied secret is wiped from the clipboard. 0 = never. */
  clipboardClearSeconds: number
  /** Hide revealed secrets as soon as the editor loses focus. */
  hideOnBlur: boolean
  /** Blur the whole editor while it is not focused. */
  privacyScreen: boolean
  /** Minutes of inactivity before a password-protected vault locks. 0 = never. */
  autoLockMinutes: number
  /** Flag entries whose backups were not checked within this many months. 0 = off. */
  backupReminderMonths: number
  /** Expandable cards, or a list beside an editor. */
  layout: Layout
  density: Density
  /** In the card layout, opening an entry closes the others. */
  singleExpand: boolean
  groupBy: GroupBy
  sort: SortOrder
}

export type Layout = 'stacked' | 'split'
export type Density = 'comfortable' | 'compact'
export type GroupBy = 'none' | 'kind' | 'chain' | 'wallet' | 'tag'
export type SortOrder = 'updated' | 'label' | 'created'

export interface VaultData {
  entries: Entry[]
  settings: VaultSettings
}

export const DEFAULT_SETTINGS: VaultSettings = {
  autoHideSeconds: 30,
  clipboardClearSeconds: 30,
  hideOnBlur: true,
  privacyScreen: false,
  autoLockMinutes: 5,
  backupReminderMonths: 12,
  layout: 'stacked',
  density: 'comfortable',
  singleExpand: false,
  groupBy: 'none',
  sort: 'updated',
}

export const today = (): string => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const emptyVault = (): VaultData => ({ entries: [], settings: { ...DEFAULT_SETTINGS } })

export const createEntry = (kind: EntryKind, overrides: Partial<Entry> = {}): Entry => {
  const now = new Date().toISOString()
  return {
    id: newId(),
    kind,
    label: '',
    description: '',
    chain: '',
    wallet: '',
    createdOn: today(),
    tags: [],
    favorite: false,
    archived: false,
    scheme: 'bip39',
    words: kind === 'mnemonic' ? new Array(12).fill('') : [],
    passphrase: '',
    passphraseHint: '',
    privateKey: '',
    derivationPath: '',
    fingerprint: '',
    publicInfo: '',
    backups: [],
    customFields: [],
    notes: '',
    addedAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback)
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const KINDS: EntryKind[] = ['mnemonic', 'privateKey', 'other']
const SCHEME_IDS: MnemonicScheme[] = ['bip39', 'electrum', 'aezeed', 'slip39', 'monero', 'other']

/** Fills defaults and drops wrong types, keeping unknown keys for forward compatibility. */
export const normalizeEntry = (raw: unknown): Entry => {
  const o = obj(raw)
  const base = createEntry('other')
  return {
    ...o,
    id: str(o.id) || base.id,
    kind: KINDS.includes(o.kind as EntryKind) ? (o.kind as EntryKind) : 'other',
    label: str(o.label),
    description: str(o.description),
    chain: str(o.chain),
    wallet: str(o.wallet),
    createdOn: str(o.createdOn),
    tags: arr(o.tags).filter((t): t is string => typeof t === 'string'),
    favorite: bool(o.favorite),
    archived: bool(o.archived),
    scheme: SCHEME_IDS.includes(o.scheme as MnemonicScheme) ? (o.scheme as MnemonicScheme) : 'bip39',
    words: arr(o.words).map((w) => str(w)),
    passphrase: str(o.passphrase),
    passphraseHint: str(o.passphraseHint),
    privateKey: str(o.privateKey),
    derivationPath: str(o.derivationPath),
    fingerprint: str(o.fingerprint),
    publicInfo: str(o.publicInfo),
    backups: arr(o.backups).map((b) => {
      const bo = obj(b)
      return { ...bo, id: str(bo.id) || newId(), location: str(bo.location), verifiedOn: str(bo.verifiedOn) }
    }),
    customFields: arr(o.customFields).map((f) => {
      const fo = obj(f)
      return {
        ...fo,
        id: str(fo.id) || newId(),
        label: str(fo.label),
        value: str(fo.value),
        hidden: bool(fo.hidden, true),
      }
    }),
    notes: str(o.notes),
    addedAt: str(o.addedAt) || base.addedAt,
    updatedAt: str(o.updatedAt) || base.updatedAt,
  }
}

export const normalizeVault = (raw: unknown): VaultData => {
  const o = obj(raw)
  const s = obj(o.settings)
  return {
    ...o,
    entries: arr(o.entries).map(normalizeEntry),
    settings: {
      ...s,
      autoHideSeconds: num(s.autoHideSeconds, DEFAULT_SETTINGS.autoHideSeconds),
      clipboardClearSeconds: num(s.clipboardClearSeconds, DEFAULT_SETTINGS.clipboardClearSeconds),
      hideOnBlur: bool(s.hideOnBlur, DEFAULT_SETTINGS.hideOnBlur),
      privacyScreen: bool(s.privacyScreen, DEFAULT_SETTINGS.privacyScreen),
      autoLockMinutes: num(s.autoLockMinutes, DEFAULT_SETTINGS.autoLockMinutes),
      backupReminderMonths: num(s.backupReminderMonths, DEFAULT_SETTINGS.backupReminderMonths),
      layout: oneOf(s.layout, ['stacked', 'split'], DEFAULT_SETTINGS.layout),
      density: oneOf(s.density, ['comfortable', 'compact'], DEFAULT_SETTINGS.density),
      singleExpand: bool(s.singleExpand, DEFAULT_SETTINGS.singleExpand),
      groupBy: oneOf(s.groupBy, ['none', 'kind', 'chain', 'wallet', 'tag'], DEFAULT_SETTINGS.groupBy),
      sort: oneOf(s.sort, ['updated', 'label', 'created'], DEFAULT_SETTINGS.sort),
    },
  }
}

export interface EncryptedBlob {
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  cipher: 'AES-256-GCM'
  iv: string
  ciphertext: string
}

export type ParsedNote =
  | { kind: 'empty' }
  | { kind: 'plain'; vault: VaultData }
  | { kind: 'encrypted'; blob: EncryptedBlob }
  | { kind: 'newer'; version: number }
  | { kind: 'foreign'; text: string }

const isBlob = (v: unknown): v is EncryptedBlob => {
  const o = obj(v)
  return (
    o.kdf === 'PBKDF2-SHA256' &&
    o.cipher === 'AES-256-GCM' &&
    typeof o.iterations === 'number' &&
    typeof o.salt === 'string' &&
    typeof o.iv === 'string' &&
    typeof o.ciphertext === 'string'
  )
}

/** Classifies the note text. Never throws; unknown text is reported as foreign. */
export const parseNote = (text: string | undefined | null): ParsedNote => {
  if (!text || !text.trim()) return { kind: 'empty' }
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return { kind: 'foreign', text }
  }
  const o = obj(doc)
  if (o.app !== APP_ID) return { kind: 'foreign', text }
  const version = typeof o.version === 'number' ? o.version : 0
  if (version > FORMAT_VERSION) return { kind: 'newer', version }
  if (o.encryption !== undefined) {
    return isBlob(o.encryption) ? { kind: 'encrypted', blob: o.encryption } : { kind: 'foreign', text }
  }
  return { kind: 'plain', vault: normalizeVault(o.vault) }
}

export const serializePlain = (vault: VaultData): string =>
  JSON.stringify({ app: APP_ID, version: FORMAT_VERSION, readme: README_NOTE, vault }, null, 1)

export const serializeEncrypted = (blob: EncryptedBlob): string =>
  JSON.stringify({ app: APP_ID, version: FORMAT_VERSION, readme: README_NOTE, encryption: blob }, null, 1)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Note-list preview. Never includes labels or secret material. */
export const previewText = (vault: VaultData | null): string => {
  if (!vault) return 'Crypto Vault (password protected)'
  const active = vault.entries.filter((e) => !e.archived)
  const seeds = active.filter((e) => e.kind === 'mnemonic').length
  const keys = active.filter((e) => e.kind === 'privateKey').length
  const other = active.length - seeds - keys
  const parts = [
    seeds && plural(seeds, 'seed phrase', 'seed phrases'),
    keys && plural(keys, 'private key', 'private keys'),
    other && plural(other, 'other secret', 'other secrets'),
  ].filter(Boolean)
  return `Crypto Vault: ${parts.length ? parts.join(', ') : 'empty'}`
}

/** Most recent backup check for an entry, or '' when none was recorded. */
export const lastVerified = (entry: Entry): string =>
  entry.backups.map((b) => b.verifiedOn).filter(Boolean).sort().at(-1) ?? ''

export const isBackupDue = (entry: Entry, months: number, now = new Date()): boolean => {
  if (months <= 0 || entry.archived) return false
  const last = lastVerified(entry)
  if (!last) return true
  const due = new Date(`${last}T00:00:00`)
  due.setMonth(due.getMonth() + months)
  return due.getTime() <= now.getTime()
}
