import type { Host } from './host'

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
  private recent: string[] = []
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

  /** True when the text is one of our own recent saves coming back. */
  isEcho(text: string): boolean {
    return this.recent.includes(text)
  }

  noteSeen(text: string): void {
    this.lastText = text
  }

  private remember(text: string): void {
    this.lastText = text
    this.recent.push(text)
    if (this.recent.length > 20) this.recent.shift()
  }
}
