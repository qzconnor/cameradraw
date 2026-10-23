<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useElementBounding } from '@vueuse/core'
import type { ImagePoint } from '@shared/types'

/**
 * Four corner handles over the picture for a perspective crop: what lies inside the
 * quadrilateral becomes a straight rectangle. The handles are dragged with the mouse or moved
 * with the arrow keys (Shift: 10 pixels); a magnifier shows the picture around the one moved.
 */
const props = defineProps<{
  imageSize: { width: number; height: number }
  /** Changes whenever the view moves (zoom, pan, resize) – the overlay follows. */
  version: number
  toClient: (point: ImagePoint) => ImagePoint
  toScene: (point: ImagePoint) => ImagePoint
  /** The picture, for the magnifier. */
  picture: HTMLCanvasElement | null
}>()
/** Top left, top right, bottom right, bottom left – in image pixels. */
const corners = defineModel<ImagePoint[]>('corners', { required: true })

const LABELS = ['Ecke oben links', 'Ecke oben rechts', 'Ecke unten rechts', 'Ecke unten links']
/** Size of the magnifier and how much it enlarges (screen pixels per image pixel). */
const LOUPE_SIZE = 128
const LOUPE_ZOOM = 4
/** How far the magnifier sits from its corner, outwards. */
const LOUPE_DISTANCE = 96

const root = ref<HTMLElement | null>(null)
const { left, top, width: boxWidth, height: boxHeight } = useElementBounding(root)

/** An image point in overlay coordinates. */
function local(point: ImagePoint): ImagePoint {
  const client = props.toClient(point)
  return { x: client.x - left.value, y: client.y - top.value }
}

const points = computed(() => {
  void props.version
  return corners.value.map(local)
})

const frame = computed(() => {
  void props.version
  const { width, height } = props.imageSize
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height }
  ].map(local)
})

const ring = (pts: ImagePoint[]): string => `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`

/** Darkens the picture outside the quadrilateral (even-odd: the inner ring cuts a hole). */
const shade = computed(() => `${ring(frame.value)} ${ring(points.value)}`)

const lerp = (a: ImagePoint, b: ImagePoint, t: number): ImagePoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t
})

/** Thirds of the quadrilateral – helps lining it up with the subject. */
const grid = computed(() => {
  const [tl, tr, br, bl] = points.value
  return [1 / 3, 2 / 3].flatMap((t) => [
    [lerp(tl, tr, t), lerp(bl, br, t)],
    [lerp(tl, bl, t), lerp(tr, br, t)]
  ])
})

const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value))

function move(index: number, point: ImagePoint): void {
  const { width, height } = props.imageSize
  const next = { x: clamp(point.x, width), y: clamp(point.y, height) }
  corners.value = corners.value.map((corner, i) => (i === index ? next : corner))
}

// ── Dragging and keys ─────────────────────────────────────────────────────────

const dragging = ref<number | null>(null)
const focused = ref<number | null>(null)

function onPointerDown(index: number, e: PointerEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragging.value = index
}

function onPointerMove(index: number, e: PointerEvent): void {
  if (dragging.value === index) move(index, props.toScene({ x: e.clientX, y: e.clientY }))
}

function onPointerUp(index: number): void {
  if (dragging.value === index) dragging.value = null
}

const STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1]
}

function onKeyDown(index: number, e: KeyboardEvent): void {
  const step = STEPS[e.key]
  if (!step) return
  // Not on to the editor, which would move a selected shape.
  e.preventDefault()
  e.stopPropagation()
  const factor = e.shiftKey ? 10 : 1
  const corner = corners.value[index]
  move(index, { x: corner.x + step[0] * factor, y: corner.y + step[1] * factor })
}

// ── Magnifier ─────────────────────────────────────────────────────────────────

const loupe = ref<HTMLCanvasElement | null>(null)
/** The corner being moved – with the mouse or the keys. */
const shown = computed(() => dragging.value ?? focused.value)

/** Next to its corner, away from the middle of the quadrilateral, inside the overlay. */
const loupePosition = computed(() => {
  const index = shown.value
  if (index === null) return null
  const point = points.value[index]
  const cx = points.value.reduce((sum, p) => sum + p.x, 0) / 4
  const cy = points.value.reduce((sum, p) => sum + p.y, 0) / 4
  const length = Math.hypot(point.x - cx, point.y - cy) || 1
  const x = point.x + ((point.x - cx) / length) * LOUPE_DISTANCE - LOUPE_SIZE / 2
  const y = point.y + ((point.y - cy) / length) * LOUPE_DISTANCE - LOUPE_SIZE / 2
  return {
    left: `${Math.min(boxWidth.value - LOUPE_SIZE, Math.max(0, x))}px`,
    top: `${Math.min(boxHeight.value - LOUPE_SIZE, Math.max(0, y))}px`
  }
})

async function drawLoupe(): Promise<void> {
  await nextTick()
  const index = shown.value
  const el = loupe.value
  const picture = props.picture
  if (index === null || !el || !picture) return
  const ratio = window.devicePixelRatio || 1
  el.width = el.height = Math.round(LOUPE_SIZE * ratio)
  const ctx = el.getContext('2d')!
  const span = LOUPE_SIZE / LOUPE_ZOOM
  const { x, y } = corners.value[index]
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, el.width, el.height)
  // The part beyond the picture's edge stays empty.
  const sx = x - span / 2
  const sy = y - span / 2
  const scale = el.width / span
  const cx = Math.max(0, sx)
  const cy = Math.max(0, sy)
  const cw = Math.min(picture.width, sx + span) - cx
  const ch = Math.min(picture.height, sy + span) - cy
  if (cw > 0 && ch > 0) {
    ctx.drawImage(
      picture,
      cx,
      cy,
      cw,
      ch,
      (cx - sx) * scale,
      (cy - sy) * scale,
      cw * scale,
      ch * scale
    )
  }
}

watch([shown, corners, () => props.picture], () => void drawLoupe(), { deep: true })
</script>

<template>
  <div ref="root" class="pointer-events-none absolute inset-0 overflow-hidden">
    <svg class="absolute inset-0 size-full">
      <path :d="shade" fill-rule="evenodd" class="fill-background/55" />
      <path
        :d="ring(points)"
        class="fill-none stroke-foreground"
        stroke-width="1.5"
        vector-effect="non-scaling-stroke"
      />
      <line
        v-for="([from, to], i) in grid"
        :key="i"
        :x1="from.x"
        :y1="from.y"
        :x2="to.x"
        :y2="to.y"
        class="stroke-foreground/45"
        stroke-width="1"
        stroke-dasharray="4 4"
      />
    </svg>

    <button
      v-for="(point, index) in points"
      :key="index"
      type="button"
      :aria-label="LABELS[index]"
      class="pointer-events-auto absolute size-5 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none rounded-full border-2 border-foreground bg-background/40 shadow-md ring-1 ring-background/60 outline-none focus-visible:ring-3 focus-visible:ring-ring"
      :style="{ left: `${point.x}px`, top: `${point.y}px` }"
      @pointerdown="onPointerDown(index, $event)"
      @pointermove="onPointerMove(index, $event)"
      @pointerup="onPointerUp(index)"
      @pointercancel="onPointerUp(index)"
      @keydown="onKeyDown(index, $event)"
      @focus="focused = index"
      @blur="focused = null"
    />

    <div
      v-if="loupePosition"
      class="absolute overflow-hidden rounded-full border-2 border-foreground bg-background shadow-xl"
      :style="{ ...loupePosition, width: `${LOUPE_SIZE}px`, height: `${LOUPE_SIZE}px` }"
    >
      <canvas ref="loupe" class="size-full" />
      <!-- Crosshair on the corner's exact position. -->
      <span class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-foreground/70" />
      <span class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/70" />
    </div>
  </div>
</template>
