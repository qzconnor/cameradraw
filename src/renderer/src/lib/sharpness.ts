import { visibleRegion } from './capture'

/**
 * How sharp the live picture is: the fine detail (Laplacian) in the middle of what the view shows,
 * in full camera resolution – it is highest when the focus sits. The number only means something
 * compared with others of the same scene, e.g. while turning the focus.
 */

/** Size of the middle part looked at (frame pixels) – enough detail, quick to read. */
const SAMPLE_WIDTH = 640
const SAMPLE_HEIGHT = 360

export interface Sharpness {
  /** Root mean square of the Laplacian of the brightness (0–255): higher is sharper. */
  value: number
  /**
   * Noise of the picture as the steepness it fakes (Sobel filter, brightness 0–1 per pixel) – the
   * focus peaking stays above it, so noise does not light up.
   */
  noise: number
}

let canvas: HTMLCanvasElement | null = null

export function measureSharpness(
  video: HTMLVideoElement,
  picture?: { width: number; height: number } | null,
  digitalZoom = 1
): Sharpness | null {
  const { videoWidth, videoHeight } = video
  if (!videoWidth || !videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return null
  }
  const region = visibleRegion({ width: videoWidth, height: videoHeight }, picture, digitalZoom)
  const w = Math.max(3, Math.min(SAMPLE_WIDTH, Math.floor(region.width)))
  const h = Math.max(3, Math.min(SAMPLE_HEIGHT, Math.floor(region.height)))
  canvas ??= document.createElement('canvas')
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  // One to one – scaling would smooth away exactly the detail that shows the focus.
  const x = Math.round(region.x + (region.width - w) / 2)
  const y = Math.round(region.y + (region.height - h) / 2)
  ctx.drawImage(video, x, y, w, h, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data

  const luma = new Float32Array(w * h)
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    luma[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
  }
  // Squared sum for the sharpness, a histogram of |L| for its median (the noise).
  const histogram = new Uint32Array(1021)
  let sum = 0
  let count = 0
  for (let row = 1; row < h - 1; row++) {
    for (let col = 1; col < w - 1; col++) {
      const i = row * w + col
      const l = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w]
      sum += l * l
      histogram[Math.min(1020, Math.round(Math.abs(l)))]++
      count++
    }
  }
  let median = 0
  for (let seen = 0; median < histogram.length; median++) {
    seen += histogram[median]
    if (seen * 2 >= count) break
  }
  // Noise σ of the brightness: median |L| = 0.6745 · √20 · σ. As steepness (Sobel ÷ 8, 0–1) that
  // noise shows as √12 / 8 · σ.
  const sigma = median / (0.6745 * Math.sqrt(20)) / 255
  return { value: Math.sqrt(sum / count), noise: (Math.sqrt(12) / 8) * sigma }
}
