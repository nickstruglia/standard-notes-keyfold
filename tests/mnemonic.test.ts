import { describe, expect, it } from 'vitest'
import { generateMnemonic, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { BIP39_ENGLISH } from '../src/lib/wordlist'
import { sha256, toHex, utf8 } from '../src/lib/encoding'
import { checkMnemonic, electrumSeedType, expandPrefix, parsePhrase, splitPhrase, suggestWords } from '../src/lib/mnemonic'

const words = (phrase: string) => phrase.split(' ')

describe('BIP39 wordlist', () => {
  it('matches the published english.txt byte for byte', async () => {
    const file = BIP39_ENGLISH.join('\n') + '\n'
    expect(toHex(await sha256(utf8(file)))).toBe(
      '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda',
    )
    expect(BIP39_ENGLISH).toEqual(wordlist)
  })
})

describe('checkMnemonic (bip39)', () => {
  it.each([
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    'legal winner thank year wave sausage worth useful legal winner thank yellow',
    'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
    'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art',
    'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote',
  ])('accepts the BIP39 test vector "%s"', async (phrase) => {
    expect((await checkMnemonic('bip39', words(phrase))).status).toBe('valid')
  })

  it('rejects a bad checksum', async () => {
    const result = await checkMnemonic('bip39', words('abandon '.repeat(12).trim()))
    expect(result.status).toBe('invalid')
    expect(result.message).toMatch(/Checksum/)
  })

  it('agrees with @scure/bip39 on random phrases of every length', async () => {
    for (const strength of [128, 160, 192, 224, 256]) {
      for (let i = 0; i < 40; i++) {
        const phrase = words(generateMnemonic(wordlist, strength))
        expect((await checkMnemonic('bip39', phrase)).status).toBe('valid')
        // Swap two words: usually breaks the checksum; must agree with the reference either way.
        const swapped = [...phrase]
        ;[swapped[0], swapped[1]] = [swapped[1], swapped[0]]
        const expected = validateMnemonic(swapped.join(' '), wordlist) ? 'valid' : 'invalid'
        expect((await checkMnemonic('bip39', swapped)).status).toBe(expected)
      }
    }
  })

  it('reports unknown words by position and incomplete phrases', async () => {
    const phrase = words('abandon abandon abandn abandon abandon abandon abandon abandon abandon abandon abandon xyz')
    const result = await checkMnemonic('bip39', phrase)
    expect(result.status).toBe('invalid')
    expect(result.unknownWords).toEqual([2, 11])

    const partial = await checkMnemonic('bip39', ['abandon', '', ''])
    expect(partial.status).toBe('incomplete')
  })

  it('rejects lengths BIP39 does not allow', async () => {
    const result = await checkMnemonic('bip39', new Array(13).fill('abandon'))
    expect(result.status).toBe('invalid')
  })

  it('does not apply BIP39 rules to other schemes', async () => {
    const result = await checkMnemonic('monero', new Array(25).fill('whatever'))
    expect(result.status).toBe('unchecked')
    expect(result.unknownWords).toEqual([])
  })
})

describe('Electrum seeds', () => {
  it('recognizes standard and segwit seeds from the Electrum test suite', async () => {
    expect(await electrumSeedType(words('cycle rocket west magnet parrot shuffle foot correct salt library feed song'))).toBe(
      'standard',
    )
    expect(await electrumSeedType(words('bitter grass shiver impose acquire brush forget axis eager alone wine silver'))).toBe(
      'segwit',
    )
  })

  it('rejects a BIP39 phrase as an Electrum seed', async () => {
    const r = await checkMnemonic('electrum', words('legal winner thank year wave sausage worth useful legal winner thank yellow'))
    expect(r.status).toBe('invalid')
  })
})

describe('word helpers', () => {
  it('splits pasted phrases with numbering, commas and newlines', () => {
    expect(splitPhrase('1. Abandon\n2) ability, 3: able  4 about')).toEqual(['abandon', 'ability', 'able', 'about'])
  })

  it('places numbered words by number when copied row by row from columns', () => {
    const phrase = 'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' ')
    // Two columns (1-6, 7-12) copied row by row.
    const twoCol = phrase.slice(0, 6).map((w, i) => `${i + 1}. ${w}  ${i + 7}. ${phrase[i + 6]}`).join('\n')
    const parsed = parsePhrase(twoCol)
    expect(parsed.words).toEqual(phrase)
    expect(parsed.reordered).toBe(true)
    expect(parsed.firstNumber).toBe(1)
    // Three columns of 8 (24 words).
    const p24 = Array.from({ length: 24 }, (_, i) => `w${String.fromCharCode(97 + i)}`)
    const threeCol = Array.from({ length: 8 }, (_, r) => [r, r + 8, r + 16].map((i) => `${i + 1}) ${p24[i]}`).join('\t')).join('\n')
    expect(parsePhrase(threeCol).words).toEqual(p24)
    // Words 13-24 keep their numbers.
    expect(parsePhrase('13. alpha 14. beta 15. gamma').firstNumber).toBe(13)
    // Without numbers on every word, the text order is kept.
    expect(parsePhrase('2. beta alpha').words).toEqual(['beta', 'alpha'])
    expect(parsePhrase('1. alpha 1. beta').reordered).toBe(false)
  })

  it('drops punctuation and number markers of every common style', () => {
    expect(splitPhrase('1 - abandon 2 - ability')).toEqual(['abandon', 'ability'])
    expect(splitPhrase('(1) legal #2 winner 3-thank a) year "wave", sausage.')).toEqual([
      'legal',
      'winner',
      'thank',
      'year',
      'wave',
      'sausage',
    ])
    expect(splitPhrase('legal\u200Bwinner | thank')).toEqual(['legal', 'winner', 'thank'])
    expect(splitPhrase('acto arte ábaco')).toEqual(['acto', 'arte', 'ábaco'.normalize('NFKD')])
  })

  it('expands unique 4-letter prefixes only', () => {
    expect(expandPrefix('aban')).toBe('abandon')
    expect(expandPrefix('zoo')).toBe('zoo')
    expect(expandPrefix('abs')).toBe('abs')
  })

  it('suggests close words for typos', () => {
    expect(suggestWords('abandn')).toContain('abandon')
  })
})
