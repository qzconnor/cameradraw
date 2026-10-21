import { ref, watch, type Ref } from 'vue'
import { useEventListener, useIntervalFn } from '@vueuse/core'

/**
 * The actual picture inside a camera's frames. Some cameras bake black bars into the frame instead
 * of changing its size – e.g. a phone used as a webcam (Windows virtual camera) keeps sending
 * 1280×720 when turned upright, with the portrait picture in the middle. Such centred bars are
 * detected here, so the view, a capture and the ambient light can cut them off.
 *
 * `null` until the video has a size; without bars it is the full frame.
 */

/** Width (px) a frame is scaled down to for the check – about 4 px precision at 1280 px. */
const ANALYSIS_WIDTH = 320
/** Brighter than this (any channel, 0–255) is picture. Baked-in bars measure 0–2. */
const BLACK = 10
/** Each bar has to cover at least this share of the frame – a thin dark border is no bar. */
const MIN_BAR = 0.04
/** Left/right (top/bottom) bar may differ by this many analysis pixels – they are centred. */
const SYMMETRY = 2
/** Picture sizes closer than this (share of the frame) count as the same – no jitter. */
const TOLERANCE = 0.02
/** Checks per second: turning a phone shows up within about a second. */
const CHECK_FPS = 2
/** Consecutive equal results before the size changes, so a dark scene cannot make it flicker. */
const STABLE = 2

type Size = { width: number; height: number }

let canvas: HTMLCanvasElement | null = null

/** Picture size inside the current frame, or null if the frame is (almost) completely black. */
function measure(video: HTMLVideoElement): Size | null {
  const sw = video.videoWidth
  const sh = video.videoHeight
  const w = ANALYSIS_WIDTH
  const h = Math.max(1, Math.round((w * sh) / sw))
  canvas ??= document.createElement('canvas')
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data

  // Brightest channel per column and per row.
  const cols = new Uint8Array(w)
  const rows = new Uint8Array(h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const v = Math.max(data[i], data[i + 1], data[i + 2])
      if (v > cols[x]) cols[x] = v
      if (v > rows[y]) rows[y] = v
    }
  }

  /** Width of the centred bars at both ends of a line (0 if there are none), null if all black. */
  const bar = (line: Uint8Array): number | null => {
    const n = line.length
    let start = 0
    while (start < n && line[start] <= BLACK) start++
    if (start === n) return null
    let end = 0
    while (line[n - 1 - end] <= BLACK) end++
    if (Math.abs(start - end) > SYMMETRY || Math.min(start, end) < n * MIN_BAR) return 0
    // One pixel more: the scaled-down edge blends bar and picture and would leave a dark line.
    return Math.max(start, end) + 1
  }
  const bx = bar(cols)
  const by = bar(rows)
  if (bx === null || by === null) return null
  return {
    width: Math.round(sw - (2 * bx * sw) / w),
    height: Math.round(sh - (2 * by * sh) / h)
  }
}

export function useVideoPicture(
  video: Ref<HTMLVideoElement | null>,
  /** Check only while true, e.g. while the camera is live and shown. */
  active: Ref<boolean>
): Ref<Size | null> {
  const picture = ref<Size | null>(null)
  let candidate: Size | null = null
  let seen = 0
  /** False right after the frame size changed: the next result is taken without waiting. */
  let settled = false

  const same = (a: Size, b: Size, el: HTMLVideoElement): boolean =>
    Math.abs(a.width - b.width) <= el.videoWidth * TOLERANCE &&
    Math.abs(a.height - b.height) <= el.videoHeight * TOLERANCE

  function check(): void {
    const el = video.value
    if (!el?.videoWidth || !el.videoHeight || el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
      return
    const size = measure(el)
    if (!size) return
    if (!settled || !picture.value) {
      picture.value = size
      settled = true
    } else if (same(size, picture.value, el)) {
      candidate = null
    } else {
      seen = candidate && same(size, candidate, el) ? seen + 1 : 1
      candidate = size
      if (seen >= STABLE) {
        picture.value = size
        candidate = null
      }
    }
  }

  // New frame size (other camera or resolution): start with the full frame, then check right away.
  useEventListener(video, ['loadedmetadata', 'resize'], () => {
    const el = video.value
    picture.value =
      el?.videoWidth && el.videoHeight ? { width: el.videoWidth, height: el.videoHeight } : null
    candidate = null
    settled = false
    check()
  })

  const { pause, resume } = useIntervalFn(check, 1000 / CHECK_FPS, { immediate: false })
  watch(active, (on) => (on ? resume() : pause()), { immediate: true })

  return picture
}
