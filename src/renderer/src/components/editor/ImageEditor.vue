<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useEventListener, useLocalStorage } from '@vueuse/core'
import { LayersIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { splitExtension } from '@shared/names'
import type { GalleryItem, ImageAdjustment, ImagePoint } from '@shared/types'
import AmbientLight from '@/components/common/AmbientLight.vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Spinner } from '@/components/ui/spinner'
import { Toggle } from '@/components/ui/toggle'
import { useGalleryDrag } from '@/composables/useGalleryDrag'
import { MAX_VIEW_ZOOM, useDrawingCanvas, type CanvasSpot } from '@/composables/useDrawingCanvas'
import { perspectiveFor } from '@/editor/adjust'
import { formatScale, measuredLength } from '@/editor/measure'
import { TOOLS } from '@/editor/tools'
import { errorMessage } from '@/lib/format'
import { encodingFor } from '@/lib/image'
import { isOverlayOpen, isTypingTarget } from '@/lib/keyboard'
import { cn } from '@/lib/utils'
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
import EditorImageTools from './EditorImageTools.vue'
import EditorLayersPanel from './EditorLayersPanel.vue'
import EditorScaleBadge from './EditorScaleBadge.vue'
import EditorToolbar from './EditorToolbar.vue'
import EditorZoomControl from './EditorZoomControl.vue'
import ExtendCanvasOverlay from './ExtendCanvasOverlay.vue'
import ImageViewBar from './ImageViewBar.vue'
import MarkdownLegend from './MarkdownLegend.vue'
import PerspectiveCropOverlay from './PerspectiveCropOverlay.vue'
import SaveImageDialog from './SaveImageDialog.vue'
import { ACTIVE_TOGGLE } from './toggle'

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
  textSelected,
  markerSelected,
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
  pasteKind,
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
  imageAdjusted,
  viewVersion,
  layers,
  activeLayer,
  imageView,
  rotateCanvas,
  extendCanvas,
  resetImage,
  leaveImageView,
  setLocked,
  sceneToClient,
  clientToScene
} = canvas

onMounted(async () => {
  try {
    await load({
      url: props.session.baseUrl,
      baseBytes: props.session.baseBytes,
      document: props.session.document,
      pictures: props.session.pictures,
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
watch(
  () => editor.fontFamily,
  () => applyStyleToSelection('fontFamily')
)
watch(
  () => editor.textAlign,
  () => applyStyleToSelection('textAlign')
)

async function run(action: () => Promise<unknown>, failure: string): Promise<void> {
  try {
    await action()
  } catch (err) {
    toast.error(failure, { description: errorMessage(err) })
  }
}

// ── Context menu ──────────────────────────────────────────────────────────────

/** What was under the pointer when the context menu opened. */
const spot = shallowRef<CanvasSpot | null>(null)

function onContextMenu(e: MouseEvent): void {
  // While placing crop corners or editing one image there is nothing to do with shapes.
  if (cropCorners.value || imageView.value) {
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
  void run(
    () => paste(spot.value?.onImage ? spot.value.point : undefined),
    'Einfügen fehlgeschlagen'
  )
}

/** Ctrl+C without a selection: there is nothing to copy – say how to copy the whole picture. */
function copyShapes(): void {
  if (copyObjects()) return
  toast('Nichts ausgewählt', {
    description: 'Wähle Formen aus, um sie zu kopieren – Strg+Shift+C kopiert das ganze Bild.'
  })
}

/** A double click on a picture edits it on its own – not while drawing freehand or typing. */
function onDoubleClick(e: MouseEvent): void {
  if (tool.value === 'pen' || tool.value === 'highlighter' || tool.value === 'text') return
  const layer = canvas.imageLayerAt(e)
  if (layer) openImageView(layer)
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
    // An image being edited on its own is saved as it is now.
    await leaveModes()
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
      pictures: canvas.exportPictures(),
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
  await leaveModes()
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
/** Handles on the picture's edges for adding space, with a form for the amount. */
const extendOverlay = ref<InstanceType<typeof ExtendCanvasOverlay> | null>(null)
/** Where the corners start: a bit inside the picture, so all four can be grabbed. */
const CROP_INSET = 0.1

const cropResult = computed(() => {
  const adjustment = cropCorners.value && perspectiveFor(cropCorners.value)
  return adjustment ? { width: adjustment.width, height: adjustment.height } : null
})

/** Turns the image edited on its own – otherwise the whole picture with every layer. */
function rotate(turns: 1 | 3): void {
  if (imageView.value) canvas.adjustImageView({ type: 'rotate', turns })
  else void run(() => rotateCanvas(turns), 'Bild konnte nicht gedreht werden')
}

function extend(adjustment: Extract<ImageAdjustment, { type: 'extend' }>): void {
  void run(() => extendCanvas(adjustment), 'Fläche konnte nicht angefügt werden')
}

function resetPicture(): void {
  if (imageView.value) canvas.resetImageView()
  else void run(() => resetImage(), 'Original konnte nicht wiederhergestellt werden')
}

// ── Editing one image on its own (double click, or cropping) ──────────────────

/** Cropping was started with all layers shown: once it is done (or not), they are shown again. */
let cropOnly = false

function openImageView(layer: string): void {
  if (!ready.value || cropCorners.value || imageView.value) return
  cropOnly = false
  canvas.enterImageView(layer)
}

/** Back to all layers – with the changes of the image, or without them. */
function closeImageView(apply: boolean): void {
  if (cropCorners.value) stopCropping()
  void run(() => leaveImageView(apply), 'Bild konnte nicht geändert werden')
}

/**
 * Places the crop corners on the image edited on its own – or on the selected image (else the
 * frame), which is shown on its own meanwhile. An image cropped before shows as it was, with the
 * corners of that crop: they can be moved again.
 */
function startCrop(): void {
  if (!ready.value || cropCorners.value) return
  if (!imageView.value) {
    const target = canvas.cropTarget()
    if (!target || !canvas.enterImageView(target)) return
    cropOnly = true
  }
  finishInteraction()
  const corners = canvas.beginImageViewCrop()
  const { width, height } = imageSize.value
  const [left, right] = [width * CROP_INSET, width * (1 - CROP_INSET)]
  const [top, bottom] = [height * CROP_INSET, height * (1 - CROP_INSET)]
  cropCorners.value = corners ?? [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom }
  ]
  setLocked(true)
}

/** Stops placing the corners without cropping. */
function stopCropping(): void {
  if (!cropCorners.value) return
  cropCorners.value = null
  setLocked(false)
  canvas.cancelImageViewCrop()
  if (cropOnly) {
    cropOnly = false
    void leaveImageView(false)
  }
}

function applyCrop(): void {
  const adjustment = cropCorners.value && perspectiveFor(cropCorners.value)
  if (!adjustment) return
  cropCorners.value = null
  setLocked(false)
  canvas.applyImageViewCrop(adjustment)
  if (cropOnly) {
    cropOnly = false
    closeImageView(true)
  }
}

/** Leaves placing crop corners and the image view – the image is taken as it is now. */
async function leaveModes(): Promise<void> {
  if (cropCorners.value) {
    // Crop corners placed from all layers lead back there by themselves.
    const back = cropOnly
    stopCropping()
    if (back) await settled()
  }
  await leaveImageView(true)
}

// ── Layers ────────────────────────────────────────────────────────────────────

/** The layer list is shown – remembered between sessions. */
const layersOpen = useLocalStorage('cameradraw.layersOpen', true)

function duplicateLayer(id: string): void {
  void run(() => canvas.duplicateLayer(id), 'Duplizieren fehlgeschlagen')
}

function pasteLayers(): void {
  void run(() => paste(), 'Einfügen fehlgeschlagen')
}

// ── Pulling images in from the gallery ────────────────────────────────────────

const galleryDrag = useGalleryDrag()
/** The drawing area takes images dragged from the gallery. */
const takesImages = computed(() => ready.value && !cropCorners.value && !imageView.value)

/** Adds an image of the gallery as a layer – by default in the middle, fitting into half. */
async function insertGalleryImage(
  item: GalleryItem,
  options: { at?: ImagePoint; width?: number; owner?: 'ai' } = {}
): Promise<string> {
  // As it is saved – with its drawing.
  const { bytes, mime } = await window.api.library.readImage(item.path)
  return canvas.insertImage({ bytes, mime, name: splitExtension(item.name).stem, ...options })
}

galleryDrag.onDrop(({ item, target }) => {
  if (target.kind !== 'editor' || !takesImages.value) return
  void run(
    () => insertGalleryImage(item, { at: clientToScene(target.client) }),
    'Bild konnte nicht eingefügt werden'
  )
})

provideRemote('editor', {
  baseUrl: props.session.baseUrl,
  canvas,
  save: saveTo,
  copyImage,
  calibrate,
  leaveModes,
  insertGalleryImage
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

  // One image on its own: turn, crop, undo – Enter takes it back into the picture.
  if (imageView.value && !(mod && key === 's')) {
    if (isTypingTarget(e.target)) return
    if (key === 'enter' || key === 'escape') {
      e.preventDefault()
      closeImageView(key === 'enter')
    } else if (mod && key === 'z' && !e.shiftKey) {
      e.preventDefault()
      canvas.undoImageView()
    } else if (mod || e.altKey) {
      return
    } else if (key === 'c') {
      startCrop()
    } else if (key === '+' || key === '=') {
      stepViewZoom(1)
    } else if (key === '-') {
      stepViewZoom(-1)
    } else if (key === '0') {
      resetView()
    }
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
        <EditorBreadcrumb :path="session.path" :layer="imageView?.name" />
        <EditorImageTools
          class="shrink-0"
          :adjusted="imageAdjusted"
          :cropping="!!cropCorners"
          :image-view="!!imageView"
          :disabled="!ready"
          @rotate="rotate"
          @crop="startCrop"
          @stop-crop="stopCropping"
          @extend="extendOverlay?.openForm('right')"
          @reset="resetPicture"
        />
        <!-- Out of the way while crop corners are placed or one image is edited. -->
        <EditorToolbar
          class="shrink-0"
          :class="(cropCorners || imageView) && 'pointer-events-none opacity-40'"
          :inert="!!(cropCorners || imageView)"
          :for-text="editingText || textSelected"
          :for-marker="markerSelected"
        />
      </div>

      <div class="flex min-h-0 flex-1 gap-3 px-4">
        <!-- The layers bottom left, beside the picture – out of the way while one is edited. -->
        <EditorLayersPanel
          v-if="layersOpen && ready"
          class="max-h-full w-64 shrink-0 self-end"
          :class="(cropCorners || imageView) && 'pointer-events-none opacity-40'"
          :inert="!!(cropCorners || imageView)"
          :layers="layers"
          :active="activeLayer"
          :can-paste="!!pasteKind"
          @select="canvas.selectLayer"
          @update="canvas.updateLayer"
          @move="canvas.moveLayer"
          @add="canvas.addLayer()"
          @duplicate="duplicateLayer"
          @copy="(id) => canvas.copyLayers([id])"
          @paste="pasteLayers"
          @remove="canvas.removeLayer"
          @edit-image="openImageView"
        />

        <div class="relative min-w-0 flex-1">
          <EditorCanvasMenu
            :spot="spot"
            :can-select-all="!isEmpty"
            :paste-kind="pasteKind"
            @add-text="addTextHere"
            @toggle-fill="toggleFill"
            @calibrate="calibrateSpot"
            @delete="deleteSpot"
            @select-all="selectAll"
            @copy="spot && copyObjects(spot.objects)"
            @duplicate="spot && duplicate(spot.objects)"
            @paste="pasteHere"
            @arrange="(where) => spot && arrange(where, spot.objects)"
            @edit-image="spot?.image && openImageView(spot.image)"
          >
            <!-- capture: runs before the menu opens, so it knows what was right-clicked. -->
            <div
              ref="host"
              :data-drop-editor="takesImages ? '' : undefined"
              :class="
                cn(
                  'flex size-full items-center justify-center rounded-xl transition-shadow [&_.canvas-container]:checkerboard [&_.canvas-container]:shadow-2xl [&_.canvas-container]:ring-1 [&_.canvas-container]:ring-foreground/10',
                  galleryDrag.overEditor.value && 'ring-2 ring-primary/70 ring-inset'
                )
              "
              @contextmenu.capture="onContextMenu"
              @dblclick="onDoubleClick"
            />
          </EditorCanvasMenu>
          <ExtendCanvasOverlay
            v-if="ready && !cropCorners && !imageView"
            ref="extendOverlay"
            :canvas="canvas"
            :area="host"
            @extend="extend"
          />
          <PerspectiveCropOverlay
            v-if="cropCorners"
            v-model:corners="cropCorners"
            :image-size="imageSize"
            :version="viewVersion"
            :to-client="sceneToClient"
            :to-scene="clientToScene"
            :picture="canvas.picture()"
          />
          <!-- Texts are Markdown – what can be written, beside the picture while texts are written. -->
          <MarkdownLegend
            v-if="ready && (tool === 'text' || editingText) && !cropCorners && !imageView"
            class="absolute top-0 right-0 z-10"
          />
          <div v-if="!ready" class="absolute inset-0 grid place-items-center">
            <Spinner class="size-6" />
          </div>
        </div>
      </div>

      <!-- Layers and zoom left, actions centred, the scale for measuring right – like the camera
           view. -->
      <div class="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 pt-3 pb-4">
        <div class="flex items-center gap-2 justify-self-start">
          <!-- The toggle is the glass panel itself (like the scale badge): alone in a panel of its
               own, the pressed toggle looked framed by a thick dark border. Height as the zoom
               panel; the glass background repeated, so it replaces the toggle's transparent one. -->
          <HintTooltip :label="layersOpen ? 'Ebenen ausblenden' : 'Ebenen zeigen'" side="top">
            <Toggle
              v-model="layersOpen"
              size="sm"
              aria-label="Ebenen"
              :class="cn('glass-panel h-9 rounded-2xl bg-popover/65 px-3.5', ACTIVE_TOGGLE)"
            >
              <LayersIcon />
              Ebenen
              <span class="tabular-nums opacity-70">{{ layers.length }}</span>
            </Toggle>
          </HintTooltip>
          <EditorZoomControl
            :zoom="viewZoom"
            :max="MAX_VIEW_ZOOM"
            @zoom-in="stepViewZoom(1)"
            @zoom-out="stepViewZoom(-1)"
            @reset="resetView"
          />
        </div>
        <CropActionBar
          v-if="cropCorners"
          :result="cropResult"
          @cancel="stopCropping"
          @apply="applyCrop"
        />
        <ImageViewBar
          v-else-if="imageView"
          :name="imageView.name"
          :can-undo="imageView.canUndo"
          :changed="imageView.changed"
          @cancel="closeImageView(false)"
          @undo="canvas.undoImageView()"
          @done="closeImageView(true)"
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

    <SaveImageDialog
      v-model:open="saveOpen"
      :source="session.path"
      :saving="saving"
      @save="(target, copy) => save(target, { copy })"
    />
  </div>
</template>
