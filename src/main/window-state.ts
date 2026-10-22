import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Size, position and maximized state of the window, kept from one session to the next. */
export interface WindowState {
  bounds: Rectangle
  maximized: boolean
}

/** At least this much of the window (px) must lie on a screen, so it can be grabbed and moved. */
const MIN_VISIBLE = 100

const stateFile = (): string => join(app.getPath('userData'), 'window-state.json')

function isOnScreen({ x, y, width, height }: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: area }) => {
    const visibleWidth = Math.min(x + width, area.x + area.width) - Math.max(x, area.x)
    const visibleHeight = Math.min(y + height, area.y + area.height) - Math.max(y, area.y)
    return visibleWidth >= MIN_VISIBLE && visibleHeight >= MIN_VISIBLE
  })
}

/**
 * The window state of the last session – null on the first start, or if it would be out of sight
 * now (e.g. on a screen that is no longer connected).
 */
export function loadWindowState(): WindowState | null {
  try {
    const { bounds, maximized } = JSON.parse(readFileSync(stateFile(), 'utf8')) as WindowState
    const valid = [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    return valid && isOnScreen(bounds) ? { bounds, maximized: maximized === true } : null
  } catch {
    return null
  }
}

/** Remembers the window state when the window closes. */
export function trackWindowState(win: BrowserWindow): void {
  // Followed while the window is used: once it is closing, Electron reports the bounds in physical
  // pixels on a scaled (HiDPI) screen. The normal bounds stay put while maximized or minimized, so
  // a maximized window gets its previous size back when restored.
  let bounds = win.getNormalBounds()
  const remember = (): void => {
    bounds = win.getNormalBounds()
  }
  win.on('resize', remember)
  win.on('move', remember)

  win.on('close', () => {
    const state: WindowState = { bounds, maximized: win.isMaximized() }
    try {
      writeFileSync(stateFile(), JSON.stringify(state))
    } catch {
      // Not worth bothering the user – the window just opens at its default size next time.
    }
  })
}
