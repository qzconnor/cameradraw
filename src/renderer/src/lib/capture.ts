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
 */
export async function captureFrame(
  video: HTMLVideoElement,
  mirror: boolean,
  digitalZoom = 1
): Promise<CapturedFrame> {
  const { videoWidth: width, videoHeight: height } = video
  if (!width || !height) throw new Error('Kein Kamerabild verfügbar')

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
    (width - cropWidth) / 2,
    (height - cropHeight) / 2,
    cropWidth,
    cropHeight,
    0,
    0,
    width,
    height
  )
  return { bytes: await canvasToBytes(canvas), width, height }
}
