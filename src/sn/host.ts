import ComponentRelay from '@standardnotes/component-relay'

// The editor talks to whatever hosts it through this interface: the real
// Standard Notes app (via the official component relay), or an in-memory
// demo when the page is opened directly in a browser.

export interface HostNote {
  text: string
  /** "Prevent editing" is on for this note. */
  locked: boolean
  /** Only appData (pinned, locked...) changed; the text did not. */
  metadataOnly: boolean
}

export interface Host {
  mode: 'standardnotes' | 'demo'
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
    appData?: Record<string, Record<string, unknown>>
  }
}

const isLocked = (item: RelayItem): boolean =>
  item.content?.appData?.['org.standardnotes.sn']?.locked === true

export const createStandardNotesHost = (): Host => {
  const relay = new ComponentRelay({ targetWindow: window })
  let current: RelayItem | null = null

  return {
    mode: 'standardnotes',
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
      // Our own Saver already debounces; skip the relay's debouncer.
      relay.saveItem(item, undefined, true)
    },
  }
}

export const createDemoHost = (initialText: string): Host => {
  let text = initialText
  return {
    mode: 'demo',
    subscribe(listener) {
      queueMicrotask(() => listener({ text, locked: false, metadataOnly: false }))
    },
    save(next) {
      text = next
    },
  }
}

export const isEmbedded = (): boolean => {
  try {
    return window.parent !== window
  } catch {
    return true
  }
}
