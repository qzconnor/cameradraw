<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
// Left/right mirror icon (vertical centre line). Lucide's old `FlipHorizontal2` alias shows up/down.
import { TrianglesCenterlineDashedVerticalIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import AmbientLight from '@/components/common/AmbientLight.vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Toggle } from '@/components/ui/toggle'
import { useVideoPicture } from '@/composables/useVideoPicture'
import { captureFrame } from '@/lib/capture'
import { errorMessage } from '@/lib/format'
import {
  isInteractiveTarget,
  isKeyboardNavigating,
  isOverlayOpen,
  isTypingTarget
} from '@/lib/keyboard'
import { useCameraStore } from '@/stores/camera'
import { useEditorStore } from '@/stores/editor'
import { usePanelsStore } from '@/stores/panels'
import { useSettingsStore } from '@/stores/settings'
import CameraStatusOverlay from './CameraStatusOverlay.vue'
import ShutterButton from './ShutterButton.vue'
import ZoomControl from './ZoomControl.vue'

const props = defineProps<{
  /** False while the editor is shown (the stream keeps running in the background). */
  active: boolean
}>()
const emit = defineEmits<{ captured: [] }>()

/** Zoom change per mouse wheel notch. */
const WHEEL_FACTOR = 1.1

const camera = useCameraStore()
const settings = useSettingsStore()
const editor = useEditorStore()
const panels = usePanelsStore()

const video = ref<HTMLVideoElement | null>(null)
const viewport = ref<HTMLElement | null>(null)
const capturing = ref(false)
const isLive = computed(() => props.active && camera.status === 'live')
const canCapture = computed(() => isLive.value && !capturing.value)

/** The camera picture without black bars baked into its frames (e.g. a phone held upright). */
const picture = useVideoPicture(video, isLive)
/** Aspect ratio of the camera picture; the viewport is fitted into the stage with it. */
const aspect = computed(() => (picture.value ? picture.value.width / picture.value.height : 16 / 9))

/** Enlargement done here (digital zoom); a camera with its own zoom delivers zoomed frames. */
const digitalZoom = computed(() => (camera.zoomMode === 'digital' ? camera.zoom : 1))

// object-contain for the viewport: as large as possible inside the stage (container query units).
const viewportStyle = computed(() => ({
  aspectRatio: String(aspect.value),
  width: `min(100cqw, calc(100cqh * ${aspect.value}))`
}))
const videoStyle = computed(() => ({
  transform: `scale(${settings.mirror ? -digitalZoom.value : digitalZoom.value}, ${digitalZoom.value})`
}))

watch(
  [video, () => camera.stream],
  ([el, stream]) => {
    if (el && el.srcObject !== stream) el.srcObject = stream
  },
  { immediate: true }
)

// Resume playback when coming back from the editor.
watch(
  () => props.active,
  (active) => {
    if (active) void video.value?.play().catch(() => undefined)
  }
)

async function capture(): Promise<void> {
  if (!canCapture.value || !video.value) return
  capturing.value = true
  try {
    const frame = await captureFrame(video.value, settings.mirror, digitalZoom.value, picture.value)
    emit('captured')
    editor.openCapture(frame.bytes, frame.width, frame.height)
  } catch (err) {
    toast.error('Aufnahme fehlgeschlagen', { description: errorMessage(err) })
  } finally {
    capturing.value = false
  }
}

function onWheel(e: WheelEvent): void {
  if (!isLive.value || !e.deltaY) return
  camera.setZoom(camera.zoom * (e.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR))
}

useEventListener(
  window,
  'keydown',
  (e: KeyboardEvent) => {
    if (e.code !== 'Space' || e.repeat || !props.active) return
    if (isOverlayOpen() || isTypingTarget(e.target)) return
    // A control reached with Tab keeps Space; one that was merely clicked with the mouse doesn't,
    // so Space still freezes the image after e.g. clicking the gallery button.
    if (isInteractiveTarget(e.target) && isKeyboardNavigating()) return
    e.preventDefault()
    e.stopPropagation()
    void capture()
  },
  // Capture phase: runs before the focused control's own Space handling.
  { capture: true }
)

// Capture from elsewhere, e.g. a device's photo button: only in the live view and only while no
// dialog or side panel is open (the user is busy with something else then).
camera.onCaptureRequest(() => {
  if (!props.active || panels.active || isOverlayOpen()) return
  void capture()
})

// Zoom keys: + / − / 0
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (!isLive.value || e.ctrlKey || e.metaKey || e.altKey) return
  if (isOverlayOpen() || isTypingTarget(e.target)) return
  if (e.key === '+' || e.key === '=') camera.stepZoom(1)
  else if (e.key === '-') camera.stepZoom(-1)
  else if (e.key === '0') camera.setZoom(1)
})
</script>

<template>
  <!-- container-type: size → the viewport can fit itself with container query units. -->
  <div
    class="absolute inset-0 overflow-hidden"
    style="container-type: size"
    @wheel.passive="onWheel"
  >
    <AmbientLight
      v-if="settings.ambientLight"
      :video="video"
      :frame="viewport"
      :picture="picture"
      :zoom="digitalZoom"
      :mirror="settings.mirror"
      :paused="!active || camera.status !== 'live'"
    />

    <!-- Picture area in the camera's aspect ratio. object-cover cuts off baked-in (centred) black
         bars; digital zoom scales the video inside it, so the visible part is exactly the centre
         that a capture keeps. -->
    <div class="absolute inset-0 grid place-items-center">
      <div ref="viewport" class="relative overflow-hidden" :style="viewportStyle">
        <video
          ref="video"
          autoplay
          muted
          playsinline
          class="size-full object-cover"
          :style="videoStyle"
        />
      </div>
    </div>

    <CameraStatusOverlay />

    <!-- Bottom controls on one line: zoom left, shutter centred, mirror right. The row lets clicks
         through (pointer-events-none) so it never covers anything; only the controls catch them. -->
    <div
      class="pointer-events-none absolute inset-x-4 bottom-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4"
    >
      <div class="justify-self-start">
        <ZoomControl v-if="camera.status === 'live'" class="pointer-events-auto" />
      </div>

      <div class="pointer-events-auto">
        <ShutterButton :disabled="!canCapture" @click="capture" />
      </div>

      <div class="justify-self-end">
        <div v-if="camera.status === 'live'" class="glass-panel pointer-events-auto p-1">
          <HintTooltip label="Bild spiegeln" side="top">
            <Toggle
              :model-value="settings.mirror"
              aria-label="Bild spiegeln"
              @update:model-value="settings.update({ mirror: $event })"
            >
              <TrianglesCenterlineDashedVerticalIcon />
            </Toggle>
          </HintTooltip>
        </div>
      </div>
    </div>
  </div>
</template>
