// What each type of entry holds, and how it is labeled. Crypto comes first:
// seed phrases and wallet keys are the main use, other keys are supported too.

export type EntryKind =
  | 'mnemonic'
  | 'privateKey'
  | 'sshKey'
  | 'pgpKey'
  | 'apiKey'
  | 'genericKey'
  | 'recoveryCodes'
  | 'other'

export type KindGroup = 'crypto' | 'keys' | 'secrets'

export interface KindInfo {
  label: string
  /** Lower-case counts for the note preview: "1 seed phrase", "2 seed phrases". */
  one: string
  plural: string
  group: KindGroup
  /** Main secret: a word grid, a key (one or more lines), a single-line token, codes, or only custom fields. */
  secret: 'words' | 'key' | 'token' | 'codes' | 'fields'
  /** Section title and field label for the main secret. */
  secretLabel: string
  secretPlaceholder?: string
  passphraseLabel?: string
  passphraseHint?: string
  /** Public half shown in "Public info". Crypto entries show addresses, xpub and derivation path instead. */
  publicKey?: { label: string; placeholder: string; fingerprintLabel: string; fingerprintPlaceholder: string }
  /** Labels for the "where" and "who" detail fields. Crypto entries use chain and wallet. */
  serviceLabel: string
  accountLabel: string
  expires: boolean
  backupReminders: boolean
}

export const KINDS: EntryKind[] = ['mnemonic', 'privateKey', 'sshKey', 'pgpKey', 'apiKey', 'genericKey', 'recoveryCodes', 'other']

export const KIND_INFO: Record<EntryKind, KindInfo> = {
  mnemonic: {
    label: 'Seed phrase',
    one: 'seed phrase',
    plural: 'seed phrases',
    group: 'crypto',
    secret: 'words',
    secretLabel: 'Seed phrase',
    passphraseLabel: 'Passphrase (25th word)',
    passphraseHint: 'Optional BIP39 passphrase. A different passphrase opens a different wallet.',
    serviceLabel: 'Chain / coin',
    accountLabel: 'Wallet / device',
    expires: false,
    backupReminders: true,
  },
  privateKey: {
    label: 'Wallet key',
    one: 'wallet key',
    plural: 'wallet keys',
    group: 'crypto',
    secret: 'key',
    secretLabel: 'Private key',
    secretPlaceholder: 'Hex, WIF, xprv, nsec, base58, keystore JSON…',
    passphraseLabel: 'Keystore password',
    passphraseHint: 'Only for encrypted keystores (e.g. Ethereum JSON keystores).',
    serviceLabel: 'Chain / coin',
    accountLabel: 'Wallet / device',
    expires: false,
    backupReminders: true,
  },
  sshKey: {
    label: 'SSH key',
    one: 'SSH key',
    plural: 'SSH keys',
    group: 'keys',
    secret: 'key',
    secretLabel: 'Private key',
    secretPlaceholder: '-----BEGIN OPENSSH PRIVATE KEY-----',
    passphraseLabel: 'Key passphrase',
    passphraseHint: 'The passphrase that unlocks the key file, if it has one.',
    publicKey: {
      label: 'Public key',
      placeholder: 'ssh-ed25519 AAAA… user@host',
      fingerprintLabel: 'Fingerprint',
      fingerprintPlaceholder: 'SHA256:…',
    },
    serviceLabel: 'Hosts / service',
    accountLabel: 'User / account',
    expires: true,
    backupReminders: false,
  },
  pgpKey: {
    label: 'PGP key',
    one: 'PGP key',
    plural: 'PGP keys',
    group: 'keys',
    secret: 'key',
    secretLabel: 'Private key',
    secretPlaceholder: '-----BEGIN PGP PRIVATE KEY BLOCK-----',
    passphraseLabel: 'Key passphrase',
    passphraseHint: 'The passphrase that protects the secret key.',
    publicKey: {
      label: 'Public key',
      placeholder: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
      fingerprintLabel: 'Fingerprint',
      fingerprintPlaceholder: '40 hex characters',
    },
    serviceLabel: 'Used for',
    accountLabel: 'User ID / email',
    expires: true,
    backupReminders: true,
  },
  apiKey: {
    label: 'API key or token',
    one: 'API key',
    plural: 'API keys',
    group: 'keys',
    secret: 'token',
    secretLabel: 'Key or token',
    secretPlaceholder: 'Paste the key or token',
    serviceLabel: 'Service',
    accountLabel: 'Account / project',
    expires: true,
    backupReminders: false,
  },
  genericKey: {
    label: 'Other key',
    one: 'other key',
    plural: 'other keys',
    group: 'keys',
    secret: 'key',
    secretLabel: 'Secret key',
    secretPlaceholder: 'age, WireGuard, PEM, JSON Web Key, Nostr…',
    passphraseLabel: 'Passphrase',
    passphraseHint: 'If the key is encrypted.',
    publicKey: {
      label: 'Public key',
      placeholder: 'Public key or recipient',
      fingerprintLabel: 'Fingerprint / key ID',
      fingerprintPlaceholder: 'Optional',
    },
    serviceLabel: 'Used for',
    accountLabel: 'Account / owner',
    expires: true,
    backupReminders: false,
  },
  recoveryCodes: {
    label: 'Recovery codes',
    one: 'set of recovery codes',
    plural: 'sets of recovery codes',
    group: 'secrets',
    secret: 'codes',
    secretLabel: 'Recovery codes',
    secretPlaceholder: 'One code per line',
    serviceLabel: 'Service',
    accountLabel: 'Account',
    expires: false,
    backupReminders: true,
  },
  other: {
    label: 'Other secret',
    one: 'other secret',
    plural: 'other secrets',
    group: 'secrets',
    secret: 'fields',
    secretLabel: 'Fields',
    serviceLabel: 'Service',
    accountLabel: 'Account',
    expires: false,
    backupReminders: false,
  },
}

export const GROUP_LABELS: Record<KindGroup, string> = {
  crypto: 'Crypto',
  keys: 'Keys',
  secrets: 'Secrets',
}

export const isCrypto = (kind: EntryKind): boolean => KIND_INFO[kind].group === 'crypto'
