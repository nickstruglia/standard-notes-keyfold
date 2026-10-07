import { useState } from 'preact/hooks'
import { Icon } from './icons'

export const LockScreen = ({ onUnlock }: { onUnlock: (password: string) => Promise<void> }) => {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: Event) => {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError('')
    try {
      await onUnlock(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div class="screen">
      <form class="card lock-card" onSubmit={submit}>
        <Icon name="lock" size={32} />
        <h2>Vault locked</h2>
        <p class="muted small">This note has an extra vault password. Standard Notes cannot recover it for you.</p>
        <input
          class="input"
          type="password"
          autocomplete="current-password"
          placeholder="Vault password"
          aria-label="Vault password"
          value={password}
          onInput={(e) => setPassword(e.currentTarget.value)}
          autofocus
        />
        {error && (
          <p class="status status-error" role="alert">
            <Icon name="alert" /> {error}
          </p>
        )}
        <button type="submit" class="button primary" disabled={!password || busy}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}

export const ForeignScreen = ({ length, readOnly, onConvert }: { length: number; readOnly: boolean; onConvert: () => void }) => (
  <div class="screen">
    <div class="card">
      <Icon name="alert" size={32} />
      <h2>This note already has other content</h2>
      <p class="small">
        It holds {length.toLocaleString()} characters that are not a Crypto Vault. Nothing has been changed.
      </p>
      <p class="small">
        To keep the note as it is, switch it back to another editor in Standard Notes. Or convert it: the existing text is
        kept in the notes of a new "Imported note" entry.
      </p>
      <button type="button" class="button primary" disabled={readOnly} onClick={onConvert}>
        Convert to a vault
      </button>
    </div>
  </div>
)

export const NewerScreen = ({ version }: { version: number }) => (
  <div class="screen">
    <div class="card">
      <Icon name="alert" size={32} />
      <h2>Saved by a newer version</h2>
      <p class="small">
        This vault uses format version {version}, which this copy of Crypto Vault does not understand yet. Nothing has been
        changed. Update the plugin in Standard Notes (Preferences → Plugins) to open it.
      </p>
    </div>
  </div>
)

export const ConnectingScreen = ({ slow }: { slow: boolean }) => (
  <div class="screen">
    <div class="card">
      <p class="muted">Connecting to Standard Notes…</p>
      {slow && <p class="small muted">Still waiting. Try closing and reopening the note.</p>}
    </div>
  </div>
)

export interface DialogState {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

export const ConfirmDialog = ({ dialog, onClose }: { dialog: DialogState; onClose: (ok: boolean) => void }) => (
  <div
    class="overlay"
    role="presentation"
    onClick={(e) => e.target === e.currentTarget && onClose(false)}
    onKeyDown={(e) => e.key === 'Escape' && onClose(false)}
  >
    <div class="card dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-message">
      <h2 id="dialog-title">{dialog.title}</h2>
      <p id="dialog-message" class="small">
        {dialog.message}
      </p>
      <div class="row end">
        <button type="button" class="button" onClick={() => onClose(false)} autofocus>
          Cancel
        </button>
        <button type="button" class={`button ${dialog.danger ? 'danger' : 'primary'}`} onClick={() => onClose(true)}>
          {dialog.confirmLabel ?? 'OK'}
        </button>
      </div>
    </div>
  </div>
)

export interface ToastItem {
  id: number
  message: string
  tone: 'info' | 'success' | 'error'
  action?: { label: string; run: () => void }
}

export const Toasts = ({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) => (
  <div class="toasts" role="status" aria-live="polite">
    {toasts.map((t) => (
      <div class={`toast toast-${t.tone}`} key={t.id}>
        <span>{t.message}</span>
        {t.action && (
          <button
            type="button"
            class="button small"
            onClick={() => {
              t.action!.run()
              onDismiss(t.id)
            }}
          >
            {t.action.label}
          </button>
        )}
        <button type="button" class="icon-button" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
          <Icon name="x" size={14} />
        </button>
      </div>
    ))}
  </div>
)
