import { createEntry, emptyVault, serializePlain, today } from './lib/vault'

// Sample content for demo mode. Every secret here is a published test vector
// (anyone can sweep funds sent to them), never a real key.
const words = (phrase: string) => phrase.split(' ')

export const demoNoteText = (): string => {
  const vault = emptyVault()
  vault.entries.push(
    createEntry('mnemonic', {
      label: 'Example: cold storage',
      description: 'Public BIP39 test vector. Do not send funds to it.',
      chain: 'Bitcoin',
      wallet: 'Coldcard',
      tags: ['example', 'long-term'],
      favorite: true,
      words: words('legal winner thank year wave sausage worth useful legal winner thank yellow'),
      passphrase: 'example passphrase',
      passphraseHint: 'Example hint only',
      derivationPath: "m/84'/0'/0'",
      createdOn: '2021-03-14',
      backups: [{ id: 'b1', location: 'Steel plate in home safe', verifiedOn: today() }],
    }),
    createEntry('mnemonic', {
      label: 'Example: multisig key 2 of 3',
      chain: 'Bitcoin',
      wallet: 'Trezor',
      tags: ['example', 'multisig'],
      words: words('letter advice cage absurd amount doctor acoustic avoid letter advice cage above'),
      derivationPath: "m/48'/0'/0'/2'",
      createdOn: '2022-08-02',
      backups: [{ id: 'b2', location: 'Bank deposit box', verifiedOn: '2025-01-10' }],
    }),
    createEntry('mnemonic', {
      label: 'Example: DeFi hot wallet',
      chain: 'Ethereum',
      wallet: 'MetaMask',
      tags: ['example'],
      words: words(`${'abandon '.repeat(23)}art`),
      derivationPath: "m/44'/60'/0'/0/0",
      createdOn: '2023-11-20',
    }),
    createEntry('mnemonic', {
      label: 'Example: NFT wallet',
      chain: 'Solana',
      wallet: 'Phantom',
      tags: ['example'],
      words: words('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'),
      createdOn: '2024-05-06',
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
