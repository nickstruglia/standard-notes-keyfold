import { useId, useState } from 'preact/hooks'
import { Icon } from './icons'
import { useFocusOnMount, useUi } from './context'
import type { VaultSettings } from '../lib/vault'
import { DEFAULT_ITERATIONS, encryptionAvailable } from '../lib/vaultCrypto'

const seconds = (n: number) => (n === 0 ? 'Never' : n < 60 ? `${n} seconds` : `${n / 60} minute${n === 60 ? '' : 's'}`)

const Select = ({ value, options, format, onChange, disabled }: { value: number; options: number[]; format: (n: number) => string; onChange: (n: number) => void; disabled?: boolean }) => (
  <select class="input" value={String(value)} disabled={disabled} onChange={(e) => onChange(Number(e.currentTarget.value))}>
    {[...new Set([...options, value])].sort((a, b) => a - b).map((n) => (
      <option value={String(n)}>{format(n)}</option>
    ))}
  </select>
)

/** Passwords guessed first; never "strong", whatever their characters. */
const COMMON = new Set([
  '1234567890', '12345678910', '0123456789', '1111111111', 'qwertyuiop', 'asdfghjkl;', 'password12', 'password123',
  'password1!', 'password123!', 'iloveyou12', 'letmein123', 'welcome123', 'abcdefghij', 'qwerty1234', '1q2w3e4r5t',
  'q1w2e3r4t5', 'zaq12wsxcde', 'passw0rd123', 'administrator', 'trustno1234', 'football123', 'baseball12',
])

/** Rough entropy estimate, only used to nudge toward longer passwords. */
export const passwordStrength = (pw: string): { bits: number; label: string; tone: 'error' | 'warn' | 'ok' } => {
  if (COMMON.has(pw.toLowerCase())) return { bits: 0, label: 'Very common', tone: 'error' }
  const pool =
    (/[a-z]/.test(pw) ? 26 : 0) + (/[A-Z]/.test(pw) ? 26 : 0) + (/[0-9]/.test(pw) ? 10 : 0) + (/[^a-zA-Z0-9]/.test(pw) ? 33 : 0)
  const unique = new Set(pw).size
  const bits = Math.round(Math.min(pw.length, unique * 2) * Math.log2(Math.max(pool, 1)))
  if (bits < 50) return { bits, label: 'Weak', tone: 'error' }
  if (bits < 75) return { bits, label: 'Fair', tone: 'warn' }
  return { bits, label: 'Strong', tone: 'ok' }
}

type PasswordMode = 'set' | 'change' | 'remove'

interface PasswordFormProps {
  mode: PasswordMode
  onSubmit: (current: string, next: string) => Promise<void>
  onCancel: () => void
}

const MIN_LENGTH = 10

const PasswordForm = ({ mode, onSubmit, onCancel }: PasswordFormProps) => {
  const currentRef = useFocusOnMount<HTMLInputElement>(mode !== 'set')
  const nextRef = useFocusOnMount<HTMLInputElement>(mode === 'set')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmNext, setConfirmNext] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [weakOk, setWeakOk] = useState(false)
  const ids = { strength: useId(), mismatch: useId() }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const strength = passwordStrength(next)
  const weak = strength.tone === 'error'
  const needsNew = mode !== 'remove'
  const mismatch = confirmNext !== '' && confirmNext !== next
  const valid =
    (mode === 'set' || current.length > 0) &&
    (!needsNew || (next.length >= MIN_LENGTH && next === confirmNext && understood && (!weak || weakOk)))

  const submit = async (e: Event) => {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(current, next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <form class="password-form" onSubmit={submit}>
      {mode !== 'set' && (
        <label class="field">
          <span class="field-label">Current vault password</span>
          <input class="input" type="password" autocomplete="current-password" value={current} onInput={(e) => setCurrent(e.currentTarget.value)} ref={currentRef} />
        </label>
      )}
      {needsNew && (
        <>
          <label class="field">
            <span class="field-label">New vault password</span>
            <input
              class="input"
              type="password"
              autocomplete="new-password"
              value={next}
              onInput={(e) => setNext(e.currentTarget.value)}
              ref={nextRef}
              aria-describedby={next ? ids.strength : undefined}
            />
            {next && (
              <span id={ids.strength} class={`hint status-${strength.tone}`}>
                {strength.label} (~{strength.bits} bits).{' '}
                {next.length < MIN_LENGTH ? `Use at least ${MIN_LENGTH} characters. ` : ''}A phrase of 5+ random words works well.
              </span>
            )}
          </label>
          <label class="field">
            <span class="field-label">Repeat new password</span>
            <input
              class="input"
              type="password"
              autocomplete="new-password"
              value={confirmNext}
              onInput={(e) => setConfirmNext(e.currentTarget.value)}
              aria-invalid={mismatch}
              aria-describedby={mismatch ? ids.mismatch : undefined}
            />
            {mismatch && (
              <span id={ids.mismatch} class="hint status-error" role="alert">
                Passwords do not match.
              </span>
            )}
          </label>
          {weak && next.length >= MIN_LENGTH && (
            <label class="check">
              <input type="checkbox" checked={weakOk} onChange={(e) => setWeakOk(e.currentTarget.checked)} />
              <span>
                Use this weak password anyway. Someone with access to your Standard Notes account could guess it quickly.
              </span>
            </label>
          )}
          {mode === 'change' && (
            <p class="small status-warn">
              <Icon name="alert" /> Older versions of this note in Standard Notes' note history still open with the old
              password. If it leaked, delete those revisions too.
            </p>
          )}
          <label class="check">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.currentTarget.checked)} />
            <span>I understand that if I forget this password, no one (not Standard Notes, not the developer) can recover the secrets in this note.</span>
          </label>
        </>
      )}
      {error && (
        <p class="status status-error" role="alert">
          <Icon name="alert" /> {error}
        </p>
      )}
      <div class="row">
        <button type="submit" class={`button ${mode === 'remove' ? 'danger' : 'primary'}`} disabled={!valid || busy}>
          {busy ? 'Working…' : mode === 'set' ? 'Set password' : mode === 'change' ? 'Change password' : 'Remove password'}
        </button>
        <button type="button" class="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}

interface SettingsProps {
  settings: VaultSettings
  hasPassword: boolean
  onChange: (patch: Partial<VaultSettings>) => void
  onSetPassword: (next: string) => Promise<void>
  onChangePassword: (current: string, next: string) => Promise<void>
  onRemovePassword: (current: string) => Promise<void>
  onLock: () => void
  onClose: () => void
}

export const Settings = ({ settings, hasPassword, onChange, onSetPassword, onChangePassword, onRemovePassword, onLock, onClose }: SettingsProps) => {
  const { readOnly } = useUi()
  const [mode, setMode] = useState<PasswordMode | null>(null)

  const handle = async (current: string, next: string) => {
    if (mode === 'set') await onSetPassword(next)
    if (mode === 'change') await onChangePassword(current, next)
    if (mode === 'remove') await onRemovePassword(current)
    setMode(null)
  }

  return (
    <article class="editor settings">
      <header class="editor-header">
        <button type="button" class="icon-button" aria-label="Close settings" title="Back" onClick={onClose}>
          <Icon name="back" />
        </button>
        <h2>Vault settings</h2>
      </header>
      <div class="editor-body">
        <p class="muted small">Settings are saved in this note, so every device uses the same ones.</p>
        <section class="section">
          <h3>
            <Icon name="eye" /> Privacy
          </h3>
          <div class="row">
            <label class="field">
              <span class="field-label">Hide revealed secrets after</span>
              <Select value={settings.autoHideSeconds} options={[0, 10, 30, 60, 120, 300]} format={seconds} disabled={readOnly} onChange={(autoHideSeconds) => onChange({ autoHideSeconds })} />
            </label>
            <label class="field">
              <span class="field-label">Clear clipboard after</span>
              <Select value={settings.clipboardClearSeconds} options={[0, 10, 20, 30, 60, 120]} format={seconds} disabled={readOnly} onChange={(clipboardClearSeconds) => onChange({ clipboardClearSeconds })} />
            </label>
          </div>
          <label class="check">
            <input type="checkbox" checked={settings.hideOnBlur} disabled={readOnly} onChange={(e) => onChange({ hideOnBlur: e.currentTarget.checked })} />
            <span>Hide revealed secrets when the editor loses focus</span>
          </label>
          <label class="check">
            <input type="checkbox" checked={settings.privacyScreen} disabled={readOnly} onChange={(e) => onChange({ privacyScreen: e.currentTarget.checked })} />
            <span>Privacy screen: blur the whole vault while the editor is not focused</span>
          </label>
        </section>

        <section class="section">
          <h3>
            <Icon name="shield" /> Backup reminders
          </h3>
          <label class="field">
            <span class="field-label">Flag entries whose backups were not checked within</span>
            <Select
              value={settings.backupReminderMonths}
              options={[0, 3, 6, 12, 24]}
              format={(n) => (n === 0 ? 'Off' : `${n} months`)}
              disabled={readOnly}
              onChange={(backupReminderMonths) => onChange({ backupReminderMonths })}
            />
          </label>
        </section>

        <section class="section">
          <h3>
            <Icon name="lock" /> Vault password
          </h3>
          <p class="small">
            Standard Notes already end-to-end encrypts this note. A vault password adds a second layer: the note stays
            unreadable even to someone using your unlocked Standard Notes account, until the password is entered.
          </p>
          <p class="muted small">
            AES-256-GCM, key derived with PBKDF2-SHA256 ({DEFAULT_ITERATIONS.toLocaleString()} iterations). The key is kept
            only in memory while the vault is unlocked.
          </p>
          {!hasPassword && (
            <p class="status status-warn">
              <Icon name="alert" /> Older versions of this note in Standard Notes' note history are not re-encrypted. To keep
              no unprotected copy, set the password on a new, empty vault note before adding secrets, or delete the old
              revisions.
            </p>
          )}
          {!encryptionAvailable() ? (
            <p class="status status-warn">
              <Icon name="alert" /> Your browser does not provide WebCrypto here, so a vault password is not available.
            </p>
          ) : mode ? (
            <PasswordForm mode={mode} onSubmit={handle} onCancel={() => setMode(null)} />
          ) : hasPassword ? (
            <>
              <p class="status status-ok">
                <Icon name="check" /> This vault is password protected.
              </p>
              <label class="field">
                <span class="field-label">Lock automatically after inactivity</span>
                <Select
                  value={settings.autoLockMinutes}
                  options={[0, 1, 2, 5, 10, 15, 30, 60]}
                  format={(n) => (n === 0 ? 'Never' : `${n} minute${n === 1 ? '' : 's'}`)}
                  disabled={readOnly}
                  onChange={(autoLockMinutes) => onChange({ autoLockMinutes })}
                />
              </label>
              <div class="row">
                <button type="button" class="button primary" onClick={onLock}>
                  <Icon name="lock" /> Lock now
                </button>
                <button type="button" class="button" disabled={readOnly} onClick={() => setMode('change')}>
                  Change password
                </button>
                <button type="button" class="button danger" disabled={readOnly} onClick={() => setMode('remove')}>
                  Remove password
                </button>
              </div>
            </>
          ) : (
            <button type="button" class="button primary" disabled={readOnly} onClick={() => setMode('set')}>
              <Icon name="lock" /> Set a vault password
            </button>
          )}
        </section>

        <section class="section">
          <h3>About</h3>
          <p class="small">
            Keyfold {__APP_VERSION__}, from {__SITE_URL__}. Open source (MIT):{' '}
            <a href={__REPO_URL__} target="_blank" rel="noopener noreferrer">
              {__REPO_URL__.replace('https://', '')}
            </a>
            . Its Content Security Policy blocks all outgoing connections, images and fonts from other sites; only your
            Standard Notes theme's stylesheets load.
          </p>
        </section>
      </div>
    </article>
  )
}
