import { createEntry, emptyVault, serializePlain, today } from './lib/vault'

// Sample content for demo mode. Every secret here is a published test vector
// (anyone can sweep funds sent to them), never a real key.
export const demoNoteText = (): string => {
  const vault = emptyVault()
  vault.entries.push(
    createEntry('mnemonic', {
      label: 'Example: hardware wallet',
      description: 'Public BIP39 test vector. Do not send funds to it.',
      chain: 'Bitcoin',
      wallet: 'Example device',
      tags: ['example'],
      favorite: true,
      words: 'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' '),
      passphraseHint: 'Example hint only',
      derivationPath: "m/84'/0'/0'",
      backups: [{ id: 'b1', location: 'Steel plate in home safe', verifiedOn: today() }],
    }),
    createEntry('privateKey', {
      label: 'Example: paper wallet',
      description: 'WIF test vector from the Bitcoin wiki.',
      chain: 'Bitcoin',
      tags: ['example'],
      privateKey: '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ',
      createdOn: '2013-04-01',
    }),
    createEntry('other', {
      label: 'Example: exchange 2FA backup codes',
      tags: ['example'],
      customFields: [
        { id: 'f1', label: 'Backup codes', value: '1234-5678 9012-3456', hidden: true },
        { id: 'f2', label: 'Account email', value: 'you@example.com', hidden: false },
      ],
    }),
  )
  return serializePlain(vault)
}
