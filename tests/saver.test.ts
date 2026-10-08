import { afterEach, describe, expect, it, vi } from 'vitest'
import { Saver } from '../src/sn/saver'
import type { Host } from '../src/sn/host'

const host = (): Host & { sent: string[] } => {
  const sent: string[] = []
  return { mode: 'demo', sent, subscribe: () => undefined, save: (text) => sent.push(text) }
}

afterEach(() => vi.useRealTimers())

describe('Saver echo detection', () => {
  it('recognizes its own saves, including late echoes of older ones', async () => {
    const h = host()
    const saver = new Saver(h, () => undefined)
    for (const text of ['a', 'b']) {
      saver.schedule(() => ({ text, preview: '' }))
      await saver.settle()
    }
    expect(h.sent).toEqual(['a', 'b'])
    expect(saver.isEcho('a')).toBe(true)
    expect(saver.isEcho('b')).toBe(true)
    // Once a newer save has come back, an older one is a real change.
    expect(saver.isEcho('a')).toBe(false)
    // A repeated echo of the latest save is still ignored.
    expect(saver.isEcho('b')).toBe(true)
  })

  it('treats an old version coming back later as a real change (history restore)', async () => {
    vi.useFakeTimers()
    const saver = new Saver(host(), () => undefined)
    saver.schedule(() => ({ text: 'v1', preview: '' }))
    await saver.settle()
    saver.schedule(() => ({ text: 'v2', preview: '' }))
    await saver.settle()
    vi.advanceTimersByTime(10_000)
    expect(saver.isEcho('v1')).toBe(false)
  })

  it('keeps saves in order even when serializing takes different times', async () => {
    const h = host()
    const saver = new Saver(h, () => undefined)
    saver.schedule(() => new Promise((r) => setTimeout(() => r({ text: 'slow', preview: '' }), 20)))
    saver.schedule(() => ({ text: 'fast', preview: '' }))
    await saver.settle()
    expect(h.sent).toEqual(['fast'])
  })
})
