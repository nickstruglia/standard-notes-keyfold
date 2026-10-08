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
      ['Wallet keys', 'C'],
      ['Other secrets', 'D'],
    ])
  })

  it('groups chains case-insensitively and puts the empty group last', () => {
    expect(shape('chain')).toEqual([
      ['Bitcoin', 'AB'],
      ['Ethereum', 'C'],
      ['No chain or service', 'D'],
    ])
  })

  it('groups crypto chains together with services of other keys', () => {
    const list = [
      createEntry('mnemonic', { label: 'A', chain: 'Bitcoin' }),
      createEntry('sshKey', { label: 'B', service: 'github.com' }),
    ]
    expect(groupEntries(list, 'chain').map((g) => g.label)).toEqual(['Bitcoin', 'github.com'])
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
      groupBy: 'kind',
      sort: 'updated',
    })
    const s = normalizeVault({ settings: { layout: 'split', density: 'bogus', groupBy: 'chain', singleExpand: true } }).settings
    expect(s).toMatchObject({ layout: 'split', density: 'comfortable', groupBy: 'chain', singleExpand: true })
  })
})

describe('stabilize', () => {
  it('keeps the previous order and groups while editing, and puts new entries first', async () => {
    const { stabilize, snapshotOf } = await import('../src/ui/EntryList')
    const a = createEntry('mnemonic', { label: 'A', chain: 'Bitcoin' })
    const b = createEntry('mnemonic', { label: 'B', chain: 'Bitcoin' })
    const before = snapshotOf(groupEntries([a, b], 'chain'))

    // Editing B moves it first by date, and changing its chain would regroup it.
    const edited = { ...b, chain: 'Ethereum' }
    const c = createEntry('mnemonic', { label: 'C', chain: 'Bitcoin' })
    const fresh = groupEntries([c, edited, a], 'chain')
    const stable = stabilize(fresh, before)
    expect(stable.map((g) => [g.label, g.entries.map((e) => e.label).join('')])).toEqual([['Bitcoin', 'CAB']])
  })
})
