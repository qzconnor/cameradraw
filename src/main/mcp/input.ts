import { nativeImage, type NativeImage } from 'electron'
import type { RemotePoint } from '@shared/mcp'
import { mainWindow } from './bridge'

/** Pictures for the client as JPEG – much smaller than PNG, and plenty to see what is there. */
const JPEG_QUALITY = 85

export interface EncodedImage {
  data: string
  mimeType: string
  width: number
  height: number
}

/** Scales a picture down to at most `maxSize` pixels on its longer side and encodes it. */
export function encodeImage(image: NativeImage, maxSize: number): EncodedImage {
  if (image.isEmpty()) throw new Error('Das Bild konnte nicht gelesen werden.')
  const { width, height } = image.getSize()
  const factor = Math.min(1, maxSize / Math.max(width, height))
  const scaled =
    factor < 1
      ? image.resize({
          width: Math.max(1, Math.round(width * factor)),
          height: Math.max(1, Math.round(height * factor)),
          quality: 'good'
        })
      : image
  const size = scaled.getSize()
  return {
    data: scaled.toJPEG(JPEG_QUALITY).toString('base64'),
    mimeType: 'image/jpeg',
    ...size
  }
}

export const encodeBytes = (bytes: Uint8Array, maxSize: number): EncodedImage =>
  encodeImage(nativeImage.createFromBuffer(Buffer.from(bytes)), maxSize)

function visibleWindow(): Electron.BrowserWindow {
  const win = mainWindow()
  if (win.isMinimized()) throw new Error('Das Fenster von CameraDraw ist minimiert.')
  return win
}

/**
 * The window as the user sees it, in window coordinates (CSS pixels) – the same ones `click` and
 * `drag` take. `maxWidth` scales it down further; `scale` says by how much.
 */
export async function screenshot(maxWidth?: number): Promise<EncodedImage & { scale: number }> {
  const win = visibleWindow()
  const [width] = win.getContentSize()
  const image = await win.webContents.capturePage()
  const target = Math.min(width, maxWidth ?? width)
  // The capture has device pixels; scaled so its width is `target`.
  const { width: captured, height } = image.getSize()
  const encoded = encodeImage(image, (Math.max(captured, height) * target) / captured)
  return { ...encoded, scale: encoded.width / width }
}

type Modifier = 'shift' | 'control' | 'alt' | 'meta'

const MODIFIERS: Record<string, Modifier> = {
  shift: 'shift',
  control: 'control',
  ctrl: 'control',
  strg: 'control',
  alt: 'alt',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta'
}

/** Key names as in the DOM / Playwright → Electron's accelerator names. */
const KEY_NAMES: Record<string, string> = {
  arrowleft: 'Left',
  arrowright: 'Right',
  arrowup: 'Up',
  arrowdown: 'Down',
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
  enter: 'Return',
  return: 'Return',
  escape: 'Escape',
  esc: 'Escape',
  space: 'Space',
  ' ': 'Space',
  leertaste: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  entf: 'Delete',
  home: 'Home',
  pos1: 'Home',
  end: 'End',
  ende: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  '+': 'Plus',
  plus: 'Plus',
  '-': '-',
  minus: '-'
}

/** `Control+Shift+S` → modifiers and key. A trailing `+` is the key itself (`Control++`). */
function parseKeys(combo: string): { key: string; modifiers: Modifier[] } {
  const trimmed = combo.trim()
  const parts = trimmed.endsWith('++')
    ? [...trimmed.slice(0, -2).split('+'), '+']
    : trimmed === '+'
      ? ['+']
      : trimmed.split('+')
  const raw = parts.pop()?.trim() ?? ''
  const modifiers = parts.map((part) => {
    const modifier = MODIFIERS[part.trim().toLowerCase()]
    if (!modifier) throw new Error(`Unbekannte Taste: ${part}`)
    return modifier
  })
  if (!raw) throw new Error('Keine Taste angegeben.')
  const named = KEY_NAMES[raw.toLowerCase()]
  // Single characters are sent as typed (letters lower case unless Shift is held).
  const key =
    named ??
    (raw.length === 1
      ? modifiers.includes('shift')
        ? raw.toUpperCase()
        : raw.toLowerCase()
      : raw.charAt(0).toUpperCase() + raw.slice(1))
  return { key, modifiers }
}

/** Presses a key (with modifiers) like on the keyboard, e.g. `Space`, `Escape`, `Control+Z`. */
export async function pressKeys(combo: string, times = 1): Promise<void> {
  const { webContents } = visibleWindow()
  const { key, modifiers } = parseKeys(combo)
  const printable = key.length === 1 && !modifiers.some((m) => m !== 'shift')
  for (let i = 0; i < times; i++) {
    webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers })
    // Text fields only get a character from the "char" event.
    if (printable) webContents.sendInputEvent({ type: 'char', keyCode: key, modifiers })
    webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers })
    await tick()
  }
}

/** Types text into the focused field. */
export async function typeText(text: string): Promise<void> {
  await visibleWindow().webContents.insertText(text)
}

type Button = 'left' | 'right' | 'middle'

const BUTTON_DOWN: Record<Button, 'leftbuttondown' | 'rightbuttondown' | 'middlebuttondown'> = {
  left: 'leftbuttondown',
  right: 'rightbuttondown',
  middle: 'middlebuttondown'
}

/** Lets the page handle the events sent so far (pointer handlers often react a frame later). */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 16))

export async function click(
  at: RemotePoint,
  button: Button = 'left',
  clickCount = 1
): Promise<void> {
  const { webContents } = visibleWindow()
  const { x, y } = at
  webContents.sendInputEvent({ type: 'mouseMove', x, y })
  await tick()
  for (let n = 1; n <= clickCount; n++) {
    webContents.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: n })
    webContents.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: n })
    await tick()
  }
}

/** Presses the button at `from`, moves to `to` in `steps` and lets go – e.g. to draw or drop. */
export async function drag(
  from: RemotePoint,
  to: RemotePoint,
  button: Button = 'left',
  steps = 12
): Promise<void> {
  const { webContents } = visibleWindow()
  const held: Electron.MouseInputEvent['modifiers'] = [BUTTON_DOWN[button]]
  webContents.sendInputEvent({ type: 'mouseMove', x: from.x, y: from.y })
  await tick()
  webContents.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button, clickCount: 1 })
  await tick()
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(from.x + ((to.x - from.x) * i) / steps)
    const y = Math.round(from.y + ((to.y - from.y) * i) / steps)
    webContents.sendInputEvent({ type: 'mouseMove', x, y, button, modifiers: held })
    await tick()
  }
  webContents.sendInputEvent({ type: 'mouseUp', x: to.x, y: to.y, button, clickCount: 1 })
  await tick()
}
