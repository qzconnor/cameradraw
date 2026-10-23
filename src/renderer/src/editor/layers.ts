import type {
  DrawingLayerData,
  EditorDocument,
  FillLayerData,
  ImageAdjustment,
  ImageLayerData,
  ImagePoint,
  LayerData,
  LegacyEditorDocument
} from '@shared/types'
import { sizeAfterAll, type Side, type Size } from './adjust'

/**
 * Layers of a picture: images (the frame and pictures pulled in from the gallery), plain space
 * added beside them, and drawings. The editor keeps their order and settings here; the drawn
 * objects themselves live on the canvas.
 */

/** Source of the image layer showing the original frame. */
export const BASE_SOURCE = 'base'

/** A layer as the editor keeps it: images get their place from their canvas object. */
export type LayerMeta =
  Omit<ImageLayerData, 'left' | 'top' | 'scale'> | FillLayerData | Omit<DrawingLayerData, 'objects'>

export type ImageMeta = Extract<LayerMeta, { type: 'image' }>
export type DrawingMeta = Extract<LayerMeta, { type: 'drawing' }>

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

const randomId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

export const newLayerId = randomId
/** Names the picture file of an image layer (letters and digits, see `isPictureId`). */
export const newPictureId = randomId

export const DEFAULT_DRAWING_NAME = 'Zeichnung'
export const BASE_IMAGE_NAME = 'Bild'
export const SIDE_NAMES: Record<Side, string> = {
  top: 'oben',
  right: 'rechts',
  bottom: 'unten',
  left: 'links'
}

/** `name`, or `name 2`, `name 3`, … – the first one not in `taken`. */
export function uniqueName(name: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.toLocaleLowerCase()))
  if (!used.has(name.toLocaleLowerCase())) return name
  let n = 2
  while (used.has(`${name} ${n}`.toLocaleLowerCase())) n++
  return `${name} ${n}`
}

export const drawingLayer = (name: string, owner?: 'ai'): DrawingLayerData => ({
  id: newLayerId(),
  type: 'drawing',
  name,
  visible: true,
  locked: false,
  ...(owner ? { owner } : {}),
  objects: []
})

/** The frame as the bottom layer – locked, so it is not moved by accident. */
const baseLayer = (adjustments: ImageAdjustment[]): ImageLayerData => ({
  id: newLayerId(),
  type: 'image',
  name: BASE_IMAGE_NAME,
  visible: true,
  locked: true,
  source: BASE_SOURCE,
  adjustments,
  left: 0,
  top: 0,
  scale: 1
})

/**
 * The layers of a picture: as saved, or – for a new capture and files of older versions, which
 * had one drawing on the (adjusted) frame – the frame with a drawing layer on it.
 */
export function layersOf(
  document: EditorDocument | LegacyEditorDocument | null,
  frame: Size
): EditorDocument {
  if (document?.version === 2 && Array.isArray(document.layers)) return document
  const legacy = document as LegacyEditorDocument | null
  const adjustments = legacy?.adjustments ?? []
  const { width, height } = sizeAfterAll(frame, adjustments)
  return {
    ...(legacy ?? {}),
    version: 2,
    width,
    height,
    layers: [
      baseLayer(adjustments),
      { ...drawingLayer(DEFAULT_DRAWING_NAME), objects: legacy?.objects ?? [] }
    ]
  } as EditorDocument
}

/** Strips of `color` for space added around a picture of `size` (top and bottom go across). */
export function fillsFor(
  size: Size,
  space: Record<Side, number>,
  color: string,
  taken: string[]
): FillLayerData[] {
  const width = size.width + space.left + space.right
  const height = size.height + space.top + space.bottom
  const boxes: [Side, Box][] = [
    ['top', { left: 0, top: 0, width, height: space.top }],
    ['bottom', { left: 0, top: height - space.bottom, width, height: space.bottom }],
    ['left', { left: 0, top: space.top, width: space.left, height: size.height }],
    [
      'right',
      { left: width - space.right, top: space.top, width: space.right, height: size.height }
    ]
  ]
  const names = [...taken]
  return boxes
    .filter(([side]) => space[side] > 0)
    .map(([side, box]) => {
      const name = uniqueName(`Fläche ${SIDE_NAMES[side]}`, names)
      names.push(name)
      return {
        id: newLayerId(),
        type: 'fill',
        name,
        visible: true,
        locked: true,
        color,
        ...box
      }
    })
}

export const contains = (box: Box, { x, y }: ImagePoint, slack = 0): boolean =>
  x >= box.left - slack &&
  y >= box.top - slack &&
  x <= box.left + box.width + slack &&
  y <= box.top + box.height + slack

/**
 * Where things go when the picture in `box` gets the size `width` × `height` (its top left stays):
 * what is on it follows `inside`; what lies beside it keeps its distance to its edges – beyond
 * the right or bottom edge it moves along, across from it it is spread like the edge.
 */
export function reflow(
  box: Box,
  width: number,
  height: number,
  inside: (p: ImagePoint) => ImagePoint
): { map: (p: ImagePoint) => ImagePoint; beside: (p: ImagePoint) => ImagePoint } {
  const axis = (value: number, start: number, before: number, after: number): number =>
    value <= start
      ? value
      : value >= start + before
        ? value + after - before
        : start + ((value - start) * after) / (before || 1)
  const beside = ({ x, y }: ImagePoint): ImagePoint => ({
    x: axis(x, box.left, box.width, width),
    y: axis(y, box.top, box.height, height)
  })
  return { map: (p) => (contains(box, p) ? inside(p) : beside(p)), beside }
}

/** The box spanned by two corners, whichever way round. */
export function boxOf(a: ImagePoint, b: ImagePoint): Box {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  }
}

export type { LayerData }
