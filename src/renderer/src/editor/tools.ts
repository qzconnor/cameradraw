import type { Component } from 'vue'
import {
  ArrowUpRightIcon,
  CircleIcon,
  EraserIcon,
  HighlighterIcon,
  MinusIcon,
  MousePointer2Icon,
  PencilIcon,
  RulerIcon,
  SquareIcon,
  TypeIcon
} from '@lucide/vue'

export type Tool =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'eraser'
  | 'measure'

export type ShapeTool = Extract<Tool, 'line' | 'arrow' | 'rect' | 'ellipse'>

export interface ToolDefinition {
  id: Tool
  label: string
  icon: Component
  /** Single-key shortcut (without modifiers). */
  shortcut: string
}

export const TOOL_GROUPS: ToolDefinition[][] = [
  [{ id: 'select', label: 'Auswählen & verschieben', icon: MousePointer2Icon, shortcut: 'V' }],
  [
    { id: 'pen', label: 'Stift', icon: PencilIcon, shortcut: 'P' },
    { id: 'highlighter', label: 'Textmarker', icon: HighlighterIcon, shortcut: 'M' },
    { id: 'eraser', label: 'Radierer', icon: EraserIcon, shortcut: 'E' }
  ],
  [
    { id: 'line', label: 'Linie', icon: MinusIcon, shortcut: 'L' },
    { id: 'arrow', label: 'Pfeil', icon: ArrowUpRightIcon, shortcut: 'A' },
    { id: 'rect', label: 'Rechteck', icon: SquareIcon, shortcut: 'R' },
    { id: 'ellipse', label: 'Ellipse', icon: CircleIcon, shortcut: 'O' }
  ],
  [{ id: 'text', label: 'Text', icon: TypeIcon, shortcut: 'T' }],
  [{ id: 'measure', label: 'Messen', icon: RulerIcon, shortcut: 'D' }]
]

export const TOOLS: ToolDefinition[] = TOOL_GROUPS.flat()

export const isShapeTool = (tool: Tool): tool is ShapeTool =>
  tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'ellipse'

/** Tools that use the stroke-width setting. */
export const usesStroke = (tool: Tool): boolean =>
  tool === 'pen' || tool === 'highlighter' || tool === 'measure' || isShapeTool(tool)

/** Tools whose shapes can be filled. */
export const usesFill = (tool: Tool): boolean => tool === 'rect' || tool === 'ellipse'

/** Drawing colors – these are content colors chosen by the user, not UI theme colors. */
export const COLOR_PRESETS = [
  '#ffffff',
  '#171717',
  '#ef4444',
  '#f97316',
  '#facc15',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ec4899'
]

export const STROKE_PRESETS = [2, 4, 8, 14, 24]
export const FONT_SIZE_PRESETS = [24, 36, 48, 72, 112]

export interface DrawStyle {
  color: string
  strokeWidth: number
  fontSize: number
  filled: boolean
}
