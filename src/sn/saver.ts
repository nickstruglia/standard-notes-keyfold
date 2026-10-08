import type { Host } from './host'

const ECHO_WINDOW_MS = 5000

export interface Serialized {
  text: string
  preview: string
}

/**
 * Debounces saves and keeps them in order even though serializing can be
 * async (encryption). Serialization starts immediately on every change so a
 * ready result can be flushed synchronously when the editor is about to go
 * away (switching notes destroys the iframe).
 */
export class Saver {
  private version = 0
  private ready: Serialized | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private inflight: Promise<void> = Promise.resolve()
  /** Texts we sent that Standard Notes has not echoed back yet. */
  private pending: { text: string; at: number }[] = []
  /** The note text as last seen or sent. */
  lastText = ''

  constructor(
    private host: Host,
    private onError: (error: unknown) => void,
    private delayMs = 300,
  ) {}

  schedule(produce: () => Promise<Serialized> | Serialized): void {
    const version = ++this.version
    const run = async () => {
      try {
        const out = await produce()
        if (version !== this.version) return
        this.ready = out
        clearTimeout(this.timer)
        this.timer = setTimeout(() => this.flush(), this.delayMs)
      } catch (error) {
        if (version === this.version) this.onError(error)
      }
    }
    this.inflight = this.inflight.then(run)
  }

  /** Sends the latest serialized state right away, if any. */
  flush(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    const out = this.ready
    if (!out) return
    this.ready = null
    this.remember(out.text)
    this.host.save(out.text, out.preview)
  }

  /** Waits for in-flight serialization, then flushes. */
  async settle(): Promise<void> {
    await this.inflight
    this.flush()
  }

  /** Drops pending work, e.g. when a newer version arrives from another device. */
  cancel(): void {
    this.version++
    clearTimeout(this.timer)
    this.timer = undefined
    this.ready = null
  }

  /**
   * True when the text is one of our own saves coming back. Echoes arrive
   * within moments, so a save older than ECHO_WINDOW_MS no longer counts:
   * an older version restored from note history is treated as a real change.
   */
  isEcho(text: string): boolean {
    const now = Date.now()
    this.pending = this.pending.filter((p) => now - p.at < ECHO_WINDOW_MS)
    const index = this.pending.findIndex((p) => p.text === text)
    if (index !== -1) {
      // Saves older than this one can no longer come back as echoes.
      this.pending.splice(0, index)
      return true
    }
    // Identical to what the editor already shows: nothing changed.
    return text !== '' && text === this.lastText
  }

  /** Drops pending work and remembered texts, e.g. when the vault locks. */
  forget(): void {
    this.cancel()
    this.pending = []
  }

  noteSeen(text: string): void {
    this.lastText = text
  }

  private remember(text: string): void {
    this.lastText = text
    this.pending.push({ text, at: Date.now() })
    if (this.pending.length > 20) this.pending.shift()
  }
}
