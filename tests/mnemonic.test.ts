import { describe, expect, it } from 'vitest'
import { generateMnemonic, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { BIP39_ENGLISH } from '../src/lib/wordlist'
import { sha256, toHex, utf8 } from '../src/lib/encoding'
import { crc32 as zlibCrc32 } from 'node:zlib'
import { MONERO_ENGLISH } from '../src/lib/moneroWords'
import { aezeedCheck, checkMnemonic, electrumSeedType, expandPrefix, parsePhrase, splitPhrase, suggestWords } from '../src/lib/mnemonic'

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
    const result = await checkMnemonic('slip39', new Array(20).fill('whatever'))
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
    expect(splitPhrase('acto arte ábaco')).toEqual(['acto', 'arte', 'ábaco'.normalize('NFC')])
  })

  it('stores pasted words composed (NFC), which is how Monero and other wallets look them up', () => {
    const decomposed = 'alteza río rígido'.normalize('NFKD')
    expect(splitPhrase(decomposed)).toEqual(['alteza', 'río'.normalize('NFC'), 'rígido'.normalize('NFC')])
    expect(expandPrefix('río'.normalize('NFKD'))).toBe('río'.normalize('NFC'))
  })

  it('drops a label repeated before every number ("Word 1: merge")', () => {
    const phrase = 'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' ')
    const labelled = phrase.map((w, i) => `Word ${i + 1}: ${w}`).join('\n')
    expect(parsePhrase(labelled).words).toEqual(phrase)
    expect(parsePhrase(phrase.map((w, i) => `Wort ${i + 1} - ${w}`).join(' ')).words).toEqual(phrase)
    // Not a label: the same word before only some of the numbers.
    expect(splitPhrase('1. abandon 2. abandon 3. about')).toEqual(['abandon', 'abandon', 'about'])
  })

  it('handles long runs of punctuation quickly', () => {
    const started = performance.now()
    splitPhrase('a' + '.'.repeat(100_000) + 'b')
    expect(performance.now() - started).toBeLessThan(1000)
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

describe('more checksums', () => {
  it('checks the Monero checksum word', async () => {
    const seed = 'sequence atlas unveil summon pebbles tuesday beer rudely snake rockets different fuselage woven tagged bested dented vegan hover rapid fawns obvious muppet randomly seasons randomly'.split(' ')
    expect((await checkMnemonic('monero', seed)).status).toBe('valid')
    // Monero compares prefixes, so an abbreviated checksum word is fine.
    expect((await checkMnemonic('monero', [...seed.slice(0, 24), 'ran'])).status).toBe('valid')
    const wrong = [...seed.slice(0, 24), 'sequence']
    expect((await checkMnemonic('monero', wrong)).status).toBe('invalid')
  })

  it('points out an Electrum seed entered as BIP39', async () => {
    // A valid Electrum 2.0 standard seed (from Electrum's test vectors) is not valid BIP39.
    const words = 'wild father tree among universe such mobile favorite target dynamic credit identify'.split(' ')
    const electrum = await electrumSeedType(words)
    const result = await checkMnemonic('bip39', words)
    if (electrum) expect(result.message).toMatch(/pass Electrum's check .*otherwise check every word/)
    else expect(result.status).toBe('invalid')
  })
})

describe('aezeed seeds', () => {
  // The version 0 test vectors from lnd's aezeed/cipherseed_test.go.
  const LND_VECTORS = [
    'ability liquid travel stem barely drastic pact cupboard apple thrive morning oak feature tissue couch old math inform success suggest drink motion know royal',
    'able tree stool crush transfer cloud cross three profit outside hen citizen plate ride require leg siren drum success suggest drink require fiscal upgrade',
  ]

  it.each(LND_VECTORS)('accepts the lnd test vector "%s"', async (phrase) => {
    const result = await checkMnemonic('aezeed', words(phrase))
    expect(result.status).toBe('valid')
    expect(result.message).toMatch(/Valid aezeed checksum/)
  })

  it('rejects a changed word', async () => {
    const changed = words(LND_VECTORS[0])
    changed[23] = 'zoo'
    const result = await checkMnemonic('aezeed', changed)
    expect(result.status).toBe('invalid')
    expect(result.message).toMatch(/Checksum mismatch/)
  })

  it('rejects swapped words', async () => {
    const swapped = words(LND_VECTORS[1])
    ;[swapped[5], swapped[6]] = [swapped[6], swapped[5]]
    expect((await checkMnemonic('aezeed', swapped)).status).toBe('invalid')
  })

  it('rejects an unknown version', async () => {
    const changed = words(LND_VECTORS[0])
    changed[0] = 'zoo'
    expect(aezeedCheck(changed.map((w) => BIP39_ENGLISH.indexOf(w)))).toBe('version')
    expect((await checkMnemonic('aezeed', changed)).message).toMatch(/aezeed version/)
  })

  it('needs 24 words', async () => {
    const result = await checkMnemonic('aezeed', words(LND_VECTORS[0]).slice(0, 12))
    expect(result.status).toBe('invalid')
    expect(result.message).toMatch(/24 words/)
  })

  it('does not send a mistyped aezeed seed to BIP39, where it could pass by chance', async () => {
    // lnd vector 1 with "morning" changed to "code": a failed CRC, but a valid BIP39 checksum.
    const typo = words(LND_VECTORS[0])
    typo[10] = 'code'
    const result = await checkMnemonic('aezeed', typo)
    expect(result.status).toBe('invalid')
    expect(result.message).toMatch(/Checksum mismatch/)
    expect(result.message).not.toMatch(/BIP39/)
  })

  it('points out an aezeed seed entered as BIP39, and the reverse', async () => {
    const asBip39 = await checkMnemonic('bip39', words(LND_VECTORS[0]))
    expect(asBip39.status).toBe('invalid')
    expect(asBip39.message).toMatch(/valid aezeed seed/)

    // (Not "abandon … art": phrases starting with one of the first 8 words look like a mistyped aezeed seed.)
    const bip39 = 'zoo '.repeat(23) + 'vote'
    const asAezeed = await checkMnemonic('aezeed', words(bip39))
    expect(asAezeed.status).toBe('invalid')
    expect(asAezeed.message).toMatch(/pass the BIP39 checksum/)
  })

  it('rarely mistakes random BIP39 phrases for aezeed seeds', () => {
    for (let i = 0; i < 200; i++) {
      const phrase = generateMnemonic(wordlist, 256)
      expect(aezeedCheck(words(phrase).map((w) => BIP39_ENGLISH.indexOf(w)))).not.toBe('valid')
    }
  })
})

describe('Monero seeds (English list, checked exactly as Monero does)', () => {
  it('matches the published Monero English wordlist', async () => {
    expect(MONERO_ENGLISH).toHaveLength(1626)
    expect(toHex(await sha256(utf8(MONERO_ENGLISH.join('\n') + '\n')))).toBe(
      'eaa6bce7dd92f4d6dd74f224264e0ef4ad21095d68ec77616b26ceb599baf4f7',
    )
  })

  // An independent implementation of Monero's create_checksum_index, with Node's CRC-32.
  const moneroSeed = (body: string[]) => {
    const prefixes = body.map((w) => w.slice(0, 3)).join('')
    return [...body, body[zlibCrc32(Buffer.from(prefixes)) % body.length]]
  }
  const randomWords = (n: number) => Array.from({ length: n }, () => MONERO_ENGLISH[Math.floor(Math.random() * 1626)])

  it('accepts genuine 25- and 13-word seeds, including abbreviated words', async () => {
    for (let i = 0; i < 100; i++) {
      const seed = moneroSeed(randomWords(24))
      expect((await checkMnemonic('monero', seed)).status).toBe('valid')
      const short = moneroSeed(randomWords(12))
      expect((await checkMnemonic('monero', short)).message).toBe('Monero checksum word OK (English, 13 words).')
      // Monero only reads the first 3 letters of each word.
      const abbreviated = seed.map((w, j) => (j % 5 === 0 ? w.slice(0, 3) : w))
      expect((await checkMnemonic('monero', abbreviated)).status).toBe('valid')
    }
  })

  it('lets about as few typos through as Monero itself', async () => {
    let passed = 0
    const runs = 1000
    for (let i = 0; i < runs; i++) {
      const seed = moneroSeed(randomWords(24))
      const at = Math.floor(Math.random() * 24)
      const typo = [...seed]
      do typo[at] = MONERO_ENGLISH[Math.floor(Math.random() * 1626)]
      while (typo[at].slice(0, 3) === seed[at].slice(0, 3))
      if ((await checkMnemonic('monero', typo)).status === 'valid') passed++
    }
    // Monero's own check: about 1 in 25. The old multi-language guess: about 1 in 10.
    expect(passed / runs).toBeLessThan(0.07)
  })

  it('names words that are not in the English list', async () => {
    const seed = moneroSeed(randomWords(24))
    seed[4] = 'qqqq'
    const result = await checkMnemonic('monero', seed)
    expect(result.status).toBe('invalid')
    expect(result.message).toBe('Not in the Monero English wordlist: #5.')
    expect(result.unknownWords).toEqual([4])
  })

  it('does not call genuine seeds in other languages invalid', async () => {
    // Generated with Monero's algorithm from its German (capitalised, 4-letter prefixes) and French lists.
    const german = 'kämmen Moorhuhn zähmen Kerze Kamel Leder Obdach Diadem Delfin Leseecke Klischee Pudding Person Zweck Deponie Bauer Kabarett Fitness Boudoir Barkasse Maske Sirup Quark Anakonda Kamel'
    const french = 'ratio lune navrer sauna trame retard sanguin conclure rire aduler pilote azote averse annoncer dieu extase record amener vitamine nouer hibou moyen rapace disposer rapace'
    for (const seed of [german, french]) {
      const result = await checkMnemonic('monero', seed.split(' '))
      expect(result.status).toBe('unchecked')
      expect(result.message).toMatch(/English seeds only/)
    }
  })
})
