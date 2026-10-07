import { describe, expect, it } from 'vitest'
import { groupEntries, visibleEntries } from '../src/ui/EntryList'
import { createEntry, normalizeVault } from '../src/lib/vault'

const entries = [
  createEntry('mnemonic', { label: 'A', chain: 'Bitcoin', wallet: 'Ledger', tags: ['cold'] }),
  createEntry('mnemonic', { label: 'B', chain: 'bitcoin', tags: ['hot', 'cold'] }),
  createEntry('privateKey', { label: 'C', chain: 'Ethereum' }),
  createEntry('other', { label: 'D' }),
]

const shape = (groupBy: Parameters<typeof groupEntries>[1]) =>
  groupEntries(entries, groupBy).map((g) => [g.label, g.entries.map((e) => e.label).join('')])

describe('groupEntries', () => {
  it('returns one unlabeled group when grouping is off', () => {
    expect(shape('none')).toEqual([['', 'ABCD']])
  })

  it('groups by type in a fixed order', () => {
    expect(shape('kind')).toEqual([
      ['Seed phrases', 'AB'],
      ['Private keys', 'C'],
      ['Other secrets', 'D'],
    ])
  })

  it('groups chains case-insensitively and puts the empty group last', () => {
    expect(shape('chain')).toEqual([
      ['Bitcoin', 'AB'],
      ['Ethereum', 'C'],
      ['No chain', 'D'],
    ])
  })

  it('uses the first tag only, so each entry appears once', () => {
    expect(shape('tag')).toEqual([
      ['cold', 'A'],
      ['hot', 'B'],
      ['Untagged', 'CD'],
    ])
  })
})

describe('visibleEntries', () => {
  it('puts favorites first and hides archived entries unless asked', () => {
    const list = [
      createEntry('mnemonic', { label: 'x' }),
      createEntry('mnemonic', { label: 'y', favorite: true }),
      createEntry('mnemonic', { label: 'z', archived: true }),
    ]
    expect(visibleEntries(list, 'all', 'label', '', 0).map((e) => e.label)).toEqual(['y', 'x'])
    expect(visibleEntries(list, 'archived', 'label', '', 0).map((e) => e.label)).toEqual(['z'])
  })
})

describe('view settings', () => {
  it('default and validate layout, density and grouping', () => {
    expect(normalizeVault({}).settings).toMatchObject({
      layout: 'stacked',
      density: 'comfortable',
      singleExpand: false,
      groupBy: 'none',
      sort: 'updated',
    })
    const s = normalizeVault({ settings: { layout: 'split', density: 'bogus', groupBy: 'chain', singleExpand: true } }).settings
    expect(s).toMatchObject({ layout: 'split', density: 'comfortable', groupBy: 'chain', singleExpand: true })
  })
})
