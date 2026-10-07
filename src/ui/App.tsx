import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Icon } from './icons'
import { UiContext, type ConfirmOptions, type Ui } from './context'
import { EntryEditor } from './EntryEditor'
import { EntryList, FILTERS, type Filter, type Sort, visibleEntries } from './EntryList'
import { Settings } from './Settings'
import { ConfirmDialog, ConnectingScreen, type DialogState, ForeignScreen, LockScreen, NewerScreen, type ToastItem, Toasts } from './Screens'
import { BIP39_ENGLISH } from '../lib/wordlist'
import { clearClipboard, copyText } from '../lib/clipboard'
import {
  type EncryptedBlob,
  type Entry,
  type EntryKind,
  type VaultData,
  type VaultSettings,
  createEntry,
  emptyVault,
  isBackupDue,
  parseNote,
  previewText,
  serializeEncrypted,
  serializePlain,
} from '../lib/vault'
import { type VaultKey, decryptVault, deriveKey, encryptVault, sameSalt, unlockVault } from '../lib/vaultCrypto'
import { newId } from '../lib/encoding'
import type { Host } from '../sn/host'
import { Saver } from '../sn/saver'

type Phase =
  | { name: 'connecting' }
  | { name: 'foreign'; text: string }
  | { name: 'newer'; version: number }
  | { name: 'locked'; blob: EncryptedBlob }
  | { name: 'ready' }

type View = { type: 'list' } | { type: 'entry'; id: string } | { type: 'settings' }

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const App = ({ host }: { host: Host }) => {
  const [phase, setPhase] = useState<Phase>({ name: 'connecting' })
  const [vault, setVaultState] = useState<VaultData>(emptyVault)
  const [noteLocked, setNoteLocked] = useState(false)
  const [hasPassword, setHasPassword] = useState(false)
  const [hideEpoch, setHideEpoch] = useState(0)
  const [focused, setFocused] = useState(() => document.hasFocus())
  const [slow, setSlow] = useState(false)
  const [view, setView] = useState<View>({ type: 'list' })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('updated')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [dialog, setDialog] = useState<DialogState | null>(null)

  const vaultRef = useRef(vault)
  const keyRef = useRef<VaultKey | null>(null)
  const incomingSeq = useRef(0)
  const copySeq = useRef(0)
  const toastSeq = useRef(0)

  const toast = useCallback((message: string, tone: ToastItem['tone'] = 'info', action?: ToastItem['action'], ms = 4000) => {
    const id = ++toastSeq.current
    setToasts((list) => [...list.slice(-3), { id, message, tone, action }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), ms)
  }, [])

  const saver = useMemo(() => new Saver(host, (e) => toast(`Could not save: ${errorMessage(e)}`, 'error', undefined, 8000)), [host])

  const serialize = async (data: VaultData) => {
    const key = keyRef.current
    return key
      ? { text: serializeEncrypted(await encryptVault(data, key)), preview: previewText(null) }
      : { text: serializePlain(data), preview: previewText(data) }
  }

  const showVault = (data: VaultData) => {
    vaultRef.current = data
    setVaultState(data)
  }

  const readOnly = noteLocked || phase.name !== 'ready'
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly

  /** Applies a local change and queues a save. */
  const update = useCallback((change: (v: VaultData) => VaultData) => {
    if (readOnlyRef.current) return
    const next = change(vaultRef.current)
    showVault(next)
    saver.schedule(() => serialize(next))
  }, [saver])

  // Incoming note content from Standard Notes (first load, other devices, history restores).
  useEffect(() => {
    host.subscribe(async (note) => {
      setNoteLocked(note.locked)
      if (note.metadataOnly || saver.isEcho(note.text)) return
      saver.cancel()
      saver.noteSeen(note.text)
      const seq = ++incomingSeq.current
      const parsed = parseNote(note.text)
      switch (parsed.kind) {
        case 'empty':
        case 'plain':
          keyRef.current = null
          setHasPassword(false)
          showVault(parsed.kind === 'plain' ? parsed.vault : emptyVault())
          setPhase({ name: 'ready' })
          return
        case 'encrypted': {
          setHasPassword(true)
          const key = keyRef.current
          if (key && sameSalt(parsed.blob, key)) {
            try {
              const data = await decryptVault(parsed.blob, key)
              if (seq !== incomingSeq.current) return
              showVault(data)
              setPhase({ name: 'ready' })
              return
            } catch {
              // Password changed elsewhere; fall through to the lock screen.
            }
          }
          if (seq !== incomingSeq.current) return
          keyRef.current = null
          showVault(emptyVault())
          setPhase({ name: 'locked', blob: parsed.blob })
          return
        }
        case 'foreign':
          setPhase({ name: 'foreign', text: parsed.text })
          return
        case 'newer':
          setPhase({ name: 'newer', version: parsed.version })
          return
      }
    })
  }, [host, saver])

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 5000)
    return () => clearTimeout(timer)
  }, [])

  const settings = vault.settings
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // Save before the iframe goes away, and hide secrets when focus leaves.
  useEffect(() => {
    const flush = () => saver.flush()
    const onBlur = () => {
      saver.flush()
      setFocused(false)
      if (settingsRef.current.hideOnBlur) setHideEpoch((n) => n + 1)
    }
    const onFocus = () => setFocused(true)
    const onVisibility = () => document.visibilityState === 'hidden' && saver.flush()
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [saver])

  const lock = useCallback(async () => {
    await saver.settle()
    const parsed = parseNote(saver.lastText)
    if (parsed.kind !== 'encrypted') return
    keyRef.current = null
    showVault(emptyVault())
    setHideEpoch((n) => n + 1)
    setView({ type: 'list' })
    setPhase({ name: 'locked', blob: parsed.blob })
  }, [saver])

  // Auto-lock after inactivity.
  useEffect(() => {
    if (!hasPassword || phase.name !== 'ready' || !settings.autoLockMinutes) return
    let last = Date.now()
    const bump = () => (last = Date.now())
    const events = ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const timer = setInterval(() => {
      if (Date.now() - last >= settings.autoLockMinutes * 60_000) lock()
    }, 5000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump))
      clearInterval(timer)
    }
  }, [hasPassword, phase.name, settings.autoLockMinutes, lock])

  const unlock = async (password: string) => {
    if (phase.name !== 'locked') return
    const { vault: data, vaultKey } = await unlockVault(phase.blob, password)
    keyRef.current = vaultKey
    showVault(data)
    setPhase({ name: 'ready' })
  }

  /** Confirms the current password against what is saved in the note. */
  const verifyPassword = async (password: string) => {
    await saver.settle()
    const parsed = parseNote(saver.lastText)
    if (parsed.kind !== 'encrypted') throw new Error('The vault is not password protected.')
    await unlockVault(parsed.blob, password)
  }

  const setPassword = async (password: string) => {
    keyRef.current = await deriveKey(password)
    setHasPassword(true)
    saver.schedule(() => serialize(vaultRef.current))
    toast('Vault password set. The note is now encrypted with it.', 'success')
  }

  const changePassword = async (current: string, next: string) => {
    await verifyPassword(current)
    keyRef.current = await deriveKey(next)
    saver.schedule(() => serialize(vaultRef.current))
    toast('Vault password changed.', 'success')
  }

  const removePassword = async (current: string) => {
    await verifyPassword(current)
    keyRef.current = null
    setHasPassword(false)
    saver.schedule(() => serialize(vaultRef.current))
    toast('Vault password removed. Standard Notes encryption still protects the note.', 'success')
  }

  const copy = useCallback(async (text: string, what: string) => {
    if (!text) return
    if (!(await copyText(text))) {
      toast(`Could not copy ${what.toLowerCase()}: clipboard access was blocked.`, 'error')
      return
    }
    const secs = settingsRef.current.clipboardClearSeconds
    const id = ++copySeq.current
    toast(secs ? `${what} copied. Clipboard clears in ${secs}s.` : `${what} copied.`, 'success')
    if (!secs) return
    setTimeout(async () => {
      if (id !== copySeq.current) return
      const cleared = await clearClipboard()
      toast(
        cleared ? 'Clipboard cleared.' : 'Could not clear the clipboard automatically. Copy something else to overwrite it.',
        cleared ? 'info' : 'error',
        undefined,
        cleared ? 3000 : 8000,
      )
    }, secs * 1000)
  }, [toast])

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...options, resolve })),
    [],
  )

  const ui: Ui = { settings, readOnly, hideEpoch, copy, toast, confirm }

  const addEntry = (kind: EntryKind) => {
    const entry = createEntry(kind)
    update((v) => ({ ...v, entries: [entry, ...v.entries] }))
    setFilter('all')
    setView({ type: 'entry', id: entry.id })
  }

  const updateEntry = (id: string, patch: Partial<Entry>) =>
    update((v) => ({
      ...v,
      entries: v.entries.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e)),
    }))

  const duplicateEntry = (id: string) => {
    const source = vaultRef.current.entries.find((e) => e.id === id)
    if (!source) return
    const now = new Date().toISOString()
    const copyOf: Entry = {
      ...structuredClone(source),
      id: newId(),
      label: source.label ? `${source.label} (copy)` : '',
      addedAt: now,
      updatedAt: now,
    }
    update((v) => ({ ...v, entries: [copyOf, ...v.entries] }))
    setView({ type: 'entry', id: copyOf.id })
  }

  const deleteEntry = async (id: string) => {
    const index = vaultRef.current.entries.findIndex((e) => e.id === id)
    const entry = vaultRef.current.entries[index]
    if (!entry) return
    const ok = await confirm({
      title: 'Delete this entry?',
      message: `"${entry.label || 'Untitled'}" will be removed from this note. You can undo right after, and Standard Notes keeps note history.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    update((v) => ({ ...v, entries: v.entries.filter((e) => e.id !== id) }))
    setView({ type: 'list' })
    toast('Entry deleted.', 'info', {
      label: 'Undo',
      run: () =>
        update((v) => {
          const entries = [...v.entries]
          entries.splice(Math.min(index, entries.length), 0, entry)
          return { ...v, entries }
        }),
    }, 10000)
  }

  const updateSettings = (patch: Partial<VaultSettings>) => update((v) => ({ ...v, settings: { ...v.settings, ...patch } }))

  const convertForeign = async (text: string) => {
    const ok = await confirm({
      title: 'Convert this note?',
      message: 'The existing text is moved into the notes of a new "Imported note" entry, and the note becomes a vault.',
      confirmLabel: 'Convert',
    })
    if (!ok) return
    const data = emptyVault()
    data.entries.push(createEntry('other', { label: 'Imported note', notes: text }))
    showVault(data)
    setPhase({ name: 'ready' })
    saver.schedule(() => serialize(data))
  }

  const entries = visibleEntries(vault.entries, filter, sort, query, settings.backupReminderMonths)
  const selected = view.type === 'entry' ? vault.entries.find((e) => e.id === view.id) ?? null : null
  const dueCount = vault.entries.filter((e) => isBackupDue(e, settings.backupReminderMonths)).length
  const showDetail = view.type === 'settings' || selected !== null

  let body
  switch (phase.name) {
    case 'connecting':
      body = <ConnectingScreen slow={slow} />
      break
    case 'locked':
      body = <LockScreen onUnlock={unlock} />
      break
    case 'foreign':
      body = <ForeignScreen length={phase.text.length} readOnly={noteLocked} onConvert={() => convertForeign(phase.text)} />
      break
    case 'newer':
      body = <NewerScreen version={phase.version} />
      break
    case 'ready':
      body = (
        <div class={`layout ${showDetail ? 'has-detail' : ''}`}>
          <aside class="sidebar">
            <div class="toolbar">
              <div class="search">
                <Icon name="search" />
                <input
                  class="input"
                  type="search"
                  placeholder="Search labels, tags, notes"
                  aria-label="Search"
                  value={query}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  spellcheck={false}
                />
              </div>
              <div class="row tight">
                <select class="input" aria-label="Filter" value={filter} onChange={(e) => setFilter(e.currentTarget.value as Filter)}>
                  {FILTERS.map(([id, label]) => (
                    <option value={id}>
                      {label}
                      {id === 'attention' && dueCount ? ` (${dueCount})` : ''}
                    </option>
                  ))}
                </select>
                <select class="input" aria-label="Sort" value={sort} onChange={(e) => setSort(e.currentTarget.value as Sort)}>
                  <option value="updated">Recently updated</option>
                  <option value="label">Label</option>
                  <option value="created">Date created</option>
                </select>
              </div>
              {!readOnly && (
                <div class="row tight new-buttons">
                  <button type="button" class="button primary small" onClick={() => addEntry('mnemonic')}>
                    <Icon name="plus" /> Seed phrase
                  </button>
                  <button type="button" class="button small" onClick={() => addEntry('privateKey')}>
                    <Icon name="plus" /> Private key
                  </button>
                  <button type="button" class="button small" onClick={() => addEntry('other')}>
                    <Icon name="plus" /> Other
                  </button>
                </div>
              )}
            </div>
            {vault.entries.length === 0 ? (
              <div class="empty">
                <Icon name="shield" size={28} />
                <p>
                  <strong>No secrets yet.</strong>
                </p>
                <p class="small muted">
                  Add a seed phrase (12 to 33 words, with checksum checks) or a private key. Secrets stay hidden until you
                  reveal them, and nothing ever leaves Standard Notes' encryption.
                </p>
              </div>
            ) : entries.length === 0 ? (
              <p class="empty small muted">No entries match.</p>
            ) : (
              <EntryList entries={entries} selectedId={selected?.id ?? null} reminderMonths={settings.backupReminderMonths} onSelect={(id) => setView({ type: 'entry', id })} />
            )}
            <div class="sidebar-footer">
              <button type="button" class="button small" onClick={() => setView({ type: 'settings' })}>
                <Icon name="settings" /> Settings
              </button>
              {hasPassword && (
                <button type="button" class="button small" onClick={lock}>
                  <Icon name="lock" /> Lock
                </button>
              )}
              <button type="button" class="button small" onClick={() => setHideEpoch((n) => n + 1)} title="Hide every revealed secret">
                <Icon name="eyeOff" /> Hide all
              </button>
            </div>
          </aside>
          <main class="detail">
            {view.type === 'settings' ? (
              <Settings
                settings={settings}
                hasPassword={hasPassword}
                onChange={updateSettings}
                onSetPassword={setPassword}
                onChangePassword={changePassword}
                onRemovePassword={removePassword}
                onClose={() => setView({ type: 'list' })}
              />
            ) : selected ? (
              <EntryEditor
                key={selected.id}
                entry={selected}
                reminderMonths={settings.backupReminderMonths}
                onUpdate={(patch) => updateEntry(selected.id, patch)}
                onDelete={() => deleteEntry(selected.id)}
                onDuplicate={() => duplicateEntry(selected.id)}
                onBack={() => setView({ type: 'list' })}
              />
            ) : (
              <div class="placeholder muted">
                <Icon name="shield" size={36} />
                <p>Select an entry, or add a new one.</p>
              </div>
            )}
          </main>
        </div>
      )
  }

  return (
    <UiContext.Provider value={ui}>
      <div class={`app ${settings.privacyScreen && !focused && phase.name === 'ready' ? 'privacy' : ''}`}>
        {host.mode === 'demo' && (
          <div class="banner banner-warn" role="note">
            <Icon name="alert" /> Demo mode: not connected to Standard Notes, nothing is saved. Do not type real secrets here.
            To install, add <code>{new URL('ext.json', location.href).href}</code> in Standard Notes → Preferences → Plugins.
          </div>
        )}
        {noteLocked && phase.name === 'ready' && (
          <div class="banner" role="note">
            <Icon name="lock" /> "Prevent editing" is on for this note. You can still reveal and copy secrets.
          </div>
        )}
        {body}
        {settings.privacyScreen && !focused && phase.name === 'ready' && (
          <div class="privacy-cover" aria-hidden="true">
            <Icon name="eyeOff" size={28} />
            <span>Click to show the vault</span>
          </div>
        )}
      </div>
      <datalist id="bip39-words">
        {BIP39_ENGLISH.map((w) => (
          <option value={w} />
        ))}
      </datalist>
      {dialog && (
        <ConfirmDialog
          dialog={dialog}
          onClose={(ok) => {
            dialog.resolve(ok)
            setDialog(null)
          }}
        />
      )}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((list) => list.filter((t) => t.id !== id))} />
    </UiContext.Provider>
  )
}
