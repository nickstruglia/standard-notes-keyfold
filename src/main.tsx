import { render } from 'preact'
import { App } from './ui/App'
import { createDemoHost, createStandardNotesHost, isEmbedded } from './sn/host'
import { demoNoteText } from './demo'
import './styles.css'

const embedded = isEmbedded()
document.documentElement.classList.toggle('standalone', !embedded)

const host = embedded ? createStandardNotesHost() : createDemoHost(demoNoteText())
render(<App host={host} />, document.getElementById('app')!)
