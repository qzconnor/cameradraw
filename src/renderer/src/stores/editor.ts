import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import type { EditorDocument } from '@shared/types'
import type { DrawStyle, Tool } from '@/editor/tools'
import { bytesToObjectUrl, canvasToBytes, imageSize } from '@/lib/image'

export interface EditorSession {
  /** Path of the image when editing from the gallery, null for a fresh capture. */
  path: string | null
  /** Object URL of the base image shown under the drawing. */
  baseUrl: string
  /** Base image as PNG – stored next to the result so drawings stay editable. */
  baseBytes: Uint8Array
  width: number
  height: number
  document: EditorDocument | null
  /** When the picture was taken: a fresh capture now, an image from the gallery keeps its date. */
  capturedAt: number
}

/** Converts arbitrary image bytes to PNG (project base images are always PNG). */
async function toPng(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const url = bytesToObjectUrl(bytes, mime)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d')!.drawImage(img, 0, 0)
    return await canvasToBytes(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const useEditorStore = defineStore('editor', () => {
  const session = shallowRef<EditorSession | null>(null)
  const isOpen = computed(() => session.value !== null)
  /** Reported by the editor canvas: unsaved changes exist. */
  const dirty = ref(false)
  const loading = ref(false)
  /** Action waiting for the user to confirm discarding unsaved changes. */
  const pendingAction = shallowRef<(() => void | Promise<void>) | null>(null)

  // Tool settings – remembered between sessions.
  const tool = useLocalStorage<Tool>('cameradraw.tool', 'pen')
  const color = useLocalStorage('cameradraw.color', '#ef4444')
  const strokeWidth = useLocalStorage('cameradraw.strokeWidth', 8)
  const fontSize = useLocalStorage('cameradraw.fontSize', 48)
  const filled = useLocalStorage('cameradraw.filled', false)
  const style = computed<DrawStyle>(() => ({
    color: color.value,
    strokeWidth: strokeWidth.value,
    fontSize: fontSize.value,
    filled: filled.value
  }))

  function setSession(next: EditorSession | null): void {
    if (session.value) URL.revokeObjectURL(session.value.baseUrl)
    session.value = next
    dirty.value = false
  }

  const unsaved = computed(() => session.value !== null && dirty.value)

  /** Runs `action` right away, or after confirmation if there are unsaved changes. */
  function guard(action: () => void | Promise<void>): void {
    if (unsaved.value) pendingAction.value = action
    else void action()
  }

  // Closing the window (or quitting) with unsaved changes asks first too. Refusing the unload keeps
  // the window open (the main process brings it to the front); after confirming it closes again.
  let closeConfirmed = false
  window.addEventListener('beforeunload', (e) => {
    if (closeConfirmed || !unsaved.value) return
    e.preventDefault()
    guard(() => {
      closeConfirmed = true
      window.close()
    })
  })

  function confirmPending(): void {
    const action = pendingAction.value
    pendingAction.value = null
    dirty.value = false
    void action?.()
  }

  function cancelPending(): void {
    pendingAction.value = null
  }

  function openCapture(bytes: Uint8Array, width: number, height: number): void {
    setSession({
      path: null,
      baseUrl: bytesToObjectUrl(bytes, 'image/png'),
      baseBytes: bytes,
      width,
      height,
      document: null,
      capturedAt: Date.now()
    })
  }

  function openFromGallery(path: string): void {
    if (session.value?.path === path) return
    guard(async () => {
      loading.value = true
      try {
        const loaded = await window.api.library.load(path)
        const base =
          loaded.baseMime === 'image/png' ? loaded.base : await toPng(loaded.base, loaded.baseMime)
        const baseUrl = bytesToObjectUrl(base, 'image/png')
        const { width, height } = await imageSize(baseUrl)
        setSession({
          path,
          baseUrl,
          baseBytes: base,
          width,
          height,
          document: loaded.document,
          capturedAt: loaded.capturedAt
        })
      } finally {
        loading.value = false
      }
    })
  }

  /**
   * Keeps the open image's path up to date when it was moved (`from` is its old path) or its
   * project was renamed (`from` is the old project name).
   */
  function pathChanged(from: string, to: string): void {
    const current = session.value
    if (!current?.path) return
    if (current.path === from) session.value = { ...current, path: to }
    else if (current.path.startsWith(`${from}/`)) {
      session.value = { ...current, path: to + current.path.slice(from.length) }
    }
  }

  /** True if the open image lies at `path` or, for a project name, inside that project. */
  const isEditing = (path: string): boolean =>
    !!session.value?.path &&
    (session.value.path === path || session.value.path.startsWith(`${path}/`))

  /** Close without asking (after saving). */
  function close(): void {
    setSession(null)
  }

  /** Close, asking first if there are unsaved changes. */
  function requestClose(): void {
    guard(close)
  }

  return {
    session,
    isOpen,
    dirty,
    loading,
    pendingAction,
    tool,
    color,
    strokeWidth,
    fontSize,
    filled,
    style,
    guard,
    confirmPending,
    cancelPending,
    openCapture,
    openFromGallery,
    pathChanged,
    isEditing,
    close,
    requestClose
  }
})
