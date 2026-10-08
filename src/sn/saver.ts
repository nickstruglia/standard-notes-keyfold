import type { Host } from './host'

// Standard Notes echoes a save back within moments. Kept short, so a
// history restore of a just-saved version right after it still counts.
const ECHO_WINDOW_MS = 2000

export interface Serialized {
  text: string
  preview: string
}

/**
 * Debounces saves and keeps them in order even though serializing can be
 * async (encryption). Serialization starts immediately on every change so a
 * ready result can be flushed synchronously when the editor loses focus or
 * is hidden. (When Standard Notes switches notes it removes the viewer before
 * the iframe, so a save sent from pagehide is dropped; the blur and
 * visibilitychange flushes are the ones that count.)
 */
export class Saver {
  private version = 0
  private ready: Serialized | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private inflight: Promise<void> = Promise.resolve()
  /** When the oldest change not yet sent to Standard Notes was made. */
  private unsentSince: number | null = null
  private readyVersion = 0
  /** Texts we sent that Standard Notes has not echoed back yet. */
  private pending: { text: string; at: number }[] = []
  /** The note text as last seen or sent. */
  lastText = ''

  constructor(
    private host: Host,
    private onError: (error: unknown) => void,
    private delayMs = 300,
    /** Saves at least this often during continuous typing. */
    private maxWaitMs = 1000,
  ) {}

  schedule(produce: () => Promise<Serialized> | Serialized): void {
    const version = ++this.version
    this.unsentSince ??= Date.now()
    const run = async () => {
      // A newer change supersedes this one: skip the work (encryption is costly).
      if (version !== this.version) return
      try {
        const out = await produce()
        if (version !== this.version) return
        this.ready = out
        this.readyVersion = version
        clearTimeout(this.timer)
        const since = this.unsentSince ?? Date.now()
        const wait = Math.max(0, Math.min(this.delayMs, since + this.maxWaitMs - Date.now()))
        this.timer = setTimeout(() => this.flush(), wait)
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
    if (this.readyVersion === this.version) this.unsentSince = null
    this.remember(out.text)
    this.host.save(out.text, out.preview)
  }

  /** True when local changes have not reached Standard Notes yet. */
  hasUnsent(): boolean {
    return this.unsentSince !== null
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
    this.unsentSince = null
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
