import { describe, expect, it } from 'vitest'
import { StandardNotesRelay, replyTarget, themeUrl } from '../src/sn/relay'

type FakeLink = { href?: string; onload?: () => void; onerror?: () => void; getAttribute(name: string): string | null }

/** A minimal stand-in for the editor's window and its parent (Standard Notes). */
const setup = () => {
  const listeners: Record<string, ((e: any) => void)[]> = {}
  const posted: { message: any; target: string }[] = []
  const parent = { postMessage: (message: unknown, target: string) => posted.push({ message, target }) }
  const links: FakeLink[] = []
  const classes = new Set(['theme-pending'])
  const root = { classList: { remove: (name: string) => classes.delete(name) }, style: { colorScheme: '' } }
  const page = { background: 'rgb(255, 255, 255)' }
  const doc = {
    documentElement: root,
    body: {},
    head: { appendChild: (el: FakeLink) => links.push(el) },
    querySelectorAll: () => [...links],
    createElement: () => {
      const link: FakeLink & Record<string, unknown> = {
        setAttribute() {},
        getAttribute: (name: string) => (name === 'href' ? (link.href ?? null) : null),
        remove: () => links.splice(links.indexOf(link), 1),
      }
      return link
    },
  }
  const win = {
    parent,
    document: doc,
    getComputedStyle: () => ({ backgroundColor: page.background }),
    addEventListener: (type: string, fn: (e: any) => void) => (listeners[type] ??= []).push(fn),
  }
  const emit = (type: string, event: unknown) => listeners[type]?.forEach((fn) => fn(event))
  const fromApp = (data: unknown, origin = 'null', source: unknown = parent) => emit('message', { source, origin, data })
  const relay = new StandardNotesRelay(win as unknown as Window)
  return { relay, posted, emit, fromApp, links, classes, root, page }
}

const settle = () => new Promise((resolve) => setTimeout(resolve))

const register = (env: ReturnType<typeof setup>, origin = 'null', environment = 'native-mobile-web') =>
  env.fromApp(
    { action: 'component-registered', sessionKey: 'session-1', data: { environment, activeThemeUrls: ['https://app/theme.css'] } },
    origin,
  )

describe('replyTarget', () => {
  it('targets web origins exactly and falls back to * for null and file origins', () => {
    expect(replyTarget('https://app.standardnotes.com')).toBe('https://app.standardnotes.com')
    expect(replyTarget('http://127.0.0.1:45653')).toBe('http://127.0.0.1:45653')
    expect(replyTarget('null')).toBe('*')
    expect(replyTarget('file://')).toBe('*')
    expect(replyTarget(undefined)).toBe('*')
  })
})

describe('themeUrl', () => {
  it('loads web and desktop theme URLs as they are', () => {
    expect(themeUrl('https://app.standardnotes.com/components/assets/org.standardnotes.theme-midnight/index.css')).toBe(
      'https://app.standardnotes.com/components/assets/org.standardnotes.theme-midnight/index.css',
    )
    expect(themeUrl('http://localhost:45653/components/org.standardnotes.theme-midnight/index.css')).toBe(
      'http://localhost:45653/components/org.standardnotes.theme-midnight/index.css',
    )
    expect(themeUrl('https://example.com/my-theme.css')).toBe('https://example.com/my-theme.css')
  })

  it("loads the mobile apps' built-in themes from Standard Notes' web copies", () => {
    expect(themeUrl('file:///android_asset/Web.bundle/src/web-src/components/assets/org.standardnotes.theme-focus/index.css')).toBe(
      'https://app.standardnotes.com/components/assets/org.standardnotes.theme-focus/index.css',
    )
    expect(
      themeUrl('file:///private/var/containers/Bundle/Application/ABC/StandardNotes.app/Web.bundle/src/web-src/components/assets/com.standardnotes.theme-proton/index.css'),
    ).toBe('https://app.standardnotes.com/components/assets/com.standardnotes.theme-proton/index.css')
  })

  it('ignores URLs it cannot load', () => {
    expect(themeUrl('file:///android_asset/web-src/components/assets/../../secrets/index.css')).toBeUndefined()
    expect(themeUrl('file:///android_asset/web-src/components/assets/org.standardnotes.theme-focus/index.js')).toBeUndefined()
    expect(themeUrl('javascript:alert(1)')).toBeUndefined()
    expect(themeUrl('theme.css')).toBeUndefined()
  })
})

describe('StandardNotesRelay', () => {
  it('queues requests until registered, then sends them with the session key', () => {
    const env = setup()
    const items: unknown[] = []
    env.relay.streamContextItem((item) => items.push(item))
    expect(env.posted).toHaveLength(0)

    register(env)
    const actions = env.posted.map((p) => p.message.action)
    expect(actions).toEqual(['themes-activated', 'stream-context-item'])
    expect(env.posted.every((p) => p.target === '*' && p.message.sessionKey === 'session-1')).toBe(true)
    expect(env.links.map((l) => l.href)).toEqual(['https://app/theme.css'])

    // Every reply to the stream request delivers the latest note.
    const request = env.posted[1].message
    env.fromApp({ action: 'reply', original: { messageId: request.messageId }, data: { item: { uuid: 'n1' } } })
    env.fromApp({ action: 'reply', original: { messageId: request.messageId }, data: { item: { uuid: 'n1', v: 2 } } })
    expect(items).toEqual([{ uuid: 'n1' }, { uuid: 'n1', v: 2 }])
  })

  it('replies to an https app origin exactly', () => {
    const env = setup()
    register(env, 'https://app.standardnotes.com', 'web')
    env.relay.saveItem({ uuid: 'n1' })
    expect(env.posted.at(-1)).toMatchObject({ target: 'https://app.standardnotes.com', message: { action: 'save-items' } })
  })

  it('accepts JSON strings and ignores messages that are not from the parent window', () => {
    const env = setup()
    env.fromApp({ action: 'component-registered', sessionKey: 'evil', data: {} }, 'https://evil.example', {})
    expect(env.posted).toHaveLength(0)
    env.fromApp(JSON.stringify({ action: 'component-registered', sessionKey: 'session-1', data: {} }))
    expect(env.posted.map((p) => p.message.action)).toEqual(['themes-activated'])
    // A second registration cannot replace the session.
    env.fromApp({ action: 'component-registered', sessionKey: 'session-2', data: {} })
    env.relay.saveItem({})
    expect(env.posted.at(-1)?.message.sessionKey).toBe('session-1')
  })

  it('runs a save callback once', () => {
    const env = setup()
    register(env)
    let saved = 0
    env.relay.saveItem({ uuid: 'n1' }, () => saved++)
    const id = env.posted.at(-1)!.message.messageId
    env.fromApp({ action: 'reply', original: { messageId: id }, data: {} })
    env.fromApp({ action: 'reply', original: { messageId: id }, data: {} })
    expect(saved).toBe(1)
  })

  it('sends strings only to the legacy "mobile" environment', () => {
    const env = setup()
    register(env, 'null', 'mobile')
    expect(typeof env.posted[0].message).toBe('string')
  })

  it('forwards Ctrl/Cmd shortcuts and clicks, but not ordinary typing', () => {
    const env = setup()
    register(env)
    const before = env.posted.length
    env.emit('keydown', { type: 'keydown', key: 'A', code: 'KeyA', shiftKey: true, ctrlKey: false, metaKey: false, altKey: false })
    env.emit('keydown', { type: 'keydown', key: 'π', code: 'KeyP', shiftKey: false, ctrlKey: false, metaKey: false, altKey: true })
    expect(env.posted.length).toBe(before)
    env.emit('keydown', { type: 'keydown', key: 'k', code: 'KeyK', shiftKey: false, ctrlKey: true, metaKey: false, altKey: false })
    env.emit('click', {})
    expect(env.posted.slice(before).map((p) => p.message.action)).toEqual(['key-down', 'click'])
  })

  it('shows the page once the theme loads, and swaps themes without a flash of the default one', async () => {
    const env = setup()
    const focus = 'file:///android_asset/Web.bundle/src/web-src/components/assets/org.standardnotes.theme-focus/index.css'
    env.fromApp({ action: 'component-registered', sessionKey: 'session-1', data: { activeThemeUrls: [focus] } })
    // Standard Notes repeats the active themes right after registering.
    env.fromApp({ action: 'themes', data: { themes: [focus] } })
    expect(env.links.map((l) => l.href)).toEqual(['https://app.standardnotes.com/components/assets/org.standardnotes.theme-focus/index.css'])
    await settle()
    expect(env.classes.has('theme-pending')).toBe(true)

    env.page.background = 'rgb(15, 16, 17)'
    env.links[0].onload!()
    await settle()
    expect(env.classes.has('theme-pending')).toBe(false)
    expect(env.root.style.colorScheme).toBe('dark')

    // The old theme stays until the new one has loaded.
    env.fromApp({ action: 'themes', data: { themes: ['https://example.com/light.css'] } })
    await settle()
    expect(env.links).toHaveLength(2)
    env.page.background = 'rgb(250, 250, 250)'
    env.links[1].onload!()
    await settle()
    expect(env.links.map((l) => l.href)).toEqual(['https://example.com/light.css'])
    expect(env.root.style.colorScheme).toBe('light')

    env.fromApp({ action: 'themes', data: { themes: [] } })
    await settle()
    expect(env.links).toHaveLength(0)
  })

  it('shows the page right away when no theme is active', async () => {
    const env = setup()
    env.fromApp({ action: 'component-registered', sessionKey: 'session-1', data: {} })
    await settle()
    expect(env.classes.has('theme-pending')).toBe(false)
    expect(env.root.style.colorScheme).toBe('light')
  })
})
