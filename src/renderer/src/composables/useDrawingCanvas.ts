import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import {
  ActiveSelection,
  Canvas,
  FabricImage,
  IText,
  Path,
  PencilBrush,
  Point,
  Rect,
  util,
  type FabricObject,
  type TPointerEvent,
  type TPointerEventInfo,
  type XY
} from 'fabric'
import type {
  EditorDocument,
  FillLayerData,
  ImageAdjustment,
  ImagePoint,
  LayerData,
  LayerPicture,
  LayerType,
  LegacyEditorDocument
} from '@shared/types'
import {
  changeMapper,
  pointMapper,
  render,
  renderAll,
  sizeAfter,
  toCanvas,
  turnBetween,
  withTurn,
  type Side,
  type Size
} from '@/editor/adjust'
import { CanvasHistory } from '@/editor/history'
import {
  BASE_SOURCE,
  boxOf,
  contains,
  DEFAULT_DRAWING_NAME,
  drawingLayer,
  fillsFor,
  layersOf,
  newLayerId,
  newPictureId,
  reflow,
  uniqueName,
  type Box,
  type ImageMeta,
  type LayerMeta
} from '@/editor/layers'
import { MarkdownText } from '@/editor/markdown'
import {
  createMeasure,
  formatLength,
  isMeasure,
  lockMeasure,
  measureLine,
  measuredLength,
  relabel,
  restyleMeasure
} from '@/editor/measure'
import { CUSTOM_PROPS, createShape, kindOf, snapAngle, tag, type ObjectKind } from '@/editor/shapes'
import { isShapeTool, type DrawStyle, type ShapeTool, type Tool } from '@/editor/tools'
import { bytesToObjectUrl, canvasToBytes, toHex, withAlpha } from '@/lib/image'
import {
  isInteractiveTarget,
  isKeyboardNavigating,
  isOverlayOpen,
  isTypingTarget
} from '@/lib/keyboard'

/** Style values are defined for a 1920px wide image and scaled to the actual image size. */
const REFERENCE_SIZE = 1920
const HIGHLIGHTER_ALPHA = 0.4
const HIGHLIGHTER_WIDTH_FACTOR = 3
const TEXT_FONT = '"Geist Variable", sans-serif'
/** Zoom range on top of the fitted image (1 = whole image visible). */
export const MAX_VIEW_ZOOM = 8
/** Below 1 only to leave room beside the picture, e.g. while space is added to it. */
export const MIN_ROOM_ZOOM = 0.1
/** One zoom step of the + / − keys and buttons – like in the camera view. */
const VIEW_ZOOM_STEP = 0.5
/** Zoom per wheel delta unit: one mouse wheel notch (100) zooms by about 16 %. */
const WHEEL_ZOOM = 0.0015
/** How far a pasted or duplicated copy lands from the original (for a 1920px wide image). */
const PASTE_OFFSET = 24
/** Arrow key presses closer together than this are one undo step. */
const NUDGE_MERGE_MS = 1000
/** Adjusted pictures kept for undo and redo besides those shown (each a full-size canvas). */
const RENDER_CACHE = 4
/** Longer side of the small copy of the picture (for the ambient light). */
const PREVIEW_SIZE = 512
/** Longer side of the small pictures in the layer list. */
const THUMB_SIZE = 96
/** A picture pulled in from the gallery covers at most this share of the canvas to start with. */
const INSERT_SHARE = 0.5

/**
 * Copied objects or layers, as saved – kept while the app runs, so they can be pasted into
 * another image too. `pastes` moves every further copy of objects a bit more; layers carry the
 * pictures of their images along, and the image they came from (`document`).
 */
type EditorClipboard =
  | { kind: 'objects'; objects: Record<string, unknown>[]; pastes: number }
  | { kind: 'layers'; layers: LayerData[]; pictures: Map<string, Uint8Array>; document: string }

let clipboard: EditorClipboard | null = null
const clipboardKind = ref<EditorClipboard['kind'] | null>(null)

/** Selection handle look (rendered on the canvas, therefore plain colors). */
const CONTROL_STYLE = {
  cornerStyle: 'circle',
  cornerColor: '#ffffff',
  cornerStrokeColor: '#3b82f6',
  borderColor: '#3b82f6',
  transparentCorners: false,
  cornerSize: 11,
  borderScaleFactor: 1.5,
  padding: 4
} as const

export interface LoadImageOptions {
  /** The original frame. */
  url: string
  /** The frame as PNG – copied layers carry it into other images. */
  baseBytes: Uint8Array
  /** The layers as saved; null for a new capture. */
  document: EditorDocument | LegacyEditorDocument | null
  /** Pictures of the image layers besides the frame. */
  pictures: LayerPicture[]
  /** Scale for the measuring lines, null = lengths in pixels. */
  micronsPerPixel: number | null
}

export type StyleChange = 'color' | 'strokeWidth' | 'fontSize'

/** Changes to objects: style values as in the toolbar, and the text of a text. */
export type ObjectChange = Partial<DrawStyle> & { text?: string }

/**
 * A shape drawn without the mouse (remote control), in image pixels. Style values as in the
 * toolbar; missing ones are taken from the current style.
 */
export type ShapeSpec = Partial<DrawStyle> &
  (
    | { type: ShapeTool | 'measure'; from: XY; to: XY }
    | { type: 'pen' | 'highlighter'; points: XY[] }
    | { type: 'text'; at: XY; text: string }
  )

/** A drawn object as described to the remote control. */
export interface DrawnObject {
  /** Position in the stacking order of the drawn objects, 0 = bottom. */
  index: number
  kind: ObjectKind | null
  /** Id of its layer. */
  layer: string
  /** Bounding box in image pixels. */
  box: { left: number; top: number; width: number; height: number }
  color: string | null
  /** Line width as in the toolbar. */
  strokeWidth?: number
  filled?: boolean
  text?: string
  fontSize?: number
  /** Measuring lines: the length as shown, and in image pixels. */
  length?: string
  lengthPixels?: number
  selected: boolean
}

/** A layer as the layer list shows it. */
export interface LayerInfo {
  id: string
  type: LayerType
  name: string
  visible: boolean
  locked: boolean
  owner?: 'ai'
  /** Drawing layers: how many objects lie on it. */
  objects: number
  /** Image layers: the picture is cropped or turned. */
  adjusted: boolean
  /** Image layers: a small copy of the picture. */
  thumbnail: string | null
  /** Space: its colour. */
  color: string | null
}

/** A layer as described to the remote control. */
export interface LayerDescription {
  /** Position from the bottom, 0 = bottom. */
  index: number
  id: string
  type: LayerType
  name: string
  visible: boolean
  locked: boolean
  owner: 'ai' | null
  /** The layer the user works on. */
  active: boolean
  /** Drawing layers: indices of its objects (see `DrawnObject.index`). */
  objects?: number[]
  /** Images and space: where they lie in the picture (image pixels). */
  box?: Box
  /** Images: the size of their own picture, how it is scaled, and its adjustments. */
  pictureSize?: Size
  scale?: number
  adjustments?: ImageAdjustment[]
  color?: string
}

/** The image being edited on its own (double click on a picture). */
export interface ImageViewInfo {
  layerId: string
  name: string
  /** Changed since it was opened. */
  changed: boolean
  canUndo: boolean
  /** It is cropped or turned. */
  adjusted: boolean
}

export interface InsertImageOptions {
  /** The picture – PNG, JPEG or WebP. */
  bytes: Uint8Array
  mime?: string
  name: string
  /** Middle of the picture in the image (pixels); default: the middle of the image. */
  at?: XY
  /** Width in the image (pixels); default: fitting into half the image. */
  width?: number
  /** Pulled in by an AI assistant – the user's layer stays the one worked on. */
  owner?: 'ai'
}

/** What is under the pointer – for the canvas context menu. */
export interface CanvasSpot {
  /** Pointer position in scene (image) coordinates. */
  point: XY
  /** The pointer is on the image, not on the margin around it. */
  onImage: boolean
  /** Objects the menu acts on: the selection if the pointer is on it, else the object under it. */
  objects: FabricObject[]
  /** Some of them are shapes that can be filled (rectangle, ellipse) … */
  fillable: boolean
  /** … and all of those are filled already. */
  filled: boolean
  /** The one object is a measuring line – it can set the scale. */
  measurement: FabricObject | null
  /** Image layer under the pointer – it can be edited on its own. */
  image: string | null
}

interface UseDrawingCanvasOptions {
  /** Element the canvas is rendered into; the image is fitted into its size. */
  host: Ref<HTMLElement | null>
  tool: Ref<Tool>
  style: Ref<DrawStyle>
}

export interface DrawingCanvas {
  ready: Ref<boolean>
  canUndo: Ref<boolean>
  canRedo: Ref<boolean>
  hasSelection: Ref<boolean>
  isEmpty: Ref<boolean>
  /** True if the drawing differs from the last loaded/saved state (incl. text being typed). */
  dirty: Ref<boolean>
  /** A text is being typed (its Markdown source is shown). */
  editingText: Ref<boolean>
  /** Zoom of the view, 1 = whole image (up to `MAX_VIEW_ZOOM`). */
  viewZoom: Ref<number>
  /** Size of what is shown: the canvas – or, while an image is edited on its own, its picture. */
  imageSize: Ref<Size>
  /** Size of the canvas with every layer. */
  canvasSize(): Size
  /** A small copy of the picture with everything on it; null until there is one. */
  previewUrl: Ref<string | null>
  /** The picture "Original wiederherstellen" acts on is cropped or turned. */
  imageAdjusted: Ref<boolean>
  /** Changes whenever the view moves (zoom, pan, resize) – for overlays that follow it. */
  viewVersion: Ref<number>
  /** The layers, bottom first. */
  layers: Ref<LayerInfo[]>
  /** The layer the user works on: new drawings go there. */
  activeLayer: Ref<string | null>
  /** The image edited on its own, null while all layers are shown. */
  imageView: Ref<ImageViewInfo | null>
  load(options: LoadImageOptions): Promise<void>
  /** Zooms the view to `value`; `min` below 1 lets the picture shrink to leave room beside it. */
  setViewZoom(value: number, min?: number): void
  /**
   * Shows the whole picture with room for `room` image pixels beside its sides (zooming out below
   * 1 if needed) – e.g. for a preview of space being added. Without any room: the whole picture.
   */
  showRoom(room: Partial<Record<Side, number>>): void
  /** Zooms in (1) or out (−1) by one step, like the + / − keys. */
  stepViewZoom(direction: 1 | -1): void
  /** Shows the whole image again. */
  resetView(): void
  /** Scale of the picture (µm per image pixel), null = measuring in pixels. */
  micronsPerPixel: Ref<number | null>
  /** Sets the scale; every measuring line shows its length with it right away. */
  setScale(micronsPerPixel: number | null): void
  undo(): void
  redo(): void
  deleteSelection(): void
  clearAll(): void
  applyStyleToSelection(change: StyleChange): void
  /** Changes style or text of `objects` (one undo step). */
  restyle(objects: FabricObject[], change: ObjectChange): void
  /** Looks at what is under the pointer of a (context menu) mouse event. */
  inspectAt(e: MouseEvent): CanvasSpot
  /** Adds a text at `point` and starts typing; the previous tool returns when the text is done. */
  addTextAt(point: XY): void
  /** Fills rectangles / ellipses among `objects` in their stroke colour, or removes the fill. */
  setFilled(objects: FabricObject[], filled: boolean): void
  /** Removes drawn objects – an image or a space among them takes its layer along. */
  removeObjects(objects: FabricObject[]): void
  /** Selects every drawn object that can be (switches to the select tool). */
  selectAll(): void
  /** What was copied last and can be pasted: objects or layers. */
  pasteKind: Ref<'objects' | 'layers' | null>
  /** Copies drawn `objects` (default: the selection); false if there was nothing to copy. */
  copyObjects(objects?: FabricObject[]): boolean
  /** Copies the selection and removes it. */
  cutSelection(): boolean
  /**
   * Pastes what was copied: objects into the layer worked on – a bit offset, or centred on `at` –
   * and selects them; layers above it.
   */
  paste(at?: XY): Promise<void>
  /** Adds a copy of `objects` (default: the selection) next to them, without the clipboard. */
  duplicate(objects?: FabricObject[]): Promise<void>
  /** Moves the selection by `dx`/`dy` image pixels (for 1920px); false without a selection. */
  nudgeSelection(dx: number, dy: number): boolean
  /** Brings `objects` (default: the selection) in front of all others of their layer or behind. */
  arrange(where: 'front' | 'back', objects?: FabricObject[]): void
  /** The drawn objects in stacking order (bottom first) – not the images and spaces. */
  objects(): FabricObject[]
  describeObjects(): DrawnObject[]
  describeLayers(): LayerDescription[]
  /**
   * Draws shapes as if drawn by hand (one undo step) and returns them – into `layer`, or the layer
   * the user works on.
   */
  drawShapes(specs: ShapeSpec[], layer?: string): FabricObject[]
  /** Selects `objects` with the select tool; none clears the selection. */
  selectObjects(objects: FabricObject[]): void
  /** Moves `objects` by `dx`/`dy` image pixels (one undo step). */
  moveObjects(objects: FabricObject[], dx: number, dy: number): void
  /** Zooms the view to `value` (1 = whole image), centred on `at` (image pixels) if given. */
  setView(value: number, at?: XY): void
  // ── Layers ──
  /** Adds a drawing layer above the one worked on (or for an AI assistant on top); its id. */
  addLayer(name?: string, owner?: 'ai'): string
  /** The topmost layer of the AI assistants – a new one on top if there is none yet. */
  aiLayer(name: string): string
  /** Works on that layer from now on; an image of it is selected with the select tool. */
  selectLayer(id: string): void
  updateLayer(id: string, change: { name?: string; visible?: boolean; locked?: boolean }): void
  /** Moves a layer to `index` (0 = bottom). */
  moveLayer(id: string, index: number): void
  duplicateLayer(id: string): Promise<void>
  removeLayer(id: string): void
  /** Copies layers – with their pictures, so they can be pasted into other images too. */
  copyLayers(ids: string[]): void
  /** Pulls a picture in as a new image layer (one undo step); resolves with its id. */
  insertImage(options: InsertImageOptions): Promise<string>
  /** The image layer under the pointer – none if a drawn object is there. */
  imageLayerAt(e: MouseEvent): string | null
  /** The image cropping acts on: the selected image layer, else the bottom one (the frame). */
  cropTarget(): string | null
  /** A point of the canvas in the picture of an image layer (its own pixels). */
  imagePoint(layer: string, point: XY): XY
  imageAdjustments(layer: string): ImageAdjustment[]
  // ── Changing pictures ──
  /** The adjustments of the bottom image (the frame) – turned, straightened, extended. */
  adjustments(): ImageAdjustment[]
  /** Turns the whole canvas with every layer by quarter turns (one undo step). */
  rotateCanvas(turns: 1 | 2 | 3): Promise<void>
  /** Adds space around the canvas – a layer of plain colour for each side (one undo step). */
  extendCanvas(adjustment: Extract<ImageAdjustment, { type: 'extend' }>): Promise<void>
  /**
   * Gives an image layer other adjustments. What lies on it moves along; for the frame what lies
   * beside it keeps its distance, and the canvas follows its size (one undo step).
   */
  changeImage(layer: string, adjustments: ImageAdjustment[]): Promise<void>
  /** Turns the canvas, adds space, or crops the frame (corners in its pixels). */
  adjustImage(adjustment: ImageAdjustment): Promise<void>
  /** Back to its original picture (default: the image cropping acts on). */
  resetImage(layer?: string): Promise<void>
  // ── Editing one image on its own ──
  /** Shows only that image, to turn or crop it; false if it is no image layer. */
  enterImageView(layer: string): boolean
  /** Turns the image being edited (or crops it), undoable on its own. */
  adjustImageView(adjustment: ImageAdjustment): void
  resetImageView(): void
  undoImageView(): void
  /**
   * Shows the picture as before its last perspective crop, so its corners can be moved again –
   * returns them; null if it has none (then a new crop starts on the picture as it is).
   */
  beginImageViewCrop(): ImagePoint[] | null
  applyImageViewCrop(adjustment: Extract<ImageAdjustment, { type: 'perspective' }>): void
  cancelImageViewCrop(): void
  /** Back to all layers – with the changes of the image (one undo step), or without them. */
  leaveImageView(apply: boolean): Promise<void>
  /** While locked (e.g. choosing crop corners) nothing is drawn or selected; zoom still works. */
  setLocked(locked: boolean): void
  /** The picture shown on its own (being edited), e.g. for a magnifier. */
  picture(): HTMLCanvasElement | null
  /** Image point ↔ position in the window (client coordinates), for overlays. */
  sceneToClient(point: XY): XY
  clientToScene(point: XY): XY
  /** Resolves once undo, redo and paste steps still being applied are done. */
  settled(): Promise<void>
  isEditingText(): boolean
  finishInteraction(): void
  exportImage(mime?: string, quality?: number): Promise<Uint8Array>
  exportDocument(): EditorDocument
  /** The pictures of the image layers besides the frame, for saving. */
  exportPictures(): LayerPicture[]
  /** Marks `document` (from `exportDocument` when saving) as the saved state. */
  markSaved(document: EditorDocument): void
  dispose(): Promise<void>
}

type Tagged = FabricObject & { cdLayer?: string }

/** Id of the layer an object belongs to (not saved – the layers hold their objects). */
const layerIdOf = (obj: FabricObject): string | undefined => (obj as Tagged).cdLayer

function setLayerId(obj: FabricObject, id: string): void {
  ;(obj as Tagged).cdLayer = id
}

/** Images and spaces are kept by their layers – only drawn objects are serialized. */
const isDrawn = (obj: FabricObject): boolean => !obj.excludeFromExport

const round = (value: number, digits = 0): number => Math.round(value * 10 ** digits) / 10 ** digits

let emptyPicture: HTMLCanvasElement | null = null

/** Shown for a picture whose file is missing. */
function empty(): HTMLCanvasElement {
  emptyPicture ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 })
  return emptyPicture
}

/** Decodes image bytes into a canvas, so adjustments can work on its pixels. */
async function decodePicture(bytes: Uint8Array, mime = 'image/png'): Promise<HTMLCanvasElement> {
  const url = bytesToObjectUrl(bytes, mime)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return toCanvas(image)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function useDrawingCanvas({ host, tool, style }: UseDrawingCanvasOptions): DrawingCanvas {
  let canvas: Canvas | null = null
  /** Size of the canvas with all layers … */
  let docSize: Size = { width: 0, height: 0 }
  /** … and of what is shown: that, or the picture of an image edited on its own. */
  let size: Size = { width: 0, height: 0 }
  /** Every picture an image layer can show, by its source, as loaded (before adjustments). */
  const sources = new Map<string, { picture: HTMLCanvasElement; bytes: Uint8Array }>()
  /** Adjusted pictures by source and adjustments, least recently used first. */
  const rendered = new Map<string, HTMLCanvasElement>()
  /** Small copies of pictures for the layer list, by the same key. */
  const thumbnails = new Map<string, string>()
  /** The layers, bottom first – the canvas holds their objects in the same order. */
  let layers: LayerMeta[] = []
  /** Tells the image layers were copied from (see `EditorClipboard`). */
  let documentKey = ''
  let locked = false
  let unit = 1
  let zoom = 1
  const history = new CanvasHistory()
  let initialSnapshot = ''
  /** Changes that need loading objects first (undo, redo, paste) – applied one after another. */
  let restoreQueue: Promise<void> = Promise.resolve()

  // Interaction state
  let draft: { from: XY; object: FabricObject | null } | null = null
  let erasing = false
  let erased = false
  let textWasEditing = false
  /** Content of the text being typed when typing started (it is committed only on leaving it). */
  let textBeforeEdit: string | null = null
  /** Tool to return to when a text added from the context menu is done. */
  let toolBeforeText: Tool | null = null

  /**
   * The image edited on its own: its adjustments so far and before each change (undo), the layers'
   * objects taken off the canvas meanwhile, and – while its corners are placed – the adjustments
   * before and after the perspective crop being changed.
   */
  interface View {
    layerId: string
    source: string
    list: ImageAdjustment[]
    initial: ImageAdjustment[]
    steps: ImageAdjustment[][]
    objects: FabricObject[]
    crop: { before: ImageAdjustment[]; after: ImageAdjustment[] } | null
    /** The picture on screen. */
    shown: HTMLCanvasElement
    /** The layer worked on before – again afterwards. */
    active: string | null
  }
  let view: View | null = null

  const ready = ref(false)
  const canUndo = ref(false)
  const canRedo = ref(false)
  const hasSelection = ref(false)
  const isEmpty = ref(true)
  const dirty = ref(false)
  const editingText = ref(false)
  const viewZoom = ref(1)
  const imageSize = ref<Size>({ width: 0, height: 0 })
  const previewUrl = ref<string | null>(null)
  const imageAdjusted = ref(false)
  const viewVersion = ref(0)
  const micronsPerPixel = ref<number | null>(null)
  const layerList = shallowRef<LayerInfo[]>([])
  const activeLayer = ref<string | null>(null)
  const imageView = shallowRef<ImageViewInfo | null>(null)
  /** Scale as loaded or last saved – a different one is an unsaved change. */
  let initialScale: number | null = null

  // ── Layers and their objects ────────────────────────────────────────────────

  const metaOf = (id: string | null | undefined): LayerMeta | undefined =>
    id ? layers.find((l) => l.id === id) : undefined

  const imageMeta = (id: string | null | undefined): ImageMeta | undefined => {
    const meta = metaOf(id)
    return meta?.type === 'image' ? meta : undefined
  }

  const layerOf = (obj: FabricObject): LayerMeta | undefined => metaOf(layerIdOf(obj))

  /** Every object of the layers – also while an image is shown on its own (then off the canvas). */
  const allObjects = (): FabricObject[] => view?.objects ?? canvas?.getObjects() ?? []

  /** The one canvas object of an image or space layer. */
  const objectOf = (id: string): FabricObject | undefined =>
    allObjects().find((o) => layerIdOf(o) === id)

  const objectsOfLayer = (id: string): FabricObject[] =>
    allObjects().filter((o) => layerIdOf(o) === id)

  const drawnObjects = (): FabricObject[] => allObjects().filter(isDrawn)

  /** Not hidden or locked – its objects can be selected and changed. */
  const isOpen = (meta: LayerMeta | undefined): boolean => !!meta && meta.visible && !meta.locked

  /** The bottom image – usually the frame; the canvas follows its size when it is cropped. */
  const mainImage = (): ImageMeta | undefined =>
    layers.find((l): l is ImageMeta => l.type === 'image')

  const names = (): string[] => layers.map((l) => l.name)

  const activeIndex = (): number => layers.findIndex((l) => l.id === activeLayer.value)

  /**
   * Puts an object on top of its layer's objects – into the canvas, or moved there. The canvas
   * keeps the objects in the order of their layers.
   */
  function placeInLayer(obj: FabricObject, id: string): void {
    const c = canvas!
    setLayerId(obj, id)
    const order = new Map(layers.map((l, i) => [l.id, i]))
    const index = order.get(id) ?? layers.length
    const at = c
      .getObjects()
      .filter((o) => o !== obj && (order.get(layerIdOf(o) ?? '') ?? -1) <= index).length
    if (c.getObjects().includes(obj)) c.moveObjectTo(obj, at)
    else c.insertAt(at, obj)
  }

  /** Sorts the canvas objects by the order of their layers (after a layer was moved). */
  function restack(): void {
    const c = canvas!
    const order = new Map(layers.map((l, i) => [l.id, i]))
    c.getObjects()
      .map((obj, i) => ({ obj, i, layer: order.get(layerIdOf(obj) ?? '') ?? 0 }))
      .sort((a, b) => a.layer - b.layer || a.i - b.i)
      .forEach(({ obj }, i) => c.moveObjectTo(obj, i))
  }

  /** A new drawing layer at `index` (no undo step of its own); its id. */
  function createDrawingLayer(index: number, name?: string, owner?: 'ai'): string {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { objects, ...meta } = drawingLayer(
      uniqueName(name ?? DEFAULT_DRAWING_NAME, names()),
      owner
    )
    layers.splice(Math.max(0, Math.min(layers.length, index)), 0, meta)
    return meta.id
  }

  /**
   * The layer something new is drawn into: the one worked on if it is a drawing (shown again if
   * hidden), else the drawing right above it, else a new one there – which is worked on from then.
   */
  function drawingTarget(): string {
    const index = activeIndex()
    const active = layers[index]
    if (active?.type === 'drawing' && !active.locked) {
      if (!active.visible) {
        active.visible = true
        applyTool()
      }
      return active.id
    }
    const above = index >= 0 ? layers[index + 1] : undefined
    const target =
      active?.type !== 'drawing' && above?.type === 'drawing' && isOpen(above)
        ? above.id
        : createDrawingLayer(index >= 0 ? index + 1 : layers.length)
    activeLayer.value = target
    return target
  }

  /** A layer to work on after the one worked on is gone: the topmost drawing of the user. */
  function defaultLayer(): string | null {
    const drawings = layers.filter((l) => l.type === 'drawing')
    return (
      [...drawings].reverse().find((l) => !l.owner)?.id ??
      drawings[drawings.length - 1]?.id ??
      layers[layers.length - 1]?.id ??
      null
    )
  }

  // ── Pictures ────────────────────────────────────────────────────────────────

  const pictureKey = (source: string, list: ImageAdjustment[]): string =>
    `${source}|${JSON.stringify(list)}`

  /** Drops adjusted pictures beyond the cache size that no layer shows. */
  function prunePictures(): void {
    const used = new Set(
      layers.flatMap((l) => (l.type === 'image' ? [pictureKey(l.source, l.adjustments)] : []))
    )
    if (view) used.add(pictureKey(view.source, view.list))
    const spare = [...rendered.keys()].filter((key) => !used.has(key))
    while (spare.length > RENDER_CACHE) rendered.delete(spare.shift()!)
    if (thumbnails.size > 50) thumbnails.clear()
  }

  /** The picture of `source` with `list` applied, from the cache or rendered. */
  function pictureOf(source: string, list: ImageAdjustment[]): HTMLCanvasElement {
    const original = sources.get(source)?.picture ?? empty()
    if (!list.length) return original
    const key = pictureKey(source, list)
    const cached = rendered.get(key)
    if (cached) {
      rendered.delete(key)
      rendered.set(key, cached)
      return cached
    }
    // Usually one step more than a picture shown before: only that step is rendered.
    const before =
      list.length === 1 ? original : rendered.get(pictureKey(source, list.slice(0, -1)))
    const picture = before ? render(before, list[list.length - 1]) : renderAll(original, list)
    rendered.set(key, picture)
    prunePictures()
    return picture
  }

  function thumbnailOf(meta: ImageMeta): string {
    const key = pictureKey(meta.source, meta.adjustments)
    const known = thumbnails.get(key)
    if (known) return known
    const picture = pictureOf(meta.source, meta.adjustments)
    const factor = Math.min(1, THUMB_SIZE / Math.max(picture.width, picture.height))
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.round(picture.width * factor))
    small.height = Math.max(1, Math.round(picture.height * factor))
    small.getContext('2d')!.drawImage(picture, 0, 0, small.width, small.height)
    const url = small.toDataURL('image/jpeg', 0.75)
    thumbnails.set(key, url)
    return url
  }

  /** Where an image lies: its top left corner in the canvas and its scale. */
  function placementOf(obj: FabricObject): { left: number; top: number; scale: number } {
    // Absolute also inside a multi-selection.
    const { translateX, translateY, scaleX } = util.qrDecompose(obj.calcTransformMatrix())
    return {
      left: round(translateX - (obj.width * scaleX) / 2, 3),
      top: round(translateY - (obj.height * scaleX) / 2, 3),
      scale: round(scaleX, 6)
    }
  }

  function boxOfImage(obj: FabricObject): Box {
    const { left, top, scale } = placementOf(obj)
    return { left, top, width: obj.width * scale, height: obj.height * scale }
  }

  function imageObject(
    meta: ImageMeta,
    place: { left: number; top: number; scale: number }
  ): FabricImage {
    const picture = pictureOf(meta.source, meta.adjustments)
    const obj = new FabricImage(picture, {
      left: place.left + (picture.width * place.scale) / 2,
      top: place.top + (picture.height * place.scale) / 2,
      scaleX: place.scale,
      scaleY: place.scale,
      excludeFromExport: true,
      lockRotation: true,
      lockScalingFlip: true,
      lockSkewingX: true,
      lockSkewingY: true
    })
    // Only uniform scaling from the corners – the picture keeps its proportions.
    obj.setControlsVisibility({ mtr: false, ml: false, mr: false, mt: false, mb: false })
    setLayerId(obj, meta.id)
    return obj
  }

  function fillObject(fill: FillLayerData): Rect {
    const rect = new Rect({ excludeFromExport: true, strokeWidth: 0, objectCaching: false })
    syncFill(fill, rect)
    setLayerId(rect, fill.id)
    return rect
  }

  function syncFill(fill: FillLayerData, rect: FabricObject): void {
    rect.set({
      left: fill.left + fill.width / 2,
      top: fill.top + fill.height / 2,
      width: fill.width,
      height: fill.height,
      fill: fill.color
    })
    rect.setCoords()
  }

  /** Moves a space with its corners. */
  function moveFill(fill: FillLayerData, rect: FabricObject, map: (p: XY) => XY): void {
    const box = boxOf(
      map({ x: fill.left, y: fill.top }),
      map({ x: fill.left + fill.width, y: fill.top + fill.height })
    )
    Object.assign(fill, {
      left: round(box.left),
      top: round(box.top),
      width: Math.max(1, round(box.width)),
      height: Math.max(1, round(box.height))
    })
    syncFill(fill, rect)
  }

  function replaceObject(old: FabricObject, next: FabricObject): void {
    const c = canvas!
    const index = c.getObjects().indexOf(old)
    c.remove(old)
    c.insertAt(Math.max(0, index), next)
  }

  // ── State ───────────────────────────────────────────────────────────────────

  /** Drawn objects as saved, each with its layer. */
  function drawnData(): { layer: string; data: Record<string, unknown> }[] {
    const c = canvas
    if (!c) return []
    // The canvas serializes them, not each object itself: in a multi-selection an object's own
    // position is relative to the selection, the canvas stores where it is in the image.
    const data = (c.toObject(CUSTOM_PROPS).objects as Record<string, unknown>[] | undefined) ?? []
    return drawnObjects().map((obj, i) => ({ layer: layerIdOf(obj) ?? '', data: data[i] }))
  }

  /** Every layer as saved (images and spaces from their objects). */
  function layersData(): LayerData[] {
    const drawn = drawnData()
    return layers.map((meta): LayerData => {
      if (meta.type === 'drawing') {
        return {
          ...meta,
          objects: drawn.filter((d) => d.layer === meta.id).map((d) => d.data)
        }
      }
      if (meta.type === 'image') {
        const obj = objectOf(meta.id)
        return { ...meta, ...(obj ? placementOf(obj) : { left: 0, top: 0, scale: 1 }) }
      }
      return { ...meta }
    })
  }

  /** One state of the history: the canvas size and every layer. */
  const stateOf = (width: number, height: number, list: LayerData[]): string =>
    JSON.stringify({ width, height, layers: list })
  const snapshot = (): string => stateOf(docSize.width, docSize.height, layersData())

  /** Typed into the text being edited – not in the history yet, but already a change. */
  function typedChanges(): boolean {
    const active = canvas?.getActiveObject()
    return active instanceof IText && active.isEditing && active.text !== textBeforeEdit
  }

  function syncLayers(): void {
    const counts = new Map<string, number>()
    for (const obj of drawnObjects()) {
      const id = layerIdOf(obj) ?? ''
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    layerList.value = layers.map((meta) => ({
      id: meta.id,
      type: meta.type,
      name: meta.name,
      visible: meta.visible,
      locked: meta.locked,
      ...(meta.owner ? { owner: meta.owner } : {}),
      objects: counts.get(meta.id) ?? 0,
      adjusted: meta.type === 'image' && meta.adjustments.length > 0,
      thumbnail: meta.type === 'image' ? thumbnailOf(meta) : null,
      color: meta.type === 'fill' ? meta.color : null
    }))
    if (!metaOf(activeLayer.value)) activeLayer.value = defaultLayer()
  }

  function syncView(): void {
    const v = view
    imageView.value = v && {
      layerId: v.layerId,
      name: metaOf(v.layerId)?.name ?? '',
      changed: JSON.stringify(v.list) !== JSON.stringify(v.initial),
      canUndo: v.steps.length > 0,
      adjusted: v.list.length > 0
    }
    const target = imageMeta(cropTarget())
    imageAdjusted.value = v ? v.list.length > 0 : !!target?.adjustments.length
  }

  function syncState(): void {
    canUndo.value = history.canUndo
    canRedo.value = history.canRedo
    isEmpty.value = drawnObjects().length === 0
    syncLayers()
    syncView()
    dirty.value =
      history.current !== initialSnapshot ||
      typedChanges() ||
      micronsPerPixel.value !== initialScale ||
      !!imageView.value?.changed
    hasSelection.value = (canvas?.getActiveObjects().length ?? 0) > 0
  }

  const isFillable = (obj: FabricObject): boolean => {
    const kind = kindOf(obj)
    return kind === 'rect' || kind === 'ellipse'
  }

  function commit(): void {
    if (!canvas || view) return
    if (history.push(snapshot())) {
      syncState()
      schedulePreview()
    } else syncLayers()
  }

  // ── Sizing, zoom and panning ────────────────────────────────────────────────

  /** Scene point shown in the middle of the drawing area. */
  let center = { x: 0, y: 0 }

  /** Zoom at which the whole image fits into the host. */
  const fitZoom = (el: HTMLElement): number =>
    Math.min(el.clientWidth / size.width, el.clientHeight / size.height)

  /** `value` within `min`…`max`; the middle if the range is empty. */
  const clamp = (value: number, min: number, max: number): number =>
    min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value))

  /**
   * Sizes the canvas to exactly the visible part of the image (at most the host) and moves the
   * view there – so the picture always covers it, with no empty margin while zoomed or panned.
   */
  function layout(): void {
    const el = host.value
    if (!canvas || !el || !size.width) return
    zoom = fitZoom(el) * viewZoom.value
    const width = Math.max(1, Math.min(el.clientWidth, Math.floor(size.width * zoom)))
    const height = Math.max(1, Math.min(el.clientHeight, Math.floor(size.height * zoom)))
    canvas.setDimensions({ width, height })
    const halfWidth = width / zoom / 2
    const halfHeight = height / zoom / 2
    center = {
      x: clamp(center.x, halfWidth, size.width - halfWidth),
      y: clamp(center.y, halfHeight, size.height - halfHeight)
    }
    canvas.setViewportTransform([
      zoom,
      0,
      0,
      zoom,
      width / 2 - center.x * zoom,
      height / 2 - center.y * zoom
    ])
    // Right away: resizing cleared the canvas, and a render on the next frame would come after the
    // next resize when the view changes every frame (zooming out while space is dragged).
    canvas.renderAll()
    viewVersion.value++
  }

  useResizeObserver(host, layout)

  /**
   * Zooms to `value` (1 = whole image). The point at `anchor` (host coordinates, e.g. the mouse
   * pointer) stays where it is; without one the middle does.
   */
  function setViewZoom(value: number, anchor?: XY, min = 1): void {
    const el = host.value
    if (!canvas || !el || !size.width) return
    // The canvas is centred in the host, so the host's middle shows `center`.
    const offset = anchor
      ? { x: anchor.x - el.clientWidth / 2, y: anchor.y - el.clientHeight / 2 }
      : { x: 0, y: 0 }
    const fixed = { x: center.x + offset.x / zoom, y: center.y + offset.y / zoom }
    viewZoom.value = Math.round(clamp(value, min, MAX_VIEW_ZOOM) * 1000) / 1000
    const next = fitZoom(el) * viewZoom.value
    center = { x: fixed.x - offset.x / next, y: fixed.y - offset.y / next }
    layout()
  }

  const stepViewZoom = (direction: 1 | -1): void =>
    setViewZoom(viewZoom.value + direction * VIEW_ZOOM_STEP)

  function resetView(): void {
    viewZoom.value = 1
    center = { x: size.width / 2, y: size.height / 2 }
    layout()
  }

  function showRoom({
    top = 0,
    right = 0,
    bottom = 0,
    left = 0
  }: Partial<Record<Side, number>>): void {
    const el = host.value
    if (!canvas || !el || !size.width) return
    // The picture stays in the middle, so the wider room is needed on both sides.
    const needed = Math.min(
      el.clientWidth / (size.width + 2 * Math.max(left, right)),
      el.clientHeight / (size.height + 2 * Math.max(top, bottom))
    )
    viewZoom.value = clamp(needed / fitZoom(el), MIN_ROOM_ZOOM, 1)
    center = { x: size.width / 2, y: size.height / 2 }
    layout()
  }

  /** Shows the canvas with all layers in its (new) size. */
  function fitDocument(): void {
    const changed = size.width !== docSize.width || size.height !== docSize.height
    size = { ...docSize }
    imageSize.value = { ...size }
    if (changed) resetView()
  }

  /** Host coordinates of a mouse event. */
  function hostPoint(e: MouseEvent): XY {
    const rect = host.value!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  useEventListener(
    host,
    'wheel',
    (e: WheelEvent) => {
      if (!canvas || !e.deltaY) return
      e.preventDefault()
      setViewZoom(viewZoom.value * Math.exp(-e.deltaY * WHEEL_ZOOM), hostPoint(e))
    },
    { passive: false }
  )

  // Panning: drag with the middle mouse button, or with the left one while Space is held. Such a
  // press never reaches fabric (capture phase), so nothing is drawn or selected meanwhile.
  let spaceHeld = false
  /** Last mouse position (client coordinates) while panning. */
  let panFrom: XY | null = null

  const showPanCursor = (): void => canvas?.setCursor(panFrom ? 'grabbing' : 'grab')

  function endSpacePan(): void {
    spaceHeld = false
    if (!panFrom) applyTool()
  }

  useEventListener(
    host,
    'mousedown',
    (e: MouseEvent) => {
      if (!canvas || !(e.button === 1 || (e.button === 0 && spaceHeld))) return
      e.preventDefault() // no auto scrolling on a middle click
      e.stopPropagation()
      panFrom = { x: e.clientX, y: e.clientY }
      showPanCursor()
    },
    { capture: true }
  )
  // While panning (or ready to), fabric must not change the cursor on hover.
  useEventListener(
    host,
    'mousemove',
    (e: MouseEvent) => {
      if (!spaceHeld && !panFrom) return
      e.stopPropagation()
      showPanCursor()
    },
    { capture: true }
  )
  // On the window, so dragging beyond the drawing area keeps panning.
  useEventListener(
    window,
    'mousemove',
    (e: MouseEvent) => {
      if (!panFrom) return
      center = {
        x: center.x - (e.clientX - panFrom.x) / zoom,
        y: center.y - (e.clientY - panFrom.y) / zoom
      }
      panFrom = { x: e.clientX, y: e.clientY }
      layout()
    },
    { capture: true }
  )
  useEventListener(
    window,
    'mouseup',
    () => {
      if (!panFrom) return
      panFrom = null
      if (spaceHeld) showPanCursor()
      else applyTool()
    },
    { capture: true }
  )

  useEventListener(window, 'keydown', (e: KeyboardEvent) => {
    if (e.code !== 'Space' || !canvas) return
    if (isOverlayOpen() || isTypingTarget(e.target) || isEditingText()) return
    // A control reached with Tab keeps Space (see the camera view).
    if (isInteractiveTarget(e.target) && isKeyboardNavigating()) return
    e.preventDefault()
    if (spaceHeld) return
    spaceHeld = true
    showPanCursor()
  })
  useEventListener(window, 'keyup', (e: KeyboardEvent) => {
    if (e.code !== 'Space' || !spaceHeld) return
    e.preventDefault() // a focused button would be clicked otherwise
    endSpacePan()
  })
  useEventListener(window, 'blur', () => spaceHeld && endSpacePan())

  // ── Tools ───────────────────────────────────────────────────────────────────

  const sceneStroke = (): number => style.value.strokeWidth * unit

  function configureBrush(c: Canvas): void {
    const isHighlighter = tool.value === 'highlighter'
    const brush = new PencilBrush(c)
    brush.color = isHighlighter
      ? withAlpha(style.value.color, HIGHLIGHTER_ALPHA)
      : style.value.color
    brush.width = sceneStroke() * (isHighlighter ? HIGHLIGHTER_WIDTH_FACTOR : 1)
    brush.strokeLineCap = isHighlighter ? 'square' : 'round'
    brush.strokeLineJoin = 'round'
    c.freeDrawingBrush = brush
  }

  function isSelectableIn(obj: FabricObject, t: Tool): boolean {
    return t === 'select' || (t === 'text' && obj instanceof IText)
  }

  /**
   * Objects of hidden or locked layers cannot be hit; images can be moved with the select tool,
   * spaces never.
   */
  function applyLayerStates(c: Canvas, t: Tool): void {
    for (const obj of c.getObjects()) {
      const meta = layerOf(obj)
      obj.visible = meta?.visible ?? true
      const open = isOpen(meta)
      if (meta?.type === 'drawing') {
        obj.selectable = open && isSelectableIn(obj, t)
        obj.evented = open
      } else {
        obj.selectable = obj.evented = meta?.type === 'image' && open && t === 'select'
      }
    }
    const selected = c.getActiveObjects()
    if (selected.some((o) => !o.selectable)) c.discardActiveObject()
  }

  function applyTool(): void {
    const c = canvas
    if (!c) return
    const t = tool.value
    if (locked || view) {
      c.discardActiveObject()
      c.isDrawingMode = false
      c.selection = false
      c.skipTargetFind = true
      c.defaultCursor = c.hoverCursor = 'default'
      c.requestRenderAll()
      return
    }

    if (t !== 'select' && !(t === 'text' && c.getActiveObject() instanceof IText)) {
      c.discardActiveObject()
    }
    c.isDrawingMode = t === 'pen' || t === 'highlighter'
    if (c.isDrawingMode) configureBrush(c)

    c.selection = t === 'select'
    c.skipTargetFind = !(t === 'select' || t === 'text' || t === 'eraser')
    c.perPixelTargetFind = t === 'eraser'
    c.targetFindTolerance = t === 'eraser' ? 8 : 0
    c.defaultCursor = t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair'
    c.hoverCursor =
      t === 'select' ? 'move' : t === 'eraser' ? 'pointer' : t === 'text' ? 'text' : 'crosshair'
    applyLayerStates(c, t)
    c.requestRenderAll()
  }

  /** Changes style or text of `objects`; measuring lines only take colour and line width. */
  function restyle(objects: FabricObject[], change: ObjectChange): void {
    const c = canvas
    const drawn = objects.filter(isDrawn)
    if (!c || !drawn.length) return
    const { color, strokeWidth, fontSize, filled, text } = change

    for (const obj of drawn) {
      const kind = kindOf(obj)
      if (isMeasure(obj)) {
        restyleMeasure(obj, {
          color,
          strokeWidth: strokeWidth === undefined ? undefined : strokeWidth * unit
        })
        obj.setCoords()
        continue
      }
      if (color !== undefined) {
        if (kind === 'text') obj.set('fill', color)
        else if (kind === 'highlighter') obj.set('stroke', withAlpha(color, HIGHLIGHTER_ALPHA))
        else if (kind === 'arrow') obj.set({ stroke: color, fill: color })
        else if (kind === 'rect' || kind === 'ellipse') {
          obj.set({ stroke: color, ...(obj.fill !== 'transparent' ? { fill: color } : {}) })
        } else obj.set('stroke', color)
      }
      if (strokeWidth !== undefined && kind && kind !== 'text') {
        obj.set(
          'strokeWidth',
          strokeWidth * unit * (kind === 'highlighter' ? HIGHLIGHTER_WIDTH_FACTOR : 1)
        )
      }
      if (fontSize !== undefined && kind === 'text') obj.set('fontSize', fontSize * unit)
      if (text !== undefined && obj instanceof IText) obj.set('text', text)
      if (filled !== undefined && isFillable(obj)) {
        obj.set('fill', filled ? (obj.stroke as string) : 'transparent')
      }
      obj.setCoords()
    }
    c.requestRenderAll()
    commit()
  }

  /** Applies a changed style setting to the currently selected objects. */
  function applyStyleToSelection(change: StyleChange): void {
    restyle(canvas?.getActiveObjects() ?? [], { [change]: style.value[change] })
  }

  // ── Pointer interaction ─────────────────────────────────────────────────────

  function createText(at: XY, content: string, color: string, fontSize: number): IText {
    return tag(
      new MarkdownText(content, {
        left: at.x,
        top: at.y,
        // Anchor top-left so the text grows to the right while typing.
        originX: 'left',
        originY: 'top',
        fontFamily: TEXT_FONT,
        fontWeight: 600,
        fontSize: fontSize * unit,
        fill: color,
        cursorColor: color,
        editingBorderColor: '#3b82f6'
      }),
      'text'
    )
  }

  function addText(at: XY, e?: TPointerEvent): void {
    const c = canvas!
    const text = createText(at, '', style.value.color, style.value.fontSize)
    placeInLayer(text, drawingTarget())
    applyLayerStates(c, tool.value)
    c.setActiveObject(text)
    text.enterEditing(e)
    c.requestRenderAll()
  }

  function eraseAt(e: TPointerEvent): void {
    const c = canvas!
    const target = c.findTarget(e).target
    if (target && isDrawn(target)) {
      c.remove(target)
      erased = true
      c.requestRenderAll()
    }
  }

  function onMouseDownBefore(): void {
    const active = canvas?.getActiveObject()
    textWasEditing = active instanceof IText && active.isEditing
  }

  function onMouseDown(opt: TPointerEventInfo): void {
    if (locked || view) return
    const t = tool.value
    if (isShapeTool(t) || t === 'measure') {
      draft = { from: opt.scenePoint, object: null }
    } else if (t === 'text') {
      // A click while typing only finishes the text – it must not spawn a new one.
      if (textWasEditing || opt.target instanceof IText) return
      addText(opt.scenePoint, opt.e)
    } else if (t === 'eraser') {
      erasing = true
      erased = false
      eraseAt(opt.e)
    }
  }

  function onMouseMove(opt: TPointerEventInfo): void {
    const c = canvas!
    const t = tool.value
    if (draft && (isShapeTool(t) || t === 'measure')) {
      if (draft.object) c.remove(draft.object)
      draft.object =
        t === 'measure'
          ? createMeasure(
              draft.from,
              opt.e.shiftKey ? snapAngle(draft.from, opt.scenePoint) : opt.scenePoint,
              { color: style.value.color, strokeWidth: sceneStroke(), unit },
              micronsPerPixel.value
            )
          : createShape(
              t,
              draft.from,
              opt.scenePoint,
              { color: style.value.color, strokeWidth: sceneStroke(), filled: style.value.filled },
              opt.e.shiftKey
            )
      draft.object.selectable = false
      // On top while it is drawn; into its layer when done.
      c.add(draft.object)
      c.requestRenderAll()
    } else if (erasing) {
      eraseAt(opt.e)
    }
  }

  function onMouseUp(opt: TPointerEventInfo): void {
    const c = canvas!
    // Text tool: a single click into existing text starts editing right away.
    if (
      tool.value === 'text' &&
      opt.target instanceof IText &&
      !opt.target.isEditing &&
      !textWasEditing
    ) {
      opt.target.enterEditing(opt.e)
      opt.target.setCursorByClick(opt.e)
    }
    if (draft) {
      const obj = draft.object
      draft = null
      if (obj) {
        // Discard accidental clicks that produced (almost) nothing. (A measuring line has its
        // label, so only its length tells.)
        const { width, height } = obj.getBoundingRect()
        const extent = isMeasure(obj) ? measuredLength(obj) : Math.max(width, height)
        if (extent < 4) c.remove(obj)
        else {
          placeInLayer(obj, drawingTarget())
          applyLayerStates(c, tool.value)
          commit()
        }
      }
    }
    if (erasing) {
      erasing = false
      if (erased) commit()
    }
  }

  /** The layer of the topmost selected object is the one worked on. */
  function onSelection(): void {
    const c = canvas
    if (c) {
      const all = c.getObjects()
      const top = c
        .getActiveObjects()
        .reduce<FabricObject | null>(
          (best, obj) => (!best || all.indexOf(obj) > all.indexOf(best) ? obj : best),
          null
        )
      const id = top && layerIdOf(top)
      if (id) activeLayer.value = id
    }
    syncState()
  }

  function bindEvents(c: Canvas): void {
    c.on('object:added', ({ target }) => target.set(CONTROL_STYLE))
    c.on('mouse:down:before', onMouseDownBefore)
    c.on('mouse:down', onMouseDown)
    c.on('mouse:move', onMouseMove)
    c.on('mouse:up', onMouseUp)
    c.on('path:created', ({ path }) => {
      const highlighter = tool.value === 'highlighter'
      tag(path, highlighter ? 'highlighter' : 'pen')
      path.set({ strokeUniform: true, selectable: false })
      placeInLayer(path, drawingTarget())
      applyLayerStates(c, tool.value)
      commit()
    })
    c.on('object:modified', commit)
    c.on('text:editing:entered', ({ target }) => {
      textBeforeEdit = target.text
      editingText.value = true
    })
    // So closing or leaving the editor asks while a text is still being typed.
    c.on('text:changed', syncState)
    c.on('text:editing:exited', ({ target }) => {
      textBeforeEdit = null
      editingText.value = false
      if (!target.text.trim()) c.remove(target)
      commit()
      if (toolBeforeText && tool.value === 'text') tool.value = toolBeforeText
      toolBeforeText = null
    })
    c.on('selection:created', onSelection)
    c.on('selection:updated', onSelection)
    c.on('selection:cleared', syncState)
  }

  // ── Loading and the history ─────────────────────────────────────────────────

  /**
   * Objects read from JSON: measuring lines get their locks back (not serialized) and show their
   * length with the current scale (it may have changed since).
   */
  function prepareLoaded(objects: FabricObject[]): FabricObject[] {
    for (const obj of objects) {
      if (!isMeasure(obj)) continue
      lockMeasure(obj)
      relabel(obj, micronsPerPixel.value)
    }
    return objects
  }

  /** Shows `state` on the canvas: every layer with its objects. */
  async function rebuild(state: {
    width: number
    height: number
    layers: LayerData[]
  }): Promise<void> {
    const c = canvas
    if (!c) return
    const drawn = await util.enlivenObjects<FabricObject>(
      state.layers.flatMap((l) => (l.type === 'drawing' ? l.objects : []))
    )
    if (canvas !== c) return
    c.discardActiveObject()
    c.remove(...c.getObjects())
    layers = state.layers.map((layer): LayerMeta => {
      if (layer.type === 'drawing') {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { objects, ...meta } = layer
        return meta
      }
      if (layer.type === 'image') {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { left, top, scale, ...meta } = layer
        return { ...meta, adjustments: [...meta.adjustments] }
      }
      return { ...layer }
    })
    const objects: FabricObject[] = []
    let next = 0
    state.layers.forEach((layer, i) => {
      const meta = layers[i]
      if (layer.type === 'drawing') {
        for (let k = 0; k < layer.objects.length; k++) {
          const obj = drawn[next++]
          setLayerId(obj, meta.id)
          objects.push(obj)
        }
      } else if (layer.type === 'image') {
        objects.push(imageObject(meta as ImageMeta, layer))
      } else objects.push(fillObject(meta as FillLayerData))
    })
    c.add(...prepareLoaded(objects))
    docSize = { width: state.width, height: state.height }
    if (!view) fitDocument()
    prunePictures()
  }

  async function load({
    url,
    baseBytes,
    document,
    pictures,
    micronsPerPixel: scale
  }: LoadImageOptions): Promise<void> {
    await dispose()
    const el = host.value
    if (!el) return

    const canvasEl = window.document.createElement('canvas')
    el.appendChild(canvasEl)
    const c = new Canvas(canvasEl, {
      // Fabric's defaults swallow the context menu and treat right / middle clicks like a left
      // click (drawing, erasing, adding text) – the right click opens our menu instead.
      stopContextMenu: false,
      fireRightClick: false,
      fireMiddleClick: false,
      preserveObjectStacking: true,
      enableRetinaScaling: true,
      selectionColor: 'rgba(59, 130, 246, 0.12)',
      selectionBorderColor: '#3b82f6',
      selectionLineWidth: 1
    })
    canvas = c
    micronsPerPixel.value = initialScale = scale
    documentKey = newLayerId()
    // Bind before adding saved objects so they get the same control style as new ones.
    bindEvents(c)

    const image = new Image()
    image.src = url
    await image.decode()
    if (canvas !== c) return // another image was opened meanwhile
    const frame = toCanvas(image)
    const decoded = await Promise.all(
      pictures.map(async (p) => ({ ...p, picture: await decodePicture(p.bytes) }))
    )
    if (canvas !== c) return
    sources.set(BASE_SOURCE, { picture: frame, bytes: baseBytes })
    for (const p of decoded) sources.set(p.id, { picture: p.picture, bytes: p.bytes })
    // Style sizes follow the frame, so they stay the same whatever is cut off or added.
    unit = Math.max(frame.width, frame.height) / REFERENCE_SIZE

    await rebuild(layersOf(document, frame))
    if (canvas !== c) return
    activeLayer.value = defaultLayer()

    initialSnapshot = snapshot()
    history.reset(initialSnapshot)
    resetView()
    applyTool()
    syncState()
    schedulePreview()
    ready.value = true
  }

  function restore(state: string | null): void {
    if (state === null) return
    restoreQueue = restoreQueue.then(async () => {
      if (!canvas) return
      await rebuild(JSON.parse(state))
      applyTool()
      syncState()
      schedulePreview()
    })
  }

  const undo = (): void => restore(history.undo())
  const redo = (): void => restore(history.redo())

  // ── The small copy for the ambient light ────────────────────────────────────

  let previewTimer: ReturnType<typeof setTimeout> | undefined

  function schedulePreview(): void {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(updatePreview, 250)
  }

  function updatePreview(): void {
    const c = canvas
    if (!c || view || !docSize.width) return
    const factor = Math.min(1, PREVIEW_SIZE / Math.max(docSize.width, docSize.height))
    const [, , , , left, top] = c.viewportTransform
    const small = c.toCanvasElement(factor / zoom, {
      left,
      top,
      width: docSize.width * zoom,
      height: docSize.height * zoom
    })
    small.toBlob(
      (blob) => {
        if (!blob || canvas !== c) return
        if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
        previewUrl.value = URL.createObjectURL(blob)
      },
      'image/jpeg',
      0.8
    )
  }

  // ── Changing pictures ───────────────────────────────────────────────────────

  /** Moves an object: its centre goes to `to`, it keeps its size and turns by `turn` degrees. */
  function moveObject(obj: FabricObject, to: XY, turn: number): void {
    if (turn) obj.set('angle', (obj.angle + turn + 360) % 360)
    obj.setPositionByOrigin(new Point(to.x, to.y), 'center', 'center')
    obj.setCoords()
  }

  function cropTarget(): string | null {
    const active = imageMeta(activeLayer.value)
    return (active ?? mainImage())?.id ?? null
  }

  function rotateCanvas(turns: 1 | 2 | 3): Promise<void> {
    restoreQueue = restoreQueue.then(() => {
      const c = canvas
      if (!c || view) return
      c.discardActiveObject()
      const step: ImageAdjustment = { type: 'rotate', turns }
      const map = pointMapper(docSize, step)
      for (const obj of c.getObjects()) {
        const meta = layerOf(obj)
        if (meta?.type === 'fill') moveFill(meta, obj, map)
        else if (meta?.type === 'image') {
          // The picture itself turns; its middle goes where it maps to.
          const { scale } = placementOf(obj)
          const middle = map(obj.getCenterPoint())
          meta.adjustments = withTurn(meta.adjustments, turns)
          const picture = pictureOf(meta.source, meta.adjustments)
          replaceObject(
            obj,
            imageObject(meta, {
              left: middle.x - (picture.width * scale) / 2,
              top: middle.y - (picture.height * scale) / 2,
              scale
            })
          )
        } else moveObject(obj, map(obj.getCenterPoint()), turns * 90)
      }
      docSize = sizeAfter(docSize, step)
      fitDocument()
      applyTool()
      commit()
    })
    return restoreQueue
  }

  function extendCanvas(adjustment: Extract<ImageAdjustment, { type: 'extend' }>): Promise<void> {
    restoreQueue = restoreQueue.then(() => {
      const c = canvas
      if (!c || view) return
      const { top, right, bottom, left, color } = adjustment
      c.discardActiveObject()
      const shift = ({ x, y }: XY): XY => ({ x: x + left, y: y + top })
      for (const obj of c.getObjects()) {
        const meta = layerOf(obj)
        if (meta?.type === 'fill') moveFill(meta, obj, shift)
        else moveObject(obj, shift(obj.getCenterPoint()), 0)
      }
      const fills = fillsFor(docSize, { top, right, bottom, left }, color, names())
      docSize = { width: docSize.width + left + right, height: docSize.height + top + bottom }
      // Beneath everything – nothing lies there yet.
      layers.unshift(...fills)
      c.insertAt(0, ...fills.map(fillObject))
      fitDocument()
      applyTool()
      commit()
    })
    return restoreQueue
  }

  function changeImage(id: string, next: ImageAdjustment[]): Promise<void> {
    restoreQueue = restoreQueue.then(() => {
      const c = canvas
      const meta = imageMeta(id)
      const obj = objectOf(id)
      if (!c || !meta || !obj || view) return
      const before = meta.adjustments
      if (JSON.stringify(before) === JSON.stringify(next)) return
      c.discardActiveObject()
      const source = sources.get(meta.source)?.picture ?? empty()
      const { scale } = placementOf(obj)
      const box = boxOfImage(obj)
      const picture = pictureOf(meta.source, next)
      const width = picture.width * scale
      const height = picture.height * scale
      const toNew = changeMapper(source, before, next)
      const turn = turnBetween(before, next)
      // The frame (with nothing of it beyond the canvas) gives the canvas its size: its top left
      // stays. Another picture stays where its middle shows.
      const slack = 0.5
      const main =
        mainImage()?.id === id &&
        box.left >= -slack &&
        box.top >= -slack &&
        box.left + box.width <= docSize.width + slack &&
        box.top + box.height <= docSize.height + slack
      let at: XY = { x: box.left, y: box.top }
      if (!main) {
        const middle = { x: picture.width / 2, y: picture.height / 2 }
        const was = changeMapper(source, next, before)(middle)
        at = { x: box.left + (was.x - middle.x) * scale, y: box.top + (was.y - middle.y) * scale }
      }
      const inside = (p: XY): XY => {
        const q = toNew({ x: (p.x - box.left) / scale, y: (p.y - box.top) / scale })
        return { x: at.x + q.x * scale, y: at.y + q.y * scale }
      }
      const index = layers.indexOf(meta)
      const others = c.getObjects().filter((o) => o !== obj)
      if (main) {
        const { map, beside } = reflow(box, width, height, inside)
        for (const other of others) {
          const layer = layerOf(other)
          if (layer?.type === 'fill') moveFill(layer, other, beside)
          else {
            const centre = other.getCenterPoint()
            const on = contains(box, centre)
            moveObject(other, map(centre), on && layer?.type === 'drawing' ? turn : 0)
          }
        }
        docSize = {
          width: Math.max(1, Math.round(docSize.width + width - box.width)),
          height: Math.max(1, Math.round(docSize.height + height - box.height))
        }
      } else {
        // What is drawn on the picture (above it) moves along.
        for (const other of others) {
          const layer = layerOf(other)
          if (!layer || layer.type === 'fill' || layers.indexOf(layer) < index) continue
          const centre = other.getCenterPoint()
          if (contains(box, centre)) {
            moveObject(other, inside(centre), layer.type === 'drawing' ? turn : 0)
          }
        }
      }
      meta.adjustments = next
      replaceObject(obj, imageObject(meta, { left: at.x, top: at.y, scale }))
      fitDocument()
      applyTool()
      commit()
    })
    return restoreQueue
  }

  function adjustImage(adjustment: ImageAdjustment): Promise<void> {
    if (adjustment.type === 'rotate') return rotateCanvas(adjustment.turns)
    if (adjustment.type === 'extend') return extendCanvas(adjustment)
    const main = mainImage()
    return main ? changeImage(main.id, [...main.adjustments, adjustment]) : restoreQueue
  }

  function resetImage(id = cropTarget() ?? ''): Promise<void> {
    return imageMeta(id) ? changeImage(id, []) : restoreQueue
  }

  function imagePoint(id: string, { x, y }: XY): XY {
    const obj = objectOf(id)
    if (!obj) return { x, y }
    const { left, top, scale } = placementOf(obj)
    return { x: (x - left) / scale, y: (y - top) / scale }
  }

  const imageAdjustments = (id: string): ImageAdjustment[] => [
    ...(imageMeta(id)?.adjustments ?? [])
  ]

  function setLocked(value: boolean): void {
    locked = value
    draft = null
    applyTool()
  }

  // ── Editing one image on its own ────────────────────────────────────────────

  function showPicture(picture: HTMLCanvasElement): void {
    const c = canvas!
    view!.shown = picture
    size = { width: picture.width, height: picture.height }
    imageSize.value = { ...size }
    c.backgroundImage = new FabricImage(picture, {
      left: size.width / 2,
      top: size.height / 2,
      selectable: false,
      evented: false
    })
    resetView()
  }

  function enterImageView(id: string): boolean {
    const c = canvas
    const meta = imageMeta(id)
    if (!c || !meta || view) return false
    finishInteraction()
    draft = null
    const objects = c.getObjects()
    c.remove(...objects)
    view = {
      layerId: id,
      source: meta.source,
      list: [...meta.adjustments],
      initial: [...meta.adjustments],
      steps: [],
      objects,
      crop: null,
      shown: empty(),
      active: activeLayer.value
    }
    activeLayer.value = id
    showPicture(pictureOf(meta.source, view.list))
    applyTool()
    syncState()
    return true
  }

  function changeView(list: ImageAdjustment[]): void {
    const v = view
    if (!v) return
    v.steps.push(v.list)
    v.list = list
    v.crop = null
    showPicture(pictureOf(v.source, list))
    syncState()
  }

  function adjustImageView(adjustment: ImageAdjustment): void {
    if (!view) return
    changeView(
      adjustment.type === 'rotate'
        ? withTurn(view.list, adjustment.turns)
        : [...view.list, adjustment]
    )
  }

  function resetImageView(): void {
    if (view?.list.length) changeView([])
  }

  function undoImageView(): void {
    const v = view
    if (!v?.steps.length) return
    v.list = v.steps.pop()!
    v.crop = null
    showPicture(pictureOf(v.source, v.list))
    syncState()
  }

  function beginImageViewCrop(): ImagePoint[] | null {
    const v = view
    if (!v) return null
    const last = v.list.findLastIndex((a) => a.type === 'perspective')
    if (last < 0) {
      v.crop = { before: v.list, after: [] }
      return null
    }
    const crop = v.list[last] as Extract<ImageAdjustment, { type: 'perspective' }>
    v.crop = { before: v.list.slice(0, last), after: v.list.slice(last + 1) }
    showPicture(pictureOf(v.source, v.crop.before))
    return crop.corners.map((p) => ({ ...p }))
  }

  function applyImageViewCrop(adjustment: Extract<ImageAdjustment, { type: 'perspective' }>): void {
    const crop = view?.crop
    if (crop) changeView([...crop.before, adjustment, ...crop.after])
  }

  function cancelImageViewCrop(): void {
    const v = view
    if (!v?.crop) return
    v.crop = null
    showPicture(pictureOf(v.source, v.list))
  }

  function leaveImageView(apply: boolean): Promise<void> {
    const c = canvas
    const v = view
    if (!c || !v) return restoreQueue
    view = null
    c.backgroundImage = undefined
    c.add(...v.objects)
    activeLayer.value = v.active
    size = { width: 0, height: 0 } // shown again in full
    fitDocument()
    applyTool()
    syncState()
    const changed = JSON.stringify(v.list) !== JSON.stringify(v.initial)
    return apply && changed ? changeImage(v.layerId, v.list) : restoreQueue
  }

  // ── Selecting, removing ─────────────────────────────────────────────────────

  function sceneToClient({ x, y }: XY): XY {
    const c = canvas
    if (!c) return { x, y }
    const rect = c.upperCanvasEl.getBoundingClientRect()
    const [z, , , , tx, ty] = c.viewportTransform
    return { x: rect.left + x * z + tx, y: rect.top + y * z + ty }
  }

  function clientToScene({ x, y }: XY): XY {
    const c = canvas
    if (!c) return { x, y }
    const rect = c.upperCanvasEl.getBoundingClientRect()
    const [z, , , , tx, ty] = c.viewportTransform
    return { x: (x - rect.left - tx) / z, y: (y - rect.top - ty) / z }
  }

  function removeObjects(objects: FabricObject[]): void {
    const c = canvas
    if (!c || !objects.length || view) return
    if (objects.some((o) => c.getActiveObjects().includes(o))) c.discardActiveObject()
    // An image or space is its layer.
    const gone = new Set(objects.filter((o) => !isDrawn(o)).map((o) => layerIdOf(o)))
    layers = layers.filter((l) => !gone.has(l.id))
    c.remove(...objects)
    c.requestRenderAll()
    commit()
  }

  const deleteSelection = (): void => removeObjects(canvas?.getActiveObjects() ?? [])

  /** The topmost visible image layer at a scene point. */
  function imageAt(point: XY): string | null {
    for (const meta of [...layers].reverse()) {
      if (meta.type !== 'image' || !meta.visible) continue
      if (objectOf(meta.id)?.containsPoint(new Point(point.x, point.y))) return meta.id
    }
    return null
  }

  /** The object under the pointer by its bounding box, whatever the tool. */
  function objectAt(e: MouseEvent): FabricObject | undefined {
    const c = canvas!
    // Drawing tools skip them otherwise.
    const { skipTargetFind, perPixelTargetFind } = c
    c.skipTargetFind = false
    c.perPixelTargetFind = false
    const target = c.findTarget(e).target
    c.skipTargetFind = skipTargetFind
    c.perPixelTargetFind = perPixelTargetFind
    return target
  }

  function imageLayerAt(e: MouseEvent): string | null {
    const c = canvas
    if (!c || view || locked) return null
    const target = objectAt(e)
    if (target && !(target instanceof ActiveSelection) && isDrawn(target)) return null
    return imageAt(c.getScenePoint(e))
  }

  function inspectAt(e: MouseEvent): CanvasSpot {
    const c = canvas
    const point = c ? c.getScenePoint(e) : { x: 0, y: 0 }
    const onImage = point.x >= 0 && point.y >= 0 && point.x <= size.width && point.y <= size.height
    const nothing: CanvasSpot = {
      point,
      onImage,
      objects: [],
      fillable: false,
      filled: false,
      measurement: null,
      image: null
    }
    if (!c || view) return nothing

    const target = objectAt(e)
    const selected = c.getActiveObjects()
    let objects: FabricObject[] = []
    if (target instanceof ActiveSelection || (target && selected.includes(target))) {
      objects = selected
    } else if (target) {
      objects = [target]
      // With the select tool, show which object the menu is about.
      if (tool.value === 'select' && target.selectable) {
        c.setActiveObject(target)
        c.requestRenderAll()
      }
    }
    const fillable = objects.filter(isFillable)
    return {
      ...nothing,
      objects,
      fillable: fillable.length > 0,
      filled: fillable.length > 0 && fillable.every((o) => o.fill !== 'transparent'),
      measurement: objects.length === 1 && isMeasure(objects[0]) ? objects[0] : null,
      image: imageAt(point)
    }
  }

  function setScale(value: number | null): void {
    micronsPerPixel.value = value
    const c = canvas
    if (!c) return
    const all = view ? view.objects : c.getObjects()
    for (const obj of all) if (isMeasure(obj)) relabel(obj, value)
    c.requestRenderAll()
    // No undo step of its own (undoing would only seem to do nothing – labels follow the scale);
    // the current state just shows the new labels.
    if (!view) history.replace(snapshot())
    syncState()
  }

  function addTextAt(point: XY): void {
    if (!canvas || view) return
    if (tool.value !== 'text') {
      toolBeforeText = tool.value
      tool.value = 'text'
    }
    addText(point)
  }

  function setFilled(objects: FabricObject[], filled: boolean): void {
    restyle(objects.filter(isFillable), { filled })
  }

  function select(objects: FabricObject[]): void {
    const c = canvas!
    c.discardActiveObject()
    c.setActiveObject(
      objects.length === 1
        ? objects[0]
        : new ActiveSelection(objects, { canvas: c, ...CONTROL_STYLE })
    )
    c.requestRenderAll()
  }

  function selectObjects(objects: FabricObject[]): void {
    const c = canvas
    if (!c || view) return
    if (!objects.length) return finishInteraction()
    tool.value = 'select'
    applyTool() // objects become selectable right away, not only after the tool watcher
    const selectable = objects.filter((o) => o.selectable)
    if (selectable.length) select(selectable)
    syncState()
  }

  function selectAll(): void {
    const objects = drawnObjects().filter((o) => isOpen(layerOf(o)))
    if (objects.length) selectObjects(objects)
  }

  // ── Copy, paste and arrange ───────────────────────────────────────────────────

  /** Drawn `objects` as saved, in their stacking order. */
  function serializedOf(objects: FabricObject[]): Record<string, unknown>[] {
    const data = drawnData()
    return drawnObjects().flatMap((o, i) => (objects.includes(o) ? [data[i].data] : []))
  }

  const selection = (): FabricObject[] => canvas?.getActiveObjects() ?? []

  function copyObjects(objects = selection()): boolean {
    if (view) return false
    const data = serializedOf(objects)
    if (!data.length) return false
    clipboard = { kind: 'objects', objects: data, pastes: 0 }
    clipboardKind.value = 'objects'
    return true
  }

  function cutSelection(): boolean {
    const objects = selection().filter(isDrawn)
    if (!copyObjects(objects)) return false
    removeObjects(objects)
    return true
  }

  /**
   * Adds the objects in `data` to a layer and selects them (with the select tool, so they can be
   * moved on right away). `place` gets their bounding box and returns how far to move them.
   */
  function insert(
    data: Record<string, unknown>[],
    layer: () => string,
    place: (box: { left: number; top: number; width: number; height: number }) => XY
  ): Promise<void> {
    const c = canvas
    if (!c || !data.length || view) return Promise.resolve()
    restoreQueue = restoreQueue.then(async () => {
      const copies = prepareLoaded(await util.enlivenObjects<FabricObject>(data))
      if (canvas !== c || view) return // another image was opened meanwhile
      const offset = place(util.makeBoundingBoxFromPoints(copies.flatMap((o) => o.getCoords())))
      const target = layer()
      for (const obj of copies) {
        obj.set({ left: obj.left + offset.x, top: obj.top + offset.y })
        obj.setCoords()
        placeInLayer(obj, target)
      }
      activeLayer.value = target
      tool.value = 'select'
      applyTool()
      select(copies)
      commit()
    })
    return restoreQueue
  }

  function paste(at?: XY): Promise<void> {
    const copied = clipboard
    if (!copied) return Promise.resolve()
    if (copied.kind === 'layers') {
      return insertLayers(
        copied.layers,
        copied.document === documentKey ? null : copied.pictures,
        false
      )
    }
    const step = PASTE_OFFSET * unit * ++copied.pastes
    return insert(copied.objects, drawingTarget, (box) =>
      at
        ? { x: at.x - box.left - box.width / 2, y: at.y - box.top - box.height / 2 }
        : { x: step, y: step }
    )
  }

  function duplicate(objects = selection()): Promise<void> {
    const step = PASTE_OFFSET * unit
    const drawn = objects.filter(isDrawn)
    const own = drawn.length ? layerIdOf(drawn[0]) : undefined
    const layer = (): string =>
      metaOf(own)?.type === 'drawing' && isOpen(metaOf(own)) ? own! : drawingTarget()
    return insert(serializedOf(drawn), layer, () => ({ x: step, y: step }))
  }

  /** The state after the last arrow key press – a quick further press updates it. */
  let nudged: { state: string; at: number } | null = null

  function nudgeSelection(dx: number, dy: number): boolean {
    const c = canvas
    const active = c?.getActiveObject()
    if (!c || !active || isEditingText() || view) return false
    active.set({
      left: active.left + (active.lockMovementX ? 0 : dx * unit),
      top: active.top + (active.lockMovementY ? 0 : dy * unit)
    })
    active.setCoords()
    c.requestRenderAll()
    const state = snapshot()
    const now = performance.now()
    if (nudged && history.current === nudged.state && now - nudged.at < NUDGE_MERGE_MS) {
      history.replace(state)
    } else history.push(state)
    nudged = { state, at: now }
    syncState()
    return true
  }

  function arrange(where: 'front' | 'back', objects = selection()): void {
    const c = canvas
    if (!c || view) return
    // In stacking order, so the objects keep their order among themselves – within their layer.
    const ordered = c.getObjects().filter((o) => objects.includes(o) && isDrawn(o))
    if (!ordered.length) return
    if (where === 'front') for (const obj of ordered) placeInLayer(obj, layerIdOf(obj)!)
    else {
      for (const obj of ordered.reverse()) {
        const id = layerIdOf(obj)!
        const order = new Map(layers.map((l, i) => [l.id, i]))
        const index = order.get(id) ?? 0
        const start = c
          .getObjects()
          .filter((o) => o !== obj && (order.get(layerIdOf(o) ?? '') ?? -1) < index).length
        c.moveObjectTo(obj, start)
      }
    }
    c.requestRenderAll()
    commit()
  }

  // ── Layers ──────────────────────────────────────────────────────────────────

  function addLayer(name?: string, owner?: 'ai'): string {
    const id = createDrawingLayer(
      owner ? layers.length : activeIndex() + 1 || layers.length,
      name,
      owner
    )
    if (!owner) activeLayer.value = id
    commit()
    return id
  }

  function aiLayer(name: string): string {
    const existing = [...layers].reverse().find((l) => l.type === 'drawing' && l.owner === 'ai')
    return existing?.id ?? createDrawingLayer(layers.length, name, 'ai')
  }

  function selectLayer(id: string): void {
    const c = canvas
    const meta = metaOf(id)
    if (!c || !meta || view) return
    activeLayer.value = id
    const obj = meta.type === 'image' ? objectOf(id) : undefined
    if (obj && tool.value === 'select' && obj.selectable) select([obj])
    else if (c.getActiveObjects().some((o) => layerIdOf(o) !== id)) c.discardActiveObject()
    c.requestRenderAll()
    syncState()
  }

  function updateLayer(
    id: string,
    { name, visible, locked: lock }: { name?: string; visible?: boolean; locked?: boolean }
  ): void {
    const meta = metaOf(id)
    if (!canvas || !meta || view) return
    const trimmed = name?.trim()
    if (trimmed) meta.name = trimmed
    if (visible !== undefined) meta.visible = visible
    // Spaces cannot be moved anyway.
    if (lock !== undefined && meta.type !== 'fill') meta.locked = lock
    applyTool()
    commit()
  }

  function moveLayer(id: string, index: number): void {
    const meta = metaOf(id)
    if (!canvas || !meta || view) return
    const from = layers.indexOf(meta)
    const to = Math.max(0, Math.min(layers.length - 1, Math.round(index)))
    if (from === to) return
    layers.splice(from, 1)
    layers.splice(to, 0, meta)
    restack()
    canvas.requestRenderAll()
    commit()
  }

  function removeLayer(id: string): void {
    const c = canvas
    const meta = metaOf(id)
    if (!c || !meta || view) return
    const objects = objectsOfLayer(id)
    if (objects.some((o) => c.getActiveObjects().includes(o))) c.discardActiveObject()
    const index = layers.indexOf(meta)
    layers.splice(index, 1)
    c.remove(...objects)
    if (activeLayer.value === id) {
      activeLayer.value = (layers[index - 1] ?? layers[index])?.id ?? null
    }
    c.requestRenderAll()
    commit()
  }

  function copyLayers(ids: string[]): void {
    if (view) return
    const data = layersData().filter((l) => ids.includes(l.id))
    if (!data.length) return
    const pictures = new Map<string, Uint8Array>()
    for (const layer of data) {
      const bytes = layer.type === 'image' ? sources.get(layer.source)?.bytes : undefined
      if (layer.type === 'image' && bytes) pictures.set(layer.source, bytes)
    }
    clipboard = { kind: 'layers', layers: data, pictures, document: documentKey }
    clipboardKind.value = 'layers'
  }

  /**
   * Adds layers above the one worked on, the top one is worked on then. From another image they
   * bring their `pictures`; duplicates are named as copies.
   */
  function insertLayers(
    data: LayerData[],
    pictures: Map<string, Uint8Array> | null,
    copies: boolean
  ): Promise<void> {
    const c = canvas
    if (!c || !data.length || view) return restoreQueue
    restoreQueue = restoreQueue.then(async () => {
      const drawn = await util.enlivenObjects<FabricObject>(
        data.flatMap((l) => (l.type === 'drawing' ? l.objects : []))
      )
      // Pictures of another image get ids of their own here.
      const remap = new Map<string, string>()
      if (pictures) {
        for (const [source, bytes] of pictures) {
          const id = newPictureId()
          sources.set(id, { picture: await decodePicture(bytes), bytes })
          remap.set(source, id)
        }
      }
      if (canvas !== c || view) return
      c.discardActiveObject()
      let at = activeIndex() >= 0 ? activeIndex() + 1 : layers.length
      let next = 0
      let top: string | null = null
      for (const layer of data) {
        const id = newLayerId()
        const name = uniqueName(copies ? `${layer.name} Kopie` : layer.name, names())
        if (layer.type === 'drawing') {
          const { objects, ...meta } = layer
          layers.splice(at++, 0, { ...meta, id, name })
          for (let k = 0; k < objects.length; k++) placeInLayer(drawn[next++], id)
        } else if (layer.type === 'image') {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { left, top: y, scale, ...rest } = layer
          const meta: ImageMeta = {
            ...rest,
            id,
            name,
            source: remap.get(layer.source) ?? layer.source,
            adjustments: [...layer.adjustments]
          }
          layers.splice(at++, 0, meta)
          placeInLayer(imageObject(meta, layer), id)
        } else {
          const fill: FillLayerData = { ...layer, id, name }
          layers.splice(at++, 0, fill)
          placeInLayer(fillObject(fill), id)
        }
        top = id
      }
      prepareLoaded(drawn)
      activeLayer.value = top
      applyTool()
      commit()
    })
    return restoreQueue
  }

  function duplicateLayer(id: string): Promise<void> {
    if (view) return restoreQueue
    const data = layersData().filter((l) => l.id === id)
    if (!data.length) return restoreQueue
    activeLayer.value = id
    return insertLayers(data, null, true)
  }

  async function insertImage({
    bytes,
    mime,
    name,
    at,
    width,
    owner
  }: InsertImageOptions): Promise<string> {
    const c = canvas
    if (!c) throw new Error('Kein Bild geladen')
    const picture = await decodePicture(bytes, mime)
    // Kept as PNG, whatever it came as.
    const png = mime === 'image/png' ? bytes : await canvasToBytes(picture)
    let id = ''
    restoreQueue = restoreQueue.then(() => {
      if (canvas !== c || view) return
      const source = newPictureId()
      sources.set(source, { picture, bytes: png })
      const scale = width
        ? width / picture.width
        : Math.min(
            1,
            (INSERT_SHARE * docSize.width) / picture.width,
            (INSERT_SHARE * docSize.height) / picture.height
          )
      const middle = at ?? { x: docSize.width / 2, y: docSize.height / 2 }
      const meta: ImageMeta = {
        id: newLayerId(),
        type: 'image',
        name: uniqueName(name, names()),
        visible: true,
        locked: false,
        ...(owner ? { owner } : {}),
        source,
        adjustments: []
      }
      layers.splice(owner || activeIndex() < 0 ? layers.length : activeIndex() + 1, 0, meta)
      const obj = imageObject(meta, {
        left: middle.x - (picture.width * scale) / 2,
        top: middle.y - (picture.height * scale) / 2,
        scale
      })
      placeInLayer(obj, meta.id)
      if (!owner) {
        // Selected, so it can be moved and scaled right away.
        activeLayer.value = meta.id
        tool.value = 'select'
        applyTool()
        select([obj])
      } else applyTool()
      commit()
      id = meta.id
    })
    await restoreQueue
    if (!id) throw new Error('Das Bild konnte nicht eingefügt werden.')
    return id
  }

  function describeLayers(): LayerDescription[] {
    const drawn = drawnObjects()
    return layers.map((meta, index) => {
      const info: LayerDescription = {
        index,
        id: meta.id,
        type: meta.type,
        name: meta.name,
        visible: meta.visible,
        locked: meta.locked,
        owner: meta.owner ?? null,
        active: meta.id === activeLayer.value
      }
      if (meta.type === 'drawing') {
        info.objects = drawn.flatMap((o, i) => (layerIdOf(o) === meta.id ? [i] : []))
      } else if (meta.type === 'fill') {
        info.box = { left: meta.left, top: meta.top, width: meta.width, height: meta.height }
        info.color = meta.color
      } else {
        const obj = objectOf(meta.id)
        if (obj) {
          const box = boxOfImage(obj)
          info.box = {
            left: round(box.left, 1),
            top: round(box.top, 1),
            width: round(box.width, 1),
            height: round(box.height, 1)
          }
          info.pictureSize = { width: obj.width, height: obj.height }
          info.scale = placementOf(obj).scale
        }
        info.adjustments = meta.adjustments
      }
      return info
    })
  }

  // ── Drawing and describing without the mouse (remote control) ─────────────────

  function shapeFrom(spec: ShapeSpec): FabricObject {
    const color = spec.color ?? style.value.color
    const strokeWidth = (spec.strokeWidth ?? style.value.strokeWidth) * unit
    switch (spec.type) {
      case 'measure':
        return createMeasure(
          spec.from,
          spec.to,
          { color, strokeWidth, unit },
          micronsPerPixel.value
        )
      case 'text':
        return createText(spec.at, spec.text, color, spec.fontSize ?? style.value.fontSize)
      case 'pen':
      case 'highlighter': {
        // Like the brush draws them: smoothed through the points.
        const highlighter = spec.type === 'highlighter'
        const points = spec.points.map((p) => new Point(p.x, p.y))
        const path = new Path(util.getSmoothPathFromPoints(points), {
          fill: null,
          stroke: highlighter ? withAlpha(color, HIGHLIGHTER_ALPHA) : color,
          strokeWidth: strokeWidth * (highlighter ? HIGHLIGHTER_WIDTH_FACTOR : 1),
          strokeLineCap: highlighter ? 'square' : 'round',
          strokeLineJoin: 'round',
          strokeUniform: true
        })
        return tag(path, spec.type)
      }
      default:
        return createShape(
          spec.type,
          spec.from,
          spec.to,
          { color, strokeWidth, filled: spec.filled ?? style.value.filled },
          false
        )
    }
  }

  function drawShapes(specs: ShapeSpec[], layer?: string): FabricObject[] {
    const c = canvas
    if (!c || !specs.length || view) return []
    const shapes = specs.map(shapeFrom)
    const target = metaOf(layer)?.type === 'drawing' ? layer! : drawingTarget()
    for (const shape of shapes) placeInLayer(shape, target)
    applyTool() // selectable or not, like everything else with the current tool
    c.requestRenderAll()
    commit()
    return shapes
  }

  function describeObjects(): DrawnObject[] {
    const c = canvas
    if (!c) return []
    const selected = c.getActiveObjects()
    return drawnObjects().map((obj, index) => {
      const kind = kindOf(obj) ?? null
      const { left, top, width, height } = obj.getBoundingRect()
      const stroke = isMeasure(obj) ? measureLine(obj) : obj
      const info: DrawnObject = {
        index,
        kind,
        layer: layerIdOf(obj) ?? '',
        box: { left: round(left), top: round(top), width: round(width), height: round(height) },
        color: toHex(String((kind === 'text' ? obj.fill : stroke?.stroke) ?? '')) || null,
        selected: selected.includes(obj)
      }
      if (kind === 'text' && obj instanceof IText) {
        info.text = obj.text
        info.fontSize = round(obj.fontSize / unit, 1)
      } else if (stroke) {
        const factor = kind === 'highlighter' ? HIGHLIGHTER_WIDTH_FACTOR : 1
        info.strokeWidth = round(stroke.strokeWidth / unit / factor, 1)
      }
      if (isFillable(obj)) info.filled = obj.fill !== 'transparent'
      if (isMeasure(obj)) {
        info.lengthPixels = round(measuredLength(obj), 1)
        info.length = formatLength(measuredLength(obj), micronsPerPixel.value)
      }
      return info
    })
  }

  function moveObjects(objects: FabricObject[], dx: number, dy: number): void {
    const c = canvas
    if (!c || !objects.length || view) return
    // Positions inside a multi-selection are relative to it.
    c.discardActiveObject()
    for (const obj of objects) {
      obj.set({ left: obj.left + dx, top: obj.top + dy })
      obj.setCoords()
    }
    c.requestRenderAll()
    commit()
  }

  function setView(value: number, at?: XY): void {
    if (!canvas || !size.width) return
    viewZoom.value = Math.round(clamp(value, 1, MAX_VIEW_ZOOM) * 100) / 100
    if (at) center = { x: at.x, y: at.y }
    layout()
  }

  /** Removes every drawn object of the layers that are not locked; the layers stay. */
  function clearAll(): void {
    const c = canvas
    const objects = drawnObjects().filter((o) => !layerOf(o)?.locked)
    if (!c || !objects.length || view) return
    c.discardActiveObject()
    c.remove(...objects)
    c.requestRenderAll()
    commit()
  }

  function isEditingText(): boolean {
    const active = canvas?.getActiveObject()
    return active instanceof IText && active.isEditing
  }

  /** Leaves text editing / selection so nothing is half-finished before saving. */
  function finishInteraction(): void {
    canvas?.discardActiveObject()
    canvas?.requestRenderAll()
  }

  /** Renders every visible layer at the original image resolution. */
  async function exportImage(mime = 'image/png', quality?: number): Promise<Uint8Array> {
    const c = canvas
    if (!c) throw new Error('Kein Bild geladen')
    if (view) await leaveImageView(true)
    finishInteraction()
    // The tiny epsilon prevents floating point errors from cutting off the last pixel row.
    // The whole image, wherever the view is zoomed or panned to: it starts at the translation.
    const [, , , , left, top] = c.viewportTransform
    let out = c.toCanvasElement(1 / zoom, {
      left,
      top,
      width: size.width * zoom + 1e-6,
      height: size.height * zoom + 1e-6
    })
    if (mime === 'image/jpeg') {
      // JPEG has no transparency – where no layer covers the canvas it is white, not black.
      const flat = window.document.createElement('canvas')
      flat.width = out.width
      flat.height = out.height
      const ctx = flat.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, flat.width, flat.height)
      ctx.drawImage(out, 0, 0)
      out = flat
    }
    return canvasToBytes(out, mime, quality)
  }

  function exportDocument(): EditorDocument {
    return {
      version: 2,
      width: docSize.width,
      height: docSize.height,
      layers: layersData(),
      ...(micronsPerPixel.value ? { micronsPerPixel: micronsPerPixel.value } : {})
    }
  }

  function exportPictures(): LayerPicture[] {
    const ids = new Set(
      layers.flatMap((l) => (l.type === 'image' && l.source !== BASE_SOURCE ? [l.source] : []))
    )
    return [...ids].flatMap((id) => {
      const bytes = sources.get(id)?.bytes
      return bytes ? [{ id, bytes }] : []
    })
  }

  /**
   * The state that was saved – not the current one, which may have changed while the file was
   * being written.
   */
  function markSaved(document: EditorDocument): void {
    initialSnapshot = stateOf(document.width, document.height, document.layers)
    initialScale = document.micronsPerPixel ?? null
    syncState()
  }

  async function dispose(): Promise<void> {
    ready.value = false
    const c = canvas
    canvas = null
    clearTimeout(previewTimer)
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
    sources.clear()
    rendered.clear()
    thumbnails.clear()
    layers = []
    layerList.value = []
    activeLayer.value = null
    view = null
    imageView.value = null
    locked = false
    draft = null
    erasing = false
    textBeforeEdit = null
    editingText.value = false
    if (c) await c.dispose()
    if (host.value) host.value.replaceChildren()
  }

  watch(tool, applyTool)
  watch(
    () => [style.value.color, style.value.strokeWidth],
    () => {
      if (canvas?.isDrawingMode) configureBrush(canvas)
    }
  )

  onBeforeUnmount(() => {
    void dispose()
  })

  return {
    ready,
    canUndo,
    canRedo,
    hasSelection,
    isEmpty,
    dirty,
    editingText,
    viewZoom,
    imageSize,
    canvasSize: () => ({ ...docSize }),
    previewUrl,
    imageAdjusted,
    viewVersion,
    layers: layerList,
    activeLayer,
    imageView,
    load,
    setViewZoom: (value: number, min?: number) => setViewZoom(value, undefined, min),
    showRoom,
    stepViewZoom,
    resetView,
    micronsPerPixel,
    setScale,
    undo,
    redo,
    deleteSelection,
    clearAll,
    applyStyleToSelection,
    restyle,
    inspectAt,
    addTextAt,
    setFilled,
    removeObjects,
    selectAll,
    pasteKind: clipboardKind,
    copyObjects,
    cutSelection,
    paste,
    duplicate,
    nudgeSelection,
    arrange,
    objects: drawnObjects,
    describeObjects,
    describeLayers,
    drawShapes,
    selectObjects,
    moveObjects,
    setView,
    addLayer,
    aiLayer,
    selectLayer,
    updateLayer,
    moveLayer,
    duplicateLayer,
    removeLayer,
    copyLayers,
    insertImage,
    imageLayerAt,
    cropTarget,
    imagePoint,
    imageAdjustments,
    adjustments: () => [...(mainImage()?.adjustments ?? [])],
    rotateCanvas,
    extendCanvas,
    changeImage,
    adjustImage,
    resetImage,
    enterImageView,
    adjustImageView,
    resetImageView,
    undoImageView,
    beginImageViewCrop,
    applyImageViewCrop,
    cancelImageViewCrop,
    leaveImageView,
    setLocked,
    picture: () => view?.shown ?? null,
    sceneToClient,
    clientToScene,
    settled: () => restoreQueue,
    isEditingText,
    finishInteraction,
    exportImage,
    exportDocument,
    exportPictures,
    markSaved,
    dispose
  }
}
