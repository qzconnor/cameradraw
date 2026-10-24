/**
 * "Weicher Kontrast": the picture squeezed into the TV range 16–235 (out = 16 + in · 219/255), the
 * way Logi Capture shows a webcam – measured from its output. Highlights no longer burn out and
 * colours and colour casts get calmer. Written as CSS filter functions so the live view (`filter`)
 * and captures (`ctx.filter`) do exactly the same: contrast(c) then brightness(k) gives
 * k·c·x + k·(1 − c)/2, with k·c = 219/255 and k·(1 − c)/2 = 16/255.
 */
export const SOFT_CONTRAST = 'contrast(0.872509) brightness(0.984315)'

export interface CapturedFrame {
  /** The picture in full resolution, ready to be encoded (e.g. with `canvasToBytes`). */
  canvas: HTMLCanvasElement
  width: number
  height: number
  /** Width of the camera frame it was taken from (the picture may be cut out of it). */
  frameWidth: number
}

export interface FrameRegion {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The part of a camera frame the view shows, in frame pixels: the picture inside it (black bars
 * baked in around it – centred – cut off), and with digital zoom only its centre.
 */
export function visibleRegion(
  frame: { width: number; height: number },
  picture?: { width: number; height: number } | null,
  digitalZoom = 1
): FrameRegion {
  const zoom = Math.max(1, digitalZoom)
  const width = Math.min(frame.width, picture?.width ?? frame.width) / zoom
  const height = Math.min(frame.height, picture?.height ?? frame.height) / zoom
  return { x: (frame.width - width) / 2, y: (frame.height - height) / 2, width, height }
}

/**
 * Grabs the current video frame in full camera resolution – right away, so a picture shows the
 * moment of the key press even if encoding and saving it take a while.
 * With digital zoom only the visible centre is kept and scaled back up to full resolution
 * (like a phone camera), so the saved image matches what was on screen.
 * `picture` is the size of the actual picture inside the frame: black bars baked in around it
 * (centred) are cut off. `filter` (CSS filter functions) is applied like on the live view.
 */
export function captureFrame(
  video: HTMLVideoElement,
  mirror: boolean,
  digitalZoom = 1,
  picture?: { width: number; height: number } | null,
  filter?: string
): CapturedFrame {
  const { videoWidth, videoHeight } = video
  if (!videoWidth || !videoHeight) throw new Error('Kein Kamerabild verfügbar')
  const width = Math.min(videoWidth, picture?.width ?? videoWidth)
  const height = Math.min(videoHeight, picture?.height ?? videoHeight)
  const crop = visibleRegion({ width: videoWidth, height: videoHeight }, picture, digitalZoom)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  if (filter) ctx.filter = filter
  if (mirror) {
    ctx.translate(width, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
  return { canvas, width, height, frameWidth: videoWidth }
}
