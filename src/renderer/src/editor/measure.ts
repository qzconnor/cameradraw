import { FabricText, Group, Path, type FabricObject, type XY } from 'fabric'
import { kindOf, tag } from './shapes'

/** Label size in image pixels of a 1920 px wide image (scaled like the other style values). */
const LABEL_SIZE = 28
const LABEL_FONT = '"Geist Variable", sans-serif'
/** Readable on any picture: white on a dark band. */
const LABEL_FILL = '#ffffff'
const LABEL_BACKGROUND = 'rgba(0, 0, 0, 0.6)'

export interface MeasureStyle {
  color: string
  /** Stroke width in image pixels. */
  strokeWidth: number
  /** Image pixels per reference pixel (image size / 1920). */
  unit: number
}

const decimal = (digits: number): Intl.NumberFormat =>
  new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits })

/**
 * `523 px` without a scale; with one `45,2 µm`, `523 µm`, `1,23 mm` or `12,3 mm` – as many digits
 * as make sense for the size.
 */
export function formatLength(pixels: number, micronsPerPixel: number | null): string {
  if (!micronsPerPixel) return `${Math.round(pixels)} px`
  const microns = pixels * micronsPerPixel
  if (microns < 100) return `${decimal(1).format(microns)} µm`
  if (microns < 1000) return `${Math.round(microns)} µm`
  const mm = microns / 1000
  return `${decimal(mm < 10 ? 2 : 1).format(mm)} mm`
}

const SCALE_FORMAT = new Intl.NumberFormat('de-DE', { maximumSignificantDigits: 4 })

/** `1 px = 2,483 µm`, `1 px = 10,99 µm` – four digits, whatever the size. */
export function formatScale(micronsPerPixel: number): string {
  return `1 px = ${SCALE_FORMAT.format(micronsPerPixel)} µm`
}

/**
 * A measuring line from `from` to `to`: the line with short end ticks and its length above the
 * middle. Grouped, so it moves as one; it is not scaled or rotated (that would change the length
 * it shows).
 */
export function createMeasure(
  from: XY,
  to: XY,
  style: MeasureStyle,
  micronsPerPixel: number | null
): Group {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  // Unit normal, pointing upwards so the label sits above the line.
  let nx = length ? -dy / length : 0
  let ny = length ? dx / length : -1
  if (ny > 0) {
    nx = -nx
    ny = -ny
  }
  const tick = Math.max(style.strokeWidth * 3, 10 * style.unit)
  const line = new Path(
    `M ${from.x} ${from.y} L ${to.x} ${to.y} ` +
      `M ${from.x + nx * tick} ${from.y + ny * tick} L ${from.x - nx * tick} ${from.y - ny * tick} ` +
      `M ${to.x + nx * tick} ${to.y + ny * tick} L ${to.x - nx * tick} ${to.y - ny * tick}`,
    {
      fill: 'transparent',
      stroke: style.color,
      strokeWidth: style.strokeWidth,
      strokeUniform: true,
      strokeLineCap: 'round'
    }
  )
  const fontSize = LABEL_SIZE * style.unit
  const offset = tick + fontSize * 0.7
  const label = new FabricText(labelText(length, micronsPerPixel), {
    left: (from.x + to.x) / 2 + nx * offset,
    top: (from.y + to.y) / 2 + ny * offset,
    originX: 'center',
    originY: 'center',
    fontFamily: LABEL_FONT,
    fontWeight: 600,
    fontSize,
    fill: LABEL_FILL,
    backgroundColor: LABEL_BACKGROUND
  })
  const group = lockMeasure(new Group([line, label]))
  group.set('cdLength', length)
  return tag(group, 'measure')
}

/**
 * Movable, but never scaled or rotated – that would change the length it shows. (Not serialized,
 * so set again after loading.)
 */
export function lockMeasure(group: Group): Group {
  group.set({ hasControls: false, lockScalingX: true, lockScalingY: true, lockRotation: true })
  return group
}

/** Thin spaces give the dark band a little room around the text. */
const THIN_SPACE = String.fromCharCode(0x2009)
const labelText = (pixels: number, micronsPerPixel: number | null): string =>
  `${THIN_SPACE}${formatLength(pixels, micronsPerPixel)}${THIN_SPACE}`

export const isMeasure = (obj: FabricObject): obj is Group => kindOf(obj) === 'measure'

/** Length of a measuring line in image pixels. */
export const measuredLength = (obj: FabricObject): number =>
  (obj as FabricObject & { cdLength?: number }).cdLength ?? 0

const parts = (group: Group): { line?: Path; label?: FabricText } => ({
  line: group.getObjects().find((o): o is Path => o instanceof Path),
  label: group.getObjects().find((o): o is FabricText => o instanceof FabricText)
})

/** Shows the length with another scale (e.g. after calibrating). */
export function relabel(group: Group, micronsPerPixel: number | null): void {
  const { label } = parts(group)
  if (!label) return
  label.set('text', labelText(measuredLength(group), micronsPerPixel))
  group.triggerLayout()
}

/** Colour and stroke width of the line; the label stays white on dark. */
export function restyleMeasure(group: Group, change: Partial<Omit<MeasureStyle, 'unit'>>): void {
  const { line } = parts(group)
  if (!line) return
  if (change.color) line.set('stroke', change.color)
  if (change.strokeWidth) line.set('strokeWidth', change.strokeWidth)
  group.triggerLayout()
}
