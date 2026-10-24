/**
 * Focus stacking: pictures of the same spot, each sharp at another depth, merged into one that is
 * sharp throughout. The pictures come in one by one (while the focus is turned) and are merged
 * right away, so only the result and a few working copies are kept – never the whole series.
 *
 * Turning the focus of a microscope also changes its magnification a little and may shift the
 * picture, so every picture is lined up with the first one first: scale about the middle and shift,
 * found by comparing it with the picture before (Lucas–Kanade on a small pyramid of the brightness).
 * Then every pixel is mixed from the pictures by how much fine detail each has around it – the
 * sharpest by far the most. Where none is sharp (a plain wall), they are about equal and the
 * mixture even calms the noise; a hard "the sharpest wins" would pick the noisiest there.
 *
 * The result is cut to the part every picture shows (the edges of a picture that grew are missing
 * in the later ones) – not scaled, so it has the scale of the camera like any capture.
 */

/** Scale about the middle and shift (pixels of the full picture). */
interface Similarity {
  scale: number
  x: number
  y: number
}

const IDENTITY: Similarity = { scale: 1, x: 0, y: 0 }

/** Brightness of a level of the pyramid, normalised (mean 0, deviation 1) against exposure changes. */
interface Level {
  width: number
  height: number
  pixels: Float32Array
}

/** The pyramid is aligned on levels down to this width … */
const ALIGN_MIN_WIDTH = 100
/** … and up to this one – finer would cost a lot and add little. */
const ALIGN_MAX_WIDTH = 640
const ALIGN_ITERATIONS = 12
/** A step changes the scale by less than this and the shift by less than this (level pixels). */
const ALIGN_DONE_SCALE = 1e-5
const ALIGN_DONE_SHIFT = 0.01
/** More between two pictures is no focus breathing but a failure – they are taken as they are. */
const MAX_SCALE_STEP = 0.06
const MAX_SHIFT_STEP = 0.08
/**
 * Radius of the area the fine detail is averaged over, per 1000 pixels of picture width. Wide
 * enough that a sharp edge outweighs the blur a far-off focus spreads around it (halos).
 */
const DETAIL_RADIUS = 10
/**
 * Weight of a picture at a pixel: its fine detail (mean squared Laplacian) compared with the most
 * any picture had there, to this power – half the detail weighs 1/256. Many blurred pictures
 * together must not outweigh the one sharp picture.
 */
const DETAIL_POWER = 8
/** Detail below this counts as this – pixels without any detail are still mixed evenly. */
const MIN_DETAIL = 1e-3
/** The result is cut to the part all pictures show – unless that is less than this share. */
const MIN_KEPT = 0.5
/** Exposure changes between the pictures are evened out, up to this factor either way. */
const MAX_GAIN = 1.5

const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b

function brightness(rgba: Uint8ClampedArray, count: number): Float32Array {
  const out = new Float32Array(count)
  for (let i = 0, p = 0; i < count; i++, p += 4) out[i] = luma(rgba[p], rgba[p + 1], rgba[p + 2])
  return out
}

/** Half the size, each pixel the mean of four. */
function halve(level: Level): Level {
  const width = Math.max(1, level.width >> 1)
  const height = Math.max(1, level.height >> 1)
  const src = level.pixels
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const a = 2 * y * level.width
    const b = Math.min(2 * y + 1, level.height - 1) * level.width
    for (let x = 0; x < width; x++) {
      const x0 = 2 * x
      const x1 = Math.min(x0 + 1, level.width - 1)
      out[y * width + x] = (src[a + x0] + src[a + x1] + src[b + x0] + src[b + x1]) / 4
    }
  }
  return { width, height, pixels: out }
}

function normalise(level: Level): Level {
  const { pixels } = level
  let sum = 0
  for (const v of pixels) sum += v
  const mean = sum / pixels.length
  let squares = 0
  for (const v of pixels) squares += (v - mean) ** 2
  const deviation = Math.sqrt(squares / pixels.length) || 1
  const out = new Float32Array(pixels.length)
  for (let i = 0; i < pixels.length; i++) out[i] = (pixels[i] - mean) / deviation
  return { ...level, pixels: out }
}

/** The levels used for aligning, coarsest first; `factor` of each: full width / its width. */
function pyramid(
  gray: Float32Array,
  width: number,
  height: number
): { level: Level; factor: number }[] {
  let level: Level = { width, height, pixels: gray }
  let factor = 1
  while (level.width > ALIGN_MAX_WIDTH) {
    level = halve(level)
    factor *= 2
  }
  const out: { level: Level; factor: number }[] = []
  while (level.width >= ALIGN_MIN_WIDTH) {
    out.unshift({ level: normalise(level), factor })
    level = halve(level)
    factor *= 2
  }
  return out
}

/** Bilinear sample; NaN outside. */
function sample(level: Level, x: number, y: number): number {
  const { width, height, pixels } = level
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return NaN
  const x0 = Math.min(Math.floor(x), width - 2)
  const y0 = Math.min(Math.floor(y), height - 2)
  const fx = x - x0
  const fy = y - y0
  const i = y0 * width + x0
  const top = pixels[i] + (pixels[i + 1] - pixels[i]) * fx
  const bottom = pixels[i + width] + (pixels[i + width + 1] - pixels[i + width]) * fx
  return top + (bottom - top) * fy
}

/** Gradients by central differences. */
function gradients(level: Level): [Level, Level] {
  const { width, height, pixels } = level
  const gx = new Float32Array(width * height)
  const gy = new Float32Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      gx[i] = (pixels[i + 1] - pixels[i - 1]) / 2
      gy[i] = (pixels[i + width] - pixels[i - width]) / 2
    }
  }
  return [
    { width, height, pixels: gx },
    { width, height, pixels: gy }
  ]
}

/**
 * How the picture `next` lies compared with `previous`: the similarity that maps a point of the
 * previous picture to the same spot in the next one (pixels of the full picture), or null if the
 * two cannot be lined up.
 */
function align(
  previous: ReturnType<typeof pyramid>,
  next: ReturnType<typeof pyramid>,
  width: number
): Similarity | null {
  let a = 0 // scale − 1
  let tx = 0
  let ty = 0
  let lastFactor = 0
  for (let l = 0; l < next.length; l++) {
    const template = previous[l].level
    const image = next[l].level
    const { factor } = next[l]
    if (lastFactor) {
      tx *= lastFactor / factor
      ty *= lastFactor / factor
    }
    lastFactor = factor
    const [gx, gy] = gradients(image)
    const cx = (template.width - 1) / 2
    const cy = (template.height - 1) / 2
    for (let iteration = 0; iteration < ALIGN_ITERATIONS; iteration++) {
      // Gauss–Newton for (a, tx, ty): H · Δ = −b, with H symmetric.
      const h = [0, 0, 0, 0, 0, 0]
      const b = [0, 0, 0]
      for (let y = 2; y < template.height - 2; y++) {
        const dy = y - cy
        for (let x = 2; x < template.width - 2; x++) {
          const dx = x - cx
          const wx = (1 + a) * dx + cx + tx
          const wy = (1 + a) * dy + cy + ty
          const value = sample(image, wx, wy)
          if (Number.isNaN(value)) continue
          const e = value - template.pixels[y * template.width + x]
          const ix = sample(gx, wx, wy)
          const iy = sample(gy, wx, wy)
          // How the error changes with the scale and the shift.
          const js = ix * dx + iy * dy
          h[0] += js * js
          h[1] += js * ix
          h[2] += js * iy
          h[3] += ix * ix
          h[4] += ix * iy
          h[5] += iy * iy
          b[0] += js * e
          b[1] += ix * e
          b[2] += iy * e
        }
      }
      const step = solve3(h, [-b[0], -b[1], -b[2]])
      if (!step) return null
      a += step[0]
      tx += step[1]
      ty += step[2]
      if (
        Math.abs(step[0]) < ALIGN_DONE_SCALE &&
        Math.abs(step[1]) < ALIGN_DONE_SHIFT &&
        Math.abs(step[2]) < ALIGN_DONE_SHIFT
      ) {
        break
      }
    }
  }
  const x = tx * lastFactor
  const y = ty * lastFactor
  if (
    !Number.isFinite(a + x + y) ||
    Math.abs(a) > MAX_SCALE_STEP ||
    Math.hypot(x, y) > MAX_SHIFT_STEP * width
  ) {
    return null
  }
  return { scale: 1 + a, x, y }
}

/**
 * Solves the symmetric 3×3 system [a b c; b d e; c e f] · x = r (`m` = [a, b, c, d, e, f]); null
 * if it is (nearly) singular.
 */
function solve3(m: number[], r: number[]): [number, number, number] | null {
  const [a, b, c, d, e, f] = m
  const [r0, r1, r2] = r
  const det = a * (d * f - e * e) - b * (b * f - e * c) + c * (b * e - d * c)
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  const x = (r0 * (d * f - e * e) - b * (r1 * f - e * r2) + c * (r1 * e - d * r2)) / det
  const y = (a * (r1 * f - e * r2) - r0 * (b * f - e * c) + c * (b * r2 - r1 * c)) / det
  const z = (a * (d * r2 - r1 * e) - b * (b * r2 - r1 * c) + r0 * (b * e - d * c)) / det
  return [x, y, z]
}

/** Sum over a (2r+1)² square around each pixel, in place (two sliding passes). */
function boxSum(values: Float32Array, width: number, height: number, r: number): void {
  const line = new Float32Array(Math.max(width, height))
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let x = -r; x <= r; x++) sum += values[row + Math.min(width - 1, Math.max(0, x))]
    for (let x = 0; x < width; x++) {
      line[x] = sum
      sum += values[row + Math.min(width - 1, x + r + 1)] - values[row + Math.max(0, x - r)]
    }
    values.set(line.subarray(0, width), row)
  }
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) sum += values[Math.min(height - 1, Math.max(0, y)) * width + x]
    for (let y = 0; y < height; y++) {
      line[y] = sum
      sum +=
        values[Math.min(height - 1, y + r + 1) * width + x] - values[Math.max(0, y - r) * width + x]
    }
    for (let y = 0; y < height; y++) values[y * width + x] = line[y]
  }
}

/** A part of the picture, in pixels (`right` and `bottom` excluded). */
interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface StackResult {
  width: number
  height: number
  rgba: Uint8ClampedArray
}

export class FocusStacker {
  /** Pictures merged so far. */
  count = 0
  /**
   * Weighted sum of the colours (RGB) and the weights per pixel; the weights are relative to the
   * most detail so far (`most`), so they stay between 0 and 1.
   */
  private readonly sums: Float32Array
  private readonly weights: Float32Array
  private readonly most: Float32Array
  /** Maps a point of the first picture to the same spot in the last one. */
  private placement: Similarity = IDENTITY
  private previous: ReturnType<typeof pyramid> | null = null
  /** Mean brightness of the middle of the first picture – the others are evened out to it. */
  private exposure = 0
  /** The part of the first picture all pictures so far show. */
  private shown: Bounds
  /** Pictures that could not be lined up with the one before (taken as they were). */
  unaligned = 0

  constructor(
    readonly width: number,
    readonly height: number
  ) {
    this.sums = new Float32Array(width * height * 3)
    this.weights = new Float32Array(width * height)
    this.most = new Float32Array(width * height)
    this.shown = { left: 0, top: 0, right: width, bottom: height }
  }

  /** Merges the next picture (RGBA, the size of the stack). */
  add(rgba: Uint8ClampedArray): void {
    const { width, height } = this
    const count = width * height
    const gray = brightness(rgba, count)
    const levels = pyramid(gray, width, height)
    if (this.previous) {
      const step = align(this.previous, levels, width)
      if (step) {
        // First → last = (previous → this) ∘ (first → previous), all about the middle.
        const p = this.placement
        this.placement = {
          scale: step.scale * p.scale,
          x: step.scale * p.x + step.x,
          y: step.scale * p.y + step.y
        }
      } else this.unaligned++
    }
    this.previous = levels
    this.narrowShown()

    const { picture, cover } = this.lineUp(rgba)
    const lined = picture === rgba ? gray : brightness(picture, count)

    // A camera that adjusts its exposure while the focus moves: brighter or darker like the first.
    const middle = this.middleBrightness(lined)
    if (!this.count) this.exposure = middle
    const gain = middle ? Math.min(MAX_GAIN, Math.max(1 / MAX_GAIN, this.exposure / middle)) : 1

    // Fine detail: the squared Laplacian, averaged over a small area so a pixel goes with its
    // neighbourhood (single pixels would follow the noise).
    const energy = new Float32Array(count)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        const l = 4 * lined[i] - lined[i - 1] - lined[i + 1] - lined[i - width] - lined[i + width]
        energy[i] = l * l
      }
    }
    const radius = Math.max(1, Math.round((DETAIL_RADIUS * width) / 1000))
    boxSum(energy, width, height, radius)
    const scale = (gain * gain) / (2 * radius + 1) ** 2

    const { sums, weights, most } = this
    for (let i = 0, p = 0, q = 0; i < count; i++, p += 4, q += 3) {
      const share = cover ? cover[i] : 1
      if (!share) continue
      const detail = Math.max(MIN_DETAIL, energy[i] * scale)
      let relative = 1
      if (detail > most[i]) {
        // The sharpest so far here: what was summed up weighs that much less from now on.
        const fade = (most[i] / detail) ** DETAIL_POWER
        sums[q] *= fade
        sums[q + 1] *= fade
        sums[q + 2] *= fade
        weights[i] *= fade
        most[i] = detail
      } else relative = (detail / most[i]) ** DETAIL_POWER
      const weight = relative * share
      const w = weight * gain
      sums[q] += picture[p] * w
      sums[q + 1] += picture[p + 1] * w
      sums[q + 2] += picture[p + 2] * w
      weights[i] += weight
    }
    this.count++
  }

  /** Narrows the part all pictures show to what the last one shows too. */
  private narrowShown(): void {
    const { width, height, placement: p, shown } = this
    const cx = (width - 1) / 2
    const cy = (height - 1) / 2
    // The points of the first picture that lie inside the last one.
    shown.left = Math.max(shown.left, Math.ceil(cx + (-cx - p.x) / p.scale))
    shown.right = Math.min(shown.right, Math.floor(cx + (width - 1 - cx - p.x) / p.scale) + 1)
    shown.top = Math.max(shown.top, Math.ceil(cy + (-cy - p.y) / p.scale))
    shown.bottom = Math.min(shown.bottom, Math.floor(cy + (height - 1 - cy - p.y) / p.scale) + 1)
  }

  /** Mean brightness of the middle half of a picture (0 if it is black). */
  private middleBrightness(gray: Float32Array): number {
    const { width, height } = this
    let sum = 0
    let n = 0
    for (let y = height >> 2; y < (height * 3) >> 2; y++) {
      for (let x = width >> 2; x < (width * 3) >> 2; x++) {
        sum += gray[y * width + x]
        n++
      }
    }
    return n ? sum / n : 0
  }

  /**
   * The picture moved and scaled to lie like the first one (bilinear). `cover` marks the pixels
   * inside it; null if it already lies like the first one. Outside, its edge is continued – an
   * empty (black) border would look like a sharp edge and win there.
   */
  private lineUp(rgba: Uint8ClampedArray): {
    picture: Uint8ClampedArray
    cover: Uint8Array | null
  } {
    const { width, height, placement } = this
    if (
      Math.abs(placement.scale - 1) < 1e-4 &&
      Math.abs(placement.x) < 0.05 &&
      Math.abs(placement.y) < 0.05
    ) {
      return { picture: rgba, cover: null }
    }
    const out = new Uint8ClampedArray(rgba.length)
    const cover = new Uint8Array(width * height)
    const cx = (width - 1) / 2
    const cy = (height - 1) / 2
    for (let y = 0; y < height; y++) {
      const ty = placement.scale * (y - cy) + cy + placement.y
      const sy = Math.min(height - 1, Math.max(0, ty))
      const y0 = Math.min(Math.floor(sy), height - 2)
      const fy = sy - y0
      for (let x = 0; x < width; x++) {
        const tx = placement.scale * (x - cx) + cx + placement.x
        const sx = Math.min(width - 1, Math.max(0, tx))
        const x0 = Math.min(Math.floor(sx), width - 2)
        const fx = sx - x0
        const i = (y0 * width + x0) * 4
        const j = i + width * 4
        const o = (y * width + x) * 4
        for (let c = 0; c < 3; c++) {
          const top = rgba[i + c] + (rgba[i + 4 + c] - rgba[i + c]) * fx
          const bottom = rgba[j + c] + (rgba[j + 4 + c] - rgba[j + c]) * fx
          out[o + c] = top + (bottom - top) * fy
        }
        out[o + 3] = 255
        if (sx === tx && sy === ty) cover[y * width + x] = 1
      }
    }
    return { picture: out, cover }
  }

  /** The merged picture, cut to the part all pictures show. */
  result(): StackResult {
    const { width, height, sums, weights } = this
    let { left, top, right, bottom } = this.shown
    // Lined up that badly, cutting would leave too little: the whole picture, edges and all.
    if (right - left < width * MIN_KEPT || bottom - top < height * MIN_KEPT) {
      ;[left, top, right, bottom] = [0, 0, width, height]
    }
    const w = right - left
    const h = bottom - top
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y + top) * width + x + left
        const weight = weights[i] || 1
        const o = (y * w + x) * 4
        rgba[o] = sums[i * 3] / weight
        rgba[o + 1] = sums[i * 3 + 1] / weight
        rgba[o + 2] = sums[i * 3 + 2] / weight
        rgba[o + 3] = 255
      }
    }
    return { width: w, height: h, rgba }
  }
}
