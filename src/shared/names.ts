/**
 * Names in the save folder. Images lie directly in it or in a project (a sub folder, one level
 * deep). An image is identified by its path: `<file>` or `<project>/<file>`, always with `/`.
 */

export const MAX_NAME_LENGTH = 100

// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/
// Device names Windows reserves, with or without an extension.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/** Why a file or project name typed by the user cannot be used, or null if it is fine. */
export function nameError(name: string): string | null {
  if (!name) return 'Bitte gib einen Namen ein.'
  if (name !== name.trim()) return 'Der Name darf nicht mit einem Leerzeichen beginnen oder enden.'
  if (name.length > MAX_NAME_LENGTH)
    return `Der Name darf höchstens ${MAX_NAME_LENGTH} Zeichen haben.`
  if (INVALID_CHARS.test(name)) return 'Diese Zeichen sind nicht erlaubt: \\ / : * ? " < > |'
  if (name.startsWith('.')) return 'Der Name darf nicht mit einem Punkt beginnen.'
  if (name.endsWith('.')) return 'Der Name darf nicht mit einem Punkt enden.'
  if (RESERVED.test(name)) return 'Dieser Name ist unter Windows reserviert.'
  return null
}

export const itemPath = (project: string | null, name: string): string =>
  project ? `${project}/${name}` : name

export function splitItemPath(path: string): { project: string | null; name: string } {
  const slash = path.indexOf('/')
  return slash < 0
    ? { project: null, name: path }
    : { project: path.slice(0, slash), name: path.slice(slash + 1) }
}

/** `Bild.png` → `Bild` + `.png` */
export function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' }
}

/** Windows and macOS treat `Bild.png` and `bild.png` as the same file. */
export const sameName = (a: string, b: string): boolean =>
  a.toLocaleLowerCase() === b.toLocaleLowerCase()

/** Suggested name for a new capture, e.g. `CameraDraw_2026-10-21_15-50-12`. */
export function captureStem(date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `CameraDraw_${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`
}
