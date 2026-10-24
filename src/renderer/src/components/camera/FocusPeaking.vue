<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useIntervalFn, useResizeObserver } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { visibleRegion } from '@/lib/capture'
import { errorMessage } from '@/lib/format'
import { PeakingRenderer } from '@/lib/peaking'
import { measureSharpness } from '@/lib/sharpness'
import { useFocusPeakingStore } from '@/stores/focus-peaking'

/**
 * Focus peaking over the live picture: edges in focus light up (see `lib/peaking.ts`). Lies exactly
 * over the video in the viewport; digital zoom is applied by showing only the middle of the frame,
 * so the peaks stay as crisp as the screen allows. Measures the sharpness for the meter meanwhile.
 */
const props = defineProps<{
  video: HTMLVideoElement | null
  /** The picture inside the frame, without baked-in bars (see `useVideoPicture`). */
  picture: { width: number; height: number } | null
  zoom: number
  mirror: boolean
  /** The camera picture is live and shown. */
  active: boolean
}>()

/** Measurements per second for the meter. */
const MEASURE_FPS = 8

const peaking = useFocusPeakingStore()
const canvas = ref<HTMLCanvasElement | null>(null)
let renderer: PeakingRenderer | null = null
let frameRequest: number | null = null

const running = computed(() => props.active && peaking.enabled && !!props.video)

function region(video: HTMLVideoElement): ReturnType<typeof visibleRegion> {
  return visibleRegion(
    { width: video.videoWidth, height: video.videoHeight },
    props.picture,
    props.zoom
  )
}

function draw(): void {
  frameRequest = null
  const video = props.video
  if (!running.value || !renderer || !video) return
  if (video.videoWidth && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    renderer.render(video, {
      region: region(video),
      minSlope: peaking.minSlope,
      minRatio: peaking.minRatio,
      color: peaking.color
    })
  }
  frameRequest = video.requestVideoFrameCallback(draw)
}

function stop(): void {
  if (frameRequest !== null) props.video?.cancelVideoFrameCallback(frameRequest)
  frameRequest = null
  renderer?.clear()
}

watch(running, (on) => (on ? frameRequest === null && draw() : stop()))
// Another video element (camera view re-created) needs its own callback.
watch(
  () => props.video,
  (_, old) => {
    if (frameRequest !== null) old?.cancelVideoFrameCallback(frameRequest)
    frameRequest = null
    if (running.value) draw()
  }
)

useResizeObserver(canvas, () => {
  const el = canvas.value
  if (!el) return
  const width = Math.max(1, Math.round(el.clientWidth * devicePixelRatio))
  const height = Math.max(1, Math.round(el.clientHeight * devicePixelRatio))
  if (el.width !== width || el.height !== height) {
    el.width = width
    el.height = height
  }
})

onMounted(() => {
  try {
    renderer = new PeakingRenderer(canvas.value!)
  } catch (err) {
    toast.error('Schärfehilfe nicht verfügbar', { description: errorMessage(err) })
    return
  }
  if (running.value) draw()
})

onBeforeUnmount(() => {
  stop()
  renderer?.dispose()
  renderer = null
  peaking.reset()
})

// The meter: also while the peaks are drawn, at a few measurements per second.
const meter = useIntervalFn(
  () => {
    const video = props.video
    const result = video && measureSharpness(video, props.picture, props.zoom)
    if (result) peaking.measured(result.value, result.noise)
  },
  1000 / MEASURE_FPS,
  { immediate: false }
)
watch(
  running,
  (on) => {
    if (on) meter.resume()
    else {
      meter.pause()
      peaking.reset()
    }
  },
  { immediate: true }
)
</script>

<template>
  <canvas
    ref="canvas"
    class="pointer-events-none absolute inset-0 size-full"
    :class="!running && 'invisible'"
    :style="mirror ? { transform: 'scaleX(-1)' } : undefined"
    data-focus-peaking
  />
</template>
