import { useEffect, useRef, useState } from 'preact/hooks'
import { Icon } from './icons'
import { isTouchDevice, useFocusOnMount } from './context'
import { formatDate } from './labels'
import { MAX_FILE_BYTES, readText } from './OpenNote'
import { parseNote } from '../lib/vault'
import { encryptionAvailable } from '../lib/vaultCrypto'

interface RestoreBackupProps {
  /** The Standard Notes phone apps, which may not let plugins open files. */
  mobileApp: boolean
  /** This vault has a password of its own, which it keeps. */
  vaultHasPassword: boolean
  /** Loads the text into the vault, decrypting it with the password; rejects with a message to show. */
  onRestore: (text: string, password: string) => Promise<void>
  onCancel: () => void
}

/**
 * Restores a backup file, or the copied text of a Keyfold note, into an
 * empty vault. A vault with a password keeps it; otherwise an encrypted
 * backup's password becomes the vault's. (Pasting the text into a new note
 * still works too.)
 */
export const RestoreBackup = ({ mobileApp, vaultHasPassword, onRestore, onCancel }: RestoreBackupProps) => {
  const [pasted, setPasted] = useState('')
  const [encrypted, setEncrypted] = useState<{ text: string; exportedAt?: string } | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const chooseRef = useFocusOnMount<HTMLButtonElement>(!mobileApp)

  useEffect(() => {
    if (encrypted) passwordRef.current?.focus()
  }, [encrypted])

  const restore = async (text: string, pw: string) => {
    setBusy(true)
    setError('')
    try {
      await onRestore(text, pw)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const take = (text: string, from: 'file' | 'paste') => {
    setError('')
    const parsed = parseNote(text)
    switch (parsed.kind) {
      case 'empty':
        return setError(from === 'file' ? 'This file is empty.' : 'Paste the text first.')
      case 'foreign':
        return setError(
          from === 'file'
            ? 'This file is not a Keyfold backup.'
            : 'This is not the text of a Keyfold backup or note. Copy all of it, from the first { to the last }, without editing.',
        )
      case 'newer':
        return setError('This was made by a newer version of Keyfold. Update the plugin in Standard Notes (Preferences → Plugins), then try again.')
      case 'unsupported':
        return setError('Its encryption uses settings this copy of Keyfold cannot read, or the file is damaged.')
      case 'plain':
        return void restore(text, '')
      case 'encrypted':
        return setEncrypted({ text, exportedAt: parsed.exportedAt })
    }
  }

  const takeFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    if (file.size > MAX_FILE_BYTES) return setError('This file is too large to be a Keyfold backup.')
    try {
      take(await readText(file), 'file')
    } catch {
      setError('Could not read this file.')
    }
  }

  const errorLine = error && (
    <p class="status status-error" role="alert">
      <Icon name="alert" /> {error}
    </p>
  )

  if (encrypted) {
    const what = encrypted.exportedAt ? 'Backup password' : 'Vault password'
    return (
      <div class="screen">
        <form
          class="card restore-backup"
          onSubmit={(e) => {
            e.preventDefault()
            if (password && !busy) void restore(encrypted.text, password)
          }}
        >
          <Icon name="lock" size={32} />
          <h2>{encrypted.exportedAt ? 'Encrypted backup' : 'Encrypted vault'}</h2>
          <p class="small">
            {encrypted.exportedAt
              ? `Made ${formatDate(encrypted.exportedAt)}. Enter the password chosen when the backup was made.`
              : 'Enter the vault password of the note this text came from.'}{' '}
            {vaultHasPassword
              ? 'This vault keeps its own password.'
              : 'The restored vault keeps this password. You can change it in Settings.'}
          </p>
          {!encryptionAvailable() && (
            <p class="status status-error" role="alert">
              <Icon name="alert" /> Encryption needs a secure (https) connection. Open the note in the Standard Notes app or
              at app.standardnotes.com.
            </p>
          )}
          <input
            ref={passwordRef}
            class="input"
            type="password"
            autocomplete="current-password"
            placeholder={what}
            aria-label={what}
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
          {errorLine}
          <div class="row">
            <button type="submit" class="button primary" disabled={!password || busy}>
              {busy ? 'Restoring…' : 'Restore'}
            </button>
            <button
              type="button"
              class="button"
              disabled={busy}
              onClick={() => {
                setEncrypted(null)
                setPassword('')
                setError('')
              }}
            >
              Back
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div
      class={`screen ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        // Without this the browser opens the dropped file itself.
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void takeFile(e.dataTransfer?.files[0])
      }}
    >
      <form
        class="card restore-backup"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) take(pasted, 'paste')
        }}
      >
        <Icon name="file" size={32} />
        <h2>Restore a backup</h2>
        <p class="small">
          Choose a Keyfold backup file, or paste its text. Its entries are restored into this note, which is empty.
        </p>
        <input
          ref={fileInput}
          type="file"
          hidden
          aria-label="Backup file"
          onChange={(e) => {
            const input = e.currentTarget
            void takeFile(input.files?.[0]).finally(() => {
              // Choosing the same file again must fire change again.
              input.value = ''
            })
          }}
        />
        <button ref={chooseRef} type="button" class="button primary" disabled={busy} onClick={() => fileInput.current?.click()}>
          <Icon name="file" /> Choose backup file
        </button>
        {!isTouchDevice() && <p class="muted small">or drop it here</p>}
        {mobileApp && (
          <p class="small">The Standard Notes phone app may not let plugins open files. If nothing happens, paste the text instead.</p>
        )}
        {errorLine}
        <details class="paste-note" open={mobileApp}>
          <summary>Paste the text instead</summary>
          <textarea
            class="input mono"
            rows={6}
            value={pasted}
            aria-label="Backup text"
            placeholder='{ "app": "keyfold", ... }'
            onInput={(e) => setPasted(e.currentTarget.value)}
            autocomplete="off"
            spellcheck={false}
          />
          <button type="submit" class="button" disabled={!pasted.trim() || busy}>
            Continue
          </button>
        </details>
        <button type="button" class="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </form>
    </div>
  )
}
