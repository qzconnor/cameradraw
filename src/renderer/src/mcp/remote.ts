import { onBeforeUnmount, shallowRef, type ShallowRef } from 'vue'
import type { GalleryItem } from '@shared/types'
import type { DrawingCanvas } from '@/composables/useDrawingCanvas'

/**
 * What the camera view and the editor offer the remote control (MCP, see `./actions.ts`) while
 * they are on screen – their actions live in the components, not in a store.
 */

export interface CameraRemote {
  /** The live picture can be captured right now. */
  canCapture(): boolean
  /**
   * Takes a picture and opens it in the editor – or with `direct` saves it and resolves with the
   * saved image. Rejects if that failed (the app shows why in a toast as well).
   */
  capture(direct: boolean): Promise<GalleryItem | null>
}

export interface EditorRemote {
  /** Of the editor session it belongs to (the editor is re-created for every image). */
  baseUrl: string
  canvas: DrawingCanvas
  /**
   * Saves to `target`; stays open (showing the saved image from then on) or goes back to the
   * camera. A copy is a new image, the original stays as it is.
   */
  save(target: string, options: { copy: boolean; stayOpen: boolean }): Promise<GalleryItem>
  /** Puts the picture with its drawing on the clipboard. */
  copyImage(): Promise<void>
  /** Sets the scale for measuring, remembered for new pictures of the camera if asked. */
  calibrate(micronsPerPixel: number, remember: boolean): void
  /** Leaves placing the corners of a perspective crop, if that is going on. */
  stopCropping(): void
}

interface Remotes {
  camera: CameraRemote
  editor: EditorRemote
}

export const remotes: { [K in keyof Remotes]: ShallowRef<Remotes[K] | null> } = {
  camera: shallowRef(null),
  editor: shallowRef(null)
}

/** Offers a component's actions to the remote control while it is mounted. */
export function provideRemote<K extends keyof Remotes>(name: K, value: Remotes[K]): void {
  const slot = remotes[name] as ShallowRef<Remotes[K] | null>
  slot.value = value
  onBeforeUnmount(() => {
    if (slot.value === value) slot.value = null
  })
}
