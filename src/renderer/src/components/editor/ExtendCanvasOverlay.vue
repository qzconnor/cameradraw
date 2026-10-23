<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useElementBounding, useElementSize, useEventListener } from '@vueuse/core'
import type { ImageAdjustment, ImagePoint } from '@shared/types'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { MIN_ROOM_ZOOM, type DrawingCanvas } from '@/composables/useDrawingCanvas'
import { acrossOf, extendAt, isHorizontal, maxExtend, type Side } from '@/editor/adjust'
import { cn } from '@/lib/utils'
import { useEditorStore } from '@/stores/editor'
import ExtendCanvasForm from './ExtendCanvasForm.vue'

/**
 * Handles on the edges of the picture for adding space: drag one outwards, or click / right-click
 * it to type how much. The space is previewed before it is added.
 */
const props = defineProps<{
  canvas: DrawingCanvas
  /** The drawing area – an edge outside of it (zoomed in) gets no handle. */
  area: HTMLElement | null
}>()
const emit = defineEmits<{ extend: [adjustment: Extract<ImageAdjustment, { type: 'extend' }>] }>()

const { extendColor } = storeToRefs(useEditorStore())

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const NAMES: Record<Side, string> = { top: 'oben', right: 'rechts', bottom: 'unten', left: 'links' }
/** The form opens away from its edge, over the picture – there is always room. */
const INWARDS: Record<Side, Side> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }
/** Thickness of the strip beside an edge that can be dragged like its handle (screen pixels). */
const STRIP = 12
/** Dragging this close to the border of the drawing area zooms out – room for more space. */
const EDGE_ZONE = 32
/** Meanwhile the space grows by this share of the picture per second (at the very border). */
const GROW_RATE = 0.5
/** Distance of the amount label from the edge when the space is too narrow to hold it. */
const LABEL_GAP = 12
/** With Shift, dragging snaps to quarters of the picture. */
const SNAP_SHARE = 0.25
/** A press that moves less than this is a click (screen pixels). */
const CLICK_SLOP = 3

const root = ref<HTMLElement | null>(null)
const rootBox = useElementBounding(root)
const label = ref<HTMLElement | null>(null)
const labelSize = useElementSize(label, undefined, { box: 'border-box' })
const areaBox = useElementBounding(() => props.area)
const size = computed(() => props.canvas.imageSize.value)

// ── What is added ─────────────────────────────────────────────────────────────

const dragging = ref<Side | null>(null)
const dragAmount = ref(0)

const formOpen = ref(false)
const formSide = ref<Side>('right')
const formAmount = ref('')
const form = ref<InstanceType<typeof ExtendCanvasForm> | null>(null)

/** The typed amount if it can be added, else 0. */
const formPixels = computed(() => {
  const pixels = Number(formAmount.value)
  return Number.isInteger(pixels) && pixels >= 1 && pixels <= maxExtend(size.value, formSide.value)
    ? pixels
    : 0
})

/** Space shown as a preview: being dragged or typed. */
const pending = computed<{ side: Side; amount: number } | null>(() => {
  if (dragging.value) return { side: dragging.value, amount: dragAmount.value }
  if (formOpen.value) return { side: formSide.value, amount: formPixels.value }
  return null
})

// ── Where things are ──────────────────────────────────────────────────────────

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** An image point in overlay coordinates. */
function local(point: ImagePoint): ImagePoint {
  const client = props.canvas.sceneToClient(point)
  return { x: client.x - rootBox.left.value, y: client.y - rootBox.top.value }
}

const boxOf = (a: ImagePoint, b: ImagePoint): Box => ({
  left: a.x,
  top: a.y,
  right: b.x,
  bottom: b.y
})

const intersect = (a: Box, b: Box): Box => ({
  left: Math.max(a.left, b.left),
  top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom)
})

const geometry = computed(() => {
  void props.canvas.viewVersion.value
  const { width, height } = size.value
  const add = { top: 0, right: 0, bottom: 0, left: 0 }
  if (pending.value) add[pending.value.side] = pending.value.amount
  const picture = boxOf(local({ x: 0, y: 0 }), local({ x: width, y: height }))
  // The picture with the space – its edges carry the handles.
  const outer = boxOf(
    local({ x: -add.left, y: -add.top }),
    local({ x: width + add.right, y: height + add.bottom })
  )
  const area: Box = {
    left: areaBox.left.value - rootBox.left.value,
    top: areaBox.top.value - rootBox.top.value,
    right: areaBox.right.value - rootBox.left.value,
    bottom: areaBox.bottom.value - rootBox.top.value
  }
  return { picture, outer, area, visible: intersect(outer, area) }
})

interface Handle {
  side: Side
  /** The edge lies in the drawing area. */
  shown: boolean
  x: number
  y: number
  strip: { left: string; top: string; width: string; height: string }
}

const px = (value: number): string => `${value}px`

const handles = computed<Handle[]>(() => {
  const { outer, area, visible: v } = geometry.value
  const midX = (v.left + v.right) / 2
  const midY = (v.top + v.bottom) / 2
  const along = (from: number, to: number): [string, string] => [
    px(from),
    px(Math.max(0, to - from))
  ]
  const within = (value: number, min: number, max: number): boolean =>
    v.right > v.left && v.bottom > v.top && value >= min - 1 && value <= max + 1
  return SIDES.map((side): Handle => {
    switch (side) {
      case 'top': {
        const [left, width] = along(v.left, v.right)
        return {
          side,
          shown: within(outer.top, area.top, area.bottom),
          x: midX,
          y: outer.top,
          strip: { left, width, top: px(outer.top - STRIP), height: px(STRIP) }
        }
      }
      case 'bottom': {
        const [left, width] = along(v.left, v.right)
        return {
          side,
          shown: within(outer.bottom, area.top, area.bottom),
          x: midX,
          y: outer.bottom,
          strip: { left, width, top: px(outer.bottom), height: px(STRIP) }
        }
      }
      case 'left': {
        const [top, height] = along(v.top, v.bottom)
        return {
          side,
          shown: within(outer.left, area.left, area.right),
          x: outer.left,
          y: midY,
          strip: { top, height, left: px(outer.left - STRIP), width: px(STRIP) }
        }
      }
      case 'right': {
        const [top, height] = along(v.top, v.bottom)
        return {
          side,
          shown: within(outer.right, area.left, area.right),
          x: outer.right,
          y: midY,
          strip: { top, height, left: px(outer.right), width: px(STRIP) }
        }
      }
    }
  })
})

/** The space being added – coloured like it will be – and where its label goes. */
const preview = computed(() => {
  const space = pending.value
  if (!space || space.amount < 1) return null
  const { picture: p, outer: o } = geometry.value
  const box: Box = {
    top: { left: p.left, top: o.top, right: p.right, bottom: p.top },
    right: { left: p.right, top: p.top, right: o.right, bottom: p.bottom },
    bottom: { left: p.left, top: p.bottom, right: p.right, bottom: o.bottom },
    left: { left: o.left, top: p.top, right: p.left, bottom: p.bottom }
  }[space.side]
  // The label in the middle of the part that can be seen – or inside the picture next to the
  // edge while the space is too narrow for it.
  const seen = intersect(box, {
    left: 0,
    top: 0,
    right: rootBox.width.value,
    bottom: rootBox.height.value
  })
  const half = { x: labelSize.width.value / 2, y: labelSize.height.value / 2 }
  let at = { x: (seen.left + seen.right) / 2, y: (seen.top + seen.bottom) / 2 }
  if (
    isHorizontal(space.side)
      ? seen.right - seen.left < 2 * (half.x + LABEL_GAP)
      : seen.bottom - seen.top < 2 * (half.y + LABEL_GAP)
  ) {
    at = {
      top: { x: at.x, y: p.top + LABEL_GAP + half.y },
      right: { x: p.right - LABEL_GAP - half.x, y: at.y },
      bottom: { x: at.x, y: p.bottom - LABEL_GAP - half.y },
      left: { x: p.left + LABEL_GAP + half.x, y: at.y }
    }[space.side]
  }
  const { width, height } = size.value
  return {
    style: {
      left: px(box.left),
      top: px(box.top),
      width: px(box.right - box.left),
      height: px(box.bottom - box.top),
      backgroundColor: extendColor.value
    },
    label: { left: px(at.x), top: px(at.y) },
    amount: space.amount,
    result: isHorizontal(space.side)
      ? { width: width + space.amount, height }
      : { width, height: height + space.amount }
  }
})

/** The form hangs at the picture's edge (not the space's), so it leaves the preview free. */
const anchor = computed(() => {
  const { picture: p, visible: v } = geometry.value
  const midX = (Math.max(p.left, v.left) + Math.min(p.right, v.right)) / 2
  const midY = (Math.max(p.top, v.top) + Math.min(p.bottom, v.bottom)) / 2
  const at = {
    top: { x: midX, y: p.top },
    right: { x: p.right, y: midY },
    bottom: { x: midX, y: p.bottom },
    left: { x: p.left, y: midY }
  }[formSide.value]
  return { left: px(at.x), top: px(at.y) }
})

// ── Dragging ──────────────────────────────────────────────────────────────────

/** Pointer position (client coordinates) and how far from the edge it grabbed. */
let pointer: ImagePoint | null = null
let grab: ImagePoint = { x: 0, y: 0 }
let start: ImagePoint = { x: 0, y: 0 }
let moved = false
/** How far beyond the edge the pointer is (image pixels) – the amount before snapping. */
let reach = 0
let snap = false
let zoomed = false
let frame = 0
let lastFrame = 0

/** The edge of the picture (image pixels) – a point on it. */
function edgeOf(side: Side): ImagePoint {
  const { width, height } = size.value
  return side === 'right'
    ? { x: width, y: 0 }
    : side === 'bottom'
      ? { x: 0, y: height }
      : { x: 0, y: 0 }
}

function update(): void {
  const side = dragging.value
  if (!side || !pointer) return
  const scene = props.canvas.clientToScene({ x: pointer.x - grab.x, y: pointer.y - grab.y })
  const { width, height } = size.value
  const raw =
    side === 'right'
      ? scene.x - width
      : side === 'left'
        ? -scene.x
        : side === 'bottom'
          ? scene.y - height
          : -scene.y
  const most = maxExtend(size.value, side)
  reach = Math.min(most, Math.max(0, raw))
  const step = snap ? acrossOf(size.value, side) * SNAP_SHARE : 1
  dragAmount.value = Math.min(most, Math.max(0, Math.round(Math.round(raw / step) * step)))
}

/** How deep the pointer is in the zone at the border: 0 outside it, 1 at the border, more beyond. */
function borderDepth(side: Side): number {
  const box = root.value?.getBoundingClientRect()
  if (!box || !pointer) return 0
  const inside = {
    top: pointer.y - box.top,
    right: box.right - pointer.x,
    bottom: box.bottom - pointer.y,
    left: pointer.x - box.left
  }[side]
  return Math.max(0, 1 - inside / EDGE_ZONE)
}

/**
 * Zooms out frame by frame while the pointer stays at the border, so the space keeps growing at a
 * steady pace – faster the further out the pointer is.
 */
function zoomOut(time: number): void {
  frame = 0
  const side = dragging.value
  const depth = side ? borderDepth(side) : 0
  const most = side ? maxExtend(size.value, side) : 0
  const zoom = props.canvas.viewZoom.value
  if (!side || !depth || reach < 1 || reach >= most || zoom <= MIN_ROOM_ZOOM) {
    lastFrame = 0
    return
  }
  const seconds = lastFrame ? Math.min(0.05, (time - lastFrame) / 1000) : 1 / 60
  lastFrame = time
  const across = acrossOf(size.value, side)
  const target = Math.min(most, reach + across * GROW_RATE * Math.min(3, depth) * seconds)
  // The picture stays centred and the pointer where it is: the zoom shrinks with the distance from
  // the picture's middle to the space's outer edge.
  props.canvas.setViewZoom((zoom * (reach + across / 2)) / (target + across / 2), MIN_ROOM_ZOOM)
  zoomed = true
  update()
  frame = requestAnimationFrame(zoomOut)
}

function onPointerDown(side: Side, e: PointerEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  formOpen.value = false
  const edge = props.canvas.sceneToClient(edgeOf(side))
  grab = isHorizontal(side) ? { x: e.clientX - edge.x, y: 0 } : { x: 0, y: e.clientY - edge.y }
  pointer = start = { x: e.clientX, y: e.clientY }
  moved = false
  snap = e.shiftKey
  zoomed = props.canvas.viewZoom.value < 1
  reach = 0
  dragging.value = side
  dragAmount.value = 0
}

function onPointerMove(side: Side, e: PointerEvent): void {
  if (dragging.value !== side) return
  pointer = { x: e.clientX, y: e.clientY }
  moved ||= Math.hypot(pointer.x - start.x, pointer.y - start.y) > CLICK_SLOP
  snap = e.shiftKey
  update()
  if (!frame && borderDepth(side)) frame = requestAnimationFrame(zoomOut)
}

function finish(apply: boolean): void {
  const side = dragging.value
  if (!side) return
  cancelAnimationFrame(frame)
  frame = lastFrame = 0
  const amount = dragAmount.value
  dragging.value = null
  dragAmount.value = 0
  pointer = null
  if (apply && amount >= 1) emit('extend', extendAt(side, amount, extendColor.value))
  else if (zoomed) props.canvas.resetView()
}

/** A click without dragging asks for the amount instead. */
function onClick(side: Side): void {
  if (moved) moved = false
  else openForm(side)
}

// The view changes under the pointer (zoomed with the wheel, or out at the border).
watch(
  () => props.canvas.viewVersion.value,
  () => update()
)

useEventListener(
  window,
  'keydown',
  (e: KeyboardEvent) => {
    if (!dragging.value) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finish(false)
    } else if (e.key === 'Shift') {
      snap = true
      update()
    }
  },
  { capture: true }
)
useEventListener(window, 'keyup', (e: KeyboardEvent) => {
  if (dragging.value && e.key === 'Shift') {
    snap = false
    update()
  }
})

// ── Typing the amount ─────────────────────────────────────────────────────────

/** Opens the form at `side` – half of the picture to start with. */
function openForm(side: Side): void {
  formSide.value = side
  formAmount.value = String(Math.round(acrossOf(size.value, side) * 0.5))
  formOpen.value = true
}

// While the form is open the view makes room for the preview; afterwards the whole picture again.
watch([formOpen, formSide, formPixels], ([open, side, pixels]) => {
  if (open) props.canvas.showRoom({ [side]: pixels })
  else if (!dragging.value && props.canvas.viewZoom.value < 1) props.canvas.resetView()
})

function submit(): void {
  if (!formPixels.value) return
  emit('extend', extendAt(formSide.value, formPixels.value, extendColor.value))
  formOpen.value = false
}

function focusForm(): void {
  void nextTick(() => form.value?.focus())
}

function onInteractOutside(e: Event): void {
  // The colour picker opens a popover of its own – a colour chosen there belongs to this form.
  if ((e.target as Element | null)?.closest?.('[data-slot="popover-content"]')) e.preventDefault()
}

defineExpose({ openForm })
</script>

<template>
  <div ref="root" class="pointer-events-none absolute inset-0">
    <div class="absolute inset-0 overflow-hidden">
      <div
        v-if="preview"
        class="absolute border-2 border-dashed border-primary"
        :style="preview.style"
      />
      <div
        v-if="preview"
        ref="label"
        class="absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-background/85 px-2 py-1 text-xs whitespace-nowrap text-foreground tabular-nums shadow-md ring-1 ring-foreground/10 backdrop-blur"
        :style="preview.label"
      >
        <span class="font-medium">+{{ preview.amount }} px</span>
        <span class="text-muted-foreground">
          · {{ preview.result.width }} × {{ preview.result.height }}</span
        >
      </div>
    </div>

    <template v-for="handle in handles" :key="handle.side">
      <!-- The dragged handle stays, even outside the area: it holds the pointer capture. -->
      <template v-if="handle.shown || dragging === handle.side">
        <div
          aria-hidden="true"
          :class="
            cn(
              'pointer-events-auto absolute touch-none',
              isHorizontal(handle.side) ? 'cursor-ew-resize' : 'cursor-ns-resize'
            )
          "
          :style="handle.strip"
          @pointerdown="onPointerDown(handle.side, $event)"
          @pointermove="onPointerMove(handle.side, $event)"
          @pointerup="finish(true)"
          @pointercancel="finish(false)"
          @lostpointercapture="finish(false)"
          @click="onClick(handle.side)"
          @contextmenu.prevent="openForm(handle.side)"
        />
        <HintTooltip
          label="Ziehen: Fläche anfügen · Klick oder Rechtsklick: Breite eingeben"
          :side="handle.side"
          :disabled="!!dragging || formOpen"
        >
          <button
            type="button"
            :aria-label="`Fläche ${NAMES[handle.side]} anfügen`"
            :class="
              cn(
                'group/handle pointer-events-auto absolute grid -translate-x-1/2 -translate-y-1/2 touch-none place-items-center outline-none',
                isHorizontal(handle.side)
                  ? 'h-14 w-5 cursor-ew-resize'
                  : 'h-5 w-14 cursor-ns-resize'
              )
            "
            :style="{ left: px(handle.x), top: px(handle.y) }"
            @pointerdown="onPointerDown(handle.side, $event)"
            @pointermove="onPointerMove(handle.side, $event)"
            @pointerup="finish(true)"
            @pointercancel="finish(false)"
            @lostpointercapture="finish(false)"
            @click="onClick(handle.side)"
            @contextmenu.prevent="openForm(handle.side)"
          >
            <span
              :class="
                cn(
                  'rounded-full border border-foreground/40 bg-background/90 shadow-md ring-1 ring-background/50 transition-colors group-hover/handle:border-primary group-hover/handle:bg-primary group-focus-visible/handle:ring-3 group-focus-visible/handle:ring-ring',
                  isHorizontal(handle.side) ? 'h-9 w-1.5' : 'h-1.5 w-9',
                  (dragging === handle.side || (formOpen && formSide === handle.side)) &&
                    'border-primary bg-primary'
                )
              "
            />
          </button>
        </HintTooltip>
      </template>
    </template>

    <Popover v-model:open="formOpen">
      <PopoverAnchor as-child>
        <div class="absolute size-0" :style="anchor" />
      </PopoverAnchor>
      <PopoverContent
        class="w-80"
        :side="INWARDS[formSide]"
        :side-offset="14"
        aria-label="Fläche anfügen"
        @open-auto-focus.prevent="focusForm"
        @interact-outside="onInteractOutside"
      >
        <ExtendCanvasForm
          ref="form"
          v-model:side="formSide"
          v-model:amount="formAmount"
          v-model:color="extendColor"
          :image-size="size"
          @submit="submit"
          @cancel="formOpen = false"
        />
      </PopoverContent>
    </Popover>
  </div>
</template>
