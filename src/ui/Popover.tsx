import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Icon, type IconName } from './icons'

interface Props {
  label: string
  icon: IconName
  /** "menu" for a list of actions, "dialog" for a panel of controls. */
  kind: 'menu' | 'dialog'
  buttonClass?: string
  children: (close: () => void) => ComponentChildren
}

/**
 * A button that opens a small floating panel (a disclosure, not an ARIA
 * menu: its items are ordinary buttons reached with Tab). Closes on an
 * outside click, when focus leaves it, or with Escape, which returns focus
 * to the button.
 */
export const Popover = ({ label, icon, kind, buttonClass = 'button small', children }: Props) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !open) return
    e.stopPropagation()
    setOpen(false)
    buttonRef.current?.focus()
  }

  // Tabbing out closes it. relatedTarget is null for ordinary clicks in some
  // browsers; those are handled by the pointerdown listener.
  const onFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null
    if (next && !ref.current?.contains(next)) setOpen(false)
  }

  return (
    <div class="popover-wrap" ref={ref} onKeyDown={onKeyDown} onFocusOut={onFocusOut}>
      <button
        type="button"
        ref={buttonRef}
        class={buttonClass}
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen(!open)}
      >
        <Icon name={icon} /> <span class="button-text">{label}</span>
      </button>
      {open && (
        <div class={`popover popover-${kind}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
