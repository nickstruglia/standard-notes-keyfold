// A small client for the Standard Notes plugin protocol: messages exchanged
// with the Standard Notes app (the parent window) through postMessage.
//
// Standard Notes sends:   component-registered, themes, reply
// We send:                stream-context-item, save-items, themes-activated,
//                         click, key-down, key-up
//
// Written for Keyfold rather than using @standardnotes/component-relay, which
// is AGPL-licensed and whose npm release (2.2.2) cannot reply when the app's
// origin is "null", as it is in the Standard Notes mobile apps.

type Callback = (data: any) => void

interface OutgoingMessage {
  action: string
  data: unknown
  messageId: string
  sessionKey: string
  api: 'component'
}

interface IncomingMessage {
  action?: string
  data?: any
  sessionKey?: string
  original?: { messageId?: string }
}

const newMessageId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * Where replies go. A normal web origin is targeted exactly. When the app runs
 * from local files (mobile apps), its origin is "null" or "file://", which
 * postMessage cannot target, so "*" is used; incoming messages are still only
 * accepted from the parent window.
 */
export const replyTarget = (origin: string | undefined): string =>
  origin && /^https?:\/\//.test(origin) ? origin : '*'

export class StandardNotesRelay {
  private sessionKey: string | undefined
  private origin: string | undefined
  private environment: string | undefined
  private queue: { action: string; data: unknown; callback?: Callback; keep: boolean }[] = []
  private callbacks = new Map<string, { callback: Callback; keep: boolean }>()
  private themeUrls: string[] = []

  constructor(private win: Window = window) {
    win.addEventListener('message', this.onMessage)
    win.addEventListener('click', this.onClick)
    win.addEventListener('keydown', this.onKey)
    win.addEventListener('keyup', this.onKey)
  }

  /** Streams the note being edited; the callback runs on every change. */
  streamContextItem(callback: Callback): void {
    this.send('stream-context-item', {}, (data) => data?.item && callback(data.item), true)
  }

  saveItem(item: unknown, onSaved?: () => void): void {
    this.send('save-items', { items: [item] }, () => onSaved?.())
  }

  private send(action: string, data: unknown, callback?: Callback, keep = false): void {
    if (!this.sessionKey) {
      this.queue.push({ action, data, callback, keep })
      return
    }
    const message: OutgoingMessage = {
      action,
      data,
      messageId: newMessageId(),
      sessionKey: this.sessionKey,
      api: 'component',
    }
    if (callback) this.callbacks.set(message.messageId, { callback, keep })
    // The legacy React Native app wanted strings; today's apps take objects.
    const payload = this.environment === 'mobile' ? JSON.stringify(message) : message
    this.win.parent.postMessage(payload, replyTarget(this.origin))
  }

  private onMessage = (event: MessageEvent): void => {
    // Only the window that framed this editor may talk to it.
    if (event.source !== this.win.parent || this.win.parent === this.win) return
    let message: IncomingMessage
    try {
      message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
    } catch {
      return
    }
    if (!message || typeof message !== 'object') return

    switch (message.action) {
      case 'component-registered':
        if (this.sessionKey || !message.sessionKey) return
        this.sessionKey = message.sessionKey
        this.origin = event.origin
        this.environment = message.data?.environment
        this.activateThemes(message.data?.activeThemeUrls ?? [])
        this.send('themes-activated', {})
        for (const queued of this.queue.splice(0)) this.send(queued.action, queued.data, queued.callback, queued.keep)
        return
      case 'themes':
        this.activateThemes(message.data?.themes ?? [])
        return
      case 'reply': {
        const id = message.original?.messageId
        const entry = id ? this.callbacks.get(id) : undefined
        if (!entry) return
        if (!entry.keep) this.callbacks.delete(id!)
        entry.callback(message.data)
        return
      }
    }
  }

  /** Lets Standard Notes close its menus when the editor is clicked. */
  private onClick = (): void => {
    if (this.sessionKey) this.send('click', {})
  }

  /**
   * Forwards Ctrl/Cmd shortcuts so Standard Notes' own shortcuts keep working.
   * Shift- or Alt-only keys are not forwarded: those are ordinary typing,
   * including capital letters in secret fields.
   */
  private onKey = (event: KeyboardEvent): void => {
    if (!this.sessionKey) return
    const modifierKey = event.key === 'Control' || event.key === 'Meta'
    if (!event.ctrlKey && !event.metaKey && !modifierKey) return
    this.send(event.type === 'keydown' ? 'key-down' : 'key-up', {
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    })
  }

  /** Loads the active Standard Notes theme stylesheets, replacing the previous ones. */
  private activateThemes(urls: string[]): void {
    const next = urls.filter((url) => typeof url === 'string' && url)
    if (next.join('\n') === this.themeUrls.join('\n')) return
    const doc = this.win.document
    doc.querySelectorAll('link[data-sn-theme]').forEach((link) => {
      if (!next.includes(link.getAttribute('href') ?? '')) link.remove()
    })
    for (const url of next) {
      if (this.themeUrls.includes(url)) continue
      const link = doc.createElement('link')
      link.rel = 'stylesheet'
      link.href = url
      link.setAttribute('data-sn-theme', '')
      doc.head.appendChild(link)
    }
    this.themeUrls = next
  }
}
