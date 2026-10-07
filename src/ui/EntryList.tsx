import { Icon } from './icons'
import { KIND_LABELS } from './EntryEditor'
import { useAsync } from './context'
import { checkMnemonic } from '../lib/mnemonic'
import { type Entry, isBackupDue } from '../lib/vault'

export type Filter = 'all' | 'mnemonic' | 'privateKey' | 'other' | 'favorites' | 'attention' | 'archived'
export type Sort = 'updated' | 'label' | 'created'

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

export const visibleEntries = (entries: Entry[], filter: Filter, sort: Sort, query: string, reminderMonths: number) =>
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

interface Props {
  entries: Entry[]
  selectedId: string | null
  reminderMonths: number
  onSelect: (id: string) => void
}

export const EntryList = ({ entries, selectedId, reminderMonths, onSelect }: Props) => (
  <ul class="entry-list" aria-label="Entries">
    {entries.map((entry) => {
      const meta = [entry.chain, entry.wallet, entry.kind === 'mnemonic' ? `${entry.words.length} words` : '']
        .filter(Boolean)
        .join(' · ')
      return (
        <li key={entry.id}>
          <button
            type="button"
            class={`entry-item ${entry.id === selectedId ? 'selected' : ''}`}
            aria-current={entry.id === selectedId}
            onClick={() => onSelect(entry.id)}
          >
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
                {isBackupDue(entry, reminderMonths) && <span class="pill pill-warn">backup check due</span>}
                {entry.tags.map((t) => (
                  <span class="pill" key={t}>
                    {t}
                  </span>
                ))}
              </span>
            </span>
            {entry.createdOn && <span class="entry-date">{entry.createdOn}</span>}
          </button>
        </li>
      )
    })}
  </ul>
)
