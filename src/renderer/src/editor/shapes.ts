import { Ellipse, Path, Rect, type FabricObject, type XY } from 'fabric'
import type { ShapeTool } from './tools'

/** Marker stored on every drawn object so style changes know how to apply. */
export type ObjectKind =
  'pen' | 'highlighter' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'measure'

/** Custom properties that must survive serialization (`cdLength`: see `editor/measure.ts`). */
export const CUSTOM_PROPS = ['cdKind', 'cdLength']

export interface ShapeStyle {
  color: string
  /** Stroke width in image pixels. */
  strokeWidth: number
  filled: boolean
}

const strokeProps = (style: ShapeStyle) =>
  ({
    stroke: style.color,
    strokeWidth: style.strokeWidth,
    strokeUniform: true,
    strokeLineCap: 'round',
    strokeLineJoin: 'round'
  }) as const

/** Snaps the end point to 45° steps (Shift while drawing lines/arrows). */
export function snapAngle(from: XY, to: XY): XY {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length }
}

/** Forces equal width and height (Shift while drawing rectangles/ellipses). */
function squareEnd(from: XY, to: XY): XY {
  const size = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))
  return {
    x: from.x + Math.sign(to.x - from.x || 1) * size,
    y: from.y + Math.sign(to.y - from.y || 1) * size
  }
}

function arrowPath(from: XY, to: XY, strokeWidth: number): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  const head = Math.min(Math.max(strokeWidth * 3.2, 14), length * 0.6)
  const spread = Math.PI / 7
  const h1 = {
    x: to.x - head * Math.cos(angle - spread),
    y: to.y - head * Math.sin(angle - spread)
  }
  const h2 = {
    x: to.x - head * Math.cos(angle + spread),
    y: to.y - head * Math.sin(angle + spread)
  }
  // Stop the shaft inside the head so the tip stays sharp.
  const shaftEnd = {
    x: to.x - head * 0.6 * Math.cos(angle),
    y: to.y - head * 0.6 * Math.sin(angle)
  }
  return `M ${from.x} ${from.y} L ${shaftEnd.x} ${shaftEnd.y} M ${h1.x} ${h1.y} L ${to.x} ${to.y} L ${h2.x} ${h2.y} Z`
}

/**
 * Creates the shape spanned by two scene points.
 * Note: fabric 7 positions objects by their center (`left`/`top` = center point).
 */
export function createShape(
  tool: ShapeTool,
  from: XY,
  rawTo: XY,
  style: ShapeStyle,
  constrain: boolean
): FabricObject {
  const isLinear = tool === 'line' || tool === 'arrow'
  const to = constrain ? (isLinear ? snapAngle(from, rawTo) : squareEnd(from, rawTo)) : rawTo
  const center = { left: (from.x + to.x) / 2, top: (from.y + to.y) / 2 }
  const width = Math.abs(to.x - from.x)
  const height = Math.abs(to.y - from.y)
  const fill = style.filled ? style.color : 'transparent'

  switch (tool) {
    case 'rect':
      return tag(new Rect({ ...center, width, height, fill, ...strokeProps(style) }), 'rect')
    case 'ellipse':
      return tag(
        new Ellipse({ ...center, rx: width / 2, ry: height / 2, fill, ...strokeProps(style) }),
        'ellipse'
      )
    case 'line':
      return tag(
        new Path(`M ${from.x} ${from.y} L ${to.x} ${to.y}`, {
          fill: 'transparent',
          ...strokeProps(style)
        }),
        'line'
      )
    case 'arrow':
      return tag(
        new Path(arrowPath(from, to, style.strokeWidth), {
          fill: style.color,
          ...strokeProps(style)
        }),
        'arrow'
      )
  }
}

export function tag<T extends FabricObject>(obj: T, kind: ObjectKind): T {
  obj.set('cdKind', kind)
  return obj
}

export const kindOf = (obj: FabricObject): ObjectKind | undefined =>
  (obj as FabricObject & { cdKind?: ObjectKind }).cdKind
