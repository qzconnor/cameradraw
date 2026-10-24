<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
// Left/right mirror icon (vertical centre line). Lucide's old `FlipHorizontal2` alias shows up/down.
import { ImagesIcon, SunMediumIcon, TrianglesCenterlineDashedVerticalIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { CaptureInfo, GalleryItem } from '@shared/types'
import AmbientLight from '@/components/common/AmbientLight.vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Toggle } from '@/components/ui/toggle'
import { useVideoPicture } from '@/composables/useVideoPicture'
import { captureFrame, type CapturedFrame } from '@/lib/capture'
import { errorMessage } from '@/lib/format'
import { canvasToBytes } from '@/lib/image'
import { provideRemote } from '@/mcp/remote'
import {
  isBlockingOverlayOpen,
  isInteractiveTarget,
  isKeyboardNavigating,
  isOverlayOpen,
  isTypingTarget
} from '@/lib/keyboard'
import { useBurstStore } from '@/stores/burst'
import { useCameraStore } from '@/stores/camera'
import { useCameraControlsStore } from '@/stores/camera-controls'
import { useEditorStore } from '@/stores/editor'
import { usePanelsStore } from '@/stores/panels'
import { useSettingsStore } from '@/stores/settings'
import BurstBar from './BurstBar.vue'
import CameraStatusOverlay from './CameraStatusOverlay.vue'
import PauseButton from './PauseButton.vue'
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
const burst = useBurstStore()
// Created with the camera view, so what the user set is applied whenever the camera starts.
const cameraControls = useCameraControlsStore()

/** The settings panel shows the camera's picture controls. */
const pictureSettingsOpen = computed(
  () => panels.isOpen('settings') && panels.settingsTab === 'picture'
)

function togglePictureSettings(open: boolean): void {
  if (open) panels.openSettings('picture')
  else panels.setOpen('settings', false)
}

const video = ref<HTMLVideoElement | null>(null)
const viewport = ref<HTMLElement | null>(null)
const capturing = ref(false)
/** The camera picture is running and not paused by the user. */
const playing = computed(() => camera.status === 'live' && !camera.paused)
const isLive = computed(() => props.active && playing.value)
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

// Whether the view is on screen – the camera may be switched off meanwhile (see settings).
watch(
  () => props.active,
  (active) => camera.setViewShown(active),
  { immediate: true }
)

// Stop the video while paused; resume it when unpaused or when coming back from the editor.
watch([() => props.active, () => camera.paused], ([active, paused]) => {
  if (paused) video.value?.pause()
  else if (active) void video.value?.play().catch(() => undefined)
})

/**
 * Takes a picture and opens it in the editor – or, with `direct` (burst capture), saves it and
 * stays in the live view, ready for the next one right away. Resolves with the saved image
 * (`direct`); rejects if that failed, after saying so in a toast.
 */
async function capture(direct = burst.enabled): Promise<GalleryItem | null> {
  if (!canCapture.value || !video.value) return null
  let frame: CapturedFrame
  try {
    frame = captureFrame(video.value, settings.mirror, digitalZoom.value, picture.value)
  } catch (err) {
    toast.error('Aufnahme fehlgeschlagen', { description: errorMessage(err) })
    throw err
  }
  emit('captured')
  // Zoom and frame width carry a calibration of the camera over to this picture.
  const info = { zoom: camera.zoom, frameWidth: frame.frameWidth }
  if (direct) return burst.save(frame, info)
  await openInEditor(frame, info)
  return null
}

/** Capture by key, button or device – failures are shown as toasts. */
function shoot(direct = burst.enabled): void {
  capture(direct).catch(() => undefined)
}

async function openInEditor(frame: CapturedFrame, info: CaptureInfo): Promise<void> {
  capturing.value = true
  try {
    const bytes = await canvasToBytes(frame.canvas)
    editor.openCapture(bytes, frame.width, frame.height, info)
    // A side panel (e.g. the gallery, open during a photo button press) would cover the editor.
    panels.closeAll()
  } catch (err) {
    toast.error('Aufnahme fehlgeschlagen', { description: errorMessage(err) })
    throw err
  } finally {
    capturing.value = false
  }
}

provideRemote('camera', {
  canCapture: () => canCapture.value && !!video.value?.videoWidth,
  capture
})

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
    // Shift+Space saves the picture without the editor, also when burst capture is off.
    shoot(e.shiftKey || burst.enabled)
  },
  // Capture phase: runs before the focused control's own Space handling.
  { capture: true }
)

// Capture from elsewhere, e.g. a device's photo button: only in the live view and only while no
// dialog or menu is open (the user is busy with something else then). Side panels like the
// gallery leave the camera visible, so the button works with them like the zoom buttons do – in
// burst capture the gallery stays open and shows each new picture.
camera.onCaptureRequest(() => {
  if (!props.active || isBlockingOverlayOpen()) return
  shoot()
})

// P pauses the camera and resumes it – shown and available like the pause button.
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.key.toLowerCase() !== 'p' || e.repeat || !props.active) return
  if (e.ctrlKey || e.metaKey || e.altKey || isOverlayOpen() || isTypingTarget(e.target)) return
  if (camera.status === 'live' || camera.paused) camera.setPaused(!camera.paused)
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
      :paused="!isLive"
    />

    <!-- Picture area in the camera's aspect ratio. object-cover cuts off baked-in (centred) black
         bars; digital zoom scales the video inside it, so the visible part is exactly the centre
         that a capture keeps. -->
    <div class="absolute inset-0 grid place-items-center">
      <div ref="viewport" class="relative overflow-hidden" :style="viewportStyle">
        <!-- No autoplay while paused, so a camera that reconnects meanwhile stays stopped. -->
        <video
          ref="video"
          :autoplay="!camera.paused"
          muted
          playsinline
          class="size-full object-cover"
          :style="videoStyle"
        />
      </div>
    </div>

    <CameraStatusOverlay />

    <!-- While burst capture is on: counter and target project, at the top like a mode banner. -->
    <div
      v-if="burst.enabled && playing"
      class="pointer-events-none absolute inset-x-4 top-4 flex justify-center"
    >
      <BurstBar class="pointer-events-auto" />
    </div>

    <!-- Bottom controls on one line: zoom left, shutter centred, pause right next to it and mirror
         right. The row lets clicks through (pointer-events-none) so it never covers anything; only
         the controls catch them. -->
    <div
      class="pointer-events-none absolute inset-x-4 bottom-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4"
    >
      <div class="justify-self-start">
        <ZoomControl v-if="playing" class="pointer-events-auto" />
      </div>

      <div class="pointer-events-auto">
        <ShutterButton
          :disabled="!canCapture"
          :burst="burst.enabled"
          @click="shoot($event.shiftKey || burst.enabled)"
        />
      </div>

      <div class="flex items-center gap-4">
        <!-- Also shown while paused and disconnected, so the pause can always be lifted. A wrapper
             catches the clicks: the button's root is a tooltip without an element of its own. -->
        <div v-if="camera.status === 'live' || camera.paused" class="pointer-events-auto">
          <PauseButton :paused="camera.paused" @click="camera.setPaused(!camera.paused)" />
        </div>
        <div v-if="playing" class="glass-panel pointer-events-auto ml-auto flex gap-1 p-1">
          <HintTooltip label="Serienaufnahme – jedes Bild sofort speichern" side="top">
            <Toggle v-model="burst.enabled" aria-label="Serienaufnahme">
              <ImagesIcon />
            </Toggle>
          </HintTooltip>
          <!-- data-panel-toggle: the settings panel would take the click as one outside of it. -->
          <HintTooltip
            v-if="cameraControls.controls.length"
            label="Bildeinstellungen der Kamera"
            side="top"
          >
            <Toggle
              :model-value="pictureSettingsOpen"
              aria-label="Bildeinstellungen"
              data-panel-toggle="settings"
              @update:model-value="togglePictureSettings"
            >
              <SunMediumIcon />
            </Toggle>
          </HintTooltip>
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
