import type { ComponentChildren } from 'preact'
import { Icon } from './icons'
import { KIND_GROUP_LABELS, KIND_LABELS } from './labels'
import { useAsync } from './context'
import { checkMnemonic } from '../lib/mnemonic'
import { type Entry, type EntryKind, type GroupBy, type SortOrder, isBackupDue } from '../lib/vault'

export type Filter = 'all' | 'mnemonic' | 'privateKey' | 'other' | 'favorites' | 'attention' | 'archived'

export const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['mnemonic', 'Seed phrases'],
  ['privateKey', 'Private keys'],
  ['other', 'Other'],
  ['favorites', 'Favorites'],
  ['attention', 'Backup check due'],
  ['archived', 'Archived'],
]

/** Searches labels and public details only, never secret values. */
const matches = (entry: Entry, query: string): boolean => {
  if (!query) return true
  const haystack = [entry.label, entry.description, entry.chain, entry.wallet, entry.notes, ...entry.tags]
    .join(' ')
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((term) => haystack.includes(term))
}

export const visibleEntries = (entries: Entry[], filter: Filter, sort: SortOrder, query: string, reminderMonths: number) =>
  entries
    .filter((e) => (filter === 'archived' ? e.archived : !e.archived))
    .filter((e) => {
      switch (filter) {
        case 'mnemonic':
        case 'privateKey':
        case 'other':
          return e.kind === filter
        case 'favorites':
          return e.favorite
        case 'attention':
          return isBackupDue(e, reminderMonths)
        default:
          return true
      }
    })
    .filter((e) => matches(e, query.trim()))
    .sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
      if (sort === 'label') return (a.label || '~').localeCompare(b.label || '~')
      if (sort === 'created') return (b.createdOn || '').localeCompare(a.createdOn || '')
      return b.updatedAt.localeCompare(a.updatedAt)
    })

export interface EntryGroup {
  key: string
  label: string
  entries: Entry[]
}

const KIND_ORDER: EntryKind[] = ['mnemonic', 'privateKey', 'other']
const EMPTY_GROUP_LABEL: Record<GroupBy, string> = {
  none: '',
  kind: '',
  chain: 'No chain',
  wallet: 'No wallet',
  tag: 'Untagged',
}

/** Splits sorted entries into groups. Entries with several tags go under their first tag. */
export const groupEntries = (entries: Entry[], groupBy: GroupBy): EntryGroup[] => {
  if (groupBy === 'none') return [{ key: 'all', label: '', entries }]
  const valueOf = (e: Entry): string =>
    groupBy === 'kind' ? e.kind : groupBy === 'chain' ? e.chain.trim() : groupBy === 'wallet' ? e.wallet.trim() : (e.tags[0] ?? '').trim()

  const groups = new Map<string, EntryGroup>()
  for (const entry of entries) {
    const value = valueOf(entry)
    const key = `${groupBy}:${value.toLowerCase()}`
    let group = groups.get(key)
    if (!group) {
      const label = groupBy === 'kind' ? KIND_GROUP_LABELS[value as EntryKind] : value || EMPTY_GROUP_LABEL[groupBy]
      group = { key, label, entries: [] }
      groups.set(key, group)
    }
    group.entries.push(entry)
  }

  const list = [...groups.values()]
  if (groupBy === 'kind') {
    return list.sort((a, b) => KIND_ORDER.indexOf(a.entries[0].kind) - KIND_ORDER.indexOf(b.entries[0].kind))
  }
  const isEmpty = (g: EntryGroup) => g.key.endsWith(':')
  return list.sort((a, b) => Number(isEmpty(a)) - Number(isEmpty(b)) || a.label.localeCompare(b.label))
}

const ChecksumBadge = ({ entry }: { entry: Entry }) => {
  const check = useAsync(() => checkMnemonic(entry.scheme, entry.words), [entry.scheme, entry.words.join(' ')])
  if (!check || check.status === 'incomplete' || check.status === 'unchecked') return null
  return check.status === 'valid' ? (
    <span class="pill pill-ok" title={check.message}>
      <Icon name="check" size={12} /> checksum
    </span>
  ) : (
    <span class="pill pill-error" title={check.message}>
      <Icon name="alert" size={12} /> check words
    </span>
  )
}

/** Icon, label, public details and status pills for an entry. Never shows secrets. */
export const EntrySummary = ({ entry, reminderMonths }: { entry: Entry; reminderMonths: number }) => {
  const meta = [entry.chain, entry.wallet, entry.kind === 'mnemonic' ? `${entry.words.length} words` : '']
    .filter(Boolean)
    .join(' · ')
  return (
    <>
      <span class={`entry-icon badge-${entry.kind}`} title={KIND_LABELS[entry.kind]}>
        <Icon name={entry.kind === 'mnemonic' ? 'seed' : entry.kind === 'privateKey' ? 'key' : 'lock'} />
      </span>
      <span class="entry-main">
        <span class="entry-title">
          {entry.favorite && <Icon name="star" size={12} fill="currentColor" class="star" />}
          {entry.label || <em class="muted">Untitled {KIND_LABELS[entry.kind].toLowerCase()}</em>}
        </span>
        {meta && <span class="entry-meta">{meta}</span>}
        <span class="entry-pills">
          {entry.kind === 'mnemonic' && <ChecksumBadge entry={entry} />}
          {entry.passphrase && <span class="pill">+ passphrase</span>}
          {entry.archived && <span class="pill">archived</span>}
          {isBackupDue(entry, reminderMonths) && <span class="pill pill-warn">backup check due</span>}
          {entry.tags.map((t) => (
            <span class="pill" key={t}>
              {t}
            </span>
          ))}
        </span>
      </span>
      {entry.createdOn && <span class="entry-date">{entry.createdOn}</span>}
    </>
  )
}

interface GroupProps {
  group: EntryGroup
  collapsed: boolean
  onToggle: () => void
  children: ComponentChildren
}

/** A collapsible group heading. Ungrouped lists render their children directly. */
export const Group = ({ group, collapsed, onToggle, children }: GroupProps) => {
  if (!group.label) return <>{children}</>
  const bodyId = `group-${group.key.replace(/[^a-z0-9]/gi, '-')}`
  return (
    <section class={`group ${collapsed ? 'collapsed' : ''}`}>
      <h2 class="group-heading">
        <button type="button" class="group-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={onToggle}>
          <Icon name="chevron" size={14} class="chevron" />
          <span>{group.label}</span>
          <span class="count">{group.entries.length}</span>
        </button>
      </h2>
      {!collapsed && <div id={bodyId}>{children}</div>}
    </section>
  )
}

interface ListProps {
  groups: EntryGroup[]
  collapsedGroups: Set<string>
  selectedId: string | null
  reminderMonths: number
  onSelect: (id: string) => void
  onToggleGroup: (key: string) => void
}

/** Sidebar list for the "list + editor" layout. */
export const EntryList = ({ groups, collapsedGroups, selectedId, reminderMonths, onSelect, onToggleGroup }: ListProps) => (
  <div class="entry-list">
    {groups.map((group) => (
      <Group key={group.key} group={group} collapsed={collapsedGroups.has(group.key)} onToggle={() => onToggleGroup(group.key)}>
        <ul class="entry-rows" aria-label={group.label || 'Entries'}>
          {group.entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                class={`entry-item ${entry.id === selectedId ? 'selected' : ''}`}
                aria-current={entry.id === selectedId}
                onClick={() => onSelect(entry.id)}
              >
                <EntrySummary entry={entry} reminderMonths={reminderMonths} />
              </button>
            </li>
          ))}
        </ul>
      </Group>
    ))}
  </div>
)
