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
