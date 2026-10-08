import { useRef, useState } from 'preact/hooks'
import { Icon } from './icons'
import { SECRET_ATTRS, isTouchDevice, useReveal, useUi } from './context'
import { MAX_WORDS, type MnemonicScheme, expandPrefix, splitPhrase, suggestWords, usesBip39Wordlist } from '../lib/mnemonic'

interface Props {
  words: string[]
  scheme: MnemonicScheme
  unknownWords: number[]
  onChange: (words: string[]) => void
}

/** Numbered, individually masked word inputs. Pasting a whole phrase fills the grid. */
export const WordGrid = ({ words, scheme, unknownWords, onChange }: Props) => {
  const { readOnly, copy } = useUi()
  const [revealed, setRevealed] = useReveal(words)
  const [focused, setFocused] = useState<number | null>(null)
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const wordlist = usesBip39Wordlist(scheme)
  // With a mouse, the focused word shows while you type it. On touch screens
  // it stays masked unless you reveal all words.
  const revealFocused = !isTouchDevice()

  const setWord = (index: number, value: string) => {
    const next = [...words]
    next[index] = value
    onChange(next)
  }

  /** Writes several words starting at index, growing the grid if needed. */
  const fill = (index: number, parts: string[]) => {
    const length = Math.min(MAX_WORDS, Math.max(words.length, index + parts.length))
    const next = Array.from({ length }, (_, i) => words[i] ?? '')
    parts.slice(0, length - index).forEach((w, i) => (next[index + i] = w))
    onChange(next)
    refs.current[Math.min(index + parts.length, length - 1)]?.focus()
  }

  const onPaste = (index: number, event: ClipboardEvent) => {
    const pasted = splitPhrase(event.clipboardData?.getData('text') ?? '')
    if (pasted.length < 2) return
    event.preventDefault()
    fill(index, pasted)
  }

  const onInput = (index: number, raw: string) => {
    if (!/\s/.test(raw)) {
      setWord(index, raw.toLowerCase())
      return
    }
    // Android keyboards do not report the space key, so handle it here:
    // a typed space moves to the next word, and several words fill the grid.
    const parts = splitPhrase(raw)
    if (parts.length > 1) {
      fill(index, parts)
      return
    }
    setWord(index, parts[0] ?? '')
    if (parts.length === 1) refs.current[index + 1]?.focus()
  }

  const onKeyDown = (index: number, event: KeyboardEvent) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      refs.current[index + 1]?.focus()
    } else if (event.key === 'Backspace' && !words[index] && index > 0) {
      event.preventDefault()
      refs.current[index - 1]?.focus()
    }
  }

  const onBlur = (index: number) => {
    setFocused(null)
    const word = words[index]
    if (wordlist && word) {
      const expanded = expandPrefix(word)
      if (expanded !== word) setWord(index, expanded)
    }
  }

  const filled = words.filter(Boolean)
  const focusedUnknown = focused !== null && unknownWords.includes(focused) && words[focused]
  const hints = focusedUnknown && (revealed || revealFocused) ? suggestWords(words[focused!]) : []

  return (
    <div class="word-grid-wrap">
      <div class="word-toolbar">
        <button type="button" class="button small" aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>
          <Icon name={revealed ? 'eyeOff' : 'eye'} /> {revealed ? 'Hide words' : 'Reveal words'}
        </button>
        <button
          type="button"
          class="button small"
          disabled={filled.length === 0}
          onClick={() =>
            copy(
              filled.join(' '),
              filled.length === words.length ? 'Seed phrase' : `Seed phrase (only ${filled.length} of ${words.length} words)`,
            )
          }
        >
          <Icon name="copy" /> Copy phrase
        </button>
        <span class="muted small helper">Tip: paste a whole phrase into word 1.</span>
      </div>
      <ol class="word-grid" aria-label="Seed words">
        {words.map((word, i) => {
          const visible = revealed || (revealFocused && focused === i)
          const unknown = unknownWords.includes(i) && focused !== i
          return (
            <li key={i} class={`word ${unknown ? 'word-invalid' : ''}`}>
              <span class="word-index" aria-hidden="true">
                {i + 1}
              </span>
              <input
                ref={(el) => {
                  refs.current[i] = el
                }}
                class="input mono"
                type={visible ? 'text' : 'password'}
                value={word}
                aria-label={`Word ${i + 1}`}
                aria-invalid={unknown}
                list={wordlist && visible ? 'bip39-words' : undefined}
                enterkeyhint={i === words.length - 1 ? 'done' : 'next'}
                readOnly={readOnly}
                onInput={(e) => onInput(i, e.currentTarget.value)}
                onPaste={(e) => onPaste(i, e)}
                onKeyDown={(e) => onKeyDown(i, e)}
                onFocus={() => setFocused(i)}
                onBlur={() => onBlur(i)}
                {...SECRET_ATTRS}
              />
            </li>
          )
        })}
      </ol>
      {hints.length > 0 && (
        <p class="hint" role="status">
          Not in the wordlist. Did you mean: {hints.join(', ')}?
        </p>
      )}
    </div>
  )
}
