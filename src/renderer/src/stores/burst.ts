import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { captureStem, itemPath, sameName } from '@shared/names'
import type { CaptureInfo, GalleryItem } from '@shared/types'
import type { CapturedFrame } from '@/lib/capture'
import { errorMessage } from '@/lib/format'
import { canvasToBytes } from '@/lib/image'
import { useEditorStore } from './editor'
import { useGalleryStore } from './gallery'
import { usePanelsStore } from './panels'

/**
 * Burst capture: pictures are saved right away – with a name from the time and into the project
 * picked last – instead of opening the editor for each one.
 */
export const useBurstStore = defineStore('burst', () => {
  const gallery = useGalleryStore()
  const editor = useEditorStore()
  const panels = usePanelsStore()

  /** Space, the shutter and a device's photo button save directly (Shift+Space always does). */
  const enabled = useLocalStorage('cameradraw.burst', false)
  /** Pictures saved since burst capture was switched on. */
  const count = ref(0)

  /** Where the pictures go: the project picked last, null for the save folder itself. */
  const project = computed(() =>
    gallery.projectExists(gallery.lastProject) ? gallery.lastProject : null
  )

  watch(enabled, () => (count.value = 0))

  function setProject(name: string | null): void {
    gallery.lastProject = name
  }

  /** Paths given to pictures that are still waiting to be saved. */
  const pending: string[] = []
  /** Pictures are saved one after another, in the order they were taken. */
  let queue: Promise<unknown> = Promise.resolve()

  /** `CameraDraw_<time>.png`, with `_2`, `_3` … for further pictures within the same second. */
  function freePath(folder: string | null, date: Date): string {
    const base = captureStem(date)
    const taken = (path: string): boolean =>
      gallery.items.some((i) => sameName(i.path, path)) || pending.some((p) => sameName(p, path))
    let path = itemPath(folder, `${base}.png`)
    for (let n = 2; taken(path); n++) path = itemPath(folder, `${base}_${n}.png`)
    return path
  }

  const placeOf = (item: GalleryItem): string =>
    item.project ? `${item.project} / ${item.name}` : item.name

  /** One toast for the whole series, updated with every picture. */
  function announce(item: GalleryItem): void {
    if (enabled.value) count.value++
    const title =
      enabled.value && count.value > 1 ? `${count.value} Bilder gespeichert` : 'Bild gespeichert'
    toast.success(title, {
      id: 'burst',
      description: placeOf(item),
      action: {
        label: 'Bearbeiten',
        onClick: () => {
          panels.closeAll()
          editor.openFromGallery(item.path)
        }
      }
    })
  }

  /**
   * Saves a captured frame as a new image, editable later like any other. Name, project and scale
   * are those of the moment it was taken; the saving itself waits for the pictures before it.
   */
  function save(frame: CapturedFrame, capture: CaptureInfo): Promise<void> {
    const capturedAt = Date.now()
    const target = freePath(project.value, new Date(capturedAt))
    const micronsPerPixel = editor.scaleOfCapture(capture) ?? undefined
    pending.push(target)

    const run = queue.then(async () => {
      try {
        const bytes = await canvasToBytes(frame.canvas)
        const item = await gallery.save({
          source: null,
          target,
          image: bytes,
          base: bytes,
          document: {
            version: 1,
            width: frame.width,
            height: frame.height,
            objects: [],
            micronsPerPixel,
            capture
          },
          capturedAt
        })
        announce(item)
      } catch (err) {
        toast.error('Bild nicht gespeichert', { description: errorMessage(err) })
      } finally {
        pending.splice(pending.indexOf(target), 1)
      }
    })
    queue = run
    return run
  }

  return { enabled, count, project, setProject, save }
})
