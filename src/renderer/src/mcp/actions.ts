import type { FabricObject } from 'fabric'
import { toast } from 'vue-sonner'
import {
  captureStem,
  itemPath,
  nameError,
  sameName,
  splitExtension,
  splitItemPath
} from '@shared/names'
import type { RemoteAction, RemoteActionArgs } from '@shared/mcp'
import type { GalleryItem } from '@shared/types'
import { formatScale } from '@/editor/measure'
import { isBlockingOverlayOpen } from '@/lib/keyboard'
import { useBurstStore } from '@/stores/burst'
import { useCameraStore } from '@/stores/camera'
import { useEditorStore } from '@/stores/editor'
import { useGalleryStore } from '@/stores/gallery'
import { usePanelsStore } from '@/stores/panels'
import { useSettingsStore } from '@/stores/settings'
import { remotes, type EditorRemote } from './remote'

/**
 * The actions an MCP client runs on the live app (requests from `src/main/mcp/`). They go through
 * the same stores and components as a click would, so everything shows on screen. Messages are
 * German like the rest of the app – the client passes them on to the user.
 */

type Actions = { [A in RemoteAction]: (args: RemoteActionArgs[A]) => Promise<unknown> }

/** Camera start, opening an image: give up after this long. */
const WAIT_TIMEOUT = 15_000
/** Images listed unless the client asks for more. */
const DEFAULT_LIST_LIMIT = 100

/** Waits until `check` returns true; a string it returns is a reason to give up right away. */
async function waitFor(check: () => boolean | string, timeoutMessage: string): Promise<void> {
  const until = Date.now() + WAIT_TIMEOUT
  for (;;) {
    const result = check()
    if (result === true) return
    if (typeof result === 'string' && result) throw new Error(result)
    if (Date.now() > until) throw new Error(timeoutMessage)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

const iso = (ms: number): string => new Date(ms).toISOString()

const imageInfo = (item: GalleryItem): Record<string, unknown> => ({
  path: item.path,
  name: item.name,
  project: item.project,
  capturedAt: iso(item.capturedAt),
  size: item.size,
  editable: item.editable
})

/** Dialogs and menus over the app – the user (or a click) has to deal with them first. */
function openOverlays(): { dialogs: string[]; menuOpen: boolean } {
  const dialogs = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
    )
  ]
    .filter((el) => !el.matches('[data-side-panel]'))
    .map((el) => {
      const title = el.getAttribute('aria-labelledby')
      return (title && document.getElementById(title)?.textContent?.trim()) || 'Dialog'
    })
  const menuOpen = !!document.querySelector(
    '[data-slot="dropdown-menu-content"], [data-slot="context-menu-content"], [data-slot="select-content"], [data-slot="popover-content"]'
  )
  return { dialogs, menuOpen }
}

/** Notifications on screen, newest first. */
const visibleToasts = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[data-sonner-toast]')]
    .map((el) =>
      [...el.querySelectorAll('[data-title], [data-description]')]
        .map((part) => part.textContent?.trim())
        .filter(Boolean)
        .join(' – ')
    )
    .filter(Boolean)
    .slice(0, 5)

/** Turns store values (reactive proxies) into plain data that can be sent to the main process. */
function plain(value: unknown): unknown {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return value.map(plain)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([key, v]) => [key, plain(v)])
    )
  }
  return value
}

function createActions(): Actions {
  const settings = useSettingsStore()
  const camera = useCameraStore()
  const editor = useEditorStore()
  const gallery = useGalleryStore()
  const panels = usePanelsStore()
  const burst = useBurstStore()

  // ── Shared helpers ──────────────────────────────────────────────────────────

  const burstState = (): Record<string, unknown> => ({
    enabled: burst.enabled,
    project: burst.project,
    saved: burst.count
  })

  const cameraState = (): Record<string, unknown> => ({
    status: camera.status,
    paused: camera.paused,
    camera: camera.selectedLabel
      ? { id: camera.selectedId, label: camera.selectedLabel, connected: !camera.selectedMissing }
      : null,
    resolution: camera.resolution,
    zoom: camera.zoom,
    maxZoom: camera.maxZoom,
    zoomMode: camera.zoomMode,
    mirror: settings.mirror,
    burst: burstState()
  })

  const settingsState = (): Record<string, unknown> => ({
    saveDir: settings.saveDir,
    saveDirAvailable: settings.saveDirAvailable,
    mirror: settings.mirror,
    ambientLight: settings.ambientLight,
    preferCameraZoom: settings.preferCameraZoom,
    stopCameraWhenHidden: settings.stopCameraWhenHidden
  })

  /** The editor of the image that is open now (not one still being replaced). */
  function currentEditor(): EditorRemote | null {
    const remote = remotes.editor.value
    return remote && remote.baseUrl === editor.session?.baseUrl ? remote : null
  }

  /** After opening an image: until it can be drawn on (the editor closes if it fails to load). */
  const waitForEditor = (): Promise<void> =>
    waitFor(
      () =>
        editor.session
          ? !editor.loading && !!currentEditor()?.canvas.ready.value
          : 'Das Bild konnte nicht geöffnet werden.',
      'Das Bild im Editor lädt zu lange.'
    )

  /** The editor with its image ready to draw on – waits for an image that is still loading. */
  async function requireEditor(): Promise<EditorRemote> {
    if (!editor.session) {
      throw new Error('Im Editor ist kein Bild offen – erst capture oder open_image.')
    }
    await waitForEditor()
    return currentEditor()!
  }

  function editorSummary(): Record<string, unknown> | null {
    const session = editor.session
    if (!session) return null
    const canvas = currentEditor()?.canvas
    const scale = canvas?.micronsPerPixel.value ?? session.micronsPerPixel
    return {
      path: session.path,
      newCapture: session.path === null,
      width: session.width,
      height: session.height,
      capturedAt: iso(session.capturedAt),
      // The canvas knows first – the store follows a moment later.
      unsavedChanges: canvas?.dirty.value ?? editor.dirty,
      micronsPerPixel: scale,
      scale: scale ? formatScale(scale) : null,
      objectCount: canvas?.objects().length ?? 0,
      selected: canvas?.describeObjects().flatMap((o) => (o.selected ? [o.index] : [])) ?? [],
      canUndo: canvas?.canUndo.value ?? false,
      canRedo: canvas?.canRedo.value ?? false,
      viewZoom: canvas?.viewZoom.value ?? 1,
      tool: editor.tool,
      style: editor.style
    }
  }

  const editorDetail = (remote: EditorRemote): Record<string, unknown> => ({
    ...editorSummary(),
    objects: remote.canvas.describeObjects()
  })

  /** The objects at `indices` (stacking order); throws for one that does not exist. */
  function objectsAt(remote: EditorRemote, indices: number[]): FabricObject[] {
    const all = remote.canvas.objects()
    return [...new Set(indices)].map((index) => {
      const obj = all[index]
      if (!obj) {
        throw new Error(
          all.length
            ? `Es gibt kein Objekt ${index} – die Indizes gehen von 0 bis ${all.length - 1}.`
            : 'Im Bild ist noch nichts gezeichnet.'
        )
      }
      return obj
    })
  }

  /** Why the camera cannot take a picture now, or '' while it may still get ready. */
  function cameraProblem(): string {
    switch (camera.status) {
      case 'waiting':
        return 'Die gewählte Kamera ist nicht verbunden.'
      case 'busy':
        return 'Die Kamera wird gerade von einem anderen Programm verwendet.'
      case 'no-camera':
        return 'Es ist keine Kamera angeschlossen.'
      case 'denied':
        return 'CameraDraw darf nicht auf die Kamera zugreifen (Windows-Datenschutzeinstellungen).'
      case 'off':
        return camera.minimized ? 'Das Fenster ist minimiert – solange ist die Kamera aus.' : ''
      default:
        return ''
    }
  }

  function requireLibrary(): void {
    if (!settings.saveDirAvailable) throw new Error('Es ist kein Speicherordner eingerichtet.')
  }

  function requireProject(name: string | null | undefined): void {
    if (name && !gallery.projectExists(name)) {
      throw new Error(`Das Projekt „${name}“ gibt es nicht – create_project legt es an.`)
    }
  }

  async function requireImage(path: string): Promise<GalleryItem> {
    requireLibrary()
    let item = gallery.items.find((i) => i.path === path)
    if (!item) {
      await gallery.refresh()
      item = gallery.items.find((i) => i.path === path)
    }
    if (!item) throw new Error(`Das Bild „${path}“ gibt es nicht – siehe list_library.`)
    return item
  }

  function requireSaved(discard: boolean | undefined): void {
    if (editor.unsaved && !discard) {
      throw new Error(
        'Im Editor gibt es ungespeicherte Änderungen – erst speichern (editor_save) oder mit discard: true verwerfen.'
      )
    }
  }

  const placeOf = (path: string): string => {
    const { project, name } = splitItemPath(path)
    return project ? `${project} / ${name}` : name
  }

  /** `Bild Kopie`, `Bild Kopie 2`, … – the first name still free in `project`. */
  function freeCopyStem(stem: string, ext: string, project: string | null): string {
    const taken = (candidate: string): boolean =>
      gallery.items.some((i) => sameName(i.path, itemPath(project, `${candidate}${ext}`)))
    let candidate = `${stem} Kopie`
    for (let n = 2; taken(candidate); n++) candidate = `${stem} Kopie ${n}`
    return candidate
  }

  /** `name` without the extension `ext` (it is kept – the file stays encoded the same way). */
  const stemOf = (name: string, ext: string): string => {
    const split = splitExtension(name)
    return sameName(split.ext, ext) ? split.stem : name
  }

  function checkName(stem: string): void {
    const problem = nameError(stem)
    if (problem) throw new Error(problem)
  }

  return {
    // ── General ───────────────────────────────────────────────────────────────

    async state() {
      return {
        view: editor.isOpen ? 'editor' : 'camera',
        panel: panels.active,
        ...openOverlays(),
        toasts: visibleToasts(),
        camera: cameraState(),
        editor: editorSummary(),
        library: {
          saveDir: settings.saveDir,
          available: settings.saveDirAvailable,
          projects: gallery.projects.length,
          images: gallery.items.length
        },
        gallery:
          panels.active === 'gallery'
            ? { project: gallery.currentProject, query: gallery.query }
            : undefined,
        settings: settingsState()
      }
    },

    async showPanel({ panel, project, query }) {
      if (panel === 'none') {
        panels.closeAll()
        return { panel: null }
      }
      if (panel === 'gallery') {
        if (project !== undefined) {
          requireProject(project)
          gallery.browse(project)
        }
        if (query !== undefined) gallery.query = query
      }
      panels.setOpen(panel, true)
      return { panel }
    },

    async updateSettings(patch) {
      await settings.update(patch)
      return settingsState()
    },

    // ── Camera ────────────────────────────────────────────────────────────────

    async listCameras({ refresh }) {
      if (refresh) await camera.refresh()
      return {
        status: camera.status,
        selected: camera.selectedLabel,
        cameras: camera.devices.map((d) => ({
          id: d.id,
          label: d.label,
          selected: d.id === camera.selectedId
        }))
      }
    },

    async selectCamera({ id, label }) {
      const device = camera.devices.find((d) => (id ? d.id === id : d.label === label))
      if (!device) {
        const known = camera.devices.map((d) => `„${d.label}“`).join(', ') || 'keine'
        throw new Error(`Diese Kamera gibt es nicht. Angeschlossen: ${known}.`)
      }
      await camera.select(device.id)
      return cameraState()
    },

    async setCamera({ paused, zoom }) {
      if (paused === true && !camera.paused) {
        if (camera.status !== 'live') throw new Error('Die Kamera läuft gerade nicht.')
        camera.setPaused(true)
      } else if (paused === false && camera.paused) {
        camera.setPaused(false)
        // Switched off while paused – back on in a moment (only shown without the editor).
        if (!editor.isOpen) {
          await waitFor(
            () => camera.status === 'live' || cameraProblem(),
            'Die Kamera startet nicht.'
          )
        }
      }
      if (zoom !== undefined) camera.setZoom(zoom)
      return cameraState()
    },

    async capture({ mode = 'edit' }) {
      if (editor.isOpen) {
        throw new Error(
          'Der Editor ist offen – erst speichern (editor_save) oder schließen (editor_close).'
        )
      }
      if (camera.paused) {
        throw new Error('Die Kamera ist pausiert – set_camera mit paused: false setzt sie fort.')
      }
      if (isBlockingOverlayOpen()) {
        throw new Error('Ein Dialog oder Menü ist offen – erst schließen (z. B. press_key Escape).')
      }
      await waitFor(
        () => !!remotes.camera.value?.canCapture() || cameraProblem(),
        'Die Kamera ist nicht bereit.'
      )
      const item = await remotes.camera.value!.capture(mode === 'save')
      if (mode === 'save') return { saved: item && imageInfo(item) }
      await waitForEditor()
      return { editor: editorSummary() }
    },

    async setBurst({ enabled, project }) {
      if (project !== undefined) {
        requireProject(project)
        burst.setProject(project)
      }
      if (enabled !== undefined) burst.enabled = enabled
      return burstState()
    },

    // ── Library ───────────────────────────────────────────────────────────────

    async listLibrary({ project, query, limit = DEFAULT_LIST_LIMIT }) {
      requireLibrary()
      await gallery.refresh()
      const q = query?.trim().toLocaleLowerCase()
      const images = gallery.items
        .filter((i) => project === undefined || i.project === project)
        .filter((i) => !q || i.name.toLocaleLowerCase().includes(q))
        .sort((a, b) => b.capturedAt - a.capturedAt)
      return {
        saveDir: settings.saveDir,
        projects: gallery.summaries
          .filter((p) => !q || p.name.toLocaleLowerCase().includes(q))
          .map((p) => ({ name: p.name, images: p.count, newest: iso(p.date) })),
        images: images.slice(0, limit).map(imageInfo),
        totalImages: images.length
      }
    },

    async openImage({ path, discard }) {
      await requireImage(path)
      if (editor.session?.path !== path || (discard && editor.unsaved)) {
        requireSaved(discard)
        // Like opening it from the gallery: the panel would cover the editor.
        panels.setOpen('gallery', false)
        editor.cancelPending()
        await editor.load(path)
      }
      await waitForEditor()
      return editorSummary()
    },

    async createProject({ name }) {
      requireLibrary()
      await gallery.createProject(name)
      toast.success('Projekt angelegt', { description: name })
      return { projects: gallery.projectNames }
    },

    async renameProject({ name, newName }) {
      requireLibrary()
      requireProject(name)
      await gallery.renameProject(name, newName)
      editor.pathChanged(name, newName)
      toast.success('Projekt umbenannt', { description: newName })
      return { projects: gallery.projectNames }
    },

    async deleteProject({ name }) {
      requireLibrary()
      requireProject(name)
      await gallery.removeProject(name)
      if (editor.isEditing(name)) editor.close()
      toast.success('Projekt in den Papierkorb verschoben', { description: name })
      return { projects: gallery.projectNames }
    },

    async renameImage({ path, newName }) {
      const item = await requireImage(path)
      const { ext } = splitExtension(item.name)
      const stem = stemOf(newName.trim(), ext)
      checkName(stem)
      const renamed = await gallery.renameImage(path, stem + ext)
      editor.pathChanged(path, renamed)
      toast.success('Bild umbenannt', { description: splitItemPath(renamed).name })
      return { path: renamed }
    },

    async moveImage({ path, project }) {
      await requireImage(path)
      requireProject(project)
      const moved = await gallery.move(path, project)
      editor.pathChanged(path, moved)
      toast.success(project ? `Nach „${project}“ verschoben` : 'Aus dem Projekt genommen', {
        description: splitItemPath(moved).name
      })
      return { path: moved }
    },

    async deleteImage({ path }) {
      const item = await requireImage(path)
      await gallery.remove(path)
      if (editor.isEditing(path)) editor.close()
      toast.success('In den Papierkorb verschoben', { description: item.name })
      return { deleted: path }
    },

    async copyImage({ path }) {
      const item = await requireImage(path)
      await gallery.copyImage(path)
      toast.success('Bild kopiert', { description: `${item.name} – zum Einfügen bereit.` })
      return { copied: path }
    },

    // ── Editor ────────────────────────────────────────────────────────────────

    async editorState() {
      return editorDetail(await requireEditor())
    },

    async editorImage({ drawing = true }) {
      const remote = await requireEditor()
      if (!drawing) return { png: editor.session!.baseBytes }
      await remote.canvas.settled()
      return { png: await remote.canvas.exportImage() }
    },

    async editorDraw({ shapes }) {
      const remote = await requireEditor()
      await remote.canvas.settled()
      const added = remote.canvas.drawShapes(shapes)
      const all = remote.canvas.objects()
      return { added: added.map((obj) => all.indexOf(obj)), ...editorDetail(remote) }
    },

    async editorSelect({ indices, all }) {
      const remote = await requireEditor()
      remote.canvas.selectObjects(all ? remote.canvas.objects() : objectsAt(remote, indices ?? []))
      return editorDetail(remote)
    },

    async editorUpdate({ indices, moveBy, ...change }) {
      const remote = await requireEditor()
      const objects = objectsAt(remote, indices)
      if (Object.values(change).some((v) => v !== undefined)) remote.canvas.restyle(objects, change)
      if (moveBy) remote.canvas.moveObjects(objects, moveBy.x, moveBy.y)
      return editorDetail(remote)
    },

    async editorDelete({ indices, all }) {
      const remote = await requireEditor()
      if (all) remote.canvas.clearAll()
      else if (indices?.length) remote.canvas.removeObjects(objectsAt(remote, indices))
      else throw new Error('Welche Objekte? indices angeben oder all: true.')
      return editorDetail(remote)
    },

    async editorArrange({ indices, where }) {
      const remote = await requireEditor()
      remote.canvas.arrange(where, objectsAt(remote, indices))
      return editorDetail(remote)
    },

    async editorClipboard({ action, indices, at }) {
      const remote = await requireEditor()
      const { canvas } = remote
      await canvas.settled()
      const objects = indices ? objectsAt(remote, indices) : undefined
      if (action === 'copy') {
        if (!canvas.copyObjects(objects)) throw new Error('Nichts ausgewählt zum Kopieren.')
      } else if (action === 'cut') {
        if (objects) canvas.selectObjects(objects)
        if (!canvas.cutSelection()) throw new Error('Nichts ausgewählt zum Ausschneiden.')
      } else if (action === 'paste') {
        if (!canvas.canPaste.value) throw new Error('Es wurde noch nichts kopiert.')
        await canvas.paste(at)
      } else {
        await canvas.duplicate(objects)
      }
      return editorDetail(remote)
    },

    async editorHistory({ action, steps = 1 }) {
      const remote = await requireEditor()
      const { canvas } = remote
      let done = 0
      for (; done < steps; done++) {
        await canvas.settled()
        if (action === 'undo' ? !canvas.canUndo.value : !canvas.canRedo.value) break
        if (action === 'undo') canvas.undo()
        else canvas.redo()
      }
      await canvas.settled()
      return { [action === 'undo' ? 'undone' : 'redone']: done, ...editorDetail(remote) }
    },

    async editorSetTool({ tool, color, strokeWidth, fontSize, filled }) {
      if (tool !== undefined) editor.tool = tool
      if (color !== undefined) editor.color = color
      if (strokeWidth !== undefined) editor.strokeWidth = strokeWidth
      if (fontSize !== undefined) editor.fontSize = fontSize
      if (filled !== undefined) editor.filled = filled
      return { tool: editor.tool, style: editor.style }
    },

    async editorSetView({ zoom, center }) {
      const { canvas } = await requireEditor()
      canvas.setView(zoom ?? canvas.viewZoom.value, center)
      return { viewZoom: canvas.viewZoom.value }
    },

    async editorSetScale({ micronsPerPixel, calibrate }) {
      const remote = await requireEditor()
      if (calibrate) {
        const line = remote.canvas.describeObjects()[calibrate.index]
        if (line?.kind !== 'measure' || !line.lengthPixels) {
          throw new Error(`Objekt ${calibrate.index} ist keine Messlinie.`)
        }
        const microns = calibrate.length * (calibrate.unit === 'mm' ? 1000 : 1)
        remote.calibrate(microns / line.lengthPixels, calibrate.remember ?? false)
      } else if (micronsPerPixel !== undefined) {
        remote.canvas.setScale(micronsPerPixel)
      } else {
        throw new Error('micronsPerPixel oder calibrate angeben.')
      }
      const scale = remote.canvas.micronsPerPixel.value
      return { micronsPerPixel: scale, scale: scale ? formatScale(scale) : null }
    },

    async editorSave({ name, project, asCopy, close }) {
      const remote = await requireEditor()
      const source = editor.session!.path
      const copy = !!asCopy && source !== null
      let target = source

      if (!source || copy || name !== undefined || project !== undefined) {
        const original = source ? splitItemPath(source) : null
        const ext = original ? splitExtension(original.name).ext : '.png'
        const folder =
          project !== undefined
            ? project
            : original
              ? original.project
              : gallery.projectExists(gallery.lastProject)
                ? gallery.lastProject
                : null
        if (folder) checkName(folder)
        const originalStem = original ? splitExtension(original.name).stem : captureStem()
        const stem = name
          ? stemOf(name.trim(), ext)
          : copy
            ? freeCopyStem(originalStem, ext, folder)
            : originalStem
        checkName(stem)
        target = itemPath(folder, stem + ext)
      }

      // For a copy the original counts as taken as well.
      const taken = gallery.items.some(
        (i) => (copy || i.path !== source) && sameName(i.path, target!)
      )
      if (taken) throw new Error(`Es gibt schon ein Bild „${placeOf(target!)}“.`)

      const stayOpen = close === undefined ? source !== null : !close
      const item = await remote.save(target!, { copy, stayOpen })
      return { saved: imageInfo(item), editor: stayOpen ? editorSummary() : null }
    },

    async editorCopyImage() {
      await (await requireEditor()).copyImage()
      return { copied: true }
    },

    async editorClose({ discard }) {
      if (editor.session) {
        requireSaved(discard)
        editor.cancelPending()
        editor.close()
      }
      return { view: 'camera' }
    }
  }
}

let actions: Actions | null = null
/** One request after another, as a person would work – e.g. no drawing while saving. */
let queue: Promise<unknown> = Promise.resolve()

/** Runs a request of the MCP server and resolves with its result as plain data. */
export function runRemoteAction(action: RemoteAction, args: unknown): Promise<unknown> {
  actions ??= createActions()
  const handler = actions[action] as ((args: unknown) => Promise<unknown>) | undefined
  if (!handler) return Promise.reject(new Error(`Unbekannte Aktion: ${action}`))
  const run = queue.then(() => handler(args ?? {})).then(plain)
  queue = run.catch(() => undefined)
  return run
}
