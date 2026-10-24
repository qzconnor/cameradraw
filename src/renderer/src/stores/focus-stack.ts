import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { toast } from 'vue-sonner'
import type { GalleryItem } from '@shared/types'
import type { CapturedFrame } from '@/lib/capture'
import type { StackRequest, StackResponse } from '@/lib/focus-stack.worker'
import { errorMessage } from '@/lib/format'
import { useCameraControlsStore, type ControlRange } from './camera-controls'

/**
 * `recording`: pictures are taken while the user turns the focus · `sweeping`: the camera moves
 * its focus itself, a picture at every step · `merging`: the last pictures are being merged.
 */
export type StackState = 'idle' | 'recording' | 'sweeping' | 'merging'

/** What the camera view gives the focus stack: its pictures, and where the result goes. */
export interface StackSource {
  /** The current frame in full resolution, exactly as a capture takes it. */
  grab(): CapturedFrame
  /** Resolves once the camera delivered a new frame (or after a moment without one). */
  nextFrame(): Promise<void>
  /** Opens the merged picture in the editor – or, `direct`, saves it right away. */
  deliver(frame: CapturedFrame, direct: boolean): Promise<GalleryItem | null>
}

/** Pictures a sweep can take. */
export const SWEEP_FRAMES = [10, 15, 25] as const

/** By hand at most this many pictures – then the stack is finished by itself. */
export const MAX_FRAMES = 60
/** A picture is taken only while fewer than this many still wait to be merged. */
const MAX_PENDING = 2
/** After the focus moved, the lens and the camera's pipeline need this long (ms). */
const SETTLE_MS = 350

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** A value of the range, on its steps. */
function onSteps(value: number, range: ControlRange): number {
  const stepped = range.step
    ? range.min + Math.round((value - range.min) / range.step) * range.step
    : value
  return Math.min(range.max, Math.max(range.min, stepped))
}

/**
 * Focus stacking ("Fokus-Stacking"): a series of pictures of the same spot, each sharp at another
 * depth, merged into one that is sharp throughout (see `lib/focus-stack.ts`). By hand the user
 * turns the focus while pictures are taken – the shutter starts and finishes it; a camera that
 * moves its own focus does it all by itself (a sweep from near to far).
 */
export const useFocusStackStore = defineStore('focusStack', () => {
  const controls = useCameraControlsStore()

  /** Focus stacking mode: the shutter, Space and the photo button start and finish a stack. */
  const enabled = ref(false)
  const state = ref<StackState>('idle')
  /** Pictures taken for the stack being made … */
  const frames = ref(0)
  /** … and merged so far. */
  const merged = ref(0)
  /** Pictures a sweep takes (null by hand). */
  const planned = ref<number | null>(null)
  const sweepFrames = useLocalStorage<number>('cameradraw.stackFrames', 15)

  /** The range of the camera's own focus – null if it cannot move it (then only by hand). */
  const focusRange = computed(() => {
    const focus = controls.controls.find((c) => c.kind === 'auto' && c.name === 'focus')
    return focus?.kind === 'auto' ? focus.range : null
  })
  const canSweep = computed(() => focusRange.value !== null)
  const busy = computed(() => state.value !== 'idle')

  let source: StackSource | null = null
  let worker: Worker | null = null
  /** Pictures sent to the worker and not merged yet. */
  let pending = 0
  let room: (() => void) | null = null
  let result: {
    resolve: (value: Extract<StackResponse, { type: 'result' }>) => void
    reject: (err: Error) => void
  } | null = null
  /** Width of the camera frame the pictures come from (for a calibration, like a capture). */
  let frameWidth = 0
  /** Save the result right away (burst capture) instead of opening it in the editor. */
  let direct = false

  function attach(next: StackSource): void {
    source = next
  }

  function detach(old: StackSource): void {
    if (source !== old) return
    cancel()
    source = null
  }

  function stopWorker(): void {
    worker?.terminate()
    worker = null
    pending = 0
    room?.()
    room = null
    result?.reject(new Error('Fokus-Stacking abgebrochen.'))
    result = null
  }

  function startWorker(): void {
    stopWorker()
    const next = new Worker(new URL('../lib/focus-stack.worker.ts', import.meta.url), {
      type: 'module'
    })
    next.onmessage = ({ data }: MessageEvent<StackResponse>) => {
      if (worker !== next) return
      if (data.type === 'added') {
        pending--
        merged.value = data.count
        room?.()
        room = null
      } else if (data.type === 'result') {
        result?.resolve(data)
        result = null
      } else {
        result?.reject(new Error(data.message))
        result = null
      }
    }
    next.onerror = (event) => {
      if (worker !== next) return
      result?.reject(new Error(event.message || 'Die Bilder konnten nicht zusammengesetzt werden.'))
      result = null
    }
    worker = next
  }

  function begin(next: StackState, sendDirect: boolean): StackSource {
    if (!source) throw new Error('Die Kamera ist nicht zu sehen.')
    if (busy.value) throw new Error('Es läuft schon ein Fokus-Stapel.')
    startWorker()
    state.value = next
    frames.value = 0
    merged.value = 0
    planned.value = null
    direct = sendDirect
    return source
  }

  function send(frame: CapturedFrame): void {
    const image = frame.canvas.getContext('2d')!.getImageData(0, 0, frame.width, frame.height)
    frameWidth = frame.frameWidth
    pending++
    frames.value++
    const request: StackRequest = {
      type: 'frame',
      width: frame.width,
      height: frame.height,
      data: image.data.buffer
    }
    worker!.postMessage(request, [image.data.buffer])
  }

  /** Waits until the worker can take another picture. */
  async function waitForRoom(): Promise<void> {
    while (worker && pending >= MAX_PENDING) await new Promise<void>((resolve) => (room = resolve))
  }

  async function record(from: StackSource): Promise<void> {
    while (state.value === 'recording') {
      await from.nextFrame()
      if (state.value !== 'recording') return
      // Pictures come no faster than they are merged – more would only pile up.
      if (pending >= MAX_PENDING) continue
      send(from.grab())
      if (frames.value >= MAX_FRAMES) {
        void finish().catch(() => undefined)
        return
      }
    }
  }

  /**
   * Starts taking pictures while the user turns the focus; `finish` merges them. With `save` the
   * result is saved right away instead of opened in the editor.
   */
  function start(save = false): void {
    const from = begin('recording', save)
    void record(from)
  }

  /** Merges the pictures and hands the result on; rejects (after a toast) if that failed. */
  async function finish(): Promise<GalleryItem | null> {
    if (state.value !== 'recording' && state.value !== 'sweeping') {
      throw new Error('Es wird gerade kein Fokus-Stapel aufgenommen.')
    }
    const from = source!
    state.value = 'merging'
    try {
      // Finished right away: one picture is a stack too.
      if (!frames.value) send(from.grab())
      const done = new Promise<Extract<StackResponse, { type: 'result' }>>((resolve, reject) => {
        result = { resolve, reject }
      })
      worker!.postMessage({ type: 'finish' } satisfies StackRequest)
      const output = await done
      const canvas = document.createElement('canvas')
      canvas.width = output.width
      canvas.height = output.height
      canvas
        .getContext('2d')!
        .putImageData(
          new ImageData(new Uint8ClampedArray(output.data), output.width, output.height),
          0,
          0
        )
      if (output.unaligned) {
        toast('Nicht alle Bilder ließen sich ausrichten', {
          description: `${output.unaligned} von ${frames.value} sind so übernommen, wie sie waren – die Probe hat sich vielleicht bewegt.`
        })
      }
      reset()
      return await from.deliver(
        { canvas, width: output.width, height: output.height, frameWidth },
        direct
      )
    } catch (err) {
      // Not when it was cancelled – nor when handing on failed (that says so itself).
      if (busy.value) {
        toast.error('Fokus-Stacking fehlgeschlagen', { description: errorMessage(err) })
      }
      reset()
      throw err
    }
  }

  /**
   * Lets the camera move its focus from near to far, a picture at every step, and merges them.
   * The focus is put back as it was. Rejects (after a toast) if that failed.
   */
  async function sweep(save = false): Promise<GalleryItem | null> {
    const range = focusRange.value
    if (!range) throw new Error('Diese Kamera stellt den Fokus nicht selbst ein – von Hand drehen.')
    const from = begin('sweeping', save)
    const count = Math.max(2, Math.round(sweepFrames.value))
    planned.value = count
    const values = controls.values
    const before =
      values.focusMode === 'manual' && values.focusDistance !== undefined
        ? { focusMode: 'manual' as const, focusDistance: values.focusDistance }
        : { focusMode: 'continuous' as const }
    try {
      for (let i = 0; i < count && state.value === 'sweeping'; i++) {
        const distance = onSteps(range.min + ((range.max - range.min) * i) / (count - 1), range)
        await controls.setTemporarily({ focusMode: 'manual', focusDistance: distance })
        await sleep(SETTLE_MS)
        await from.nextFrame()
        await from.nextFrame()
        await waitForRoom()
        if (state.value !== 'sweeping') break
        send(from.grab())
      }
    } catch (err) {
      if (state.value === 'sweeping') {
        toast.error('Fokus-Stacking fehlgeschlagen', { description: errorMessage(err) })
        reset()
      }
      throw err
    } finally {
      await controls.setTemporarily(before).catch(() => undefined)
    }
    if (state.value !== 'sweeping') return null // cancelled
    return finish()
  }

  function reset(): void {
    stopWorker()
    state.value = 'idle'
    frames.value = 0
    merged.value = 0
    planned.value = null
  }

  /** Stops a stack being taken – nothing is kept. */
  function cancel(): void {
    if (busy.value) reset()
  }

  // Switched off in the middle of a stack: it is dropped.
  watch(enabled, (on) => !on && cancel())

  return {
    enabled,
    state,
    frames,
    merged,
    planned,
    sweepFrames,
    focusRange,
    canSweep,
    busy,
    attach,
    detach,
    start,
    finish,
    sweep,
    cancel
  }
})
