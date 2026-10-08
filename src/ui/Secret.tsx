import { useEffect, useRef, useState } from 'preact/hooks'
import { Icon } from './icons'
import { SECRET_ATTRS, useReveal, useUi } from './context'

interface SecretProps {
  value: string
  onInput: (value: string) => void
  /** Used for the copy toast and the accessible name. */
  label: string
  placeholder?: string
  multiline?: boolean
  mono?: boolean
  id?: string
  /** Called instead of flattening when text with line breaks is pasted into a one-line field. */
  onMultilinePaste?: (value: string) => void
}

/**
 * A field that stays masked until revealed, hides itself again after the
 * configured delay, and copies with automatic clipboard clearing.
 *
 * Masked values sit in real password inputs (not CSS-masked text), so mobile
 * keyboards do not learn them, screen readers do not read them out, macOS
 * Secure Input applies, and Ctrl+C cannot copy them. A multi-line secret
 * cannot be a password input, so it is not rendered at all until revealed.
 */
export const SecretField = ({ value, onInput, label, placeholder, multiline, mono, id, onMultilinePaste }: SecretProps) => {
  const { readOnly, copy } = useUi()
  const [revealed, setRevealed] = useReveal(value)
  const className = `input ${mono ? 'mono' : ''}`
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const [focusArea, setFocusArea] = useState(false)
  useEffect(() => {
    if (focusArea && revealed) {
      areaRef.current?.focus()
      setFocusArea(false)
    }
  }, [focusArea, revealed])

  let control
  if (multiline && !revealed) {
    control = (
      <button
        type="button"
        class="input masked-placeholder"
        aria-label={`${label} (hidden). Reveal to view or edit`}
        onClick={() => {
          setRevealed(true)
          setFocusArea(true)
        }}
      >
        {value ? `${'•'.repeat(12)}  ${value.length} characters, hidden` : placeholder || 'Empty'}
      </button>
    )
  } else if (multiline) {
    control = (
      <textarea
        ref={areaRef}
        id={id}
        class={className}
        value={value}
        rows={value.length > 120 ? 6 : 3}
        placeholder={placeholder}
        aria-label={label}
        readOnly={readOnly}
        onInput={(e) => onInput(e.currentTarget.value)}
        {...SECRET_ATTRS}
      />
    )
  } else {
    control = (
      <input
        id={id}
        class={className}
        type={revealed ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        readOnly={readOnly}
        onInput={(e) => onInput(e.currentTarget.value)}
        onPaste={(e) => {
          const text = e.clipboardData?.getData('text') ?? ''
          if (!onMultilinePaste || !/[\r\n]/.test(text)) return
          e.preventDefault()
          const input = e.currentTarget
          const start = input.selectionStart ?? value.length
          const end = input.selectionEnd ?? value.length
          onMultilinePaste(value.slice(0, start) + text + value.slice(end))
        }}
        {...SECRET_ATTRS}
      />
    )
  }

  return (
    <div class={`secret ${multiline ? 'secret-multiline' : ''}`}>
      {control}
      <div class="secret-actions">
        <button
          type="button"
          class="icon-button"
          title={revealed ? 'Hide' : 'Reveal'}
          aria-label={`${revealed ? 'Hide' : 'Reveal'} ${label}`}
          aria-pressed={revealed}
          onClick={() => setRevealed(!revealed)}
        >
          <Icon name={revealed ? 'eyeOff' : 'eye'} />
        </button>
        <button
          type="button"
          class="icon-button"
          title="Copy"
          aria-label={`Copy ${label}`}
          disabled={!value}
          onClick={() => copy(value, label)}
        >
          <Icon name="copy" />
        </button>
      </div>
    </div>
  )
}
