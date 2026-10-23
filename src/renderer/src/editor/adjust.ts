import type { ImageAdjustment, ImagePoint } from '@shared/types'

/**
 * Changes of the picture itself – turning, straightening a perspective, adding space around it.
 * They are applied to the original frame one after another, so it stays untouched: the saved
 * layers keep the list, and undoing or resetting just applies fewer of them.
 */

export interface Size {
  width: number
  height: number
}

/** Outputs larger than this (in pixels per side) are refused – a slip of a corner handle. */
export const MAX_SIDE = 12_000

type Matrix = number[]

/** Size of the picture after an adjustment. */
export function sizeAfter(size: Size, adjustment: ImageAdjustment): Size {
  switch (adjustment.type) {
    case 'rotate':
      return adjustment.turns % 2 ? { width: size.height, height: size.width } : size
    case 'perspective':
      return { width: adjustment.width, height: adjustment.height }
    case 'extend':
      return {
        width: size.width + adjustment.left + adjustment.right,
        height: size.height + adjustment.top + adjustment.bottom
      }
  }
}

export const sizeAfterAll = (size: Size, adjustments: ImageAdjustment[]): Size =>
  adjustments.reduce(sizeAfter, size)

/** How far drawn objects turn with an adjustment (degrees, clockwise). */
export const turnOf = (adjustment: ImageAdjustment): number =>
  adjustment.type === 'rotate' ? adjustment.turns * 90 : 0

// ── Perspective ───────────────────────────────────────────────────────────────

/** Solves `a · x = b` (Gaussian elimination with partial pivoting); null if it has no solution. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = m[row][col] / m[col][col]
      for (let k = col; k <= n; k++) m[row][k] -= factor * m[col][k]
    }
  }
  return m.map((row, i) => row[n] / row[i])
}

/** The projective transform that maps the four points `from` onto `to`. */
function homography(from: ImagePoint[], to: ImagePoint[]): Matrix | null {
  const a: number[][] = []
  const b: number[] = []
  from.forEach(({ x, y }, i) => {
    const { x: u, y: v } = to[i]
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  })
  const h = solve(a, b)
  return h && [...h, 1]
}

function project(h: Matrix, { x, y }: ImagePoint): ImagePoint {
  const w = h[6] * x + h[7] * y + h[8]
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w }
}

const rectangle = (width: number, height: number): ImagePoint[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height }
]

const distance = (a: ImagePoint, b: ImagePoint): number => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * The corners in the order top left, top right, bottom right, bottom left – whatever order they
 * were given in (e.g. after dragging a handle across another).
 */
export function orderCorners(points: ImagePoint[]): ImagePoint[] {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length
  const around = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  )
  // Clockwise on screen (y points down) starting at the corner nearest to the top left.
  const first = around.reduce(
    (best, p, i) => (p.x + p.y < around[best].x + around[best].y ? i : best),
    0
  )
  return [...around.slice(first), ...around.slice(0, first)]
}

/** The corners span a proper (convex) quadrilateral – nothing crossed or collapsed. */
export function isQuadrilateral(corners: ImagePoint[]): boolean {
  if (corners.length !== 4) return false
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const [a, b, c] = [corners[i], corners[(i + 1) % 4], corners[(i + 2) % 4]]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1) return false
    if (sign && Math.sign(cross) !== sign) return false
    sign = Math.sign(cross)
  }
  return true
}

/**
 * Size of the straightened picture: the longer of each pair of opposite edges, so nothing is
 * scaled down and the pixels keep about their size (and a calibrated scale stays right).
 */
export function straightenedSize(corners: ImagePoint[]): Size {
  const [tl, tr, br, bl] = corners
  return {
    width: Math.max(1, Math.round(Math.max(distance(tl, tr), distance(bl, br)))),
    height: Math.max(1, Math.round(Math.max(distance(tl, bl), distance(tr, br))))
  }
}

/** A perspective adjustment for four corners in any order; null if they span no quadrilateral. */
export function perspectiveFor(
  points: ImagePoint[],
  size?: Partial<Size>
): Extract<ImageAdjustment, { type: 'perspective' }> | null {
  const corners = orderCorners(points)
  if (!isQuadrilateral(corners)) return null
  const natural = straightenedSize(corners)
  const width = Math.round(size?.width ?? natural.width)
  const height = Math.round(size?.height ?? natural.height)
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) return null
  const round = (p: ImagePoint): ImagePoint => ({
    x: Math.round(p.x * 100) / 100,
    y: Math.round(p.y * 100) / 100
  })
  return {
    type: 'perspective',
    corners: corners.map(round) as [ImagePoint, ImagePoint, ImagePoint, ImagePoint],
    width,
    height
  }
}

// ── Mapping points (for the drawn objects) ────────────────────────────────────

/**
 * Where a point of the picture (before the adjustment, of size `size`) lands after it – or, with
 * `inverse`, where a point after it came from.
 */
export function pointMapper(
  size: Size,
  adjustment: ImageAdjustment,
  inverse = false
): (p: ImagePoint) => ImagePoint {
  switch (adjustment.type) {
    case 'rotate': {
      const turns = inverse ? (4 - adjustment.turns) % 4 : adjustment.turns
      // Inverse turns start from the turned picture.
      const { width, height } = inverse ? sizeAfter(size, adjustment) : size
      return ({ x, y }) =>
        turns === 1
          ? { x: height - y, y: x }
          : turns === 2
            ? { x: width - x, y: height - y }
            : turns === 3
              ? { x: y, y: width - x }
              : { x, y }
    }
    case 'extend': {
      const dx = inverse ? -adjustment.left : adjustment.left
      const dy = inverse ? -adjustment.top : adjustment.top
      return ({ x, y }) => ({ x: x + dx, y: y + dy })
    }
    case 'perspective': {
      const target = rectangle(adjustment.width, adjustment.height)
      const h = inverse
        ? homography(target, adjustment.corners)
        : homography(adjustment.corners, target)
      return h ? (p) => project(h, p) : (p) => p
    }
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function newCanvas({ width, height }: Size): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** Straightens the quad: every output pixel is sampled (bilinear) from where it came from. */
function straighten(
  source: HTMLCanvasElement,
  adjustment: Extract<ImageAdjustment, { type: 'perspective' }>
): HTMLCanvasElement {
  const { width, height } = adjustment
  const out = newCanvas({ width, height })
  const h = homography(rectangle(width, height), adjustment.corners)
  if (!h) return out
  const src = source.getContext('2d')!.getImageData(0, 0, source.width, source.height)
  const sw = src.width
  const sh = src.height
  const from = src.data
  const result = new ImageData(width, height)
  const to = result.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Pixel centres: the output pixel (x, y) covers x … x + 1.
      const px = x + 0.5
      const py = y + 0.5
      const w = h[6] * px + h[7] * py + h[8]
      const sx = Math.min(sw - 1, Math.max(0, (h[0] * px + h[1] * py + h[2]) / w - 0.5))
      const sy = Math.min(sh - 1, Math.max(0, (h[3] * px + h[4] * py + h[5]) / w - 0.5))
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(sw - 1, x0 + 1)
      const y1 = Math.min(sh - 1, y0 + 1)
      const fx = sx - x0
      const fy = sy - y0
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      const o = (y * width + x) * 4
      for (let c = 0; c < 4; c++) {
        const top = from[i00 + c] + (from[i10 + c] - from[i00 + c]) * fx
        const bottom = from[i01 + c] + (from[i11 + c] - from[i01 + c]) * fx
        to[o + c] = top + (bottom - top) * fy
      }
    }
  }
  out.getContext('2d')!.putImageData(result, 0, 0)
  return out
}

/** The picture after one adjustment. */
export function render(source: HTMLCanvasElement, adjustment: ImageAdjustment): HTMLCanvasElement {
  if (adjustment.type === 'perspective') return straighten(source, adjustment)
  const out = newCanvas(sizeAfter(source, adjustment))
  const ctx = out.getContext('2d')!
  if (adjustment.type === 'extend') {
    ctx.fillStyle = adjustment.color
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(source, adjustment.left, adjustment.top)
    return out
  }
  ctx.translate(out.width / 2, out.height / 2)
  ctx.rotate((adjustment.turns * Math.PI) / 2)
  ctx.drawImage(source, -source.width / 2, -source.height / 2)
  return out
}

/** The original as a canvas, so the adjustments can work on its pixels. */
export function toCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = newCanvas({ width: image.naturalWidth, height: image.naturalHeight })
  canvas.getContext('2d')!.drawImage(image, 0, 0)
  return canvas
}

export const renderAll = (
  original: HTMLCanvasElement,
  adjustments: ImageAdjustment[]
): HTMLCanvasElement => adjustments.reduce(render, original)
