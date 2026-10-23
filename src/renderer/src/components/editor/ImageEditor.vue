<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useEventListener } from '@vueuse/core'
import { toast } from 'vue-sonner'
import type { GalleryItem, ImageAdjustment, ImagePoint } from '@shared/types'
import AmbientLight from '@/components/common/AmbientLight.vue'
import { Spinner } from '@/components/ui/spinner'
import { MAX_VIEW_ZOOM, useDrawingCanvas, type CanvasSpot } from '@/composables/useDrawingCanvas'
import { perspectiveFor } from '@/editor/adjust'
import { formatScale, measuredLength } from '@/editor/measure'
import { TOOLS } from '@/editor/tools'
import { errorMessage } from '@/lib/format'
import { encodingFor } from '@/lib/image'
import { isOverlayOpen, isTypingTarget } from '@/lib/keyboard'
import { provideRemote } from '@/mcp/remote'
import { useCameraStore } from '@/stores/camera'
import { useEditorStore, type EditorSession } from '@/stores/editor'
import { useGalleryStore } from '@/stores/gallery'
import { usePanelsStore } from '@/stores/panels'
import { useSettingsStore } from '@/stores/settings'
import CalibrateDialog from './CalibrateDialog.vue'
import CropActionBar from './CropActionBar.vue'
import EditorActionBar from './EditorActionBar.vue'
import EditorBreadcrumb from './EditorBreadcrumb.vue'
import EditorCanvasMenu from './EditorCanvasMenu.vue'
import EditorImageMenu from './EditorImageMenu.vue'
import EditorScaleBadge from './EditorScaleBadge.vue'
import EditorToolbar from './EditorToolbar.vue'
import EditorZoomControl from './EditorZoomControl.vue'
import ExtendCanvasDialog from './ExtendCanvasDialog.vue'
import PerspectiveCropOverlay from './PerspectiveCropOverlay.vue'
import SaveImageDialog from './SaveImageDialog.vue'
import TextFormatHint from './TextFormatHint.vue'

const props = defineProps<{ session: EditorSession }>()

const editor = useEditorStore()
const gallery = useGalleryStore()
const settings = useSettingsStore()
const panels = usePanelsStore()
const camera = useCameraStore()
const { tool, style } = storeToRefs(editor)

const host = ref<HTMLElement | null>(null)
const saving = ref(false)
/** The save dialog asks for the file name and the project first. */
const saveOpen = ref(false)

const canvas = useDrawingCanvas({ host, tool, style })
const {
  ready,
  canUndo,
  canRedo,
  hasSelection,
  isEmpty,
  dirty,
  load,
  undo,
  redo,
  deleteSelection,
  clearAll,
  applyStyleToSelection,
  inspectAt,
  addTextAt,
  setFilled,
  removeObjects,
  selectAll,
  canPaste,
  copyObjects,
  cutSelection,
  paste,
  duplicate,
  nudgeSelection,
  arrange,
  settled,
  isEditingText,
  editingText,
  finishInteraction,
  exportImage,
  exportDocument,
  markSaved,
  viewZoom,
  stepViewZoom,
  resetView,
  micronsPerPixel,
  setScale,
  imageSize,
  previewUrl,
  adjustmentCount,
  viewVersion,
  adjustImage,
  resetImage,
  setLocked,
  sceneToClient,
  clientToScene
} = canvas

onMounted(async () => {
  try {
    await load({
      url: props.session.baseUrl,
      document: props.session.document,
      micronsPerPixel: props.session.micronsPerPixel
    })
  } catch (err) {
    toast.error('Bild konnte nicht geöffnet werden', { description: errorMessage(err) })
    editor.close()
  }
})

watch(dirty, (value) => (editor.dirty = value), { immediate: true })

// Changing a style setting also restyles the selected objects. (The fill setting is only for new
// shapes – existing ones are filled via the context menu.)
watch(
  () => editor.color,
  () => applyStyleToSelection('color')
)
watch(
  () => editor.strokeWidth,
  () => applyStyleToSelection('strokeWidth')
)
watch(
  () => editor.fontSize,
  () => applyStyleToSelection('fontSize')
)

// ── Context menu ──────────────────────────────────────────────────────────────

/** What was under the pointer when the context menu opened. */
const spot = shallowRef<CanvasSpot | null>(null)

function onContextMenu(e: MouseEvent): void {
  // While placing crop corners there is nothing to do with shapes.
  if (cropCorners.value) {
    e.preventDefault()
    e.stopPropagation()
    return
  }
  spot.value = ready.value ? inspectAt(e) : null
}

function addTextHere(): void {
  const point = spot.value?.point
  // After the menu has closed, so the new text keeps the keyboard focus.
  if (point) setTimeout(() => addTextAt(point))
}

function toggleFill(): void {
  if (spot.value) setFilled(spot.value.objects, !spot.value.filled)
}

function deleteSpot(): void {
  if (spot.value) removeObjects(spot.value.objects)
}

function pasteHere(): void {
  void paste(spot.value?.onImage ? spot.value.point : undefined)
}

/** Ctrl+C without a selection: there is nothing to copy – say how to copy the whole picture. */
function copyShapes(): void {
  if (copyObjects()) return
  toast('Nichts ausgewählt', {
    description: 'Wähle Formen aus, um sie zu kopieren – Strg+Shift+C kopiert das ganze Bild.'
  })
}

/** Arrow keys move the selection, with Shift in bigger steps. */
const NUDGE: Record<string, [number, number]> = {
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  arrowup: [0, -1],
  arrowdown: [0, 1]
}
const NUDGE_SHIFT_FACTOR = 10

// ── Measuring ─────────────────────────────────────────────────────────────────

/** Length (image pixels) of the measuring line chosen to set the scale. */
const calibrationPixels = ref(0)
const calibrateOpen = ref(false)
const cameraLabel = computed(() => camera.selectedLabel)

function calibrateSpot(): void {
  const measurement = spot.value?.measurement
  if (!measurement) return
  calibrationPixels.value = measuredLength(measurement)
  calibrateOpen.value = true
}

/**
 * Sets the scale of this picture; remembered for new pictures of the camera, as the scale of its
 * frame without zoom (see `stores/editor.ts`).
 */
function calibrate(value: number, remember: boolean): void {
  setScale(value)
  const label = cameraLabel.value
  if (remember && label) {
    const { zoom, frameWidth } = props.session.capture
    void settings.update({
      cameraScales: {
        ...settings.cameraScales,
        [label]: { micronsPerPixel: value * zoom, frameWidth }
      }
    })
  }
  toast.success('Maßstab festgelegt', {
    description:
      remember && label ? `${formatScale(value)} – auch für neue Aufnahmen` : formatScale(value)
  })
}

// Measuring without a scale gives pixels – say once how to get real lengths: when the tool is
// picked, or right away if it is still picked from last time (once the picture is loaded).
let scaleHinted = false
watch([tool, ready], ([value, isReady]) => {
  if (!isReady || value !== 'measure' || micronsPerPixel.value || scaleHinted) return
  scaleHinted = true
  toast('Noch kein Maßstab', {
    description:
      'Ziehe eine Messlinie über eine bekannte Strecke, z. B. 5 mm auf einem Lineal, und wähle per Rechtsklick „Als Maßstab verwenden …“.',
    duration: 10_000
  })
})

/**
 * "Speichern": an image from the gallery is saved in place right away and stays open, like in
 * other editors. A new capture needs a name and a project first.
 */
function requestSave(): void {
  if (saving.value || !ready.value) return
  if (props.session.path) void save(props.session.path, { stayOpen: true })
  else requestSaveAs()
}

/** "Speichern unter …": name and project – for an image from the gallery also as a copy. */
function requestSaveAs(): void {
  if (saving.value || !ready.value) return
  // Ends text editing, so the text being typed is part of the saved image.
  finishInteraction()
  saveOpen.value = true
}

const placeOf = (item: GalleryItem): string =>
  item.project ? `${item.project} / ${item.name}` : item.name

/**
 * Writes the picture with its layers to `target`, then stays open – showing the saved image from
 * now on – or goes back to the camera. Throws if saving failed.
 */
async function saveTo(
  target: string,
  { copy = false, stayOpen = false }: { copy?: boolean; stayOpen?: boolean } = {}
): Promise<GalleryItem> {
  if (saving.value) throw new Error('Das Bild wird gerade gespeichert.')
  saving.value = true
  try {
    // An undo or paste pressed just before is part of the saved image.
    await settled()
    const { mime, quality } = encodingFor(target)
    // Picture and layers of the same moment (rendering starts right away, encoding takes longer).
    const encoding = exportImage(mime, quality)
    const document = exportDocument()
    const item = await gallery.save({
      // A copy is a new image – the original stays as it is.
      source: copy ? null : props.session.path,
      target,
      image: await encoding,
      base: props.session.baseBytes,
      document: { ...document, capture: props.session.capture },
      capturedAt: props.session.capturedAt
    })
    markSaved(document)
    saveOpen.value = false
    if (stayOpen) {
      // Saved under another name or as a copy: that is the image being edited now.
      if (item.path !== props.session.path) editor.savedAs(item.path)
      toast.success('Gespeichert', { description: placeOf(item) })
      return item
    }
    toast.success(copy ? 'Kopie gespeichert' : 'Bild gespeichert', {
      description: placeOf(item),
      // The gallery is hidden behind a button – offer a shortcut to the saved image.
      action: {
        label: 'Galerie öffnen',
        onClick: () => {
          gallery.browse(item.project)
          panels.setOpen('gallery', true)
        }
      }
    })
    editor.close()
    return item
  } finally {
    saving.value = false
  }
}

async function save(
  target: string,
  options: { copy?: boolean; stayOpen?: boolean } = {}
): Promise<void> {
  if (saving.value) return
  try {
    await saveTo(target, options)
  } catch (err) {
    toast.error('Speichern fehlgeschlagen', { description: errorMessage(err) })
  }
}

/** Puts the picture with its drawing on the clipboard, e.g. for a document or a chat. */
async function copyImage(): Promise<void> {
  await window.api.clipboard.writeImage(await exportImage())
  toast.success('Bild kopiert', { description: 'Mit Zeichnung – zum Einfügen bereit.' })
}

async function copyToClipboard(): Promise<void> {
  if (!ready.value) return
  try {
    await copyImage()
  } catch (err) {
    toast.error('Kopieren fehlgeschlagen', { description: errorMessage(err) })
  }
}

// ── Changing the picture: turn, straighten, add space ─────────────────────────

/** Corners of a perspective crop being placed (image pixels), null otherwise. */
const cropCorners = ref<ImagePoint[] | null>(null)
const extendOpen = ref(false)
/** Where the corners start: a bit inside the picture, so all four can be grabbed. */
const CROP_INSET = 0.1

const cropResult = computed(() => {
  const adjustment = cropCorners.value && perspectiveFor(cropCorners.value)
  return adjustment ? { width: adjustment.width, height: adjustment.height } : null
})

async function changePicture(adjustment: ImageAdjustment): Promise<void> {
  try {
    await adjustImage(adjustment)
  } catch (err) {
    toast.error('Bild konnte nicht geändert werden', { description: errorMessage(err) })
  }
}

async function resetPicture(): Promise<void> {
  try {
    await resetImage()
  } catch (err) {
    toast.error('Original konnte nicht wiederhergestellt werden', {
      description: errorMessage(err)
    })
  }
}

function startCrop(): void {
  if (!ready.value || cropCorners.value) return
  finishInteraction()
  const { width, height } = imageSize.value
  const [left, right] = [width * CROP_INSET, width * (1 - CROP_INSET)]
  const [top, bottom] = [height * CROP_INSET, height * (1 - CROP_INSET)]
  cropCorners.value = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom }
  ]
  setLocked(true)
}

function stopCropping(): void {
  if (!cropCorners.value) return
  cropCorners.value = null
  setLocked(false)
}

function applyCrop(): void {
  const adjustment = cropCorners.value && perspectiveFor(cropCorners.value)
  if (!adjustment) return
  stopCropping()
  void changePicture(adjustment)
}

provideRemote('editor', {
  baseUrl: props.session.baseUrl,
  canvas,
  save: saveTo,
  copyImage,
  calibrate,
  stopCropping
})

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (isOverlayOpen()) return
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()

  // Placing crop corners: Enter crops, Escape stops – nothing else may draw or move shapes.
  if (cropCorners.value) {
    if (key === 'enter' || key === 'escape') e.preventDefault()
    if (key === 'enter') applyCrop()
    else if (key === 'escape') stopCropping()
    return
  }

  // Saving and copying also work while typing text.
  if (mod && key === 's') {
    e.preventDefault()
    if (e.shiftKey) requestSaveAs()
    else requestSave()
    return
  }
  if (mod && e.shiftKey && key === 'c') {
    e.preventDefault()
    void copyToClipboard()
    return
  }
  if (isTypingTarget(e.target) || isEditingText()) return

  if (mod && key === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  } else if (mod && key === 'y') {
    e.preventDefault()
    redo()
  } else if (mod && key === 'a') {
    e.preventDefault()
    selectAll()
  } else if (mod && key === 'c') {
    e.preventDefault()
    copyShapes()
  } else if (mod && key === 'x') {
    e.preventDefault()
    cutSelection()
  } else if (mod && key === 'v') {
    e.preventDefault()
    void paste()
  } else if (mod && key === 'd') {
    e.preventDefault()
    void duplicate()
  } else if (mod || e.altKey) {
    return
  } else if (key in NUDGE) {
    const [dx, dy] = NUDGE[key]
    const factor = e.shiftKey ? NUDGE_SHIFT_FACTOR : 1
    if (nudgeSelection(dx * factor, dy * factor)) e.preventDefault()
  } else if (key === 'home' || key === 'end') {
    e.preventDefault()
    arrange(key === 'home' ? 'front' : 'back')
  } else if (key === 'delete' || key === 'backspace') {
    e.preventDefault()
    deleteSelection()
  } else if (key === 'escape') {
    e.preventDefault()
    if (hasSelection.value) finishInteraction()
    else editor.requestClose()
  } else if (key === '+' || key === '=') {
    stepViewZoom(1)
  } else if (key === '-') {
    stepViewZoom(-1)
  } else if (key === '0') {
    resetView()
  } else if (key === 'c') {
    startCrop()
  } else {
    const match = TOOLS.find((t) => t.shortcut.toLowerCase() === key)
    if (match) editor.tool = match.id
  }
})
</script>

<template>
  <div class="absolute inset-0">
    <!-- Colours of the frozen image glow into the space around it, aligned with the canvas area. -->
    <AmbientLight
      v-if="settings.ambientLight"
      :image-url="previewUrl ?? session.baseUrl"
      :frame="host"
    />

    <div class="relative flex size-full flex-col">
      <!-- Breadcrumb on the left gets all the space the right-aligned toolbar leaves. -->
      <div class="flex shrink-0 items-center gap-3 px-4 pt-4 pb-3">
        <EditorBreadcrumb :path="session.path" />
        <EditorImageMenu
          class="shrink-0"
          :adjusted="adjustmentCount > 0"
          :disabled="!ready || !!cropCorners"
          @rotate="(turns) => changePicture({ type: 'rotate', turns })"
          @crop="startCrop"
          @extend="extendOpen = true"
          @reset="resetPicture"
        />
        <!-- Out of the way while crop corners are placed. -->
        <EditorToolbar
          class="shrink-0"
          :class="cropCorners && 'pointer-events-none opacity-40'"
          :inert="!!cropCorners"
        />
      </div>

      <div class="relative min-h-0 flex-1 px-4">
        <EditorCanvasMenu
          :spot="spot"
          :can-select-all="!isEmpty"
          :can-paste="canPaste"
          @add-text="addTextHere"
          @toggle-fill="toggleFill"
          @calibrate="calibrateSpot"
          @delete="deleteSpot"
          @select-all="selectAll"
          @copy="spot && copyObjects(spot.objects)"
          @duplicate="spot && duplicate(spot.objects)"
          @paste="pasteHere"
          @arrange="(where) => spot && arrange(where, spot.objects)"
        >
          <!-- capture: runs before the menu opens, so it knows what was right-clicked. -->
          <div
            ref="host"
            class="flex size-full items-center justify-center [&_.canvas-container]:shadow-2xl [&_.canvas-container]:ring-1 [&_.canvas-container]:ring-foreground/10"
            @contextmenu.capture="onContextMenu"
          />
        </EditorCanvasMenu>
        <PerspectiveCropOverlay
          v-if="cropCorners"
          v-model:corners="cropCorners"
          :image-size="imageSize"
          :version="viewVersion"
          :to-client="sceneToClient"
          :to-scene="clientToScene"
          :picture="canvas.picture()"
        />
        <!-- Texts are Markdown – what can be written, while one is typed. -->
        <TextFormatHint
          v-if="editingText"
          class="absolute bottom-3 left-1/2 w-max -translate-x-1/2"
        />
        <div v-if="!ready" class="absolute inset-0 grid place-items-center">
          <Spinner class="size-6" />
        </div>
      </div>

      <!-- Zoom left, actions centred, the scale for measuring right – like the camera view. -->
      <div class="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 pt-3 pb-4">
        <EditorZoomControl
          class="justify-self-start"
          :zoom="viewZoom"
          :max="MAX_VIEW_ZOOM"
          @zoom-in="stepViewZoom(1)"
          @zoom-out="stepViewZoom(-1)"
          @reset="resetView"
        />
        <CropActionBar
          v-if="cropCorners"
          :result="cropResult"
          @cancel="stopCropping"
          @apply="applyCrop"
        />
        <EditorActionBar
          v-else
          :can-undo="canUndo"
          :can-redo="canRedo"
          :has-selection="hasSelection"
          :is-empty="isEmpty"
          :saving="saving"
          :existing="session.path !== null"
          @cancel="editor.requestClose()"
          @undo="undo"
          @redo="redo"
          @delete="deleteSelection"
          @clear="clearAll"
          @copy="copyToClipboard"
          @save="requestSave"
          @save-as="requestSaveAs"
        />
        <!-- A wrapper for the alignment: the badge's root (the menu) renders no element. -->
        <div v-if="micronsPerPixel" class="justify-self-end">
          <EditorScaleBadge :microns-per-pixel="micronsPerPixel" @remove="setScale(null)" />
        </div>
      </div>
    </div>

    <CalibrateDialog
      v-model:open="calibrateOpen"
      :pixels="calibrationPixels"
      :camera-label="cameraLabel"
      @confirm="calibrate"
    />

    <ExtendCanvasDialog v-model:open="extendOpen" :image-size="imageSize" @extend="changePicture" />

    <SaveImageDialog
      v-model:open="saveOpen"
      :source="session.path"
      :saving="saving"
      @save="(target, copy) => save(target, { copy })"
    />
  </div>
</template>
