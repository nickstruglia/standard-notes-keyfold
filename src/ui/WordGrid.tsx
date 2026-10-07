import { useRef, useState } from 'preact/hooks'
import { Icon } from './icons'
import { SECRET_ATTRS, supportsTextSecurity, useReveal, useUi } from './context'
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
  const cssMask = supportsTextSecurity()

  const setWord = (index: number, value: string) => {
    const next = [...words]
    next[index] = value
    onChange(next)
  }

  const onPaste = (index: number, event: ClipboardEvent) => {
    const text = event.clipboardData?.getData('text') ?? ''
    const pasted = splitPhrase(text)
    if (pasted.length < 2) return
    event.preventDefault()
    const length = Math.min(MAX_WORDS, Math.max(words.length, index + pasted.length))
    const next = Array.from({ length }, (_, i) => words[i] ?? '')
    pasted.slice(0, length - index).forEach((w, i) => (next[index + i] = w))
    onChange(next)
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

  const focusedUnknown = focused !== null && unknownWords.includes(focused) && words[focused]
  const hints = focusedUnknown ? suggestWords(words[focused!]) : []

  return (
    <div class="word-grid-wrap">
      <div class="word-toolbar">
        <button type="button" class="button small" aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>
          <Icon name={revealed ? 'eyeOff' : 'eye'} /> {revealed ? 'Hide words' : 'Reveal words'}
        </button>
        <button
          type="button"
          class="button small"
          disabled={!words.some(Boolean)}
          onClick={() => copy(words.filter(Boolean).join(' '), 'Seed phrase')}
        >
          <Icon name="copy" /> Copy phrase
        </button>
        <span class="muted small">Tip: paste a whole phrase into word 1.</span>
      </div>
      <ol class="word-grid" aria-label="Seed words">
        {words.map((word, i) => {
          const visible = revealed || focused === i
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
                class={`input mono ${!visible && cssMask ? 'masked' : ''}`}
                type={!visible && !cssMask ? 'password' : 'text'}
                value={word}
                aria-label={`Word ${i + 1}`}
                aria-invalid={unknown}
                list={wordlist && visible ? 'bip39-words' : undefined}
                readOnly={readOnly}
                onInput={(e) => setWord(i, e.currentTarget.value.trim().toLowerCase())}
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
