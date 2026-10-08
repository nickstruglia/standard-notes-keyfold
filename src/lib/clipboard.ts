// Copying secrets: execCommand first, synchronously, while the click's user
// activation is still valid (Standard Notes' iframe has no clipboard-write
// permission, so the async Clipboard API fails there and logs an error).
// The async API is the fallback for pages outside Standard Notes.

const legacyCopy = (text: string): boolean => {
  // Selecting the helper textarea moves focus; put it back afterwards so a
  // click or keystroke in progress lands where the user meant it to.
  const active = document.activeElement as HTMLElement | null
  const field = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null
  const range = field ? [field.selectionStart, field.selectionEnd] : null
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  // Older iOS versions only select the full range with this.
  area.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  active?.focus?.({ preventScroll: true })
  if (field && range && range[0] !== null && range[1] !== null) {
    try {
      field.setSelectionRange(range[0], range[1])
    } catch {
      // Some input types (e.g. date) have no selection.
    }
  }
  return ok
}

export const copyText = async (text: string): Promise<boolean> => {
  if (legacyCopy(text)) return true
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied or not focused.
  }
  return false
}

/** Clears synchronously; only works during a click, tap or key press. */
export const clearClipboardNow = (): boolean => legacyCopy(' ')

/**
 * Best effort: browsers only allow clipboard writes while the page is focused
 * (and, inside the Standard Notes iframe, only during a click), and clipboard
 * history tools (Win+V, clipboard managers) may keep a copy.
 */
export const clearClipboard = async (): Promise<boolean> => {
  if (clearClipboardNow()) return true
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText('')
      return true
    }
  } catch {
    // Blocked: no user activation, or no permission.
  }
  return false
}
