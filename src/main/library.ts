import { shell } from 'electron'
import { execFile } from 'child_process'
import { existsSync, watch, type FSWatcher } from 'fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import { itemPath, nameError, splitExtension, splitItemPath } from '@shared/names'
import {
  MEDIA_SCHEME,
  type EditorDocument,
  type GalleryItem,
  type GalleryProject,
  type LibraryListing,
  type LoadedImage,
  type SaveImageRequest
} from '@shared/types'

/**
 * Hidden sub folder that keeps the original frame + editable layers next to the images – in the
 * save folder and in every project.
 */
export const LAYERS_DIR = '.cameradraw'

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

export const isImageFile = (name: string): boolean => extname(name).toLowerCase() in IMAGE_MIME

export const mimeFor = (name: string): string =>
  IMAGE_MIME[extname(name).toLowerCase()] ?? 'application/octet-stream'

// On these platforms `Bild.png` and `bild.png` are the same file.
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'
const isSameFile = (a: string, b: string): boolean =>
  CASE_INSENSITIVE ? a.toLowerCase() === b.toLowerCase() : a === b

/**
 * Resolves an image path (`<file>` or `<project>/<file>`) or a project name inside the save
 * folder, rejecting anything that could escape it.
 */
export function resolveInLibrary(root: string, path: string): string {
  const parts = typeof path === 'string' ? path.split('/') : []
  if (
    !parts.length ||
    parts.length > 2 ||
    parts.some((p) => !p || basename(p) !== p || p.startsWith('.'))
  ) {
    throw new Error(`Ungültiger Pfad: ${path}`)
  }
  return join(root, ...parts)
}

/** Throws if a name chosen by the user for a new image or project cannot be used. */
function assertValidPath(path: string): void {
  const { project, name } = splitItemPath(path)
  const problem = (project && nameError(project)) || nameError(splitExtension(name).stem)
  if (problem) throw new Error(problem)
  if (!isImageFile(name)) throw new Error(`Ungültiger Dateityp: ${name}`)
}

/** Sub folders that are not projects: hidden ones and the system folders of a drive root. */
const isProjectDir = (name: string): boolean =>
  !name.startsWith('.') && !name.startsWith('$') && name !== 'System Volume Information'

const layerPaths = (file: string): { json: string; base: string } => {
  const dir = join(dirname(file), LAYERS_DIR)
  const stem = basename(file, extname(file))
  return { json: join(dir, `${stem}.json`), base: join(dir, `${stem}.base.png`) }
}

function toGalleryItem(
  project: string | null,
  name: string,
  mtime: number,
  size: number,
  editable: boolean
): GalleryItem {
  const path = itemPath(project, name)
  const encoded = encodeURIComponent(path)
  return {
    path,
    name,
    project,
    url: `${MEDIA_SCHEME}://media/${encoded}?v=${mtime}`,
    thumbUrl: `${MEDIA_SCHEME}://thumb/${encoded}?v=${mtime}`,
    mtime,
    size,
    editable
  }
}

async function listImages(root: string, project: string | null): Promise<GalleryItem[]> {
  const dir = project ? join(root, project) : root
  const entries = await readdir(dir, { withFileTypes: true })
  const items = await Promise.all(
    entries
      .filter((e) => e.isFile() && !e.name.startsWith('.') && isImageFile(e.name))
      .map(async (e) => {
        try {
          const file = join(dir, e.name)
          const info = await stat(file)
          const editable = existsSync(layerPaths(file).json)
          return toGalleryItem(project, e.name, Math.round(info.mtimeMs), info.size, editable)
        } catch {
          return null // file vanished between readdir and stat
        }
      })
  )
  return items.filter((i): i is GalleryItem => i !== null)
}

export async function listLibrary(root: string): Promise<LibraryListing> {
  const entries = await readdir(root, { withFileTypes: true })
  const projects = (
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && isProjectDir(e.name))
        .map(async (e): Promise<GalleryProject | null> => {
          try {
            const info = await stat(join(root, e.name))
            return { name: e.name, mtime: Math.round(info.mtimeMs) }
          } catch {
            return null
          }
        })
    )
  ).filter((p): p is GalleryProject => p !== null)

  const lists = await Promise.all([
    listImages(root, null),
    // An unreadable project shows up empty instead of breaking the whole gallery.
    ...projects.map((p) => listImages(root, p.name).catch(() => []))
  ])
  return { projects, items: lists.flat() }
}

/** `Bild.png`, `Bild_2.png`, `Bild_3.png`, … – the first name not taken in `dir`. */
function uniqueName(dir: string, name: string): string {
  const { stem, ext } = splitExtension(name)
  let candidate = name
  for (let i = 2; existsSync(join(dir, candidate)); i++) candidate = `${stem}_${i}${ext}`
  return candidate
}

async function writeAtomic(file: string, data: Uint8Array | string): Promise<void> {
  const tmp = join(file, '..', `.${basename(file)}.tmp`)
  await writeFile(tmp, data)
  await rename(tmp, file)
}

/** Creates the hidden layers folder in `dir` (and `dir` itself if it is a new project). */
async function ensureLayersDir(dir: string): Promise<void> {
  const layersDir = join(dir, LAYERS_DIR)
  if (existsSync(layersDir)) return
  await mkdir(layersDir, { recursive: true })
  if (process.platform === 'win32') {
    // Dot-folders are not hidden on Windows – set the attribute so the folder stays tidy.
    execFile('attrib', ['+h', layersDir], () => undefined)
  }
}

/** Renames, with a readable message when Windows refuses because something is in use. */
async function renameInUse(from: string, to: string, what: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
      throw new Error(
        `${what} wird gerade verwendet, z. B. von einem anderen Programm oder im Explorer.`,
        { cause: err }
      )
    }
    throw err
  }
}

/** Moves (or renames) an image together with its layer data. */
async function relocate(root: string, from: string, to: string): Promise<void> {
  const src = resolveInLibrary(root, from)
  const dest = resolveInLibrary(root, to)
  if (existsSync(dest) && !isSameFile(src, dest)) {
    throw new Error('Es gibt dort schon ein Bild mit diesem Namen.')
  }
  await mkdir(dirname(dest), { recursive: true })
  await renameInUse(src, dest, 'Das Bild')

  const [oldLayers, newLayers] = [layerPaths(src), layerPaths(dest)]
  if (existsSync(oldLayers.json) || existsSync(oldLayers.base)) await ensureLayersDir(dirname(dest))
  // Without own layers, leftovers of an earlier image with the same name must not be picked up.
  const moveOrClear = (a: string, b: string): Promise<void> =>
    existsSync(a) ? rename(a, b) : rm(b, { force: true })
  await Promise.all([
    moveOrClear(oldLayers.json, newLayers.json),
    moveOrClear(oldLayers.base, newLayers.base)
  ])
}

export async function saveImage(root: string, req: SaveImageRequest): Promise<GalleryItem> {
  const file = resolveInLibrary(root, req.target)
  // The edited image may have been deleted in the meantime – then it is saved as a new one.
  const source = req.source && existsSync(resolveInLibrary(root, req.source)) ? req.source : null

  if (source !== req.target) {
    assertValidPath(req.target)
    if (source) await relocate(root, source, req.target)
    else if (existsSync(file)) throw new Error('Es gibt dort schon ein Bild mit diesem Namen.')
  }

  const layers = layerPaths(file)
  await ensureLayersDir(dirname(file))
  await writeAtomic(layers.base, req.base)
  await writeAtomic(layers.json, JSON.stringify(req.document))
  await writeAtomic(file, req.image)

  const info = await stat(file)
  const { project, name } = splitItemPath(req.target)
  return toGalleryItem(project, name, Math.round(info.mtimeMs), info.size, true)
}

export async function loadImage(root: string, path: string): Promise<LoadedImage> {
  const file = resolveInLibrary(root, path)
  const layers = layerPaths(file)

  if (existsSync(layers.json) && existsSync(layers.base)) {
    try {
      const document = JSON.parse(await readFile(layers.json, 'utf8')) as EditorDocument
      return { path, base: await readFile(layers.base), baseMime: 'image/png', document }
    } catch {
      // Corrupt layer data – fall back to editing the flat image.
    }
  }
  return { path, base: await readFile(file), baseMime: mimeFor(file), document: null }
}

export async function removeImage(root: string, path: string): Promise<void> {
  const file = resolveInLibrary(root, path)
  const layers = layerPaths(file)
  await shell.trashItem(file)
  await Promise.all([rm(layers.json, { force: true }), rm(layers.base, { force: true })])
}

export async function moveImage(
  root: string,
  path: string,
  project: string | null
): Promise<string> {
  const { project: current, name } = splitItemPath(path)
  if (current === project) return path
  const dir = project ? resolveInLibrary(root, project) : root
  if (!existsSync(dir)) throw new Error(`Das Projekt „${project}“ gibt es nicht mehr.`)
  const target = itemPath(project, uniqueName(dir, name))
  await relocate(root, path, target)
  return target
}

/** Gives an image (and its layer data) a new file name in the same place; returns the new path. */
export async function renameImage(root: string, path: string, name: string): Promise<string> {
  const target = itemPath(splitItemPath(path).project, name)
  if (target === path) return path
  assertValidPath(target)
  await relocate(root, path, target)
  return target
}

export async function createProject(root: string, name: string): Promise<void> {
  const problem = nameError(name)
  if (problem) throw new Error(problem)
  const dir = resolveInLibrary(root, name)
  if (existsSync(dir)) throw new Error('Ein Projekt mit diesem Namen gibt es schon.')
  await mkdir(dir)
}

export async function renameProject(root: string, from: string, to: string): Promise<void> {
  const problem = nameError(to)
  if (problem) throw new Error(problem)
  const src = resolveInLibrary(root, from)
  const dest = resolveInLibrary(root, to)
  if (existsSync(dest) && !isSameFile(src, dest)) {
    throw new Error('Ein Projekt mit diesem Namen gibt es schon.')
  }
  await renameInUse(src, dest, 'Das Projekt')
}

export async function removeProject(root: string, name: string): Promise<void> {
  await shell.trashItem(resolveInLibrary(root, name))
}

export function reveal(root: string, path: string): void {
  shell.showItemInFolder(resolveInLibrary(root, path))
}

/**
 * Watches the save folder and its projects and calls `onChange` (debounced) when images or
 * projects are added, changed or removed.
 */
export function watchLibrary(dir: string, onChange: () => void): () => void {
  let timer: NodeJS.Timeout | undefined
  let watcher: FSWatcher | undefined
  try {
    watcher = watch(dir, { persistent: false, recursive: true }, (_event, filename) => {
      const f = filename?.toString() ?? ''
      // Temp files and the layer folders.
      if (f.split(/[\\/]/).some((part) => part.startsWith('.'))) return
      clearTimeout(timer)
      timer = setTimeout(onChange, 250)
    })
    watcher.on('error', () => watcher?.close())
  } catch {
    // Folder not watchable (e.g. network drive) – the gallery still refreshes after own saves.
  }
  return () => {
    clearTimeout(timer)
    watcher?.close()
  }
}
