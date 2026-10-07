import { useState } from 'preact/hooks'
import { Icon } from './icons'
import { SECRET_ATTRS, supportsTextSecurity, useReveal, useUi } from './context'

interface SecretProps {
  value: string
  onInput: (value: string) => void
  /** Used for the copy toast and the accessible name. */
  label: string
  placeholder?: string
  multiline?: boolean
  mono?: boolean
  id?: string
}

/**
 * A field that stays masked until revealed, hides itself again after the
 * configured delay, and copies with automatic clipboard clearing.
 */
export const SecretField = ({ value, onInput, label, placeholder, multiline, mono, id }: SecretProps) => {
  const { readOnly, copy } = useUi()
  const [revealed, setRevealed] = useReveal(value)
  const [editingHidden, setEditingHidden] = useState(false)
  const masked = !revealed
  const cssMask = supportsTextSecurity()
  const className = `input ${mono ? 'mono' : ''} ${masked && cssMask ? 'masked' : ''}`

  let control
  if (multiline) {
    if (masked && !cssMask && !editingHidden) {
      control = (
        <button type="button" class="input masked-placeholder" onClick={() => setRevealed(true)} disabled={!value && readOnly}>
          {value ? '•'.repeat(Math.min(value.length, 32)) : placeholder || 'Empty'}
        </button>
      )
    } else {
      control = (
        <textarea
          id={id}
          class={className}
          value={value}
          rows={value.length > 120 ? 6 : 3}
          placeholder={placeholder}
          aria-label={label}
          readOnly={readOnly}
          onInput={(e) => onInput(e.currentTarget.value)}
          onFocus={() => setEditingHidden(true)}
          onBlur={() => setEditingHidden(false)}
          {...SECRET_ATTRS}
        />
      )
    }
  } else {
    control = (
      <input
        id={id}
        class={className}
        type={masked && !cssMask ? 'password' : 'text'}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        readOnly={readOnly}
        onInput={(e) => onInput(e.currentTarget.value)}
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
