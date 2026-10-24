import { Circle, FabricText, Group, Path, Point, type FabricObject, type XY } from 'fabric'
import { kindOf, tag } from './shapes'

/**
 * Numbered markers: a filled circle with a number (or any short label) – optionally with a line to
 * the spot it marks, so the circle does not cover it. Grouped, so it moves as one; like a measuring
 * line it is not scaled or rotated – its size follows the toolbar's size.
 */

const MARKER_FONT = '"Geist Variable", sans-serif'
/** Radius per size of the number: a 48 px number sits in a 72 px wide circle. */
const RADIUS = 0.75
/** Room around a longer label (share of the size) – "12" and "3a" still fit, wider ones grow. */
const LABEL_PADDING = 0.3
/** Outline of the circle, so it stands out on a picture of the same colour. */
const OUTLINE = 0.07
/** Width of the line to the spot, and the dot at its end. */
const LINE = 0.08
const DOT = 1.8
/** Digits sit a little above the middle of their text box. */
const BASELINE_SHIFT = 0.04

const DARK = '#171717'
const LIGHT = '#ffffff'

export interface MarkerStyle {
  color: string
  /** Size of the number in image pixels. */
  fontSize: number
}

/** The number in white on dark colours, in black on light ones (yellow, white). */
function contrastOf(color: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color)
  if (!m) return LIGHT
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? DARK : LIGHT
}

/** Radius of the circle of a marker with a short label (image pixels). */
export const markerRadius = (fontSize: number): number => fontSize * RADIUS

/** Radius of the circle around `text`: the usual size, larger for a wide label. */
const radiusFor = (text: FabricText, fontSize: number): number =>
  Math.max(markerRadius(fontSize), text.width / 2 + fontSize * LABEL_PADDING)

/**
 * A marker with `label` centred at `at`; with `tip`, a line leads from it to that spot (ending in
 * a dot there).
 */
export function createMarker(at: XY, label: string, style: MarkerStyle, tip?: XY | null): Group {
  const { color, fontSize } = style
  const ink = contrastOf(color)
  const text = new FabricText(label, {
    left: at.x,
    top: at.y - fontSize * BASELINE_SHIFT,
    originX: 'center',
    originY: 'center',
    fontFamily: MARKER_FONT,
    fontWeight: 700,
    fontSize,
    fill: ink
  })
  const circle = new Circle({
    left: at.x,
    top: at.y,
    radius: radiusFor(text, fontSize),
    fill: color,
    stroke: ink,
    strokeWidth: fontSize * OUTLINE
  })
  const parts: FabricObject[] = []
  if (tip) {
    const width = fontSize * LINE
    parts.push(
      new Path(`M ${tip.x} ${tip.y} L ${at.x} ${at.y}`, {
        fill: 'transparent',
        stroke: color,
        strokeWidth: width,
        strokeLineCap: 'round'
      }),
      new Circle({ left: tip.x, top: tip.y, radius: width * DOT, fill: color, strokeWidth: 0 })
    )
  }
  parts.push(circle, text)
  const group = lockMarker(new Group(parts))
  return tag(group, 'marker')
}

/**
 * Movable, but never scaled or rotated – its size follows the toolbar. (Not serialized, so set
 * again after loading.)
 */
export function lockMarker(group: Group): Group {
  group.set({ hasControls: false, lockScalingX: true, lockScalingY: true, lockRotation: true })
  return group
}

export const isMarker = (obj: FabricObject): obj is Group => kindOf(obj) === 'marker'

interface Parts {
  line?: Path
  dot?: Circle
  circle?: Circle
  text?: FabricText
}

function parts(group: Group): Parts {
  const objects = group.getObjects()
  const circles = objects.filter((o): o is Circle => o instanceof Circle)
  return {
    line: objects.find((o): o is Path => o instanceof Path),
    // With a line the dot comes first; the circle is always the last one, under the text.
    dot: circles.length > 1 ? circles[0] : undefined,
    circle: circles.at(-1),
    text: objects.find((o): o is FabricText => o instanceof FabricText)
  }
}

export const markerLabel = (group: Group): string => parts(group).text?.text ?? ''

/** Colour of the circle. */
export const markerColor = (group: Group): string => String(parts(group).circle?.fill ?? '')

/** Size of the number in image pixels. */
export const markerSize = (group: Group): number => parts(group).text?.fontSize ?? 0

/** Middle of the circle and the spot its line leads to (null without one), in image pixels. */
export function markerGeometry(group: Group): { at: XY; tip: XY | null } {
  const { circle, dot } = parts(group)
  const at = circle?.getCenterPoint() ?? group.getCenterPoint()
  const tip = dot?.getCenterPoint() ?? null
  return { at: { x: at.x, y: at.y }, tip: tip && { x: tip.x, y: tip.y } }
}

/** Changes colour, size or label in place – the circle stays where it is, the line on its spot. */
export function restyleMarker(
  group: Group,
  change: { color?: string; fontSize?: number; label?: string }
): void {
  const { line, dot, circle, text } = parts(group)
  if (!circle || !text) return
  const color = change.color ?? String(circle.fill)
  const fontSize = change.fontSize ?? text.fontSize
  const ink = contrastOf(color)
  // The text keeps its middle; it moves only by the shift of its baseline.
  const at = circle.getRelativeCenterPoint()
  text.set({ fontSize, fill: ink, ...(change.label !== undefined ? { text: change.label } : {}) })
  text.setPositionByOrigin(new Point(at.x, at.y - fontSize * BASELINE_SHIFT), 'center', 'center')
  circle.set({
    radius: radiusFor(text, fontSize),
    fill: color,
    stroke: ink,
    strokeWidth: fontSize * OUTLINE
  })
  circle.setPositionByOrigin(at, 'center', 'center')
  if (line && dot) {
    const width = fontSize * LINE
    line.set({ stroke: color, strokeWidth: width })
    const spot = dot.getRelativeCenterPoint()
    dot.set({ fill: color, radius: width * DOT })
    dot.setPositionByOrigin(spot, 'center', 'center')
  }
  group.triggerLayout()
}

/** The label of the next marker: one more than the highest number so far, 1 for the first. */
export function nextMarkerLabel(objects: FabricObject[]): string {
  let highest = 0
  for (const obj of objects) {
    if (!isMarker(obj)) continue
    const n = parseInt(markerLabel(obj), 10)
    if (Number.isFinite(n) && n > highest) highest = n
  }
  return String(highest + 1)
}
