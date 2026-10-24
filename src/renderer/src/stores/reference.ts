import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import type { GalleryItem } from '@shared/types'
import { bytesToObjectUrl } from '@/lib/image'
import { useGalleryStore } from './gallery'

/** How the reference lies over the live picture. */
export type ReferenceMode = 'blend' | 'difference'

export const isReferenceMode = (value: unknown): value is ReferenceMode =>
  value === 'blend' || value === 'difference'

/**
 * "Referenzbild": a picture taken before lies over the live picture – half see-through, or as the
 * difference to it (what lines up turns black) – so a sample can be put back exactly where it was,
 * e.g. for a picture after a repair that matches the one before. It shows the original camera
 * frame (that is what lines up with the camera), or on request the image as saved, with its
 * drawing – markers show where to look.
 */
export const useReferenceStore = defineStore('reference', () => {
  const gallery = useGalleryStore()

  /** The image shown over the live picture, null while there is none. */
  const path = ref<string | null>(null)
  /** What is shown: an object URL of the frame or of the saved image. */
  const url = ref<string | null>(null)
  const loading = ref(false)
  const opacity = useLocalStorage('cameradraw.referenceOpacity', 0.5)
  const mode = useLocalStorage<ReferenceMode>('cameradraw.referenceMode', 'blend')
  /** Show the image as saved, with its drawing, instead of the original frame. */
  const drawing = useLocalStorage('cameradraw.referenceDrawing', false)

  const item = computed(() => gallery.items.find((i) => i.path === path.value) ?? null)
  const enabled = computed(() => path.value !== null)

  /** The images newest first – for picking one, and the newest by default. */
  const recent = computed(() => [...gallery.items].sort((a, b) => b.capturedAt - a.capturedAt))

  let token = 0

  function setUrl(next: string | null): void {
    if (url.value) URL.revokeObjectURL(url.value)
    url.value = next
  }

  async function load(target: string): Promise<void> {
    const mine = ++token
    loading.value = true
    try {
      let bytes: Uint8Array
      let mime: string
      if (drawing.value) ({ bytes, mime } = await window.api.library.readImage(target))
      else {
        const loaded = await window.api.library.load(target)
        bytes = loaded.base
        mime = loaded.baseMime
      }
      if (mine === token) setUrl(bytesToObjectUrl(bytes, mime))
    } finally {
      if (mine === token) loading.value = false
    }
  }

  /** Shows `target` (a path in the library) over the live picture. Throws if it cannot be read. */
  async function show(target: string): Promise<void> {
    const previous = path.value
    path.value = target
    try {
      await load(target)
    } catch (err) {
      path.value = previous
      throw err
    }
  }

  /** Shows the newest image – usually the picture just taken. Throws if there is none. */
  async function showLatest(): Promise<GalleryItem> {
    await gallery.refresh()
    const newest = recent.value[0]
    if (!newest) throw new Error('Es gibt noch kein Bild – erst eins aufnehmen.')
    await show(newest.path)
    return newest
  }

  function hide(): void {
    token++
    path.value = null
    loading.value = false
    setUrl(null)
  }

  // With or without its drawing: shown anew.
  watch(drawing, () => {
    if (path.value) void load(path.value).catch(() => hide())
  })
  // Deleted (or moved away) meanwhile: nothing left to show.
  watch(
    () => gallery.items,
    () => {
      if (path.value && !gallery.loading && !item.value) hide()
    }
  )

  return {
    path,
    url,
    loading,
    opacity,
    mode,
    drawing,
    item,
    enabled,
    recent,
    show,
    showLatest,
    hide
  }
})
