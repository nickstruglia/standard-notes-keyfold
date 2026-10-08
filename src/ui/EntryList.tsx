import type { ComponentChildren } from 'preact'
import { Icon } from './icons'
import { KIND_GROUP_LABELS, KIND_ICONS, KIND_LABELS } from './labels'
import { useAsync } from './context'
import { checkMnemonic } from '../lib/mnemonic'
import { KINDS, isCrypto } from '../lib/kinds'
import { type Entry, type EntryKind, type GroupBy, type SortOrder, daysUntilExpiry, isBackupDue, isExpiringSoon } from '../lib/vault'

export type Filter = 'all' | 'crypto' | EntryKind | 'favorites' | 'attention' | 'expiring' | 'archived'

export const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['crypto', 'Crypto'],
  ...KINDS.map((kind): [Filter, string] => [kind, KIND_GROUP_LABELS[kind]]),
  ['favorites', 'Favorites'],
  ['attention', 'Backup check due'],
  ['expiring', 'Expiring or expired'],
  ['archived', 'Archived'],
]

/** Searches labels and public details only, never secret values. */
const matches = (entry: Entry, query: string): boolean => {
  if (!query) return true
  const haystack = [
    entry.label,
    entry.description,
    entry.chain,
    entry.wallet,
    entry.service,
    entry.account,
    entry.notes,
    entry.derivationPath,
    entry.fingerprint,
    entry.publicInfo,
    ...entry.tags,
  ]
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
        case 'all':
        case 'archived':
          return true
        case 'crypto':
          return isCrypto(e.kind)
        case 'favorites':
          return e.favorite
        case 'attention':
          return isBackupDue(e, reminderMonths)
        case 'expiring':
          return isExpiringSoon(e)
        default:
          return e.kind === filter
      }
    })
    .filter((e) => matches(e, query.trim()))
    .sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
      if (sort === 'label') {
        // Untitled entries go last.
        if (!a.label !== !b.label) return a.label ? -1 : 1
        return a.label.localeCompare(b.label)
      }
      if (sort === 'created') return (b.createdOn || '').localeCompare(a.createdOn || '')
      return b.updatedAt.localeCompare(a.updatedAt)
    })

export interface EntryGroup {
  key: string
  label: string
  entries: Entry[]
}

const KIND_ORDER: EntryKind[] = KINDS
const EMPTY_GROUP_LABEL: Record<GroupBy, string> = {
  none: '',
  kind: '',
  chain: 'No chain or service',
  wallet: 'No wallet or account',
  tag: 'Untagged',
}

/** Splits sorted entries into groups. Entries with several tags go under their first tag. */
export const groupEntries = (entries: Entry[], groupBy: GroupBy): EntryGroup[] => {
  if (groupBy === 'none') return [{ key: 'all', label: '', entries }]
  const valueOf = (e: Entry): string =>
    groupBy === 'kind'
      ? e.kind
      : groupBy === 'chain'
        ? (e.chain || e.service).trim()
        : groupBy === 'wallet'
          ? (e.wallet || e.account).trim()
          : (e.tags[0] ?? '').trim()

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

/** Where each entry sits in the displayed list. */
export interface LayoutSnapshot {
  order: string[]
  groupOf: Map<string, string>
  labelOf: Map<string, string>
}

export const snapshotOf = (groups: EntryGroup[]): LayoutSnapshot => ({
  order: groups.flatMap((g) => g.entries.map((e) => e.id)),
  groupOf: new Map(groups.flatMap((g) => g.entries.map((e) => [e.id, g.key] as const))),
  labelOf: new Map(groups.map((g) => [g.key, g.label])),
})

/**
 * Keeps entries in the position and group they had, so editing (which changes
 * "last updated", a chain, a tag...) never moves the card under the cursor.
 * Entries that were not shown before go first, in their fresh order.
 */
export const stabilize = (fresh: EntryGroup[], previous: LayoutSnapshot): EntryGroup[] => {
  const rank = new Map(previous.order.map((id, i) => [id, i]))
  const freshGroupOf = new Map(fresh.flatMap((g) => g.entries.map((e) => [e.id, g.key] as const)))
  const freshLabelOf = new Map(fresh.map((g) => [g.key, g.label]))
  const entries = fresh.flatMap((g) => g.entries).sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1))

  const groups = new Map<string, EntryGroup>()
  for (const entry of entries) {
    const key = previous.groupOf.get(entry.id) ?? freshGroupOf.get(entry.id)!
    let group = groups.get(key)
    if (!group) {
      group = { key, label: previous.labelOf.get(key) ?? freshLabelOf.get(key) ?? '', entries: [] }
      groups.set(key, group)
    }
    group.entries.push(entry)
  }
  const keyOrder = [...new Set([...previous.labelOf.keys(), ...fresh.map((g) => g.key)])]
  return keyOrder.flatMap((key) => groups.get(key) ?? [])
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
const ExpiryPill = ({ entry }: { entry: Entry }) => {
  const days = daysUntilExpiry(entry)
  if (days === null || !isExpiringSoon(entry)) return null
  return days < 0 ? (
    <span class="pill pill-error" title={`Expired ${entry.expiresOn}`}>
      expired
    </span>
  ) : (
    <span class="pill pill-warn" title={`Expires ${entry.expiresOn}`}>
      {days === 0 ? 'expires today' : `expires in ${days} day${days === 1 ? '' : 's'}`}
    </span>
  )
}

/** idPrefix: ids for the title and details, so a button can be named by the title alone. */
export const EntrySummary = ({ entry, reminderMonths, idPrefix }: { entry: Entry; reminderMonths: number; idPrefix?: string }) => {
  const meta = (
    isCrypto(entry.kind)
      ? [entry.chain, entry.wallet, entry.kind === 'mnemonic' ? `${entry.words.length} words` : '']
      : [KIND_LABELS[entry.kind], entry.service, entry.account]
  )
    .filter(Boolean)
    .join(' · ')
  return (
    <>
      <span class={`entry-icon badge-${entry.kind}`} title={KIND_LABELS[entry.kind]}>
        <Icon name={KIND_ICONS[entry.kind]} />
      </span>
      <span class="entry-main">
        <span class="entry-title" id={idPrefix && `${idPrefix}-title`}>
          {entry.favorite && <Icon name="star" size={12} fill="currentColor" class="star" />}
          {entry.label || <em class="muted">Untitled {KIND_LABELS[entry.kind].toLowerCase()}</em>}
        </span>
        {meta && (
          <span class="entry-meta" id={idPrefix && `${idPrefix}-meta`}>
            {meta}
          </span>
        )}
        <span class="entry-pills" id={idPrefix && `${idPrefix}-pills`}>
          {entry.kind === 'mnemonic' && <ChecksumBadge entry={entry} />}
          {entry.passphrase && <span class="pill">+ passphrase</span>}
          {entry.archived && <span class="pill">archived</span>}
          <ExpiryPill entry={entry} />
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
  /** A lone group is shown without a heading. */
  bare: boolean
  collapsed: boolean
  onToggle: () => void
  children: ComponentChildren
}

/**
 * A collapsible group. Always the same elements, with or without a heading,
 * so cards are not remounted (losing focus and typing) when the number of
 * groups changes between one and two.
 */
export const Group = ({ group, bare, collapsed, onToggle, children }: GroupProps) => {
  const bodyId = `group-${group.key.replace(/[^a-z0-9]/gi, '-')}`
  if (!group.label || bare) {
    return (
      <section class="group bare">
        <div id={bodyId}>{children}</div>
      </section>
    )
  }
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
      <Group
        key={group.key}
        group={group}
        bare={groups.length === 1}
        collapsed={collapsedGroups.has(group.key) && groups.length > 1}
        onToggle={() => onToggleGroup(group.key)}
      >
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
