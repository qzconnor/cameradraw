import { canvasToBytes } from './image'

export interface CapturedFrame {
  bytes: Uint8Array
  width: number
  height: number
}

/**
 * Grabs the current video frame in full camera resolution as PNG.
 * With digital zoom only the visible centre is kept and scaled back up to full resolution
 * (like a phone camera), so the saved image matches what was on screen.
 * `picture` is the size of the actual picture inside the frame: black bars baked in around it
 * (centred) are cut off.
 */
export async function captureFrame(
  video: HTMLVideoElement,
  mirror: boolean,
  digitalZoom = 1,
  picture?: { width: number; height: number } | null
): Promise<CapturedFrame> {
  const { videoWidth, videoHeight } = video
  if (!videoWidth || !videoHeight) throw new Error('Kein Kamerabild verfügbar')
  const width = Math.min(videoWidth, picture?.width ?? videoWidth)
  const height = Math.min(videoHeight, picture?.height ?? videoHeight)

  const zoom = Math.max(1, digitalZoom)
  const cropWidth = width / zoom
  const cropHeight = height / zoom

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  if (mirror) {
    ctx.translate(width, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(
    video,
    (videoWidth - cropWidth) / 2,
    (videoHeight - cropHeight) / 2,
    cropWidth,
    cropHeight,
    0,
    0,
    width,
    height
  )
  return { bytes: await canvasToBytes(canvas), width, height }
}
