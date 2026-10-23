import { computed, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { createEventHook } from '@vueuse/core'
import { useSettingsStore } from './settings'

export interface CameraDevice {
  id: string
  label: string
}

/**
 * idle      – not started yet
 * starting  – getUserMedia is pending
 * live      – stream is running
 * waiting   – the chosen camera is disconnected; we wait for it to come back
 * busy      – the chosen camera exists but cannot be opened (e.g. used by another app)
 * no-camera – no camera has ever been chosen and none is connected
 * denied    – camera permission was denied
 * off       – not shown (paused, editor open or window minimized) and switched off by
 *             `stopCameraWhenHidden`
 */
export type CameraStatus =
  'idle' | 'starting' | 'live' | 'waiting' | 'busy' | 'no-camera' | 'denied' | 'off'

const RETRY_INTERVAL = 2000
const MIN_REFRESH_FEEDBACK = 400
/** Zoom range when the camera has no zoom control of its own (digital zoom). */
const DIGITAL_MAX_ZOOM = 4
/** One zoom step of the + / − keys and buttons. */
const ZOOM_STEP = 0.5

/** Camera pan/tilt/zoom is not part of TypeScript's DOM typings yet. */
type ZoomRange = { min: number; max: number; step: number }
type WithZoom<T> = T & { zoom?: ZoomRange }

const VIDEO_CONSTRAINTS = {
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 30 },
  // Ask for zoom control too – cameras without it are opened normally.
  zoom: true
} as MediaTrackConstraints

export const useCameraStore = defineStore('camera', () => {
  const settings = useSettingsStore()

  const devices = ref<CameraDevice[]>([])
  const selectedId = ref<string | null>(null)
  const selectedLabel = ref<string | null>(null)
  const status = ref<CameraStatus>('idle')
  const stream = shallowRef<MediaStream | null>(null)
  const resolution = ref<{ width: number; height: number } | null>(null)
  /** Manual reload of the camera list is running. */
  const refreshing = ref(false)
  /** Zoom control of the camera itself, null → digital zoom. */
  const zoomRange = shallowRef<ZoomRange | null>(null)
  /** Zoom factor shown to the user, 1 = no zoom. */
  const zoom = ref(1)
  /**
   * The user paused the camera: the picture is hidden and nothing can be captured until it is
   * resumed. With `stopCameraWhenHidden` the camera is switched off as well (status `off`);
   * otherwise the stream keeps running, so resuming is instant.
   */
  const paused = ref(false)
  /** The live view is on screen – false while the editor is open. */
  const viewShown = ref(true)
  /** The app window is minimized. */
  const minimized = ref(false)
  /** Capture requests from outside the live view (e.g. a device's photo button). */
  const captureRequests = createEventHook<void>()

  let startToken = 0
  let retryTimer: ReturnType<typeof setInterval> | undefined
  let syncing = false
  let syncAgain = false
  let initialized = false

  const selectedDevice = computed(() => devices.value.find((d) => d.id === selectedId.value))
  /** True if a camera was chosen but is currently not connected. */
  const selectedMissing = computed(() => selectedId.value !== null && !selectedDevice.value)
  /** The camera reports a zoom control of its own. */
  const hasCameraZoom = computed(() => zoomRange.value !== null)
  /**
   * `camera`: the camera zooms itself (full resolution); `digital`: the picture centre is enlarged.
   * Some cameras report a zoom control but ignore it – the setting allows falling back to digital.
   */
  const zoomMode = computed<'camera' | 'digital'>(() =>
    hasCameraZoom.value && settings.preferCameraZoom ? 'camera' : 'digital'
  )
  const maxZoom = computed(() => {
    const range = zoomRange.value
    return zoomMode.value === 'camera' && range && range.min > 0
      ? range.max / range.min
      : DIGITAL_MAX_ZOOM
  })

  // ── Device list ─────────────────────────────────────────────────────────────

  const videoInputs = async (): Promise<MediaDeviceInfo[]> =>
    (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')

  let permissionRequested = false

  async function refreshDevices(): Promise<void> {
    let list = await videoInputs()
    // Without camera permission the browser hides ids and labels – ask once, then list again.
    if (list.some((d) => !d.deviceId) && !permissionRequested) {
      permissionRequested = true
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        probe.getTracks().forEach((t) => t.stop())
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotAllowedError') status.value = 'denied'
      }
      list = await videoInputs()
    }
    devices.value = list
      .filter((d) => d.deviceId)
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Kamera ${i + 1}` }))
  }

  /**
   * Finds the user's chosen camera. Falls back to an exact label match only if that label is unique,
   * because Windows may assign a new deviceId when the same camera is plugged into another port.
   * Never returns a different camera.
   */
  function findChosenDevice(): CameraDevice | undefined {
    const byId = devices.value.find((d) => d.id === selectedId.value)
    if (byId || !selectedLabel.value) return byId
    const byLabel = devices.value.filter((d) => d.label === selectedLabel.value)
    return byLabel.length === 1 ? byLabel[0] : undefined
  }

  // ── Stream handling ─────────────────────────────────────────────────────────

  function stopStream(): void {
    stream.value?.getTracks().forEach((t) => t.stop())
    stream.value = null
    resolution.value = null
  }

  // ── Zoom ────────────────────────────────────────────────────────────────────

  /** Factor → camera zoom value (cameras use their own units, e.g. 100–400). */
  function toCameraZoom(factor: number, range: ZoomRange): number {
    const raw =
      range.min > 0
        ? factor * range.min
        : range.min + ((factor - 1) / (maxZoom.value - 1)) * (range.max - range.min)
    const snapped =
      range.min + Math.round((raw - range.min) / (range.step || 1)) * (range.step || 1)
    return Math.min(range.max, Math.max(range.min, snapped))
  }

  let applyingZoom = false

  /** Camera zoom factor to apply: the user's zoom in camera mode, otherwise none (digital zoom). */
  const cameraZoomTarget = (): number => (zoomMode.value === 'camera' ? zoom.value : 1)

  /** Sends the zoom to the camera; coalesces fast slider moves to the latest value. */
  async function applyCameraZoom(): Promise<void> {
    if (applyingZoom) return
    applyingZoom = true
    try {
      let applied = NaN
      while (zoomRange.value && stream.value && applied !== cameraZoomTarget()) {
        applied = cameraZoomTarget()
        const track = stream.value.getVideoTracks()[0]
        const constraint = {
          zoom: toCameraZoom(applied, zoomRange.value)
        } as MediaTrackConstraintSet
        await track.applyConstraints({ advanced: [constraint] }).catch(() => undefined)
      }
    } finally {
      applyingZoom = false
    }
  }

  function setZoom(factor: number): void {
    zoom.value = Math.min(maxZoom.value, Math.max(1, Math.round(factor * 100) / 100))
    if (zoomRange.value) void applyCameraZoom()
  }

  /** Zooms in (1) or out (−1) by one step, like the + / − keys. */
  function stepZoom(direction: 1 | -1): void {
    setZoom(zoom.value + direction * ZOOM_STEP)
  }

  // Switching between camera and digital zoom: reset the camera's own zoom / re-apply it.
  watch(
    () => settings.preferCameraZoom,
    () => setZoom(zoom.value)
  )

  function startRetry(): void {
    retryTimer ??= setInterval(() => void sync(), RETRY_INTERVAL)
  }

  function stopRetry(): void {
    clearInterval(retryTimer)
    retryTimer = undefined
  }

  function enterWaiting(): void {
    stopStream()
    status.value = 'waiting'
    startRetry()
  }

  async function start(deviceId: string): Promise<void> {
    const token = ++startToken
    stopStream()
    status.value = 'starting'
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...VIDEO_CONSTRAINTS, deviceId: { exact: deviceId } }
      })
      if (token !== startToken) {
        s.getTracks().forEach((t) => t.stop())
        return
      }
      const track = s.getVideoTracks()[0]
      // Fired when the camera is unplugged: wait for exactly this camera to return.
      track.addEventListener('ended', () => {
        if (stream.value === s) enterWaiting()
      })
      const { width, height } = track.getSettings()
      resolution.value = width && height ? { width, height } : null
      const range = (track.getCapabilities?.() as WithZoom<MediaTrackCapabilities>).zoom
      zoomRange.value = range && range.max > range.min ? range : null
      stream.value = s
      status.value = 'live'
      stopRetry()
      // Keep the zoom across reconnects (clamped to what this camera can do).
      setZoom(zoom.value)
    } catch (err) {
      if (token !== startToken) return
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        status.value = 'denied'
        stopRetry()
      } else if (name === 'NotReadableError' || name === 'AbortError') {
        // Device is present but blocked (other app, or not ready right after reconnecting).
        status.value = 'busy'
        startRetry()
      } else {
        enterWaiting()
      }
    }
  }

  /** Connects to the chosen camera if it is available – otherwise keeps waiting. */
  async function connectChosen(): Promise<void> {
    const device = findChosenDevice()
    if (!device) return enterWaiting()
    if (device.id !== selectedId.value) {
      // Same camera (unique label) but Windows handed out a new id → remember it.
      selectedId.value = device.id
      void settings.update({ cameraId: device.id })
    }
    await start(device.id)
  }

  /**
   * Re-reads the device list and, unless the stream is running or switched off, reconnects the
   * chosen camera. Used for device changes, the retry timer and the manual "reload" button. Never
   * switches cameras.
   */
  async function sync(): Promise<void> {
    if (syncing) {
      // A change arrived mid-sync – run once more afterwards so the list is never stale.
      syncAgain = true
      return
    }
    syncing = true
    try {
      do {
        syncAgain = false
        await refreshDevices()
        if (status.value === 'live' || status.value === 'starting' || status.value === 'off')
          continue
        if (selectedId.value) await connectChosen()
        // Nothing was ever chosen – picking the first camera is not "switching".
        else if (devices.value.length) await select(devices.value[0].id)
        else status.value = 'no-camera'
      } while (syncAgain)
    } finally {
      syncing = false
    }
  }

  // ── Public actions ──────────────────────────────────────────────────────────

  /** Explicit user choice. */
  async function select(id: string): Promise<void> {
    const device = devices.value.find((d) => d.id === id)
    if (!device) return
    stopRetry()
    selectedId.value = device.id
    selectedLabel.value = device.label
    void settings.update({ cameraId: device.id, cameraLabel: device.label })
    zoom.value = 1 // a different camera starts unzoomed
    // Switched off by a pause: the new camera starts when the pause is lifted.
    if (status.value === 'off') return
    await start(device.id)
  }

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    navigator.mediaDevices.addEventListener('devicechange', () => void sync())
    window.api.windowState.onMinimizedChange((value) => (minimized.value = value))

    selectedId.value = settings.settings?.cameraId ?? null
    selectedLabel.value = settings.settings?.cameraLabel ?? null
    await refreshDevices()

    if (selectedId.value) await connectChosen()
    else if (devices.value.length) await select(devices.value[0].id)
    else status.value = 'no-camera'
  }

  /**
   * Manual "reload camera list" – e.g. for cameras Windows did not announce, after the camera was
   * released by another app, or after camera access was enabled in the system settings.
   */
  async function refresh(): Promise<void> {
    if (refreshing.value) return
    refreshing.value = true
    permissionRequested = false // allow asking for camera access again
    try {
      // Keep the spinner visible briefly so the click gives feedback even when nothing changes.
      await Promise.all([sync(), new Promise((r) => setTimeout(r, MIN_REFRESH_FEEDBACK))])
    } finally {
      refreshing.value = false
    }
  }

  function setPaused(value: boolean): void {
    paused.value = value
  }

  function setViewShown(value: boolean): void {
    viewShown.value = value
  }

  /** The picture is not shown and `stopCameraWhenHidden` asks to switch the camera off meanwhile. */
  const switchedOff = computed(
    () => (paused.value || !viewShown.value || minimized.value) && settings.stopCameraWhenHidden
  )

  // Switch the camera off when it gets hidden (or when the setting changes meanwhile), on again
  // once it is shown – e.g. after resuming, closing the editor or restoring the window.
  watch(switchedOff, (off) => {
    if (off) {
      startToken++ // drops a camera that is still being opened
      stopRetry()
      stopStream()
      status.value = 'off'
    } else if (status.value === 'off') {
      status.value = 'idle'
      void sync()
    }
  })

  /** Freezes the picture like the Space key – the live view decides whether that fits right now. */
  function requestCapture(): void {
    void captureRequests.trigger()
  }

  return {
    devices,
    selectedId,
    selectedLabel,
    selectedDevice,
    selectedMissing,
    status,
    stream,
    resolution,
    refreshing,
    paused,
    minimized,
    zoom,
    zoomMode,
    hasCameraZoom,
    maxZoom,
    init,
    select,
    refresh,
    setZoom,
    stepZoom,
    setPaused,
    setViewShown,
    requestCapture,
    onCaptureRequest: captureRequests.on
  }
})
