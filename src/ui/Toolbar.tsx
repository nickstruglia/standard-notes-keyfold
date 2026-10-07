import { Icon } from './icons'
import { Popover } from './Popover'
import { FILTERS, type Filter } from './EntryList'
import { GROUP_OPTIONS, KIND_LABELS } from './labels'
import type { EntryKind, GroupBy, SortOrder, VaultSettings } from '../lib/vault'

export type ViewPrefs = Pick<VaultSettings, 'layout' | 'density' | 'singleExpand' | 'groupBy' | 'sort'>

interface Props {
  query: string
  onQuery: (q: string) => void
  filter: Filter
  onFilter: (f: Filter) => void
  dueCount: number
  shown: number
  total: number
  readOnly: boolean
  onAdd: (kind: EntryKind) => void
  view: ViewPrefs
  onView: (patch: Partial<ViewPrefs>) => void
  onExpandAll: () => void
  onCollapseAll: () => void
  onSettings: () => void
  hasPassword: boolean
  onLock: () => void
  onHideAll: () => void
}

const ADD_KINDS: EntryKind[] = ['mnemonic', 'privateKey', 'other']

const IconButton = ({ icon, label, onClick, disabled }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onClick: () => void; disabled?: boolean }) => (
  <button type="button" class="button small" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
    <Icon name={icon} /> <span class="button-text">{label}</span>
  </button>
)

export const Toolbar = (p: Props) => {
  const stacked = p.view.layout === 'stacked'
  return (
    <div class="toolbar">
      <div class="toolbar-row">
        <div class="search">
          <Icon name="search" />
          <input
            class="input"
            type="search"
            placeholder="Search labels, tags, notes"
            aria-label="Search"
            value={p.query}
            onInput={(e) => p.onQuery(e.currentTarget.value)}
            spellcheck={false}
          />
        </div>
        <select class="input" aria-label="Filter" value={p.filter} onChange={(e) => p.onFilter(e.currentTarget.value as Filter)}>
          {FILTERS.map(([id, label]) => (
            <option value={id}>
              {label}
              {id === 'attention' && p.dueCount ? ` (${p.dueCount})` : ''}
            </option>
          ))}
        </select>
        {!p.readOnly && (
          <Popover label="Add" icon="plus" kind="menu" buttonClass="button small primary">
            {(close) =>
              ADD_KINDS.map((kind) => (
                <button
                  type="button"
                  role="menuitem"
                  class="menu-item"
                  onClick={() => {
                    close()
                    p.onAdd(kind)
                  }}
                >
                  <Icon name={kind === 'mnemonic' ? 'seed' : kind === 'privateKey' ? 'key' : 'lock'} /> {KIND_LABELS[kind]}
                </button>
              ))
            }
          </Popover>
        )}
      </div>
      <div class="toolbar-row">
        <span class="muted small count" role="status">
          {p.shown === p.total ? `${p.total} ${p.total === 1 ? 'entry' : 'entries'}` : `${p.shown} of ${p.total} entries`}
        </span>
        <span class="spacer" />
        {stacked && (
          <>
            <IconButton icon="expand" label="Expand all" onClick={p.onExpandAll} disabled={p.view.singleExpand || p.shown === 0} />
            <IconButton icon="collapse" label="Collapse all" onClick={p.onCollapseAll} disabled={p.shown === 0} />
          </>
        )}
        <Popover label="View" icon="sliders" kind="dialog">
          {() => (
            <div class="view-options">
              <fieldset>
                <legend>Layout</legend>
                <label class="check">
                  <input type="radio" name="layout" checked={stacked} onChange={() => p.onView({ layout: 'stacked' })} /> Expandable cards
                </label>
                <label class="check">
                  <input type="radio" name="layout" checked={!stacked} onChange={() => p.onView({ layout: 'split' })} /> List + editor side by side
                </label>
              </fieldset>
              <fieldset>
                <legend>Density</legend>
                <label class="check">
                  <input type="radio" name="density" checked={p.view.density === 'comfortable'} onChange={() => p.onView({ density: 'comfortable' })} />{' '}
                  Comfortable
                </label>
                <label class="check">
                  <input type="radio" name="density" checked={p.view.density === 'compact'} onChange={() => p.onView({ density: 'compact' })} /> Compact
                </label>
              </fieldset>
              <label class="field">
                <span class="field-label">Group by</span>
                <select class="input" value={p.view.groupBy} onChange={(e) => p.onView({ groupBy: e.currentTarget.value as GroupBy })}>
                  {GROUP_OPTIONS.map(([id, label]) => (
                    <option value={id}>{label}</option>
                  ))}
                </select>
              </label>
              <label class="field">
                <span class="field-label">Sort</span>
                <select class="input" value={p.view.sort} onChange={(e) => p.onView({ sort: e.currentTarget.value as SortOrder })}>
                  <option value="updated">Recently updated</option>
                  <option value="label">Label</option>
                  <option value="created">Date created</option>
                </select>
              </label>
              {stacked && (
                <label class="check">
                  <input type="checkbox" checked={p.view.singleExpand} onChange={(e) => p.onView({ singleExpand: e.currentTarget.checked })} /> Open one
                  entry at a time
                </label>
              )}
            </div>
          )}
        </Popover>
        <IconButton icon="settings" label="Settings" onClick={p.onSettings} />
        {p.hasPassword && <IconButton icon="lock" label="Lock" onClick={p.onLock} />}
        <IconButton icon="eyeOff" label="Hide all" onClick={p.onHideAll} />
      </div>
    </div>
  )
}
