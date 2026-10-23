/** True if the event comes from a field the user types into (incl. fabric's hidden textarea). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** True if the event target handles keys itself (buttons react to Space/Enter natively). */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return (
    !!el?.closest?.(
      'button, a, input, textarea, select, [role="combobox"], [role="button"], [contenteditable]'
    ) || isTypingTarget(target)
  )
}

/**
 * Whether the user is currently navigating with the keyboard (Tab) rather than the mouse.
 * `:focus-visible` is not reliable for this: Chromium keeps it on buttons that were clicked after
 * some keyboard use, so we track the last input method ourselves.
 */
let keyboardNavigation = false
window.addEventListener('pointerdown', () => (keyboardNavigation = false), true)
window.addEventListener('keydown', (e) => e.key === 'Tab' && (keyboardNavigation = true), true)

export const isKeyboardNavigating = (): boolean => keyboardNavigation

const OVERLAYS = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[data-slot="select-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="context-menu-content"]'
].join(',')

/** True while a dialog, menu or popover is open – global shortcuts must stay quiet then. */
export function isOverlayOpen(): boolean {
  return !!document.querySelector(OVERLAYS)
}

/**
 * Like `isOverlayOpen`, but the side panels (gallery, settings, …) do not count: they leave the
 * camera visible, so a device's buttons keep working.
 */
export function isBlockingOverlayOpen(): boolean {
  return [...document.querySelectorAll(OVERLAYS)].some((el) => !el.matches('[data-side-panel]'))
}

/**
 * Gives the keyboard back to the text being typed in the editor (fabric's hidden textarea), e.g.
 * after a pick in the toolbar. False if no text is being typed.
 */
export function refocusTypedText(): boolean {
  const area = document.querySelector<HTMLTextAreaElement>('textarea[data-fabric="textarea"]')
  area?.focus({ preventScroll: true })
  return !!area
}
