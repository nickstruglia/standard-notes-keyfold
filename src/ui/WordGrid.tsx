import { useEffect, useRef, useState } from 'preact/hooks'
import { Icon } from './icons'
import { SECRET_ATTRS, isTouchDevice, useReveal, useUi } from './context'
import { MAX_WORDS, type MnemonicScheme, expandPrefix, isBip39Word, parsePhrase, splitPhrase, suggestWords, usesBip39Wordlist } from '../lib/mnemonic'

interface Props {
  words: string[]
  scheme: MnemonicScheme
  unknownWords: number[]
  onChange: (words: string[]) => void
}

/** Numbered, individually masked word inputs. Pasting a whole phrase fills the grid. */
export const WordGrid = ({ words, scheme, unknownWords, onChange }: Props) => {
  const { readOnly, copy, settings } = useUi()
  const [revealed, setRevealed] = useReveal(words)
  const [focused, setFocused] = useState<number | null>(null)
  // With a mouse or keyboard, the word being typed shows while you type it.
  // Focus alone (tabbing past the grid) never reveals a word.
  const [typing, setTyping] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const wordlist = usesBip39Wordlist(scheme)
  const revealTyped = !isTouchDevice()

  // Mask the typed word again after the auto-hide delay without input.
  useEffect(() => {
    if (typing === null || !settings.autoHideSeconds) return
    const timer = setTimeout(() => setTyping(null), settings.autoHideSeconds * 1000)
    return () => clearTimeout(timer)
  }, [typing, words, settings.autoHideSeconds])

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
    const parsed = parsePhrase(event.clipboardData?.getData('text') ?? '')
    if (parsed.words.length < 2) return
    event.preventDefault()
    // Numbered words go to their own positions ("13. word" into word 13).
    const start = parsed.firstNumber !== undefined && parsed.firstNumber - 1 < MAX_WORDS ? parsed.firstNumber - 1 : index
    fill(start, parsed.words)
    setNotice(parsed.reordered ? 'Placed the pasted words by their numbers. Check the order.' : '')
  }

  const onInput = (index: number, event: InputEvent) => {
    const input = event.currentTarget as HTMLInputElement
    const raw = input.value
    // Input methods (Japanese, Chinese, Korean, dictation) are still
    // composing: keep the text as typed and act when composition ends.
    if (event.isComposing) {
      setWord(index, raw)
      return
    }
    commit(index, input)
  }

  const commit = (index: number, input: HTMLInputElement) => {
    const raw = input.value
    if (!/\s/.test(raw)) {
      const lower = raw.toLowerCase()
      if (lower !== raw) {
        // Lowercase in place so the caret stays where it was.
        const [start, end] = [input.selectionStart, input.selectionEnd]
        input.value = lower
        if (start !== null && end !== null) input.setSelectionRange(start, end)
      }
      setWord(index, lower)
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
    // Keys an input method is using (keyCode 229) are not ours.
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      refs.current[index + 1]?.focus()
    } else if (event.key === 'Backspace' && !words[index] && index > 0) {
      event.preventDefault()
      refs.current[index - 1]?.focus()
    } else if (revealTyped && (event.key.length === 1 || event.key === 'Backspace') && !event.ctrlKey && !event.metaKey) {
      setTyping(index)
    }
  }

  const onBlur = () => {
    setFocused(null)
    setTyping(null)
  }

  const applyWord = (index: number, word: string) => {
    setWord(index, word)
    refs.current[index]?.focus()
  }

  // Abbreviations are only expanded on request: words from other wordlists
  // can look like English prefixes.
  const expansions = wordlist
    ? unknownWords.map((i) => [i, expandPrefix(words[i] ?? '')] as const).filter(([i, w]) => w !== words[i] && isBip39Word(w))
    : []
  const canExpand = expansions.length > 0 && expansions.length === unknownWords.length
  const expandAll = () => {
    const next = [...words]
    for (const [i, w] of expansions) next[i] = w
    onChange(next)
  }

  const filled = words.filter(Boolean)
  const shown = (i: number) => revealed || (revealTyped && typing === i)
  const focusedUnknown = focused !== null && unknownWords.includes(focused) && words[focused]
  const hints = focusedUnknown && shown(focused!) ? suggestWords(words[focused!]) : []

  return (
    <div class="word-grid-wrap">
      <div class="word-toolbar">
        <button type="button" class="button small" onClick={() => setRevealed(!revealed)}>
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
        <span class="muted small helper">
          Tip: paste a whole phrase into word 1.{isTouchDevice() ? ' Phrases in other scripts (Japanese, Chinese…) can only be pasted on phones.' : ''}
        </span>
      </div>
      <ol class="word-grid" aria-label="Seed words">
        {words.map((word, i) => {
          const visible = shown(i)
          const unknown = unknownWords.includes(i) && focused !== i
          return (
            <li key={i} class={`word ${unknown ? 'word-invalid' : ''}`}>
              <span class="word-index" aria-hidden="true">
                {i + 1}
              </span>
              <input
                ref={(el) => {
                  // A field first created while words are revealed starts as a
                  // password field for a moment, so the keyboard treats it as one.
                  if (el && !refs.current[i] && el.type === 'text') {
                    el.type = 'password'
                    el.type = 'text'
                  }
                  refs.current[i] = el
                }}
                class="input mono"
                // Spread as one object per type: a word list only goes with a visible (text) field.
                {...(visible ? { type: 'text' as const, list: wordlist ? 'bip39-words' : undefined } : { type: 'password' as const })}
                value={word}
                aria-label={`Word ${i + 1}`}
                aria-invalid={unknown}
                enterkeyhint={i === words.length - 1 ? 'done' : 'next'}
                readOnly={readOnly}
                onInput={(e) => onInput(i, e as unknown as InputEvent)}
                onPaste={(e) => onPaste(i, e)}
                onKeyDown={(e) => onKeyDown(i, e)}
                onFocus={() => setFocused(i)}
                onBlur={onBlur}
                {...{ oncompositionend: (e: CompositionEvent) => commit(i, e.currentTarget as HTMLInputElement) }}
                {...SECRET_ATTRS}
              />
            </li>
          )
        })}
      </ol>
      {hints.length > 0 && (
        <p class="hint" role="status">
          Not in the wordlist. Did you mean:{' '}
          {hints.map((h) => (
            <button
              type="button"
              key={h}
              class="link-button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyWord(focused!, h)}
            >
              {h}
            </button>
          ))}
          ?
        </p>
      )}
      {canExpand && !readOnly && (
        <p class="hint">
          <button type="button" class="button small" onClick={expandAll}>
            Expand abbreviated words
          </button>{' '}
          <span class="muted small">Only for English BIP39 phrases.</span>
        </p>
      )}
      {notice && (
        <p class="hint" role="status">
          {notice}
        </p>
      )}
    </div>
  )
}
