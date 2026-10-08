import { describe, expect, it } from 'vitest'
import { bech32, createBase58check } from '@scure/base'
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'
import { base58CheckDecode, detectKeyFormat } from '../src/lib/keyformat'
import { randomBytes, toHex } from '../src/lib/encoding'

const b58c = createBase58check(nobleSha256)

describe('base58check', () => {
  it('matches @scure/base on random payloads', async () => {
    for (let i = 0; i < 50; i++) {
      const payload = randomBytes(1 + (i % 80))
      if (i % 7 === 0) payload[0] = 0
      const encoded = b58c.encode(payload)
      expect(toHex((await base58CheckDecode(encoded))!)).toBe(toHex(payload))
    }
  })
})

describe('detectKeyFormat', () => {
  const label = async (text: string) => (await detectKeyFormat(text))?.label

  it('recognizes WIF keys (Bitcoin wiki vectors)', async () => {
    expect(await label('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ')).toBe(
      'WIF private key (Bitcoin mainnet, uncompressed)',
    )
    expect(await label('KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617')).toBe(
      'WIF private key (Bitcoin mainnet, compressed)',
    )
  })

  it('catches a WIF typo', async () => {
    expect((await detectKeyFormat('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTK'))?.level).toBe('error')
  })

  it('recognizes BIP32 test vector 1 keys and flags the xpub as public', async () => {
    const xprv =
      'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'
    const xpub =
      'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'
    expect(await label(xprv)).toBe('Extended private key (xprv)')
    expect((await detectKeyFormat(xpub))?.level).toBe('warn')
  })

  it('recognizes hex keys', async () => {
    const hex = toHex(randomBytes(32))
    expect(await label(hex)).toBe('Hex, 32 bytes')
    expect(await label('0x' + hex)).toBe('Hex, 32 bytes (0x-prefixed)')
    expect((await detectKeyFormat('0x' + toHex(randomBytes(20))))?.level).toBe('warn')
  })

  it('recognizes nsec and npub with a valid checksum', async () => {
    const data = bech32.toWords(randomBytes(32))
    expect(await label(bech32.encode('nsec', data))).toBe('Nostr private key (nsec)')
    expect((await detectKeyFormat(bech32.encode('npub', data)))?.level).toBe('warn')
    const good = bech32.encode('nsec', data)
    const typo = good.slice(0, 10) + (good[10] === 'q' ? 'p' : 'q') + good.slice(11)
    expect((await detectKeyFormat(typo))?.level).toBe('error')
  })

  it('recognizes Solana-style keys', async () => {
    const { base58 } = await import('@scure/base')
    expect(await label(base58.encode(randomBytes(64)))).toBe('Base58, 64 bytes')
    expect(await label(JSON.stringify(Array.from(randomBytes(64))))).toBe('Byte array, 64 bytes')
  })

  it('recognizes an encrypted keystore and a pasted seed phrase', async () => {
    expect(await label(JSON.stringify({ version: 3, crypto: { cipher: 'aes-128-ctr' } }))).toMatch(/keystore/)
    expect((await detectKeyFormat('abandon '.repeat(12)))?.label).toMatch(/12-word seed phrase/)
  })
})

describe('Cardano bech32 keys', () => {
  it('treats *_sk and *_xsk as secret and addresses as public', async () => {
    const data = bech32.toWords(randomBytes(32))
    for (const hrp of ['addr_xsk', 'root_xsk', 'acct_xsk', 'ed25519_sk']) {
      expect((await detectKeyFormat(bech32.encode(hrp, data, 200)))?.level).toBe('ok')
    }
    for (const hrp of ['addr_xvk', 'addr', 'stake']) {
      expect((await detectKeyFormat(bech32.encode(hrp, data, 200)))?.level).toBe('warn')
    }
  })
})

// Keys below are built from random bytes at test time; none is a real key.
const sshString = (bytes: Uint8Array) => {
  const out = new Uint8Array(4 + bytes.length)
  new DataView(out.buffer).setUint32(0, bytes.length)
  out.set(bytes, 4)
  return out
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
const text = (s: string) => new TextEncoder().encode(s)
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const pem = (type: string, body: Uint8Array, headers = '') =>
  `-----BEGIN ${type}-----\n${headers}${b64(body).match(/.{1,64}/g)!.join('\n')}\n-----END ${type}-----`

const openSsh = (keyType: string, cipher: string) =>
  pem(
    'OPENSSH PRIVATE KEY',
    concat(
      text('openssh-key-v1\0'),
      sshString(text(cipher)),
      sshString(text(cipher === 'none' ? 'none' : 'bcrypt')),
      sshString(new Uint8Array(0)),
      new Uint8Array([0, 0, 0, 1]),
      sshString(concat(sshString(text(keyType)), sshString(randomBytes(32)))),
      sshString(randomBytes(64)),
    ),
  )

// Independent CRC-24 (RFC 4880 sample code) for building armored test blocks.
const crc24 = (data: Uint8Array) => {
  let crc = 0xb704ce
  for (const b of data) {
    crc ^= b << 16
    for (let i = 0; i < 8; i++) {
      crc <<= 1
      if (crc & 0x1000000) crc ^= 0x1864cfb
    }
  }
  return crc & 0xffffff
}
const armor = (type: string, data: Uint8Array, crc = crc24(data)) =>
  `-----BEGIN ${type}-----\n\n${b64(data).match(/.{1,64}/g)!.join('\n')}\n=${b64(new Uint8Array([crc >> 16, (crc >> 8) & 255, crc & 255]))}\n-----END ${type}-----`

describe('other key formats', () => {
  const label = async (t: string) => (await detectKeyFormat(t))?.label
  const result = (t: string) => detectKeyFormat(t)

  it('reads OpenSSH key type and passphrase protection', async () => {
    expect(await result(openSsh('ssh-ed25519', 'none'))).toMatchObject({
      level: 'ok',
      label: 'OpenSSH private key (Ed25519)',
      detail: 'Not passphrase-protected.',
    })
    expect(await result(openSsh('ssh-rsa', 'aes256-ctr'))).toMatchObject({
      label: 'OpenSSH private key (RSA)',
      detail: 'Protected by a passphrase.',
    })
    const truncated = openSsh('ssh-ed25519', 'none').replace(/\n[^\n]+\n-----END/, '\n-----END')
    expect((await result(truncated))?.level).toBe('error')
  })

  it('flags SSH public keys and incomplete blocks', async () => {
    const blob = concat(sshString(text('ssh-ed25519')), sshString(randomBytes(32)))
    expect((await result(`ssh-ed25519 ${b64(blob)} me@laptop`))?.level).toBe('warn')
    expect((await result('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA'))?.label).toBe('Key block is incomplete')
  })

  it('checks PGP armor checksums', async () => {
    const data = randomBytes(200)
    expect(await result(armor('PGP PRIVATE KEY BLOCK', data))).toMatchObject({ level: 'ok', detail: 'Checksum OK.' })
    expect((await result(armor('PGP PRIVATE KEY BLOCK', data, crc24(data) ^ 1)))?.level).toBe('error')
    expect((await result(armor('PGP PUBLIC KEY BLOCK', data)))?.level).toBe('warn')
    expect((await result(armor('PGP MESSAGE', data)))?.label).toBe('PGP message')
  })

  it('recognizes PEM, PuTTY and JSON key files', async () => {
    expect(await label(pem('PRIVATE KEY', randomBytes(48)))).toBe('PEM private key (PKCS#8)')
    expect(await result(pem('RSA PRIVATE KEY', randomBytes(64), 'Proc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00\n\n'))).toMatchObject({
      label: 'PEM RSA private key (PKCS#1)',
      detail: 'Protected by a passphrase.',
    })
    expect((await result(pem('CERTIFICATE', randomBytes(64))))?.level).toBe('warn')
    expect(await label('PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\nComment: x')).toBe('PuTTY private key (Ed25519)')
    expect(await label(JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: 'a', d: 'b' }))).toBe('JSON Web Key (OKP, private)')
    expect((await result(JSON.stringify({ kty: 'EC', x: 'a', y: 'b' })))?.level).toBe('warn')
    expect(await label(JSON.stringify({ type: 'service_account', private_key: 'x' }))).toBe('Google Cloud service account key')
  })

  it('recognizes age keys and 32-byte base64 keys', async () => {
    const data = bech32.toWords(randomBytes(32))
    expect(await label(bech32.encode('age-secret-key-', data).toUpperCase())).toBe('age secret key')
    expect((await result(bech32.encode('age', data)))?.level).toBe('warn')
    expect(await label(b64(randomBytes(32)).replace(/=?$/, '='))).toBe('Base64, 32 bytes')
  })

  it('recognizes common API token formats', async () => {
    const chars = (n: number) => Array.from(randomBytes(n), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')
    expect(await label(`ghp_${chars(36)}`)).toBe('GitHub token')
    expect(await label(`glpat-${chars(20)}`)).toBe('GitLab access token')
    expect(await label(`sk_${'live'}_${chars(24)}`)).toBe('Stripe secret key')
    expect((await result(`pk_${'live'}_${chars(24)}`))?.level).toBe('warn')
    expect(await label(`AKIA${chars(16).toUpperCase()}`)).toBe('AWS access key ID')
    expect(await label(`eyJ${chars(10)}.eyJ${chars(10)}.${chars(10)}`)).toBe('JSON Web Token')
  })
})
