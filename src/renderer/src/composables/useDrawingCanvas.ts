import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import {
  ActiveSelection,
  Canvas,
  FabricImage,
  IText,
  Path,
  PencilBrush,
  Point,
  util,
  type FabricObject,
  type TPointerEvent,
  type TPointerEventInfo,
  type XY
} from 'fabric'
import type { EditorDocument, ImageAdjustment } from '@shared/types'
import {
  pointMapper,
  render,
  renderAll,
  sizeAfter,
  toCanvas,
  turnOf,
  type Size
} from '@/editor/adjust'
import { CanvasHistory } from '@/editor/history'
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
import { canvasToBytes, toHex, withAlpha } from '@/lib/image'
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
/** One zoom step of the + / − keys and buttons – like in the camera view. */
const VIEW_ZOOM_STEP = 0.5
/** Zoom per wheel delta unit: one mouse wheel notch (100) zooms by about 16 %. */
const WHEEL_ZOOM = 0.0015
/** How far a pasted or duplicated copy lands from the original (for a 1920px wide image). */
const PASTE_OFFSET = 24
/** Arrow key presses closer together than this are one undo step. */
const NUDGE_MERGE_MS = 1000
/** Adjusted pictures kept for undo and redo (each a full-size canvas). */
const RENDER_CACHE = 4
/** Longer side of the small copy of an adjusted picture (for the ambient light). */
const PREVIEW_SIZE = 512

/**
 * Objects copied with Ctrl+C, as saved – kept while the app runs, so they can be pasted into
 * another image too. `pastes` moves every further copy a bit more.
 */
let shapeClipboard: { objects: Record<string, unknown>[]; pastes: number } | null = null
const clipboardFilled = ref(false)

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
  /** The original frame; the document's adjustments are applied to it. */
  url: string
  document: EditorDocument | null
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
  /** Position in the stacking order, 0 = bottom. */
  index: number
  kind: ObjectKind | null
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
  /** Size of the picture as drawn on – after its adjustments. */
  imageSize: Ref<Size>
  /** A small copy of the adjusted picture; null while it is the original. */
  previewUrl: Ref<string | null>
  /** How many adjustments the picture has (0 = the original). */
  adjustmentCount: Ref<number>
  /** Changes whenever the view moves (zoom, pan, resize) – for overlays that follow it. */
  viewVersion: Ref<number>
  load(options: LoadImageOptions): Promise<void>
  setViewZoom(value: number): void
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
  removeObjects(objects: FabricObject[]): void
  /** Selects every object (switches to the select tool). */
  selectAll(): void
  /** There are copied objects to paste. */
  canPaste: Ref<boolean>
  /** Copies `objects` (default: the selection); false if there was nothing to copy. */
  copyObjects(objects?: FabricObject[]): boolean
  /** Copies the selection and removes it. */
  cutSelection(): boolean
  /** Pastes the copied objects – a bit offset, or centred on `at` – and selects them. */
  paste(at?: XY): Promise<void>
  /** Adds a copy of `objects` (default: the selection) next to them, without the clipboard. */
  duplicate(objects?: FabricObject[]): Promise<void>
  /** Moves the selection by `dx`/`dy` image pixels (for 1920px); false without a selection. */
  nudgeSelection(dx: number, dy: number): boolean
  /** Brings `objects` (default: the selection) in front of all others or behind them. */
  arrange(where: 'front' | 'back', objects?: FabricObject[]): void
  /** The drawn objects in stacking order (bottom first). */
  objects(): FabricObject[]
  describeObjects(): DrawnObject[]
  /** Draws shapes as if drawn by hand (one undo step) and returns them. */
  drawShapes(specs: ShapeSpec[]): FabricObject[]
  /** Selects `objects` with the select tool; none clears the selection. */
  selectObjects(objects: FabricObject[]): void
  /** Moves `objects` by `dx`/`dy` image pixels (one undo step). */
  moveObjects(objects: FabricObject[], dx: number, dy: number): void
  /** Zooms the view to `value` (1 = whole image), centred on `at` (image pixels) if given. */
  setView(value: number, at?: XY): void
  /** The adjustments of the picture so far (turned, straightened, extended). */
  adjustments(): ImageAdjustment[]
  /** Changes the picture; the drawn objects move along (one undo step). */
  adjustImage(adjustment: ImageAdjustment): Promise<void>
  /** Back to the original frame, objects moved back as well (one undo step). */
  resetImage(): Promise<void>
  /** While locked (e.g. choosing crop corners) nothing is drawn or selected; zoom still works. */
  setLocked(locked: boolean): void
  /** The picture as drawn on (after its adjustments), e.g. for a magnifier. */
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
  /** Marks `document` (from `exportDocument` when saving) as the saved state. */
  markSaved(document: EditorDocument): void
  dispose(): Promise<void>
}

export function useDrawingCanvas({ host, tool, style }: UseDrawingCanvasOptions): DrawingCanvas {
  let canvas: Canvas | null = null
  let size = { width: 0, height: 0 }
  /** The frame as loaded, before any adjustment, and the picture shown now. */
  let original: HTMLCanvasElement | null = null
  let shown: HTMLCanvasElement | null = null
  let adjustments: ImageAdjustment[] = []
  /** Adjusted pictures by their adjustments (JSON), newest last. */
  const rendered = new Map<string, HTMLCanvasElement>()
  let locked = false
  let unit = 1
  let zoom = 1
  const history = new CanvasHistory()
  let initialSnapshot = '[]'
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
  const adjustmentCount = ref(0)
  const viewVersion = ref(0)
  const micronsPerPixel = ref<number | null>(null)
  /** Scale as loaded or last saved – a different one is an unsaved change. */
  let initialScale: number | null = null

  /**
   * All objects as saved. The canvas serializes them, not each object itself: in a multi-selection
   * an object's own position is relative to the selection, the canvas stores where it is in the
   * image.
   */
  const serialized = (): Record<string, unknown>[] =>
    (canvas?.toObject(CUSTOM_PROPS).objects as Record<string, unknown>[] | undefined) ?? []
  /** One state of the history: the picture's adjustments and every object. */
  const stateOf = (list: ImageAdjustment[], objects: Record<string, unknown>[]): string =>
    JSON.stringify({ adjustments: list, objects })
  const snapshot = (): string => stateOf(adjustments, serialized())

  /** Typed into the text being edited – not in the history yet, but already a change. */
  function typedChanges(): boolean {
    const active = canvas?.getActiveObject()
    return active instanceof IText && active.isEditing && active.text !== textBeforeEdit
  }

  function syncState(): void {
    canUndo.value = history.canUndo
    canRedo.value = history.canRedo
    isEmpty.value = (canvas?.getObjects().length ?? 0) === 0
    dirty.value =
      history.current !== initialSnapshot ||
      typedChanges() ||
      micronsPerPixel.value !== initialScale
    hasSelection.value = (canvas?.getActiveObjects().length ?? 0) > 0
  }

  const isFillable = (obj: FabricObject): boolean => {
    const kind = kindOf(obj)
    return kind === 'rect' || kind === 'ellipse'
  }

  function commit(): void {
    if (history.push(snapshot())) syncState()
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
    canvas.requestRenderAll()
    viewVersion.value++
  }

  useResizeObserver(host, layout)

  /**
   * Zooms to `value` (1 = whole image). The point at `anchor` (host coordinates, e.g. the mouse
   * pointer) stays where it is; without one the middle does.
   */
  function setViewZoom(value: number, anchor?: XY): void {
    const el = host.value
    if (!canvas || !el || !size.width) return
    // The canvas is centred in the host, so the host's middle shows `center`.
    const offset = anchor
      ? { x: anchor.x - el.clientWidth / 2, y: anchor.y - el.clientHeight / 2 }
      : { x: 0, y: 0 }
    const fixed = { x: center.x + offset.x / zoom, y: center.y + offset.y / zoom }
    viewZoom.value = Math.round(clamp(value, 1, MAX_VIEW_ZOOM) * 100) / 100
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

  function applyTool(): void {
    const c = canvas
    if (!c) return
    const t = tool.value
    if (locked) {
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
    for (const obj of c.getObjects()) obj.selectable = isSelectableIn(obj, t)
    c.requestRenderAll()
  }

  /** Changes style or text of `objects`; measuring lines only take colour and line width. */
  function restyle(objects: FabricObject[], change: ObjectChange): void {
    const c = canvas
    if (!c || !objects.length) return
    const { color, strokeWidth, fontSize, filled, text } = change

    for (const obj of objects) {
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
    c.add(text)
    c.setActiveObject(text)
    text.enterEditing(e)
    c.requestRenderAll()
  }

  function eraseAt(e: TPointerEvent): void {
    const c = canvas!
    const target = c.findTarget(e).target
    if (target) {
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
    if (locked) return
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
        const size = isMeasure(obj) ? measuredLength(obj) : Math.max(width, height)
        if (size < 4) c.remove(obj)
        else commit()
      }
    }
    if (erasing) {
      erasing = false
      if (erased) commit()
    }
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
    c.on('selection:created', syncState)
    c.on('selection:updated', syncState)
    c.on('selection:cleared', syncState)
  }

  // ── Public API ──────────────────────────────────────────────────────────────

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

  /** The picture with `list` applied, from the cache or rendered (on top of the one before). */
  function adjusted(list: ImageAdjustment[]): HTMLCanvasElement {
    const key = JSON.stringify(list)
    const cached = rendered.get(key)
    if (cached) return cached
    // Usually one step more than a picture shown before: only that step is rendered.
    const before = list.length === 1 ? original : rendered.get(JSON.stringify(list.slice(0, -1)))
    const picture = before ? render(before, list[list.length - 1]) : renderAll(original!, list)
    rendered.set(key, picture)
    if (rendered.size > RENDER_CACHE) rendered.delete(rendered.keys().next().value!)
    return picture
  }

  function updatePreview(): void {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
    const picture = shown
    if (!picture || picture === original) return
    const factor = Math.min(1, PREVIEW_SIZE / Math.max(picture.width, picture.height))
    const small = window.document.createElement('canvas')
    small.width = Math.max(1, Math.round(picture.width * factor))
    small.height = Math.max(1, Math.round(picture.height * factor))
    small.getContext('2d')!.drawImage(picture, 0, 0, small.width, small.height)
    small.toBlob(
      (blob) => {
        if (blob && shown === picture) previewUrl.value = URL.createObjectURL(blob)
      },
      'image/jpeg',
      0.8
    )
  }

  /** Shows the original with `list` applied, as the background everything is drawn on. */
  function showAdjusted(list: ImageAdjustment[]): void {
    const c = canvas
    if (!c || !original) return
    const picture = list.length ? adjusted(list) : original
    shown = picture
    updatePreview()
    adjustments = list
    adjustmentCount.value = list.length
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

  /** Moves objects along with the picture: each keeps its size, its centre goes where it maps to. */
  function moveWith(objects: FabricObject[], map: (p: XY) => XY, turn: number): void {
    for (const obj of objects) {
      const { x, y } = map(obj.getCenterPoint())
      if (turn) obj.set('angle', (obj.angle + turn + 360) % 360)
      obj.setPositionByOrigin(new Point(x, y), 'center', 'center')
      obj.setCoords()
    }
  }

  function adjustImage(adjustment: ImageAdjustment): Promise<void> {
    restoreQueue = restoreQueue.then(() => {
      const c = canvas
      if (!c || !original) return
      c.discardActiveObject()
      moveWith(c.getObjects(), pointMapper(size, adjustment), turnOf(adjustment))
      showAdjusted([...adjustments, adjustment])
      commit()
    })
    return restoreQueue
  }

  function resetImage(): Promise<void> {
    restoreQueue = restoreQueue.then(() => {
      const c = canvas
      if (!c || !original || !adjustments.length) return
      c.discardActiveObject()
      // Back through the steps, the last one first – each from the size it produced.
      const sizes = adjustments.reduce<Size[]>(
        (list, adjustment) => [...list, sizeAfter(list[list.length - 1], adjustment)],
        [{ width: original.width, height: original.height }]
      )
      for (let i = adjustments.length - 1; i >= 0; i--) {
        const step = adjustments[i]
        moveWith(c.getObjects(), pointMapper(sizes[i], step, true), -turnOf(step))
      }
      showAdjusted([])
      commit()
    })
    return restoreQueue
  }

  function setLocked(value: boolean): void {
    locked = value
    draft = null
    applyTool()
  }

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

  async function load({ url, document, micronsPerPixel: scale }: LoadImageOptions): Promise<void> {
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
    // Bind before adding saved objects so they get the same control style as new ones.
    bindEvents(c)

    const image = new Image()
    image.src = url
    await image.decode()
    if (canvas !== c) return // another image was opened meanwhile
    original = toCanvas(image)
    rendered.clear()
    // Style sizes follow the frame, so they stay the same whatever is cut off or added.
    unit = Math.max(original.width, original.height) / REFERENCE_SIZE
    showAdjusted(document?.adjustments ?? [])

    if (document?.objects.length) {
      const objects = await util.enlivenObjects<FabricObject>(document.objects)
      c.add(...prepareLoaded(objects))
    }

    initialSnapshot = snapshot()
    history.reset(initialSnapshot)
    resetView()
    applyTool()
    syncState()
    ready.value = true
  }

  function restore(state: string | null): void {
    if (state === null) return
    restoreQueue = restoreQueue.then(async () => {
      const c = canvas
      if (!c) return
      const next = JSON.parse(state) as {
        adjustments: ImageAdjustment[]
        objects: Record<string, unknown>[]
      }
      const objects = await util.enlivenObjects<FabricObject>(next.objects)
      if (canvas !== c) return
      if (JSON.stringify(next.adjustments) !== JSON.stringify(adjustments)) {
        showAdjusted(next.adjustments)
      }
      c.discardActiveObject()
      c.remove(...c.getObjects())
      c.add(...prepareLoaded(objects))
      applyTool()
      syncState()
    })
  }

  const undo = (): void => restore(history.undo())
  const redo = (): void => restore(history.redo())

  function removeObjects(objects: FabricObject[]): void {
    const c = canvas
    if (!c || !objects.length) return
    if (objects.some((o) => c.getActiveObjects().includes(o))) c.discardActiveObject()
    c.remove(...objects)
    c.requestRenderAll()
    commit()
  }

  const deleteSelection = (): void => removeObjects(canvas?.getActiveObjects() ?? [])

  function inspectAt(e: MouseEvent): CanvasSpot {
    const c = canvas
    const point = c ? c.getScenePoint(e) : { x: 0, y: 0 }
    const onImage = point.x >= 0 && point.y >= 0 && point.x <= size.width && point.y <= size.height
    if (!c) {
      return { point, onImage, objects: [], fillable: false, filled: false, measurement: null }
    }

    // Objects are found by their bounding box whatever the tool (drawing tools skip them).
    const { skipTargetFind, perPixelTargetFind } = c
    c.skipTargetFind = false
    c.perPixelTargetFind = false
    const target = c.findTarget(e).target
    c.skipTargetFind = skipTargetFind
    c.perPixelTargetFind = perPixelTargetFind

    const selected = c.getActiveObjects()
    let objects: FabricObject[] = []
    if (target instanceof ActiveSelection || (target && selected.includes(target))) {
      objects = selected
    } else if (target) {
      objects = [target]
      // With the select tool, show which object the menu is about.
      if (tool.value === 'select') {
        c.setActiveObject(target)
        c.requestRenderAll()
      }
    }
    const fillable = objects.filter(isFillable)
    return {
      point,
      onImage,
      objects,
      fillable: fillable.length > 0,
      filled: fillable.length > 0 && fillable.every((o) => o.fill !== 'transparent'),
      measurement: objects.length === 1 && isMeasure(objects[0]) ? objects[0] : null
    }
  }

  function setScale(value: number | null): void {
    micronsPerPixel.value = value
    const c = canvas
    if (!c) return
    for (const obj of c.getObjects()) if (isMeasure(obj)) relabel(obj, value)
    c.requestRenderAll()
    // No undo step of its own (undoing would only seem to do nothing – labels follow the scale);
    // the current state just shows the new labels.
    history.replace(snapshot())
    syncState()
  }

  function addTextAt(point: XY): void {
    if (!canvas) return
    if (tool.value !== 'text') {
      toolBeforeText = tool.value
      tool.value = 'text'
    }
    addText(point)
  }

  function setFilled(objects: FabricObject[], filled: boolean): void {
    restyle(objects.filter(isFillable), { filled })
  }

  function selectObjects(objects: FabricObject[]): void {
    const c = canvas
    if (!c) return
    if (!objects.length) return finishInteraction()
    tool.value = 'select'
    applyTool() // objects become selectable right away, not only after the tool watcher
    select(objects)
    syncState()
  }

  function selectAll(): void {
    const c = canvas
    if (c?.getObjects().length) selectObjects(c.getObjects())
  }

  // ── Copy, paste and arrange ───────────────────────────────────────────────────

  /** `objects` as saved, in their stacking order. */
  function serializedOf(objects: FabricObject[]): Record<string, unknown>[] {
    const all = canvas?.getObjects() ?? []
    const data = serialized()
    return all.flatMap((o, i) => (objects.includes(o) ? [data[i]] : []))
  }

  const selection = (): FabricObject[] => canvas?.getActiveObjects() ?? []

  function copyObjects(objects = selection()): boolean {
    const data = serializedOf(objects)
    if (!data.length) return false
    shapeClipboard = { objects: data, pastes: 0 }
    clipboardFilled.value = true
    return true
  }

  function cutSelection(): boolean {
    const objects = selection()
    if (!copyObjects(objects)) return false
    removeObjects(objects)
    return true
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

  /**
   * Adds the objects in `data` and selects them (with the select tool, so they can be moved on
   * right away). `place` gets their bounding box and returns how far to move them.
   */
  function insert(
    data: Record<string, unknown>[],
    place: (box: { left: number; top: number; width: number; height: number }) => XY
  ): Promise<void> {
    const c = canvas
    if (!c || !data.length) return Promise.resolve()
    restoreQueue = restoreQueue.then(async () => {
      const copies = prepareLoaded(await util.enlivenObjects<FabricObject>(data))
      if (canvas !== c) return // another image was opened meanwhile
      const offset = place(util.makeBoundingBoxFromPoints(copies.flatMap((o) => o.getCoords())))
      for (const obj of copies) {
        obj.set({ left: obj.left + offset.x, top: obj.top + offset.y })
        obj.setCoords()
      }
      c.add(...copies)
      tool.value = 'select'
      applyTool()
      select(copies)
      commit()
    })
    return restoreQueue
  }

  function paste(at?: XY): Promise<void> {
    const copied = shapeClipboard
    if (!copied) return Promise.resolve()
    const step = PASTE_OFFSET * unit * ++copied.pastes
    return insert(copied.objects, (box) =>
      at
        ? { x: at.x - box.left - box.width / 2, y: at.y - box.top - box.height / 2 }
        : { x: step, y: step }
    )
  }

  function duplicate(objects = selection()): Promise<void> {
    const step = PASTE_OFFSET * unit
    return insert(serializedOf(objects), () => ({ x: step, y: step }))
  }

  /** The state after the last arrow key press – a quick further press updates it. */
  let nudged: { state: string; at: number } | null = null

  function nudgeSelection(dx: number, dy: number): boolean {
    const c = canvas
    const active = c?.getActiveObject()
    if (!c || !active || isEditingText()) return false
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
    if (!c) return
    // In stacking order, so the objects keep their order among themselves.
    const ordered = c.getObjects().filter((o) => objects.includes(o))
    if (!ordered.length) return
    if (where === 'front') for (const obj of ordered) c.bringObjectToFront(obj)
    else for (const obj of ordered.reverse()) c.sendObjectToBack(obj)
    c.requestRenderAll()
    commit()
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

  function drawShapes(specs: ShapeSpec[]): FabricObject[] {
    const c = canvas
    if (!c || !specs.length) return []
    const shapes = specs.map(shapeFrom)
    c.add(...shapes)
    applyTool() // selectable or not, like everything else with the current tool
    c.requestRenderAll()
    commit()
    return shapes
  }

  const round = (value: number, digits = 0): number =>
    Math.round(value * 10 ** digits) / 10 ** digits

  function describeObjects(): DrawnObject[] {
    const c = canvas
    if (!c) return []
    const selected = c.getActiveObjects()
    return c.getObjects().map((obj, index) => {
      const kind = kindOf(obj) ?? null
      const { left, top, width, height } = obj.getBoundingRect()
      const stroke = isMeasure(obj) ? measureLine(obj) : obj
      const info: DrawnObject = {
        index,
        kind,
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
    if (!c || !objects.length) return
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

  function clearAll(): void {
    const c = canvas
    if (!c || !c.getObjects().length) return
    c.discardActiveObject()
    c.remove(...c.getObjects())
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

  /** Renders background + drawing at the original image resolution. */
  async function exportImage(mime = 'image/png', quality?: number): Promise<Uint8Array> {
    const c = canvas
    if (!c) throw new Error('Kein Bild geladen')
    finishInteraction()
    // The tiny epsilon prevents floating point errors from cutting off the last pixel row.
    // The whole image, wherever the view is zoomed or panned to: it starts at the translation.
    const [, , , , left, top] = c.viewportTransform
    const out = c.toCanvasElement(1 / zoom, {
      left,
      top,
      width: size.width * zoom + 1e-6,
      height: size.height * zoom + 1e-6
    })
    return canvasToBytes(out, mime, quality)
  }

  function exportDocument(): EditorDocument {
    const state = JSON.parse(snapshot()) as Pick<EditorDocument, 'adjustments' | 'objects'>
    return {
      version: 1,
      width: size.width,
      height: size.height,
      objects: state.objects,
      ...(adjustments.length ? { adjustments: state.adjustments } : {}),
      ...(micronsPerPixel.value ? { micronsPerPixel: micronsPerPixel.value } : {})
    }
  }

  /**
   * The state that was saved – not the current one, which may have changed while the file was
   * being written.
   */
  function markSaved(document: EditorDocument): void {
    initialSnapshot = stateOf(document.adjustments ?? [], document.objects)
    initialScale = document.micronsPerPixel ?? null
    syncState()
  }

  async function dispose(): Promise<void> {
    ready.value = false
    const c = canvas
    canvas = null
    original = shown = null
    updatePreview()
    rendered.clear()
    adjustments = []
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
    previewUrl,
    adjustmentCount,
    viewVersion,
    load,
    setViewZoom: (value: number) => setViewZoom(value),
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
    canPaste: clipboardFilled,
    copyObjects,
    cutSelection,
    paste,
    duplicate,
    nudgeSelection,
    arrange,
    objects: () => canvas?.getObjects() ?? [],
    describeObjects,
    drawShapes,
    selectObjects,
    moveObjects,
    setView,
    adjustments: () => adjustments,
    adjustImage,
    resetImage,
    setLocked,
    picture: () => shown,
    sceneToClient,
    clientToScene,
    settled: () => restoreQueue,
    isEditingText,
    finishInteraction,
    exportImage,
    exportDocument,
    markSaved,
    dispose
  }
}
