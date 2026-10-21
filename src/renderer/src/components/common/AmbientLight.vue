<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import { useIntervalFn, useResizeObserver } from '@vueuse/core'

/**
 * "Ambient light" backdrop: instead of black bars, the picture's edges glow into the empty space
 * around it. The glow is drawn exactly behind the picture and its edge pixels are stretched outwards,
 * so every colour continues at the same height/position as in the picture. The source is sampled
 * into a small canvas that CSS blurs – cheap even for a live video.
 */
const props = withDefaults(
  defineProps<{
    /** Live source, sampled continuously. */
    video?: HTMLVideoElement | null
    /** Static source, sampled once (and on resize). */
    imageUrl?: string | null
    /** Element the picture is fitted into (object-contain). Defaults to the whole backdrop. */
    frame?: HTMLElement | null
    /**
     * Size of the actual picture inside the source; black bars baked in around it (centred) are
     * cut off like the shown video does. Defaults to the whole source.
     */
    picture?: { width: number; height: number } | null
    /** Mirror the glow like the (mirrored) video. */
    mirror?: boolean
    /** Stop sampling, e.g. while the view is hidden or the camera is not live. */
    paused?: boolean
    /** Digital zoom of the shown picture – only its centre (1/zoom) is visible and sampled. */
    zoom?: number
  }>(),
  {
    video: null,
    imageUrl: null,
    frame: null,
    picture: null,
    mirror: false,
    paused: false,
    zoom: 1
  }
)

/** The glow extends this far (px) beyond the visible area, so the blur's fading fringe stays hidden. */
const MARGIN = 96
/** Canvas width in pixels – it is stretched and blurred anyway. */
const RESOLUTION = 256
/** Share of the picture taken from each edge and stretched into the empty space. */
const EDGE = 0.02
/** Plenty for a blurred glow – full frame rate would only cost CPU. */
const SAMPLE_FPS = 12

const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const image = shallowRef<HTMLImageElement | null>(null)

type Source = HTMLVideoElement | HTMLImageElement
type Part = [
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number
]

const sizeOf = (src: Source): [number, number] =>
  src instanceof HTMLVideoElement
    ? [src.videoWidth, src.videoHeight]
    : [src.naturalWidth, src.naturalHeight]

function draw(src: Source): void {
  const el = canvas.value
  const box = root.value
  const frame = props.frame ?? box
  const [sw, sh] = sizeOf(src)
  if (!el || !box || !frame || !sw || !sh) return

  const outer = box.getBoundingClientRect()
  const inner = frame.getBoundingClientRect()
  if (!inner.width || !inner.height) return

  // Canvas covers the backdrop plus MARGIN on every side, scaled down by kx/ky. The height is
  // rounded to whole pixels, so the vertical scale is derived from it to keep rows aligned.
  const cw = RESOLUTION
  const ch = Math.max(
    1,
    Math.round(((outer.height + 2 * MARGIN) * cw) / (outer.width + 2 * MARGIN))
  )
  const kx = cw / (outer.width + 2 * MARGIN)
  const ky = ch / (outer.height + 2 * MARGIN)
  if (el.width !== cw || el.height !== ch) {
    el.width = cw
    el.height = ch
  }

  // The picture inside the source (without baked-in bars).
  const pw = Math.min(sw, props.picture?.width ?? sw)
  const ph = Math.min(sh, props.picture?.height ?? sh)

  // Where the picture is shown (object-contain inside the frame), in canvas coordinates.
  const fit = Math.min(inner.width / pw, inner.height / ph)
  const w = pw * fit * kx
  const h = ph * fit * ky
  const x = (inner.left - outer.left + MARGIN + (inner.width - pw * fit) / 2) * kx
  const y = (inner.top - outer.top + MARGIN + (inner.height - ph * fit) / 2) * ky
  const r = x + w
  const b = y + h

  // Visible part of the source (centred picture; digital zoom shows its centre only).
  const zoom = Math.max(1, props.zoom)
  const vw = pw / zoom
  const vh = ph / zoom
  const vx = (sw - vw) / 2
  const vy = (sh - vh) / 2
  const ex = Math.max(1, vw * EDGE)
  const ey = Math.max(1, vh * EDGE)
  const right = vx + vw - ex
  const bottom = vy + vh - ey

  const ctx = el.getContext('2d')
  if (!ctx) return
  // Mirroring flips around the picture's centre, just like the CSS-mirrored video.
  ctx.setTransform(props.mirror ? -1 : 1, 0, 0, 1, props.mirror ? 2 * x + w : 0, 0)
  ctx.clearRect(0, 0, cw, ch)

  const parts: Part[] = [
    [vx, vy, vw, vh, x, y, w, h], // the picture itself (hidden behind it, feeds the blur)
    [vx, vy, ex, vh, 0, y, x, h], // left edge → left
    [right, vy, ex, vh, r, y, cw - r, h], // right edge → right
    [vx, vy, vw, ey, x, 0, w, y], // top edge → up
    [vx, bottom, vw, ey, x, b, w, ch - b], // bottom edge → down
    [vx, vy, ex, ey, 0, 0, x, y], // corners
    [right, vy, ex, ey, r, 0, cw - r, y],
    [vx, bottom, ex, ey, 0, b, x, ch - b],
    [right, bottom, ex, ey, r, b, cw - r, ch - b]
  ]
  for (const [sx, sy, sW, sH, dx, dy, dW, dH] of parts) {
    if (dW > 0 && dH > 0) ctx.drawImage(src, sx, sy, sW, sH, dx, dy, dW, dH)
  }
}

const { pause, resume } = useIntervalFn(
  () => {
    const video = props.video
    if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) draw(video)
  },
  1000 / SAMPLE_FPS,
  { immediate: false }
)

watch(
  () => [props.video, props.paused] as const,
  ([video, paused]) => (video && !paused ? resume() : pause()),
  { immediate: true }
)

watch(
  () => props.imageUrl,
  (url) => {
    image.value = null
    if (!url) return
    const img = new Image()
    img.onload = () => {
      image.value = img
      draw(img)
    }
    img.src = url
  },
  { immediate: true }
)

// A static picture has to be redrawn when the layout changes (the live video redraws anyway).
const redrawImage = (): void => void (image.value && draw(image.value))
useResizeObserver(root, redrawImage)
useResizeObserver(() => props.frame, redrawImage)
watch(() => [props.frame, props.mirror], redrawImage, { flush: 'post' })
</script>

<template>
  <div ref="root" aria-hidden="true" class="pointer-events-none absolute inset-0 overflow-hidden">
    <!-- Oversized by MARGIN (6rem) on every side; the blur's transparent fringe falls outside. -->
    <canvas
      ref="canvas"
      class="absolute -top-24 -left-24 size-[calc(100%+12rem)] opacity-80 blur-2xl"
    />
    <!-- Dark veil: keeps the glow subtle and the floating controls readable. -->
    <div class="absolute inset-0 bg-stage/35" />
  </div>
</template>
