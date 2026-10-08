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

/** Standard Notes' web app serves its built-in themes here. */
const HOSTED_THEMES = 'https://app.standardnotes.com/components/assets/'

/**
 * Where to load a theme stylesheet from. The mobile apps send their built-in
 * themes as data: URLs, or as file:// URLs until those are ready. A page
 * served over HTTPS may not load file:// URLs, so those load from the copies
 * Standard Notes serves for its web app.
 */
export const themeUrl = (url: string): string | undefined => {
  if (/^https?:\/\//i.test(url) || /^data:text\/css[;,]/i.test(url)) return url
  const builtIn = /\/components\/assets\/([a-z0-9][a-z0-9.-]*)\/([\w.-]+(?:\/[\w.-]+)*\.css)$/i.exec(url)
  if (!builtIn || builtIn[0].includes('..')) return undefined
  return `${HOSTED_THEMES}${builtIn[1]}/${builtIn[2]}`
}

/** The page stays invisible until its theme applies, or this long at most. */
const REVEAL_AFTER_MS = 2000
const MODIFIER_KEYS = ['Shift', 'Alt', 'Control', 'Meta', 'AltGraph']

export class StandardNotesRelay {
  private sessionKey: string | undefined
  private origin: string | undefined
  private environment: string | undefined
  private queue: { action: string; data: unknown; callback?: Callback; keep: boolean }[] = []
  private callbacks = new Map<string, { callback: Callback; keep: boolean }>()
  private themeLoads = new WeakMap<Element, Promise<unknown>>()
  private themeGeneration = 0

  constructor(private win: Window = window) {
    win.addEventListener('message', this.onMessage)
    win.addEventListener('click', this.onClick)
    win.addEventListener('keydown', this.onKey)
    win.addEventListener('keyup', this.onKey)
    setTimeout(this.reveal, REVEAL_AFTER_MS)
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
        this.activateThemes(message.data?.activeThemeUrls)
        this.send('themes-activated', {})
        for (const queued of this.queue.splice(0)) this.send(queued.action, queued.data, queued.callback, queued.keep)
        return
      case 'themes':
        this.activateThemes(message.data?.themes)
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
   * including capital letters in secret fields. Releasing any modifier is
   * always forwarded, so Standard Notes never keeps one held down (releasing
   * Ctrl before Shift after Ctrl+Shift+Z left Shift stuck).
   */
  private onKey = (event: KeyboardEvent): void => {
    if (!this.sessionKey) return
    const modifier = MODIFIER_KEYS.includes(event.key)
    const release = event.type === 'keyup' && modifier
    // AltGr is reported as Ctrl+Alt on Windows: the character it types is text, not a shortcut.
    if (event.getModifierState?.('AltGraph') && !modifier) return
    const shortcut = event.ctrlKey || event.metaKey || event.key === 'Control' || event.key === 'Meta'
    if (!shortcut && !release) return
    // Ctrl/Cmd+S would open the browser's Save Page dialog; Standard Notes saves on its own.
    if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault()
    this.send(event.type === 'keydown' ? 'key-down' : 'key-up', {
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    })
  }

  /**
   * Loads the active Standard Notes theme stylesheets. The previous ones are
   * removed only once the new ones load, so switching themes never flashes
   * the default theme.
   */
  private activateThemes(urls: unknown): void {
    const list = Array.isArray(urls) ? urls.filter((url): url is string => typeof url === 'string') : []
    const next = [...new Set(list.map(themeUrl).filter((url): url is string => !!url))]
    const doc = this.win.document
    const current = [...doc.querySelectorAll('link[data-sn-theme]')]
    const loads: Promise<unknown>[] = []
    for (const url of next) {
      const existing = current.find((link) => link.getAttribute('href') === url)
      if (existing) {
        loads.push(this.themeLoads.get(existing) ?? Promise.resolve())
        continue
      }
      const link = doc.createElement('link')
      const load = new Promise((resolve) => {
        // Load or error always fires (a CSP block counts as an error). A slow
        // stylesheet keeps the old theme until it arrives; the page itself is
        // shown after REVEAL_AFTER_MS regardless.
        link.onload = link.onerror = resolve
      })
      this.themeLoads.set(link, load)
      loads.push(load)
      link.rel = 'stylesheet'
      link.href = url
      link.setAttribute('data-sn-theme', '')
      doc.head.appendChild(link)
    }
    const generation = ++this.themeGeneration
    void Promise.all(loads).then(() => {
      if (generation !== this.themeGeneration) return
      for (const link of current) if (!next.includes(link.getAttribute('href') ?? '')) link.remove()
      this.updateColorScheme()
      this.reveal()
    })
  }

  /** Matches checkboxes, date pickers and scrollbars to a light or dark theme. */
  private updateColorScheme(): void {
    const doc = this.win.document
    const rgb = /^rgba?\(([^)]*)\)/.exec(this.win.getComputedStyle(doc.body).backgroundColor)?.[1].split(/[\s,/]+/).map(Number)
    if (!rgb || rgb.length < 3 || rgb[3] === 0) return
    const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    doc.documentElement.style.colorScheme = luminance < 128 ? 'dark' : 'light'
  }

  private reveal = (): void => {
    this.win.document.documentElement.classList.remove('theme-pending')
  }
}
