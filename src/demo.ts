import { createEntry, emptyVault, serializePlain, today } from './lib/vault'
import { randomBytes, toBase64, utf8 } from './lib/encoding'

// Sample content for demo mode. Crypto secrets are published test vectors
// (anyone can sweep funds sent to them). Other keys are random bytes in the
// right shape, generated when the page loads; none of them is a usable key.
const words = (phrase: string) => phrase.split(' ')

const sshString = (bytes: Uint8Array) => {
  const out = new Uint8Array(4 + bytes.length)
  new DataView(out.buffer).setUint32(0, bytes.length)
  out.set(bytes, 4)
  return out
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/** An openssh-key-v1 file with the right structure but random key bytes. */
const sampleSshKey = () => {
  const publicBlob = concat(sshString(utf8('ssh-ed25519')), sshString(randomBytes(32)))
  const file = concat(
    utf8('openssh-key-v1\0'),
    sshString(utf8('aes256-ctr')),
    sshString(utf8('bcrypt')),
    sshString(randomBytes(24)),
    new Uint8Array([0, 0, 0, 1]),
    sshString(publicBlob),
    sshString(randomBytes(144)),
  )
  const body = toBase64(file).match(/.{1,70}/g)!.join('\n')
  return {
    privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----`,
    publicKey: `ssh-ed25519 ${toBase64(publicBlob)} demo@example`,
  }
}

const randomChars = (n: number, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') =>
  Array.from(randomBytes(n), (b) => alphabet[b % alphabet.length]).join('')

const inDays = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export const demoNoteText = (): string => {
  const ssh = sampleSshKey()
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
    createEntry('privateKey', {
      label: 'Example: paper wallet',
      description: 'WIF test vector from the Bitcoin wiki.',
      chain: 'Bitcoin',
      tags: ['example'],
      secret: '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ',
      createdOn: '2013-04-01',
    }),
    createEntry('sshKey', {
      label: 'Example: deploy key',
      description: 'Random bytes in OpenSSH format, not a working key.',
      service: 'github.com',
      account: 'git',
      tags: ['example'],
      secret: ssh.privateKey,
      passphrase: 'example passphrase',
      publicInfo: ssh.publicKey,
      expiresOn: inDays(365),
    }),
    createEntry('apiKey', {
      label: 'Example: CI token',
      description: 'Random characters in GitHub token format, not a real token.',
      service: 'GitHub',
      account: 'release workflow',
      tags: ['example'],
      secret: `ghp_${randomChars(36)}`,
      expiresOn: inDays(12),
    }),
    createEntry('recoveryCodes', {
      label: 'Example: exchange 2FA backup codes',
      service: 'Kraken',
      account: 'you@example.com',
      tags: ['example'],
      secret: Array.from({ length: 8 }, () => `${randomChars(4, '0123456789')}-${randomChars(4, '0123456789')}`).join('\n'),
    }),
  )
  // Newest first in "recently updated" order, crypto at the top.
  vault.entries.forEach((entry, i) => (entry.updatedAt = new Date(Date.now() - i * 60_000).toISOString()))
  return serializePlain(vault)
}
