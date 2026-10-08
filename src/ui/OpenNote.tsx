import { useState } from 'preact/hooks'
import { Icon } from './icons'
import { useFocusOnMount } from './context'

/**
 * The standalone page's recovery mode: paste a Keyfold note's text to read
 * it (and decrypt it with its vault password) without Standard Notes. Works
 * offline from the unzipped keyfold.zip. Nothing is saved or sent anywhere.
 */
export const OpenNote = ({ onOpen }: { onOpen: (text: string) => void }) => {
  const [text, setText] = useState('')
  const ref = useFocusOnMount<HTMLTextAreaElement>()
  return (
    <div class="app">
      <div class="screen">
        <form
          class="card open-note"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) onOpen(text)
          }}
        >
          <Icon name="lock" size={32} />
          <h2>Open a Keyfold note</h2>
          <p class="small">
            Paste the whole text of a Keyfold note (in Standard Notes: change the note type to Plain text, select all and
            copy, without editing). It opens read-only. Nothing is saved, and this page cannot send anything anywhere.
          </p>
          <textarea
            ref={ref}
            class="input mono"
            rows={8}
            value={text}
            aria-label="Note text"
            placeholder='{ "app": "keyfold", ... }'
            onInput={(e) => setText(e.currentTarget.value)}
            autocomplete="off"
            spellcheck={false}
          />
          <button type="submit" class="button primary" disabled={!text.trim()}>
            Open read-only
          </button>
          <a class="small" href="./">
            Back to the demo
          </a>
        </form>
      </div>
    </div>
  )
}
