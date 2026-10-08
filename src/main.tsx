import { render } from 'preact'
import { App } from './ui/App'
import { createDemoHost, createStandardNotesHost, createViewerHost, isEmbedded } from './sn/host'
import { OpenNote } from './ui/OpenNote'
import { demoNoteText } from './demo'
import './styles.css'

// The single-file offline viewer (keyfold-viewer.html) never talks to a host.
const offlineViewer = document.documentElement.hasAttribute('data-viewer')
const embedded = !offlineViewer && isEmbedded()
document.documentElement.classList.toggle('standalone', !embedded)
// Inside Standard Notes the relay shows the page once the theme applies.
if (!embedded) document.documentElement.classList.remove('theme-pending')

const root = document.getElementById('app')!
if (embedded) {
  render(<App host={createStandardNotesHost()} />, root)
} else if (offlineViewer || location.hash === '#open') {
  // Recovery: read a backup file or a pasted note without Standard Notes.
  render(<OpenNote offlineViewer={offlineViewer} onOpen={(text) => render(<App host={createViewerHost(text)} />, root)} />, root)
} else {
  render(<App host={createDemoHost(demoNoteText())} />, root)
}
