/**
 * Fonts of texts: the app's own font or one installed on the computer. A text keeps its font as a
 * CSS font list with the app's font behind it – it stands in where the chosen one is missing, e.g.
 * for a drawing opened on another computer.
 */

/** The app's own font (bundled with it) – texts use it unless another one is chosen. */
export const DEFAULT_FONT = 'Geist'

/** How the app's font is called in CSS (`@fontsource-variable/geist`). */
const APP_FONT = 'Geist Variable'
const FALLBACK = `"${APP_FONT}", sans-serif`

/** The CSS font list of a text in the font `name`. */
export function cssFontFamily(name: string): string {
  if (name === DEFAULT_FONT) return FALLBACK
  return `"${name.replace(/["\\]/g, '\\$&')}", ${FALLBACK}`
}

/** The font a CSS font list asks for first (texts of older versions: the app's font). */
export function fontName(css: string): string {
  const first = /^\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^,]*))/.exec(css)
  const name = (first?.[1] ?? first?.[2] ?? first?.[3] ?? '').replace(/\\(.)/g, '$1').trim()
  return !name || name === APP_FONT ? DEFAULT_FONT : name
}

/** A face of an installed font (Local Font Access API, granted by the main process). */
interface LocalFont {
  family: string
}

const collator = new Intl.Collator('de', { sensitivity: 'base' })
const same = (a: string, b: string): boolean => !collator.compare(a, b)
let installed: Promise<string[]> | null = null

async function queryFonts(): Promise<string[]> {
  const query = (window as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts
  if (!query) return []
  try {
    const faces = await query.call(window)
    const families = new Set(faces.map((face) => face.family))
    // An installed copy of the app's font is the app's font.
    families.delete(DEFAULT_FONT)
    families.delete(APP_FONT)
    return [...families].sort(collator.compare)
  } catch {
    // Asked again next time.
    installed = null
    return []
  }
}

/** The families of the installed fonts (without the app's own), sorted by name – read once. */
export function systemFonts(): Promise<string[]> {
  installed ??= queryFonts()
  return installed
}

/** `name` as it is spelled among the fonts texts can use (any case), or null if there is none. */
export async function findFont(name: string): Promise<string | null> {
  const wanted = name.trim()
  if (same(wanted, DEFAULT_FONT) || same(wanted, APP_FONT)) return DEFAULT_FONT
  return (await systemFonts()).find((font) => same(font, wanted)) ?? null
}
