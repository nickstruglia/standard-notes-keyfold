import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Icon } from './icons'
import { UiContext, isTouchDevice, type ConfirmOptions, type Ui } from './context'
import { EditorDatalists, EntryEditor, type EntryHandlers } from './EntryEditor'
import { EntryList, type Filter, type LayoutSnapshot, groupEntries, snapshotOf, stabilize, visibleEntries } from './EntryList'
import { EntryStack } from './EntryStack'
import { Toolbar, type ViewPrefs } from './Toolbar'
import { Settings } from './Settings'
import { RestoreBackup } from './RestoreBackup'
import { ConfirmDialog, ConnectingScreen, type DialogState, ForeignScreen, LockScreen, NewerScreen, type ToastItem, Toasts, UnsupportedScreen } from './Screens'
import { BIP39_ENGLISH } from '../lib/wordlist'
import { clearClipboard, clearClipboardNow, copyText } from '../lib/clipboard'
import {
  type EncryptedBlob,
  type Entry,
  type EntryKind,
  type VaultData,
  type VaultSettings,
  createEntry,
  emptyVault,
  isBackupDue,
  isFromNewerVersion,
  parseNote,
  previewText,
  serializeEncrypted,
  serializePlain,
} from '../lib/vault'
import { DEFAULT_ITERATIONS, type VaultKey, decryptVault, deriveKey, encryptVault, sameSalt, unlockVault } from '../lib/vaultCrypto'
import { newId } from '../lib/encoding'
import { createBackup } from '../lib/backup'
import type { Host } from '../sn/host'
import { Saver } from '../sn/saver'

type Phase =
  | { name: 'connecting' }
  | { name: 'foreign'; text: string }
  | { name: 'newer'; version: number }
  | { name: 'unsupported' }
  /** autoFocus: put the cursor in the password field (not when a timer or another device locked it while the user was elsewhere). */
  | { name: 'locked'; blob: EncryptedBlob; autoFocus: boolean; exportedAt?: string }
  | { name: 'ready' }

type View = { type: 'list' } | { type: 'entry'; id: string } | { type: 'settings' }

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Rendered once: 2048 options are too many to diff on every keystroke.
const BIP39_DATALIST = (
  <datalist id="bip39-words">
    {BIP39_ENGLISH.map((w) => (
      <option value={w} />
    ))}
  </datalist>
)
const EDITOR_DATALISTS = <EditorDatalists />

const CHANGED_DURING_ACTION = 'The note changed while this was running. Please try again.'

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
  // Layout state for this session only; it is not saved in the note.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const [sections, setSections] = useState<Record<string, boolean>>({})
  const [viewOverride, setViewOverride] = useState<Partial<ViewPrefs>>({})
  const [newEntryId, setNewEntryId] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [restoring, setRestoring] = useState(false)

  const vaultRef = useRef(vault)
  const keyRef = useRef<VaultKey | null>(null)
  /** The vault had a password (unlocked or locked) as of the last note shown. */
  const protectedRef = useRef(false)
  const incomingSeq = useRef(0)
  const copySeq = useRef(0)
  const toastSeq = useRef(0)
  /** A timed clipboard clear that is still waiting to run. */
  const pendingClear = useRef<{ id: number; blockedToast?: number } | null>(null)

  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])
  const toast = useCallback((message: string, tone: ToastItem['tone'] = 'info', action?: ToastItem['action'], ms = 4000) => {
    const id = ++toastSeq.current
    setToasts((list) => {
      const next = [...list, { id, message, tone, action }]
      // Keep at most 4; drop plain messages before ones with an action (Undo).
      while (next.length > 4) {
        const plain = next.findIndex((t) => !t.action && t.id !== id)
        next.splice(plain === -1 ? 0 : plain, 1)
      }
      return next
    })
    setTimeout(() => dismissToast(id), ms)
    return id
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

  // A vault with values only a newer Keyfold knows must not be saved by this one.
  const fromNewer = isFromNewerVersion(vault)
  const readOnly = noteLocked || fromNewer || phase.name !== 'ready'
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const noteLockedRef = useRef(noteLocked)
  noteLockedRef.current = noteLocked

  /** Fails a multi-step action if a newer note arrived or editing was disabled meanwhile. */
  const guard = () => {
    const seq = incomingSeq.current
    return () => {
      if (seq !== incomingSeq.current) throw new Error(CHANGED_DURING_ACTION)
      if (readOnlyRef.current) throw new Error('This note is read-only right now.')
    }
  }

  /**
   * Forgets everything an unlocked vault holds: the key, the decrypted
   * entries, and any UI state that could show them (Undo toasts keep a
   * deleted entry, dialogs show labels).
   */
  const wipeUnlocked = () => {
    keyRef.current = null
    saver.cancel()
    showVault(emptyVault())
    setHideEpoch((n) => n + 1)
    setView({ type: 'list' })
    setExpanded(new Set())
    setSections({})
    setNewEntryId(null)
    setToasts([])
    setDialog((open) => {
      open?.resolve(false)
      return null
    })
  }

  /** Applies a local change and queues a save. */
  /** Returns false when nothing was changed (the note is read-only). */
  const update = useCallback((change: (v: VaultData) => VaultData): boolean => {
    if (readOnlyRef.current) return false
    const next = change(vaultRef.current)
    showVault(next)
    saver.schedule(() => serialize(next))
    return true
  }, [saver])

  // Incoming note content from Standard Notes (first load, other devices, history restores).
  useEffect(() => {
    host.subscribe(async (note) => {
      setNoteLocked(note.locked)
      if (note.metadataOnly || saver.isEcho(note.text)) return
      // Typing not yet sent is replaced by this version; say so.
      const discarded = saver.hasUnsent()
      saver.cancel()
      saver.noteSeen(note.text)
      const seq = ++incomingSeq.current
      const first = seq === 1
      const parsed = parseNote(note.text)
      const notifyDiscarded = () =>
        discarded &&
        toast('A newer version arrived from another device or note history and replaced your last few keystrokes.', 'error', undefined, 8000)
      switch (parsed.kind) {
        case 'empty':
        case 'plain': {
          const wasProtected = protectedRef.current
          if (keyRef.current) wipeUnlocked()
          protectedRef.current = false
          setHasPassword(false)
          showVault(parsed.kind === 'plain' ? parsed.vault : emptyVault())
          setPhase({ name: 'ready' })
          if (wasProtected && !first) {
            toast(
              'This vault is no longer password protected: the note was changed on another device or restored from history. Set a password again in Settings if this was not you.',
              'error',
              undefined,
              60_000,
            )
          } else notifyDiscarded()
          return
        }
        case 'encrypted': {
          setHasPassword(true)
          protectedRef.current = true
          const key = keyRef.current
          if (key && sameSalt(parsed.blob, key)) {
            try {
              const data = await decryptVault(parsed.blob, key)
              if (seq !== incomingSeq.current) return
              // Drop any edit made during decryption: it was based on the older version.
              saver.cancel()
              showVault(data)
              setPhase({ name: 'ready' })
              notifyDiscarded()
              return
            } catch {
              // Password changed elsewhere; fall through to the lock screen.
            }
          }
          if (seq !== incomingSeq.current) return
          if (keyRef.current) wipeUnlocked()
          showVault(emptyVault())
          setPhase({ name: 'locked', blob: parsed.blob, autoFocus: first || document.hasFocus(), exportedAt: parsed.exportedAt })
          return
        }
        case 'foreign':
        case 'newer':
        case 'unsupported':
          // Nothing of the previous vault may stay usable behind this screen.
          if (keyRef.current) wipeUnlocked()
          protectedRef.current = false
          setHasPassword(false)
          setPhase(
            parsed.kind === 'foreign'
              ? { name: 'foreign', text: parsed.text }
              : parsed.kind === 'newer'
                ? { name: 'newer', version: parsed.version }
                : { name: 'unsupported' },
          )
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

  const lock = useCallback(async (manual = false) => {
    // A manual lock is a click: clear a pending copied secret now, while the
    // browser still allows it (never from auto-lock, which has no click).
    if (manual && pendingClear.current && clearClipboardNow()) {
      if (pendingClear.current.blockedToast) dismissToast(pendingClear.current.blockedToast)
      pendingClear.current = null
      copySeq.current++
    }
    // Commit a field that saves on blur (tags) before the vault goes away.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await saver.settle()
    const parsed = parseNote(saver.lastText)
    if (parsed.kind !== 'encrypted') {
      setHasPassword(false)
      if (manual) toast('This note is not password protected, so it cannot be locked.', 'error')
      return
    }
    // wipeUnlocked cancels pending work but keeps the record of recent saves,
    // so their echoes are still recognized after the lock.
    wipeUnlocked()
    setPhase({ name: 'locked', blob: parsed.blob, autoFocus: manual || document.hasFocus(), exportedAt: parsed.exportedAt })
  }, [saver])

  // Auto-lock after inactivity.
  useEffect(() => {
    if (!hasPassword || phase.name !== 'ready' || !settings.autoLockMinutes) return
    let last = Date.now()
    const bump = () => (last = Date.now())
    const events = ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const check = () => {
      if (Date.now() - last >= settings.autoLockMinutes * 60_000) lock()
    }
    // Timers are throttled in hidden tabs and on phones; check again on return.
    const timer = setInterval(check, 5000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('pageshow', check)
    window.addEventListener('focus', check)
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump))
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('pageshow', check)
      window.removeEventListener('focus', check)
    }
  }, [hasPassword, phase.name, settings.autoLockMinutes, lock])

  const unlock = async (password: string) => {
    if (phase.name !== 'locked') return
    const seq = incomingSeq.current
    let { vault: data, vaultKey } = await unlockVault(phase.blob, password)
    if (seq !== incomingSeq.current) {
      // A newer version arrived while the key was being derived; open that one.
      const latest = parseNote(saver.lastText)
      if (latest.kind !== 'encrypted' || !sameSalt(latest.blob, vaultKey)) throw new Error(CHANGED_DURING_ACTION)
      const again = incomingSeq.current
      data = await decryptVault(latest.blob, vaultKey)
      if (again !== incomingSeq.current) throw new Error(CHANGED_DURING_ACTION)
    }
    keyRef.current = vaultKey
    showVault(data)
    setPhase({ name: 'ready' })
    if (vaultKey.iterations < DEFAULT_ITERATIONS) {
      // Saved with a weaker key setting: re-encrypt at the current strength.
      const check = guard()
      const stronger = await deriveKey(password)
      try {
        check()
      } catch {
        return
      }
      keyRef.current = stronger
      saver.schedule(() => serialize(vaultRef.current))
    }
  }

  /** Confirms the current password against what is saved in the note. */
  const verifyPassword = async (password: string) => {
    await saver.settle()
    const parsed = parseNote(saver.lastText)
    if (parsed.kind !== 'encrypted') throw new Error('The vault is not password protected.')
    await unlockVault(parsed.blob, password)
  }

  const setPassword = async (password: string) => {
    const check = guard()
    const key = await deriveKey(password)
    check()
    keyRef.current = key
    setHasPassword(true)
    saver.schedule(() => serialize(vaultRef.current))
    toast('Vault password set. The note is now encrypted with it.', 'success')
  }

  const changePassword = async (current: string, next: string) => {
    const check = guard()
    await verifyPassword(current)
    const key = await deriveKey(next)
    check()
    keyRef.current = key
    saver.schedule(() => serialize(vaultRef.current))
    toast('Vault password changed.', 'success')
  }

  const removePassword = async (current: string) => {
    const check = guard()
    await verifyPassword(current)
    check()
    keyRef.current = null
    setHasPassword(false)
    saver.schedule(() => serialize(vaultRef.current))
    toast('Vault password removed. Standard Notes encryption still protects the note.', 'success')
  }

  // Entries arrived from another device: the restore offer no longer applies.
  useEffect(() => {
    if (vault.entries.length > 0) setRestoring(false)
  }, [vault.entries.length])

  /** Loads a backup file, or a copied Keyfold note, into this empty vault. Encrypted ones keep their password. */
  const restoreBackup = async (text: string, password: string) => {
    const check = guard()
    const parsed = parseNote(text)
    let data: VaultData
    let key: VaultKey | null = null
    if (parsed.kind === 'plain') data = parsed.vault
    else if (parsed.kind === 'encrypted') {
      const opened = await unlockVault(parsed.blob, password)
      data = opened.vault
      // Saved with a weaker key setting: re-encrypt at the current strength.
      key = opened.vaultKey.iterations < DEFAULT_ITERATIONS ? await deriveKey(password) : opened.vaultKey
    } else throw new Error('This is not a Keyfold backup.')
    if (isFromNewerVersion(data)) {
      throw new Error('This was made by a newer version of Keyfold. Update the plugin in Standard Notes (Preferences → Plugins), then try again.')
    }
    check()
    if (vaultRef.current.entries.length > 0) throw new Error('Entries were added to this note meanwhile. Restore into a new, empty note.')
    keyRef.current = key
    protectedRef.current = key !== null
    setHasPassword(key !== null)
    showVault(data)
    setRestoring(false)
    saver.schedule(() => serialize(data))
    const count = `${data.entries.length} ${data.entries.length === 1 ? 'entry' : 'entries'}`
    toast(
      key
        ? `Restored ${count}. The vault keeps the password you entered; you can change it in Settings.`
        : `Restored ${count}. This vault has no password of its own; you can set one in Settings.`,
      'success',
      undefined,
      8000,
    )
  }

  const exportBackup = (password: string) => {
    if (isFromNewerVersion(vaultRef.current)) throw new Error('Update Keyfold before making a backup of this vault.')
    return createBackup(vaultRef.current, password)
  }

  /** The backup is encrypted, so it stays on the clipboard until pasted. */
  const copyBackup = async (text: string) => {
    if (!(await copyText(text))) return false
    // Whatever secret a pending clear was waiting for is no longer on the clipboard.
    copySeq.current++
    if (pendingClear.current?.blockedToast) dismissToast(pendingClear.current.blockedToast)
    pendingClear.current = null
    return true
  }

  /** Starts the timed clear after something secret reached the clipboard. */
  const afterCopy = useCallback((what: string) => {
    const secs = settingsRef.current.clipboardClearSeconds
    const id = ++copySeq.current
    if (pendingClear.current?.blockedToast) dismissToast(pendingClear.current.blockedToast)
    pendingClear.current = secs ? { id } : null
    // Phone keyboards (Gboard, Samsung Keyboard...) keep their own clipboard
    // history, which no web page can clear.
    const touch = isTouchDevice()
    const copied = secs
      ? `${what} copied. The clipboard is cleared after ${secs}s, on your next click or tap here if the browser requires one. It stays copied if you leave this note first.`
      : `${what} copied.`
    toast(touch ? `${copied} Your keyboard's clipboard history may keep its own copy.` : copied, 'success', undefined, touch ? 8000 : 6000)
    if (!secs) return
    const cleared = () => {
      if (pendingClear.current?.blockedToast) dismissToast(pendingClear.current.blockedToast)
      if (pendingClear.current?.id === id) pendingClear.current = null
      touch
        ? toast("Clipboard cleared. Delete it from your keyboard's clipboard history too.", 'info', undefined, 6000)
        : toast('Clipboard cleared.', 'info', undefined, 3000)
    }
    setTimeout(async () => {
      if (id !== copySeq.current) return
      if (await clearClipboard()) {
        cleared()
        return
      }
      // Inside Standard Notes the browser only allows clipboard writes during
      // a click or tap, so clear on the next one (or the button).
      // Click, or the end of a tap: iOS does not fire click on plain elements.
      const triggers = ['click', 'touchend', 'pointerup'] as const
      let done = false
      const stop = () => triggers.forEach((t) => window.removeEventListener(t, clearOnce, true))
      const clearOnce = () => {
        if (done) return
        if (id !== copySeq.current) return stop()
        if (clearClipboardNow()) {
          done = true
          stop()
          cleared()
        }
      }
      triggers.forEach((t) => window.addEventListener(t, clearOnce, true))
      const blockedToast = toast('Waiting for a click or tap to clear the clipboard.', 'info', { label: 'Clear now', run: clearOnce }, 20000)
      if (pendingClear.current?.id === id) pendingClear.current.blockedToast = blockedToast
    }, secs * 1000)
  }, [toast])

  const copy = useCallback(async (text: string, what: string) => {
    if (!text) return
    if (!(await copyText(text))) {
      toast(`Could not copy ${what.toLowerCase()}: clipboard access was blocked.`, 'error')
      return
    }
    afterCopy(what)
  }, [afterCopy])

  // Ctrl+C, a long-press Copy or Cut from a revealed secret field also gets
  // the timed clear. Only fields marked data-secret count, so the helper
  // textarea the copy itself uses does not trigger this.
  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const target = event.target as Element | null
      if (target?.closest?.('[data-secret]')) afterCopy('Selection')
    }
    document.addEventListener('copy', onCopy, true)
    document.addEventListener('cut', onCopy, true)
    return () => {
      document.removeEventListener('copy', onCopy, true)
      document.removeEventListener('cut', onCopy, true)
    }
  }, [afterCopy])

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...options, resolve })),
    [],
  )

  // One stable object per change, so context consumers only re-render when needed.
  const ui: Ui = useMemo(
    () => ({
      settings,
      readOnly,
      hideEpoch,
      copy,
      toast,
      confirm,
      sectionOpen: (id, fallback) => sections[id] ?? fallback,
      setSectionOpen: (id, open) => setSections((all) => ({ ...all, [id]: open })),
    }),
    [settings, readOnly, hideEpoch, copy, toast, confirm, sections],
  )

  // View preferences live in the note's settings so they follow you across
  // devices; local overrides keep them working when the note is read-only.
  const viewPrefs: ViewPrefs = {
    layout: settings.layout,
    density: settings.density,
    singleExpand: settings.singleExpand,
    groupBy: settings.groupBy,
    sort: settings.sort,
    ...viewOverride,
  }
  const setViewPrefs = (patch: Partial<ViewPrefs>) => {
    setViewOverride((o) => ({ ...o, ...patch }))
    update((v) => ({ ...v, settings: { ...v.settings, ...patch } }))
  }

  const singleExpand = viewPrefs.singleExpand
  const toggleEntry = useCallback(
    (id: string) => {
      setNewEntryId(null)
      setExpanded((open) => {
        if (open.has(id)) {
          const next = new Set(open)
          next.delete(id)
          return next
        }
        return singleExpand ? new Set([id]) : new Set(open).add(id)
      })
    },
    [singleExpand],
  )

  const toggleGroup = useCallback(
    (key: string) =>
      setCollapsedGroups((closed) => {
        const next = new Set(closed)
        if (!next.delete(key)) next.add(key)
        return next
      }),
    [],
  )

  /** Shows a newly created entry: opened, scrolled to, label focused. */
  const reveal = (id: string) => {
    setFilter('all')
    setQuery('')
    setCollapsedGroups(new Set())
    setNewEntryId(id)
    setExpanded((open) => (viewPrefs.singleExpand ? new Set([id]) : new Set(open).add(id)))
    setView({ type: 'entry', id })
  }

  const addEntry = (kind: EntryKind) => {
    const entry = createEntry(kind)
    update((v) => ({ ...v, entries: [entry, ...v.entries] }))
    reveal(entry.id)
  }

  const updateEntry = (id: string, patch: Partial<Entry>) => {
    const applied = update((v) => ({
      ...v,
      entries: v.entries.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e)),
    }))
    // Archiving hides the entry from the usual filters: say where it went.
    if (applied && patch.archived === true) {
      toast('Archived. It is under the "Archived" filter.', 'info', { label: 'Undo', run: () => updateEntry(id, { archived: false }) }, 6000)
    }
  }

  const duplicateEntry = (id: string) => {
    const source = vaultRef.current.entries.find((e) => e.id === id)
    if (!source) return
    const now = new Date().toISOString()
    const copyOf: Entry = {
      ...(JSON.parse(JSON.stringify(source)) as Entry),
      id: newId(),
      label: source.label ? `${source.label} (copy)` : '',
      // A copy of an archived entry would be hidden right away.
      archived: false,
      addedAt: now,
      updatedAt: now,
    }
    update((v) => ({ ...v, entries: [copyOf, ...v.entries] }))
    reveal(copyOf.id)
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
    // The note may have become read-only, or the entry gone, while the dialog was open.
    if (!ok || !vaultRef.current.entries.some((e) => e.id === id)) return
    if (!update((v) => ({ ...v, entries: v.entries.filter((e) => e.id !== id) }))) {
      toast('Nothing was deleted: the note is read-only right now.', 'error')
      return
    }
    setView({ type: 'list' })
    setExpanded((open) => {
      const next = new Set(open)
      next.delete(id)
      return next
    })
    toast(`Deleted "${entry.label || 'Untitled'}".`, 'info', {
      label: 'Undo',
      run: () => {
        // Already back (another device, history restore) or read-only: do not add a second copy.
        if (vaultRef.current.entries.some((e) => e.id === entry.id)) return
        update((v) => {
          const entries = [...v.entries]
          entries.splice(Math.min(index, entries.length), 0, entry)
          return { ...v, entries }
        })
      },
    }, 10000)
  }

  const updateSettings = (patch: Partial<VaultSettings>) => update((v) => ({ ...v, settings: { ...v.settings, ...patch } }))

  const convertForeign = async (text: string) => {
    const seq = incomingSeq.current
    const ok = await confirm({
      title: 'Convert this note?',
      message: 'The existing text is moved into a hidden field of a new "Imported note" entry, and the note becomes a vault.',
      confirmLabel: 'Convert',
    })
    // Another device may have saved a vault while the dialog was open.
    if (!ok || seq !== incomingSeq.current || noteLockedRef.current) return
    const data = emptyVault()
    // The old text may well be a seed phrase, so it goes into a hidden field.
    data.entries.push(
      createEntry('other', {
        label: 'Imported note',
        customFields: [{ id: newId(), label: 'Imported text', value: text, hidden: true, multiline: true }],
      }),
    )
    showVault(data)
    setPhase({ name: 'ready' })
    setHasPassword(keyRef.current !== null)
    saver.schedule(() => serialize(data))
  }

  const selected = view.type === 'entry' ? vault.entries.find((e) => e.id === view.id) ?? null : null
  const dueCount = vault.entries.filter((e) => isBackupDue(e, settings.backupReminderMonths)).length

  // While an entry is open, entries keep their place and group: editing bumps
  // "last updated" (and may change a chain or tag), and moving the card under
  // the cursor would drop focus mid-word. The order refreshes once it closes.
  const editing = viewPrefs.layout === 'stacked' ? expanded.size > 0 : selected !== null
  // In the list-beside-editor layout, choosing another entry refreshes the list.
  const layoutKey = [viewPrefs.layout, viewPrefs.sort, viewPrefs.groupBy, filter, query, viewPrefs.layout === 'stacked' ? '' : selected?.id].join('|')
  const layoutRef = useRef<{ key: string; snapshot: LayoutSnapshot } | null>(null)
  const previous = editing && layoutRef.current?.key === layoutKey ? layoutRef.current.snapshot : null
  let entries = visibleEntries(vault.entries, filter, viewPrefs.sort, query, settings.backupReminderMonths)
  if (previous) {
    // Keep showing an entry that stopped matching the filter because of the edit.
    const shown = new Set(entries.map((e) => e.id))
    entries = [...entries, ...vault.entries.filter((e) => !shown.has(e.id) && previous.groupOf.has(e.id))]
  }
  let groups = groupEntries(entries, viewPrefs.groupBy)
  if (previous) groups = stabilize(groups, previous)
  layoutRef.current = { key: layoutKey, snapshot: snapshotOf(groups) }

  // Stable per-entry handlers, so unchanged cards can skip re-rendering.
  const actionsRef = useRef({ updateEntry, deleteEntry, duplicateEntry })
  actionsRef.current = { updateEntry, deleteEntry, duplicateEntry }
  const handlerCache = useRef(new Map<string, EntryHandlers>())
  const handlersFor = (id: string): EntryHandlers => {
    let handlers = handlerCache.current.get(id)
    if (!handlers) {
      handlers = {
        onUpdate: (patch) => actionsRef.current.updateEntry(id, patch),
        onDelete: () => actionsRef.current.deleteEntry(id),
        onDuplicate: () => actionsRef.current.duplicateEntry(id),
      }
      handlerCache.current.set(id, handlers)
    }
    return handlers
  }

  const emptyState = (
    <div class="empty">
      <Icon name="shield" size={28} />
      <p>
        <strong>No keys yet.</strong>
      </p>
      <p class="small muted">
        Keep every seed phrase and wallet key in this note, plus SSH, PGP and API keys and recovery codes. Each one folds
        into a single line until you open it, and secrets stay hidden until you reveal them.
      </p>
      {!readOnly && (
        <>
          <div class="row tight center">
            <button type="button" class="button primary small" onClick={() => addEntry('mnemonic')}>
              <Icon name="plus" /> Seed phrase
            </button>
            <button type="button" class="button small" onClick={() => addEntry('privateKey')}>
              <Icon name="plus" /> Wallet key
            </button>
          </div>
          <p class="small muted">Other key types are under Add.</p>
          <p class="small">
            <button type="button" class="link-button" onClick={() => setRestoring(true)}>
              Restore a backup file
            </button>
          </p>
        </>
      )}
    </div>
  )
  const allArchived = vault.entries.length > 0 && vault.entries.every((e) => e.archived) && filter !== 'archived'
  const noMatches = allArchived ? (
    <p class="empty small muted">
      Every entry is archived.{' '}
      <button type="button" class="link-button" onClick={() => setFilter('archived')}>
        Show archived entries
      </button>
    </p>
  ) : (
    <p class="empty small muted">No entries match.</p>
  )

  let body
  switch (phase.name) {
    case 'connecting':
      body = <ConnectingScreen slow={slow} />
      break
    case 'locked':
      body = <LockScreen onUnlock={unlock} autoFocus={phase.autoFocus} exportedAt={phase.exportedAt} />
      break
    case 'foreign':
      body = <ForeignScreen length={phase.text.length} readOnly={noteLocked} onConvert={() => convertForeign(phase.text)} />
      break
    case 'newer':
      body = <NewerScreen version={phase.version} />
      break
    case 'unsupported':
      body = <UnsupportedScreen />
      break
    case 'ready': {
      const toolbar = (
        <Toolbar
          query={query}
          onQuery={setQuery}
          filter={filter}
          onFilter={setFilter}
          dueCount={dueCount}
          shown={entries.length}
          // Archived entries only count in the Archived filter.
          total={vault.entries.filter((e) => (filter === 'archived' ? e.archived : !e.archived)).length}
          readOnly={readOnly}
          onAdd={addEntry}
          view={viewPrefs}
          onView={setViewPrefs}
          onExpandAll={() => {
            setCollapsedGroups(new Set())
            setExpanded(new Set(entries.map((e) => e.id)))
          }}
          onCollapseAll={() => {
            setNewEntryId(null)
            setExpanded(new Set())
          }}
          onSettings={() => setView({ type: 'settings' })}
          hasPassword={hasPassword}
          onLock={() => lock(true)}
          onHideAll={() => setHideEpoch((n) => n + 1)}
        />
      )
      if (view.type === 'settings') {
        body = (
          <main class="detail full">
            <Settings
              vault={vault}
              settings={settings}
              hasPassword={hasPassword}
              onChange={updateSettings}
              onSetPassword={setPassword}
              onChangePassword={changePassword}
              onRemovePassword={removePassword}
              onExport={exportBackup}
              onExported={(backup) => updateSettings({ lastExportedAt: backup.exportedAt })}
              onCopyBackup={copyBackup}
              mobileApp={host.inMobileApp()}
              onLock={() => lock(true)}
              onClose={() => setView({ type: 'list' })}
            />
          </main>
        )
      } else if (viewPrefs.layout === 'stacked') {
        body = (
          <>
            {toolbar}
            <main class="detail full">
              {vault.entries.length === 0 ? (
                emptyState
              ) : entries.length === 0 ? (
                noMatches
              ) : (
                <EntryStack
                  groups={groups}
                  expanded={expanded}
                  collapsedGroups={collapsedGroups}
                  reminderMonths={settings.backupReminderMonths}
                  newId={newEntryId}
                  onToggle={toggleEntry}
                  onToggleGroup={toggleGroup}
                  handlersFor={handlersFor}
                />
              )}
            </main>
          </>
        )
      } else {
        body = (
          <>
            {toolbar}
            <div class={`layout ${selected ? 'has-detail' : ''}`}>
              <aside class="sidebar">
                {vault.entries.length === 0 ? (
                  emptyState
                ) : entries.length === 0 ? (
                  noMatches
                ) : (
                  <EntryList
                    groups={groups}
                    collapsedGroups={collapsedGroups}
                    selectedId={selected?.id ?? null}
                    reminderMonths={settings.backupReminderMonths}
                    onSelect={(id) => {
                      setNewEntryId(null)
                      setView({ type: 'entry', id })
                    }}
                    onToggleGroup={toggleGroup}
                  />
                )}
              </aside>
              <main class="detail">
                {selected ? (
                  <EntryEditor
                    key={selected.id}
                    entry={selected}
                    reminderMonths={settings.backupReminderMonths}
                    focusLabel={selected.id === newEntryId}
                    onBack={() => {
                      setNewEntryId(null)
                      setView({ type: 'list' })
                    }}
                    {...handlersFor(selected.id)}
                  />
                ) : (
                  <div class="placeholder muted">
                    <Icon name="shield" size={36} />
                    <p>Select an entry, or add a new one.</p>
                  </div>
                )}
              </main>
            </div>
          </>
        )
      }
      if (restoring && vault.entries.length === 0 && !readOnly) {
        body = <RestoreBackup mobileApp={host.inMobileApp()} onRestore={restoreBackup} onCancel={() => setRestoring(false)} />
      }
    }
  }

  return (
    <UiContext.Provider value={ui}>
      <div class={`app ${viewPrefs.density} ${settings.privacyScreen && !focused && phase.name === 'ready' ? 'privacy' : ''}`}>
        {host.mode === 'demo' && (
          <div class="banner banner-warn" role="note">
            <Icon name="alert" /> Demo mode: not connected to Standard Notes, nothing is saved. Do not type real secrets here.
            To install, add <code>{new URL('ext.json', location.href).href}</code> in Standard Notes → Preferences → Plugins.{' '}
            Lost access to Keyfold? <a href="#open" onClick={() => setTimeout(() => location.reload())}>Open a backup or note read-only</a>.
          </div>
        )}
        {host.mode === 'viewer' && (
          <div class="banner" role="note">
            <Icon name="lock" /> Read-only viewer: nothing you open here is saved or sent anywhere.
            {/* Reloading forgets the opened vault and shows the open screen again. */}
            <button type="button" class="link-button" onClick={() => location.reload()}>
              Close
            </button>
          </div>
        )}
        {fromNewer && phase.name === 'ready' && (
          <div class="banner" role="note">
            <Icon name="alert" /> This vault was saved by a newer version of Keyfold, so it is read-only here. Update the
            plugin in Standard Notes (Preferences → Plugins) to edit it.
          </div>
        )}
        {noteLocked && host.mode !== 'viewer' && phase.name === 'ready' && (
          <div class="banner" role="note">
            <Icon name="lock" /> "Prevent editing" is on for this note. You can still reveal and copy secrets.
          </div>
        )}
        {body}
        {settings.privacyScreen && !focused && phase.name === 'ready' && (
          // A real button: iOS only turns a tap into a click on elements that handle one.
          <button
            type="button"
            class="privacy-cover"
            onClick={() => {
              window.focus()
              setFocused(true)
            }}
          >
            <Icon name="eyeOff" size={28} />
            <span>{isTouchDevice() ? 'Tap to show the vault' : 'Click to show the vault'}</span>
          </button>
        )}
      </div>
      {EDITOR_DATALISTS}
      {BIP39_DATALIST}
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
