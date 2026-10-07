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

/** A button that opens a small floating panel; closes on outside click or Escape. */
export const Popover = ({ label, icon, kind, buttonClass = 'button small', children }: Props) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div class="popover-wrap" ref={ref}>
      <button type="button" class={buttonClass} aria-haspopup={kind} aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)}>
        <Icon name={icon} /> <span class="button-text">{label}</span>
      </button>
      {open && (
        <div class={`popover popover-${kind}`} role={kind} aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
