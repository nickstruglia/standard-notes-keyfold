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
    content: { title: 'Crypto', text: params.get('text') || '', appData: { 'org.standardnotes.sn': { locked: false } } },
  },
  saves: [],
  contextMessage: null,
  theme: false,
}
window.mockHost = state

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
      const item = message.data.items.find((i) => i.uuid === state.note.uuid)
      if (item) {
        state.note.content = { ...state.note.content, ...item.content }
        state.saves.push(item.content.text)
      }
      send({ action: 'reply', original: message, data: {} })
      render()
      break
    }
    default:
      break
  }
})

const register = () => {
  send({
    action: 'component-registered',
    sessionKey,
    componentData: {},
    data: { uuid: 'component-1', environment: 'web', platform: 'linux', activeThemeUrls: state.theme ? [themeUrl()] : [] },
  })
}

const themeUrl = () => new URL('./dark-theme.css', location.href).href

iframe.addEventListener('load', register)
iframe.src = editorUrl

document.getElementById('toggle-lock').onclick = () => {
  const appData = state.note.content.appData['org.standardnotes.sn']
  appData.locked = !appData.locked
  streamNote(true)
}
document.getElementById('toggle-theme').onclick = () => {
  state.theme = !state.theme
  send({ action: 'themes', data: { themes: state.theme ? [themeUrl()] : [] } })
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
