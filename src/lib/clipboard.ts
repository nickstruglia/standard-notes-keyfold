// Copying secrets: tries the async Clipboard API first (needs the
// clipboard-write permission inside the Standard Notes iframe), then falls
// back to execCommand, which works during a user gesture.

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
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied or not focused; try the fallback.
  }
  return legacyCopy(text)
}

/**
 * Best effort: browsers only allow clipboard writes while the page is focused
 * (and, inside the Standard Notes iframe, only during a click), and clipboard
 * history tools (Win+V, clipboard managers) may keep a copy.
 */
export const clearClipboard = async (): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText('')
      return true
    }
  } catch {
    // fall through
  }
  return legacyCopy(' ')
}
