import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import {
  ActiveSelection,
  Canvas,
  FabricImage,
  IText,
  PencilBrush,
  util,
  type FabricObject,
  type TPointerEvent,
  type TPointerEventInfo,
  type XY
} from 'fabric'
import type { EditorDocument } from '@shared/types'
import { CanvasHistory } from '@/editor/history'
import { CUSTOM_PROPS, createShape, kindOf, tag } from '@/editor/shapes'
import { isShapeTool, type DrawStyle, type Tool } from '@/editor/tools'
import { canvasToBytes, withAlpha } from '@/lib/image'

/** Style values are defined for a 1920px wide image and scaled to the actual image size. */
const REFERENCE_SIZE = 1920
const HIGHLIGHTER_ALPHA = 0.4
const HIGHLIGHTER_WIDTH_FACTOR = 3
const TEXT_FONT = '"Geist Variable", sans-serif'

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
  url: string
  width: number
  height: number
  document: EditorDocument | null
}

export type StyleChange = 'color' | 'strokeWidth' | 'fontSize'

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
  /** True if the drawing differs from the last loaded/saved state. */
  dirty: Ref<boolean>
  load(options: LoadImageOptions): Promise<void>
  undo(): void
  redo(): void
  deleteSelection(): void
  clearAll(): void
  applyStyleToSelection(change: StyleChange): void
  /** Looks at what is under the pointer of a (context menu) mouse event. */
  inspectAt(e: MouseEvent): CanvasSpot
  /** Adds a text at `point` and starts typing; the previous tool returns when the text is done. */
  addTextAt(point: XY): void
  /** Fills rectangles / ellipses among `objects` in their stroke colour, or removes the fill. */
  setFilled(objects: FabricObject[], filled: boolean): void
  removeObjects(objects: FabricObject[]): void
  /** Selects every object (switches to the select tool). */
  selectAll(): void
  isEditingText(): boolean
  finishInteraction(): void
  exportImage(mime?: string, quality?: number): Promise<Uint8Array>
  exportDocument(): EditorDocument
  markSaved(): void
  dispose(): Promise<void>
}

export function useDrawingCanvas({ host, tool, style }: UseDrawingCanvasOptions): DrawingCanvas {
  let canvas: Canvas | null = null
  let size = { width: 0, height: 0 }
  let unit = 1
  let zoom = 1
  const history = new CanvasHistory()
  let initialSnapshot = '[]'
  let restoreQueue: Promise<void> = Promise.resolve()

  // Interaction state
  let draft: { from: XY; object: FabricObject | null } | null = null
  let erasing = false
  let erased = false
  let textWasEditing = false
  /** Tool to return to when a text added from the context menu is done. */
  let toolBeforeText: Tool | null = null

  const ready = ref(false)
  const canUndo = ref(false)
  const canRedo = ref(false)
  const hasSelection = ref(false)
  const isEmpty = ref(true)
  const dirty = ref(false)

  const snapshot = (): string =>
    JSON.stringify(canvas?.getObjects().map((o) => o.toObject(CUSTOM_PROPS)) ?? [])

  function syncState(): void {
    canUndo.value = history.canUndo
    canRedo.value = history.canRedo
    isEmpty.value = (canvas?.getObjects().length ?? 0) === 0
    dirty.value = history.current !== initialSnapshot
    hasSelection.value = (canvas?.getActiveObjects().length ?? 0) > 0
  }

  const isFillable = (obj: FabricObject): boolean => {
    const kind = kindOf(obj)
    return kind === 'rect' || kind === 'ellipse'
  }

  function commit(): void {
    if (history.push(snapshot())) syncState()
  }

  // ── Sizing ──────────────────────────────────────────────────────────────────

  function fit(): void {
    const el = host.value
    if (!canvas || !el || !size.width) return
    zoom = Math.min(el.clientWidth / size.width, el.clientHeight / size.height)
    canvas.setDimensions({
      width: Math.max(1, Math.floor(size.width * zoom)),
      height: Math.max(1, Math.floor(size.height * zoom))
    })
    canvas.setZoom(zoom)
    canvas.requestRenderAll()
  }

  useResizeObserver(host, fit)

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

  /** Applies a changed style setting to the currently selected objects. */
  function applyStyleToSelection(change: StyleChange): void {
    const c = canvas
    if (!c) return
    const objects = c.getActiveObjects()
    if (!objects.length) return
    const { color, fontSize } = style.value

    for (const obj of objects) {
      const kind = kindOf(obj)
      if (change === 'color') {
        if (kind === 'text') obj.set('fill', color)
        else if (kind === 'highlighter') obj.set('stroke', withAlpha(color, HIGHLIGHTER_ALPHA))
        else if (kind === 'arrow') obj.set({ stroke: color, fill: color })
        else if (kind === 'rect' || kind === 'ellipse') {
          obj.set({ stroke: color, ...(obj.fill !== 'transparent' ? { fill: color } : {}) })
        } else obj.set('stroke', color)
      } else if (change === 'strokeWidth' && kind && kind !== 'text') {
        obj.set(
          'strokeWidth',
          sceneStroke() * (kind === 'highlighter' ? HIGHLIGHTER_WIDTH_FACTOR : 1)
        )
      } else if (change === 'fontSize' && kind === 'text') {
        obj.set('fontSize', fontSize * unit)
      }
      obj.setCoords()
    }
    c.requestRenderAll()
    commit()
  }

  // ── Pointer interaction ─────────────────────────────────────────────────────

  function addText(at: XY, e?: TPointerEvent): void {
    const c = canvas!
    const text = tag(
      new IText('', {
        left: at.x,
        top: at.y,
        // Anchor top-left so the text grows to the right while typing.
        originX: 'left',
        originY: 'top',
        fontFamily: TEXT_FONT,
        fontWeight: 600,
        fontSize: style.value.fontSize * unit,
        fill: style.value.color,
        cursorColor: style.value.color,
        editingBorderColor: '#3b82f6'
      }),
      'text'
    )
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
    const t = tool.value
    if (isShapeTool(t)) {
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
    if (draft && isShapeTool(t)) {
      if (draft.object) c.remove(draft.object)
      draft.object = createShape(
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
        // Discard accidental clicks that produced (almost) nothing.
        const { width, height } = obj.getBoundingRect()
        if (Math.max(width, height) < 4) c.remove(obj)
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
    c.on('text:editing:exited', ({ target }) => {
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

  async function load({ url, width, height, document }: LoadImageOptions): Promise<void> {
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
    size = { width, height }
    unit = Math.max(width, height) / REFERENCE_SIZE
    // Bind before adding saved objects so they get the same control style as new ones.
    bindEvents(c)

    const background = await FabricImage.fromURL(url)
    background.set({ left: width / 2, top: height / 2, selectable: false, evented: false })
    c.backgroundImage = background

    if (document?.objects.length) {
      const objects = await util.enlivenObjects<FabricObject>(document.objects)
      c.add(...objects)
    }

    initialSnapshot = snapshot()
    history.reset(initialSnapshot)
    fit()
    applyTool()
    syncState()
    ready.value = true
  }

  function restore(state: string | null): void {
    if (state === null) return
    restoreQueue = restoreQueue.then(async () => {
      const c = canvas
      if (!c) return
      const objects = await util.enlivenObjects<FabricObject>(JSON.parse(state))
      c.discardActiveObject()
      c.remove(...c.getObjects())
      c.add(...objects)
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
    if (!c) return { point, onImage, objects: [], fillable: false, filled: false }

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
      filled: fillable.length > 0 && fillable.every((o) => o.fill !== 'transparent')
    }
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
    const targets = objects.filter(isFillable)
    if (!targets.length) return
    for (const obj of targets) obj.set('fill', filled ? (obj.stroke as string) : 'transparent')
    canvas?.requestRenderAll()
    commit()
  }

  function selectAll(): void {
    const c = canvas
    if (!c || !c.getObjects().length) return
    tool.value = 'select'
    applyTool() // objects become selectable right away, not only after the tool watcher
    c.discardActiveObject()
    const objects = c.getObjects()
    const selection =
      objects.length === 1
        ? objects[0]
        : new ActiveSelection(objects, { canvas: c, ...CONTROL_STYLE })
    c.setActiveObject(selection)
    c.requestRenderAll()
    syncState()
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
    const out = c.toCanvasElement(1 / zoom, {
      width: size.width * zoom + 1e-6,
      height: size.height * zoom + 1e-6
    })
    return canvasToBytes(out, mime, quality)
  }

  function exportDocument(): EditorDocument {
    return { version: 1, width: size.width, height: size.height, objects: JSON.parse(snapshot()) }
  }

  /** Marks the current state as saved. */
  function markSaved(): void {
    initialSnapshot = snapshot()
    syncState()
  }

  async function dispose(): Promise<void> {
    ready.value = false
    const c = canvas
    canvas = null
    draft = null
    erasing = false
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
    isEditingText,
    finishInteraction,
    exportImage,
    exportDocument,
    markSaved,
    dispose
  }
}
