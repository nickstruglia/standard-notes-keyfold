import { useEffect, useRef } from 'preact/hooks'
import { Icon } from './icons'
import { memo } from './memo'
import { EntryActions, EntryBody, type EntryHandlers } from './EntryEditor'
import { type EntryGroup, EntrySummary, Group } from './EntryList'
import type { Entry } from '../lib/vault'

interface CardProps extends EntryHandlers {
  entry: Entry
  open: boolean
  reminderMonths: number
  isNew: boolean
  onToggle: (id: string) => void
}

/** One entry as an expandable card: a one-line summary that opens into its sections. */
const EntryCard = memo(({ entry, open, reminderMonths, isNew, onToggle, ...handlers }: CardProps) => {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (isNew) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [isNew])
  const bodyId = `entry-${entry.id}`
  return (
    <li ref={ref} class={`card-entry ${open ? 'open' : ''}`}>
      <div class="card-header">
        <button
          type="button"
          class="card-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-labelledby={`${bodyId}-title`}
          aria-describedby={`${bodyId}-meta ${bodyId}-pills`}
          onClick={() => onToggle(entry.id)}
        >
          <Icon name="chevron" size={14} class="chevron" />
          <EntrySummary entry={entry} reminderMonths={reminderMonths} idPrefix={bodyId} />
        </button>
        {open && <EntryActions entry={entry} {...handlers} />}
      </div>
      {open && (
        <div class="card-body" id={bodyId}>
          <EntryBody entry={entry} reminderMonths={reminderMonths} onUpdate={handlers.onUpdate} showLabel focusLabel={isNew} />
        </div>
      )}
    </li>
  )
})

interface StackProps {
  groups: EntryGroup[]
  expanded: Set<string>
  collapsedGroups: Set<string>
  reminderMonths: number
  newId: string | null
  onToggle: (id: string) => void
  onToggleGroup: (key: string) => void
  handlersFor: (id: string) => EntryHandlers
}

/** The card layout: every entry in one scrollable column, grouped and collapsible. */
export const EntryStack = ({ groups, expanded, collapsedGroups, reminderMonths, newId, onToggle, onToggleGroup, handlersFor }: StackProps) => (
  <div class="stack">
    {groups.map((group) => (
      <Group
        key={group.key}
        group={group}
        bare={groups.length === 1}
        collapsed={collapsedGroups.has(group.key) && groups.length > 1}
        onToggle={() => onToggleGroup(group.key)}
      >
        <ul class="cards" aria-label={group.label || 'Entries'}>
          {group.entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              open={expanded.has(entry.id)}
              reminderMonths={reminderMonths}
              isNew={entry.id === newId}
              onToggle={onToggle}
              {...handlersFor(entry.id)}
            />
          ))}
        </ul>
      </Group>
    ))}
  </div>
)
