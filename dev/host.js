// Mock of the Standard Notes side of the component protocol
// (see @standardnotes/component-relay). Used for development and e2e tests.

const params = new URLSearchParams(location.search)
const editorUrl = params.get('editor') || '/'
const iframe = document.getElementById('editor')
const sessionKey = crypto.randomUUID()

const state = {
  note: {
    uuid: 'note-1',
    content_type: 'Note',
    content: {
      title: 'Crypto',
      text: params.get('text') || '',
      // ?noteType=authentication: a note made by an early Keyfold version.
      ...(params.get('noteType') ? { noteType: params.get('noteType') } : {}),
      appData: { 'org.standardnotes.sn': { locked: params.get('locked') === '1' } },
    },
  },
  saves: [],
  contextMessage: null,
  theme: params.get('theme') === 'dark' || params.has('themeUrl'),
}
window.mockHost = state
// Lets tests stream arbitrary text, e.g. a revision restored from note history.
state.restore = (text) => {
  state.note.content.text = text
  streamNote()
  render()
}

const render = () => {
  document.getElementById('note').textContent = state.note.content.text
  document.getElementById('save-count').textContent = String(state.saves.length)
  document.getElementById('preview').textContent = state.note.content.preview_plain || ''
}

const send = (message) => iframe.contentWindow.postMessage(message, '*')

const streamNote = (isMetadataUpdate = false) => {
  if (!state.contextMessage) return
  send({
    action: 'reply',
    original: state.contextMessage,
    data: { item: { ...structuredClone(state.note), isMetadataUpdate } },
  })
}

window.addEventListener('message', (event) => {
  if (event.source !== iframe.contentWindow) return
  const message = event.data
  if (!message || message.sessionKey !== sessionKey) return
  switch (message.action) {
    case 'stream-context-item':
      state.contextMessage = message
      streamNote()
      break
    case 'save-items': {
      // Like Standard Notes: a note with "Prevent editing" on refuses saves
      // (it shows an alert and never replies).
      if (state.note.content.appData['org.standardnotes.sn'].locked) {
        state.rejectedSaves = (state.rejectedSaves ?? 0) + 1
        break
      }
      const item = message.data.items.find((i) => i.uuid === state.note.uuid)
      if (item) {
        state.note.content = { ...state.note.content, ...item.content }
        state.saves.push(item.content.text)
      }
      send({ action: 'reply', original: message, data: {} })
      // Standard Notes streams the saved item back to the editor.
      streamNote(true)
      render()
      break
    }
    default:
      break
  }
})

// ?mobile=1 registers the way the Android and iOS apps do. They send their
// built-in themes as data: URLs (ComponentManager.fetchNativeThemesOnMobile),
// or, with ?mobile=file, as the file:// URLs they fall back to.
const mobile = params.get('mobile')
const darkThemeUrl = new URL('./dark-theme.css', location.href).href
let darkThemeData

const themeUrls = async () => {
  if (!state.theme) return []
  // ?themeUrl=<stylesheet>: any theme, e.g. a third-party one from its own site.
  if (params.get('themeUrl')) return [params.get('themeUrl')]
  if (mobile === 'file') return ['file:///android_asset/Web.bundle/src/web-src/components/assets/org.standardnotes.theme-focus/index.css']
  if (mobile) {
    darkThemeData ??= fetch(darkThemeUrl)
      .then((response) => response.text())
      // Inside the null-origin wrapper the fetch is blocked by CORS: use a copy.
      .catch(() => ':root { --sn-stylekit-background-color: #15161a; --sn-stylekit-foreground-color: #e6e6e6; }')
      .then((css) => `data:text/css;base64,${btoa(css)}`)
    return [await darkThemeData]
  }
  return [darkThemeUrl]
}

const register = async () => {
  const themes = await themeUrls()
  send({
    action: 'component-registered',
    sessionKey,
    componentData: {},
    data: {
      uuid: 'component-1',
      environment: mobile ? 'native-mobile-web' : 'web',
      platform: mobile ? 'android' : 'linux',
      activeThemeUrls: themes,
    },
  })
  // Standard Notes follows registration with the same themes again.
  send({ action: 'themes', data: { themes } })
}

// The same sandbox Standard Notes gives third-party plugins (IframeFeatureView.tsx):
// no allow-same-origin, so the editor runs with an opaque "null" origin, and no
// allow= attribute, so the async Clipboard API is blocked. Pass ?sandbox=0 when
// using the Vite dev server, whose module scripts need same-origin access.
if (params.get('sandbox') !== '0') {
  iframe.setAttribute(
    'sandbox',
    'allow-scripts allow-top-navigation-by-user-activation allow-popups allow-modals allow-forms allow-downloads',
  )
}
iframe.addEventListener('load', register)
iframe.src = editorUrl

document.getElementById('toggle-lock').onclick = () => {
  const appData = state.note.content.appData['org.standardnotes.sn']
  appData.locked = !appData.locked
  streamNote()
}
document.getElementById('toggle-theme').onclick = async () => {
  state.theme = !state.theme
  send({ action: 'themes', data: { themes: await themeUrls() } })
}
document.getElementById('remote-edit').onclick = () => {
  const text = state.note.content.text
  try {
    const doc = JSON.parse(text)
    if (doc.vault) {
      doc.vault.entries.unshift({ id: crypto.randomUUID(), kind: 'other', label: 'Added on another device' })
      state.note.content.text = JSON.stringify(doc)
      streamNote()
      render()
    }
  } catch {
    // not a plain vault
  }
}
document.getElementById('reload').onclick = () => {
  state.contextMessage = null
  iframe.src = editorUrl
}
document.getElementById('reset').onclick = () => {
  state.note.content.text = ''
  streamNote()
  render()
}
render()
