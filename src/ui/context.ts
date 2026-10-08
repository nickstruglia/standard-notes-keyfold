import { createContext } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import { DEFAULT_SETTINGS, type VaultSettings } from '../lib/vault'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}

export interface Ui {
  settings: VaultSettings
  readOnly: boolean
  /** Bumped to hide every revealed secret at once. */
  hideEpoch: number
  copy: (text: string, what: string) => void
  toast: (message: string, tone?: 'info' | 'success' | 'error') => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
  /** Open state of collapsible sections, kept for the session only. */
  sectionOpen: (id: string, fallback: boolean) => boolean
  setSectionOpen: (id: string, open: boolean) => void
}

export const UiContext = createContext<Ui>({
  settings: DEFAULT_SETTINGS,
  readOnly: false,
  hideEpoch: 0,
  copy: () => undefined,
  toast: () => undefined,
  confirm: async () => false,
  sectionOpen: (_id, fallback) => fallback,
  setSectionOpen: () => undefined,
})

export const useUi = () => useContext(UiContext)

export const useSection = (id: string, fallback: boolean): [boolean, (open: boolean) => void] => {
  const { sectionOpen, setSectionOpen } = useUi()
  return [sectionOpen(id, fallback), (open) => setSectionOpen(id, open)]
}

/**
 * Focuses an element on mount. The autofocus attribute is blocked inside
 * cross-origin frames like the Standard Notes plugin iframe.
 */
export const useFocusOnMount = <T extends HTMLElement>(enabled = true) => {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (enabled) ref.current?.focus()
  }, [])
  return ref
}

/** Runs an async computation and keeps only the latest result. */
export const useAsync = <T,>(compute: () => Promise<T>, deps: unknown[]): T | undefined => {
  const [value, setValue] = useState<T | undefined>(undefined)
  const seq = useRef(0)
  useEffect(() => {
    const mine = ++seq.current
    compute().then(
      (v) => mine === seq.current && setValue(() => v),
      () => mine === seq.current && setValue(undefined),
    )
  }, deps)
  return value
}

/** A revealed flag that resets on hideEpoch and after the auto-hide delay. */
export const useReveal = (activity?: unknown): [boolean, (next: boolean) => void] => {
  const { hideEpoch, settings } = useUi()
  const [revealed, setRevealed] = useState(false)
  useEffect(() => setRevealed(false), [hideEpoch])
  useEffect(() => {
    if (!revealed || !settings.autoHideSeconds) return
    const timer = setTimeout(() => setRevealed(false), settings.autoHideSeconds * 1000)
    return () => clearTimeout(timer)
  }, [revealed, settings.autoHideSeconds, activity])
  return [revealed, setRevealed]
}

/**
 * Touch screens: masked words stay masked while typing, because on-screen
 * keyboards learn whatever is typed into non-password fields.
 */
export const isTouchDevice = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

/** Attributes that keep secrets away from spellcheck services, autofill and password managers. */
export const SECRET_ATTRS = {
  autocomplete: 'off',
  autocorrect: 'off',
  autocapitalize: 'off',
  spellcheck: false,
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
  // Copying from these fields starts the timed clipboard clear.
  'data-secret': '',
} as const

/** For fields that must keep their exact text (paths, fingerprints, addresses): no autocorrect, capitals or spellcheck. */
export const EXACT_ATTRS = {
  autocorrect: 'off',
  autocapitalize: 'off',
  spellcheck: false,
} as const
