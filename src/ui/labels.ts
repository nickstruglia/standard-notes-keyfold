import type { EntryKind, GroupBy } from '../lib/vault'
import { KIND_INFO } from '../lib/kinds'
import type { IconName } from './icons'

export const KIND_LABELS: Record<EntryKind, string> = Object.fromEntries(
  Object.entries(KIND_INFO).map(([kind, info]) => [kind, info.label]),
) as Record<EntryKind, string>

export const KIND_GROUP_LABELS: Record<EntryKind, string> = {
  mnemonic: 'Seed phrases',
  privateKey: 'Wallet keys',
  sshKey: 'SSH keys',
  pgpKey: 'PGP keys',
  apiKey: 'API keys and tokens',
  genericKey: 'Other keys',
  recoveryCodes: 'Recovery codes',
  other: 'Other secrets',
}

export const KIND_ICONS: Record<EntryKind, IconName> = {
  mnemonic: 'seed',
  privateKey: 'wallet',
  sshKey: 'terminal',
  pgpKey: 'mail',
  apiKey: 'code',
  genericKey: 'key',
  recoveryCodes: 'list',
  other: 'lock',
}

export const GROUP_OPTIONS: [GroupBy, string][] = [
  ['none', 'No grouping'],
  ['kind', 'Type'],
  ['chain', 'Chain or service'],
  ['wallet', 'Wallet or account'],
  ['tag', 'First tag'],
]

/** "Untitled seed phrase", but "Untitled SSH key": acronyms keep their capitals. */
export const untitled = (kindLabel: string) =>
  `Untitled ${/^[A-Z][A-Z]/.test(kindLabel) ? kindLabel : kindLabel.toLowerCase()}`

/** A date in the reader's language, e.g. "October 8, 2026". */
export const formatDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}
