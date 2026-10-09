import { StandardNotesRelay } from './relay'

// The editor talks to whatever hosts it through this interface: the real
// Standard Notes app (through its plugin message protocol, see relay.ts), or an in-memory
// demo when the page is opened directly in a browser.

export interface HostNote {
  text: string
  /** "Prevent editing" is on for this note. */
  locked: boolean
  /** Only appData (pinned, locked...) changed; the text did not. */
  metadataOnly: boolean
}

export interface Host {
  mode: 'standardnotes' | 'demo' | 'viewer'
  /** The Standard Notes phone apps, whose web views may not save downloaded files. */
  inMobileApp(): boolean
  subscribe(listener: (note: HostNote) => void): void
  save(text: string, preview: string): void
}

type RelayItem = {
  uuid: string
  isMetadataUpdate?: boolean
  content: {
    text?: string
    preview_plain?: string
    preview_html?: string
    noteType?: string
    appData?: Record<string, Record<string, unknown>>
  }
}

const isLocked = (item: RelayItem): boolean =>
  item.content?.appData?.['org.standardnotes.sn']?.locked === true

/**
 * Early versions of Keyfold gave their notes the note type "authentication".
 * When Keyfold is missing, Standard Notes opens such a note in its
 * Authenticator, where adding an entry overwrites the vault. Standard Notes
 * stores the content a plugin saves as is, so saving with "unknown", the type
 * it gives notes of plugins without one, makes it fall back to plain text.
 * Only on a real save: saving when a note opens could send a copy that is
 * not synced yet and win over a newer one (Standard Notes keeps the copy
 * changed last), and read-only views (note history) refuse saves with an alert.
 */
const OLD_NOTE_TYPE = 'authentication'

const clearOldNoteType = (item: RelayItem): void => {
  if (item.content?.noteType === OLD_NOTE_TYPE) item.content.noteType = 'unknown'
}

export const createStandardNotesHost = (): Host => {
  const relay = new StandardNotesRelay(window)
  let current: RelayItem | null = null

  return {
    mode: 'standardnotes',
    inMobileApp: () => relay.inMobileApp,
    subscribe(listener) {
      relay.streamContextItem((item: RelayItem) => {
        current = item
        listener({
          text: item.content?.text ?? '',
          locked: isLocked(item),
          metadataOnly: item.isMetadataUpdate === true,
        })
      })
    },
    save(text, preview) {
      const item = current
      if (!item) return
      item.content.text = text
      item.content.preview_plain = preview
      item.content.preview_html = ''
      clearOldNoteType(item)
      relay.saveItem(item)
    },
  }
}

export const createDemoHost = (initialText: string): Host => {
  let text = initialText
  return {
    mode: 'demo',
    inMobileApp: () => false,
    subscribe(listener) {
      queueMicrotask(() => listener({ text, locked: false, metadataOnly: false }))
    },
    save(next) {
      text = next
    },
  }
}

/** Opens a note's text read-only, outside Standard Notes (for recovery). Nothing is saved. */
export const createViewerHost = (noteText: string): Host => ({
  mode: 'viewer',
  inMobileApp: () => false,
  subscribe(listener) {
    queueMicrotask(() => listener({ text: noteText, locked: true, metadataOnly: false }))
  },
  save() {},
})

export const isEmbedded = (): boolean => {
  try {
    return window.parent !== window
  } catch {
    return true
  }
}
