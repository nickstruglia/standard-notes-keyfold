import type { EntryKind, GroupBy } from '../lib/vault'

export const KIND_LABELS: Record<EntryKind, string> = {
  mnemonic: 'Seed phrase',
  privateKey: 'Private key',
  other: 'Other secret',
}

export const KIND_GROUP_LABELS: Record<EntryKind, string> = {
  mnemonic: 'Seed phrases',
  privateKey: 'Private keys',
  other: 'Other secrets',
}

export const GROUP_OPTIONS: [GroupBy, string][] = [
  ['none', 'No grouping'],
  ['kind', 'Type'],
  ['chain', 'Chain / coin'],
  ['wallet', 'Wallet / device'],
  ['tag', 'First tag'],
]
