import { useRef, useState } from 'preact/hooks'
import { Icon } from './icons'
import { isTouchDevice, useFocusOnMount } from './context'
import { parseNote } from '../lib/vault'
import { VIEWER_FILE } from '../lib/backup'

/** Far above any real vault; stops a wrong pick (a video) from being read into memory. */
const MAX_FILE_BYTES = 20 * 1024 * 1024

/** FileReader rather than File.text(), which older Safari lacks. */
const readText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })

/**
 * Recovery mode, without Standard Notes: open a Keyfold backup file, or paste
 * a Keyfold note's text, and read it (decrypting it with its password)
 * read-only. Runs from the site's #open page, the unzipped keyfold.zip and the
 * single-file offline viewer. Nothing is saved or sent anywhere.
 */
export const OpenNote = ({ offlineViewer, onOpen }: { offlineViewer: boolean; onOpen: (text: string) => void }) => {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const chooseRef = useFocusOnMount<HTMLButtonElement>()

  const open = (value: string, from: 'file' | 'paste') => {
    const kind = parseNote(value).kind
    if (kind === 'empty') return setError(from === 'file' ? 'This file is empty.' : 'Paste the text first.')
    if (kind === 'foreign') {
      return setError(
        from === 'file'
          ? 'This file is not a Keyfold backup or note.'
          : 'This is not the text of a Keyfold note. Copy all of it, from the first { to the last }, without editing.',
      )
    }
    onOpen(value)
  }

  const openFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    if (file.size > MAX_FILE_BYTES) return setError('This file is too large to be a Keyfold backup.')
    try {
      open(await readText(file), 'file')
    } catch {
      setError('Could not read this file.')
    }
  }

  return (
    <div class="app">
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
          void openFile(e.dataTransfer?.files[0])
        }}
      >
        <form
          class="card open-note"
          onSubmit={(e) => {
            e.preventDefault()
            setError('')
            open(text, 'paste')
          }}
        >
          <Icon name="lock" size={32} />
          <h2>{offlineViewer ? 'Keyfold offline viewer' : 'Open a Keyfold backup or note'}</h2>
          <p class="small">
            Open a Keyfold backup file, or paste the text of a Keyfold note. It opens read-only. Nothing is saved, and this
            page cannot send anything anywhere{offlineViewer ? ', so it works offline' : ''}.
          </p>
          <input
            ref={fileInput}
            type="file"
            hidden
            aria-label="Backup file"
            onChange={(e) => {
              const input = e.currentTarget
              void openFile(input.files?.[0]).finally(() => {
                // Choosing the same file again must fire change again.
                input.value = ''
              })
            }}
          />
          <button ref={chooseRef} type="button" class="button primary" onClick={() => fileInput.current?.click()}>
            <Icon name="file" /> Choose backup file
          </button>
          {!isTouchDevice() && <p class="muted small">or drop it on this page</p>}
          {error && (
            <p class="status status-error" role="alert">
              <Icon name="alert" /> {error}
            </p>
          )}
          <details class="paste-note">
            <summary>Paste a note's text instead</summary>
            <p class="small">
              In Standard Notes, change the note type to Plain text, then select all and copy, without editing.
            </p>
            <textarea
              class="input mono"
              rows={8}
              value={text}
              aria-label="Note text"
              placeholder='{ "app": "keyfold", ... }'
              onInput={(e) => setText(e.currentTarget.value)}
              autocomplete="off"
              spellcheck={false}
            />
            <button type="submit" class="button" disabled={!text.trim()}>
              Open read-only
            </button>
          </details>
          {location.protocol !== 'file:' && (
            <a class="small" href={`./${VIEWER_FILE}`} download={VIEWER_FILE}>
              Save this viewer as a single file, to keep next to your backups
            </a>
          )}
          {!offlineViewer && (
            <a class="small" href="./">
              Back to the demo
            </a>
          )}
        </form>
      </div>
    </div>
  )
}
