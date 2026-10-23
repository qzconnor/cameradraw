import { IText, classRegistry, type ITextProps, type TOptions, type XY } from 'fabric'
import { Lexer, type Token, type Tokens } from 'marked'
import { isTextAlign, type TextAlign } from './tools'

/**
 * Texts are Markdown (GitHub flavour): drawn formatted, and as their source while they are typed.
 * Headings, bold, italic, strike-through, code, links, lists with tasks, quotes, tables, code
 * blocks and rules. A line break stays a line break and an empty line an empty line, so text
 * without Markdown looks exactly as it did before. Centred and right aligned texts line up each
 * line and table on their own; code blocks and rules span the whole text anyway.
 */

const MARKDOWN = { gfm: true, breaks: true }

// Fabric's text metrics (`_fontSizeMult`, `lineHeight`, `_fontSizeFraction`), so plain text keeps
// the lines and the size it had as a plain IText.
const LINE_BOX = 1.13
const LEADING = LINE_BOX * 0.16
const BASELINE = LINE_BOX * (1 - 0.222)

// Everything below is relative to the font size.
const BOLD = 800
const HEADING_SCALE = [1.75, 1.45, 1.2, 1.05, 1, 0.9]
const CODE_FONT = '"Cascadia Mono", Consolas, "Courier New", monospace'
const CODE_SCALE = 0.9
const CODE_SPAN_PADDING = 0.2
const CODE_BLOCK_PADDING = { x: 0.5, y: 0.3 }
const CELL_PADDING = { x: 0.45, y: 0.2 }
/** Extra space around code blocks, tables and rules. */
const BLOCK_MARGIN = 0.3
const LIST_INDENT = 1.4
const QUOTE_INDENT = 0.9
/** Thickness of underlines, strike-through and table lines (like fabric's underline). */
const THIN = 1 / 15
const UNDERLINE = 0.1
const STRIKE = 0.3
/** Backgrounds and auxiliary lines are drawn in the text colour, this transparent. */
const ALPHA = { code: 0.16, mark: 0.3, header: 0.1, grid: 0.45, quote: 0.5, rule: 0.6 }

// ── Fonts and measuring ─────────────────────────────────────────────────────────

interface Font {
  family: string
  weight: number | string
  italic: boolean
  /** Size relative to the text's font size. */
  scale: number
}

const fontString = (font: Font, size: number): string =>
  `${font.italic ? 'italic ' : ''}${font.weight} ${size * font.scale}px ${font.family}`

/** Widths are measured once at this size and scaled. */
const MEASURE_SIZE = 100
const widths = new Map<string, number>()
let measuring: CanvasRenderingContext2D | null = null

// Widths measured while a font was still loading are wrong.
document.fonts?.addEventListener('loadingdone', () => widths.clear())

function measure(text: string, font: Font, size: number): number {
  const css = fontString(font, MEASURE_SIZE)
  const key = `${css}|${text}`
  let width = widths.get(key)
  if (width === undefined) {
    measuring ??= document.createElement('canvas').getContext('2d')!
    measuring.font = css
    width = measuring.measureText(text).width
    if (widths.size > 5000) widths.clear()
    widths.set(key, width)
  }
  return (width * size) / MEASURE_SIZE
}

let decoder: HTMLTextAreaElement | null = null

/** `&amp;`, `&lt;` … as the characters they stand for (Markdown leaves them to HTML). */
function decode(text: string): string {
  if (!text.includes('&')) return text
  // A textarea's content is plain text – nothing in it is parsed as HTML.
  decoder ??= document.createElement('textarea')
  decoder.innerHTML = text
  return decoder.value
}

// ── Inline content ──────────────────────────────────────────────────────────────

interface Style {
  bold?: boolean
  italic?: boolean
  strike?: boolean
  underline?: boolean
  code?: boolean
  mark?: boolean
}

interface Piece {
  text: string
  style: Style
}

/** Text in its style, or a line break. */
type Inline = Piece | 'break'

/** HTML tags that style text the Markdown way – any other tag is left out. */
const HTML_STYLES: Record<string, keyof Style> = {
  b: 'bold',
  strong: 'bold',
  i: 'italic',
  em: 'italic',
  u: 'underline',
  ins: 'underline',
  s: 'strike',
  del: 'strike',
  strike: 'strike',
  code: 'code',
  kbd: 'code',
  mark: 'mark'
}
const HTML_TAG = /<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9-]*)\b[^>]*?(\/?)>/gi

const STYLE_KEYS: (keyof Style)[] = ['bold', 'italic', 'strike', 'underline', 'code', 'mark']
const sameStyle = (a: Style, b: Style): boolean => STYLE_KEYS.every((key) => !a[key] === !b[key])

/** The inline content of `tokens` as styled pieces and line breaks. */
function inline(tokens: Token[], base: Style = {}): Inline[] {
  const out: Inline[] = []
  /** HTML tags opened and not closed yet. */
  const open: Partial<Record<keyof Style, number>> = {}

  function add(text: string, style: Style): void {
    const styled = { ...style }
    for (const key of STYLE_KEYS) if (open[key]) styled[key] = true
    text.split('\n').forEach((part, i) => {
      if (i) out.push('break')
      if (part) out.push({ text: part, style: styled })
    })
  }

  function html(source: string, style: Style): void {
    let last = 0
    for (const match of source.matchAll(HTML_TAG)) {
      add(decode(source.slice(last, match.index)), style)
      last = match.index + match[0].length
      const [, closing, name, selfClosing] = match
      const tag = name?.toLowerCase()
      if (tag === 'br') out.push('break')
      else if (tag && HTML_STYLES[tag] && !selfClosing) {
        const key = HTML_STYLES[tag]
        open[key] = Math.max(0, (open[key] ?? 0) + (closing ? -1 : 1))
      }
    }
    add(decode(source.slice(last)), style)
  }

  function walk(list: Token[], style: Style): void {
    for (const token of list as Tokens.Generic[]) {
      const children = token.tokens ?? []
      switch (token.type) {
        case 'strong':
          walk(children, { ...style, bold: true })
          break
        case 'em':
          walk(children, { ...style, italic: true })
          break
        case 'del':
          walk(children, { ...style, strike: true })
          break
        case 'link':
          walk(children, { ...style, underline: true })
          break
        case 'codespan':
          add(token.text, { ...style, code: true })
          break
        // There is no picture to show, only its description.
        case 'image':
          add(decode(token.text), { ...style, italic: true })
          break
        case 'br':
          out.push('break')
          break
        case 'html':
          html(token.text, style)
          break
        case 'checkbox':
        case 'space':
        case 'def':
          break
        default:
          if (children.length) walk(children, style)
          else if (typeof token.text === 'string') add(decode(token.text), style)
      }
    }
  }

  walk(tokens, base)
  return out
}

function splitLines(items: Inline[]): Piece[][] {
  const lines: Piece[][] = [[]]
  for (const item of items) {
    if (item === 'break') lines.push([])
    else lines[lines.length - 1].push(item)
  }
  return lines
}

interface Run {
  text: string
  style: Style
  font: Font
  /** Start of the text in the line (code has some room before it). */
  x: number
  width: number
}

interface MeasuredLine {
  runs: Run[]
  width: number
}

function fontFor(style: Style, base: Font): Font {
  if (style.code) {
    return {
      family: CODE_FONT,
      weight: style.bold ? 'bold' : 'normal',
      italic: !!style.italic,
      scale: CODE_SCALE
    }
  }
  return { ...base, weight: style.bold ? BOLD : base.weight, italic: !!style.italic }
}

function measureLine(pieces: Piece[], size: number, base: Font): MeasuredLine {
  const merged: Piece[] = []
  for (const piece of pieces) {
    const last = merged[merged.length - 1]
    if (last && sameStyle(last.style, piece.style)) last.text += piece.text
    else merged.push({ ...piece })
  }
  let x = 0
  const runs = merged.map(({ text, style }): Run => {
    const font = fontFor(style, base)
    const padding = style.code ? CODE_SPAN_PADDING * size : 0
    const width = measure(text, font, size)
    const run = { text, style, font, x: x + padding, width }
    x += width + 2 * padding
    return run
  })
  return { runs, width: x }
}

// ── Blocks ──────────────────────────────────────────────────────────────────────

/** Drawing steps in text coordinates (0,0 = top left), all in the text colour. */
export type MarkdownOp =
  | { type: 'text'; x: number; y: number; text: string; font: string; alpha?: number }
  | {
      type: 'fill'
      x: number
      y: number
      width: number
      height: number
      radius: number
      alpha?: number
    }
  | { type: 'stroke'; points: XY[]; width: number; closed?: boolean; alpha?: number }
  | { type: 'dot'; x: number; y: number; radius: number; ring?: number; alpha?: number }

type FillOp = Extract<MarkdownOp, { type: 'fill' }>

function shiftOp(op: MarkdownOp, dx: number): void {
  if (op.type === 'stroke') op.points = op.points.map((p) => ({ x: p.x + dx, y: p.y }))
  else op.x += dx
}

export interface MarkdownLayout {
  ops: MarkdownOp[]
  width: number
  height: number
}

const newlines = (text: string): number => text.match(/\n/g)?.length ?? 0
const trailingNewlines = (text: string): number => text.match(/\n*$/)![0].length

class Layout {
  readonly ops: MarkdownOp[] = []
  /** Right edge of the content so far. */
  private right = 0
  /** Bottom of the content so far. */
  private y = 0
  /** Space owed before the next line (the leading of the line before). */
  private gap = 0
  /** Empty lines owed before the next line – none before the first or after the last. */
  private blanks = 0
  private started = false
  /** Every line and box placed, top to bottom – quotes draw their bar along them. */
  private readonly rows: { top: number; bottom: number }[] = []
  /** Boxes as wide as the whole text (code blocks, rules), each from its left edge. */
  private readonly wide: { op: FillOp; x: number }[] = []
  /** Draws a list marker next to the first line of an item, once that is placed. */
  private marker: ((baseline: number) => void) | null = null
  /** Lines and tables (their ops `from` … `to`) that line up to the right as a whole. */
  private readonly aligned: { from: number; to: number; right: number }[] = []

  constructor(
    private readonly size: number,
    private readonly font: Font,
    private readonly align: TextAlign
  ) {}

  finish(): MarkdownLayout {
    for (const { op, x } of this.wide) op.width = Math.max(op.width, this.right - x)
    const width = Math.max(this.right, 1)
    // Each into the room between its indent and the right edge of the text.
    const share = this.align === 'right' ? 1 : this.align === 'center' ? 0.5 : 0
    for (const { from, to, right } of share ? this.aligned : []) {
      const dx = (width - right) * share
      for (let i = from; i < to; i++) shiftOp(this.ops[i], dx)
    }
    return {
      ops: this.ops,
      width,
      height: this.started ? this.y : LINE_BOX * this.size
    }
  }

  blocks(tokens: Token[], x: number, depth: number): void {
    for (const token of tokens) this.block(token, x, depth)
  }

  private block(token: Token, x: number, depth: number): void {
    switch (token.type) {
      case 'space':
        this.blanks += Math.max(0, newlines(token.raw) - 1)
        break
      case 'heading': {
        const heading = token as Tokens.Heading
        const scale = HEADING_SCALE[heading.depth - 1] ?? 1
        this.paragraph(inline(heading.tokens, { bold: true }), x, this.size * scale)
        break
      }
      case 'list':
        this.list(token as Tokens.List, x, depth)
        break
      case 'blockquote':
        this.quote(token as Tokens.Blockquote, x, depth)
        break
      case 'code':
        this.code((token as Tokens.Code).text, x)
        break
      case 'hr':
        this.rule(x)
        break
      case 'table':
        this.table(token as Tokens.Table, x)
        break
      // Block HTML: its text, without the empty lines around it.
      case 'html': {
        const lines = splitLines(inline([token]))
        while (lines.length > 1 && !lines[0].length) lines.shift()
        while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop()
        if (lines.some((line) => line.length)) {
          for (const line of lines) this.line(measureLine(line, this.size, this.font), x, this.size)
        }
        break
      }
      case 'def':
      case 'checkbox':
        break
      // Paragraphs, the text of tight list items and anything else with text.
      default:
        this.paragraph(inline([token]), x, this.size)
    }
  }

  /** Where the next block starts: after the space owed (and `margin` around boxes). */
  private open(margin = 0): number {
    if (this.started) {
      this.y += this.gap + margin + this.blanks * (LINE_BOX + LEADING) * this.size
    }
    this.blanks = 0
    this.started = true
    return this.y
  }

  private close(top: number, bottom: number, gap: number): void {
    this.rows.push({ top, bottom })
    this.y = bottom
    this.gap = gap
  }

  private paragraph(items: Inline[], x: number, size: number): void {
    for (const pieces of splitLines(items)) this.line(measureLine(pieces, size, this.font), x, size)
  }

  private line(line: MeasuredLine, x: number, size: number): void {
    const top = this.open()
    // The list marker moves along with its line.
    const from = this.ops.length
    this.marker?.(top + BASELINE * size)
    this.marker = null
    this.draw(line, x, top, size)
    if (line.width) this.aligned.push({ from, to: this.ops.length, right: x + line.width })
    this.close(top, top + LINE_BOX * size, LEADING * size)
  }

  private draw(line: MeasuredLine, x: number, top: number, size: number): void {
    const baseline = top + BASELINE * size
    const back: MarkdownOp[] = []
    const front: MarkdownOp[] = []
    const thin = THIN * size
    for (const run of line.runs) {
      const left = x + run.x
      const right = left + run.width
      if (run.style.code || run.style.mark) {
        const padding = run.style.code ? CODE_SPAN_PADDING * size : 0
        back.push({
          type: 'fill',
          x: left - padding,
          y: baseline - 0.84 * size,
          width: run.width + 2 * padding,
          height: 1.08 * size,
          radius: 0.18 * size,
          alpha: run.style.code ? ALPHA.code : ALPHA.mark
        })
      }
      front.push({
        type: 'text',
        x: left,
        y: baseline,
        text: run.text,
        font: fontString(run.font, size)
      })
      if (run.style.underline) {
        const y = baseline + UNDERLINE * size
        front.push({
          type: 'stroke',
          points: [
            { x: left, y },
            { x: right, y }
          ],
          width: thin
        })
      }
      if (run.style.strike) {
        const y = baseline - STRIKE * size
        front.push({
          type: 'stroke',
          points: [
            { x: left, y },
            { x: right, y }
          ],
          width: thin
        })
      }
    }
    this.ops.push(...back, ...front)
    this.right = Math.max(this.right, x + line.width)
  }

  private list(list: Tokens.List, x: number, depth: number): void {
    const size = this.size
    const start = typeof list.start === 'number' ? list.start : 1
    const numbers = list.items.map((_, i) => `${start + i}.`)
    const indent = list.ordered
      ? Math.max(
          LIST_INDENT * size,
          ...numbers.map((n) => measure(n, this.font, size) + 0.5 * size)
        )
      : LIST_INDENT * size
    list.items.forEach((item, i) => {
      // Empty lines between the items of a loose list are at the end of the item before.
      if (i) this.blanks += Math.max(0, trailingNewlines(list.items[i - 1].raw) - 1)
      let marked = false
      this.marker = (baseline) => {
        marked = true
        if (item.task) this.checkbox(x, baseline, !!item.checked)
        else if (list.ordered) {
          const font = fontString(this.font, size)
          const width = measure(numbers[i], this.font, size)
          this.ops.push({
            type: 'text',
            x: x + indent - 0.4 * size - width,
            y: baseline,
            text: numbers[i],
            font
          })
        } else this.bullet(x, baseline, depth)
      }
      const tokens = [...item.tokens]
      while (tokens[tokens.length - 1]?.type === 'space') tokens.pop()
      this.blocks(tokens, x + indent, depth + 1)
      // An empty item still gets its marker.
      if (!marked) this.line({ runs: [], width: 0 }, x + indent, size)
    })
  }

  private bullet(x: number, baseline: number, depth: number): void {
    const size = this.size
    const cx = x + 0.5 * size
    const cy = baseline - 0.33 * size
    if (depth === 0) this.ops.push({ type: 'dot', x: cx, y: cy, radius: 0.16 * size })
    else if (depth === 1) {
      this.ops.push({ type: 'dot', x: cx, y: cy, radius: 0.14 * size, ring: 0.075 * size })
    } else {
      const half = 0.13 * size
      this.ops.push({
        type: 'fill',
        x: cx - half,
        y: cy - half,
        width: 2 * half,
        height: 2 * half,
        radius: 0
      })
    }
  }

  private checkbox(x: number, baseline: number, checked: boolean): void {
    const size = this.size
    const box = 0.72 * size
    const left = x + 0.12 * size
    const top = baseline - box
    const at = (fx: number, fy: number): XY => ({ x: left + fx * box, y: top + fy * box })
    this.ops.push({
      type: 'stroke',
      points: [at(0, 0), at(1, 0), at(1, 1), at(0, 1)],
      closed: true,
      width: 0.08 * size
    })
    if (checked) {
      this.ops.push({
        type: 'stroke',
        points: [at(0.2, 0.52), at(0.42, 0.74), at(0.8, 0.28)],
        width: 0.12 * size
      })
    }
  }

  private quote(quote: Tokens.Blockquote, x: number, depth: number): void {
    const size = this.size
    const first = this.rows.length
    this.blocks(quote.tokens, x + QUOTE_INDENT * size, depth)
    const rows = this.rows.slice(first)
    if (!rows.length) return
    const top = rows[0].top
    const bottom = rows[rows.length - 1].bottom
    this.ops.push({
      type: 'fill',
      x: x + 0.1 * size,
      y: top,
      width: 0.16 * size,
      height: bottom - top,
      radius: 0.08 * size,
      alpha: ALPHA.quote
    })
  }

  private code(text: string, x: number): void {
    const size = this.size
    const font: Font = { family: CODE_FONT, weight: 'normal', italic: false, scale: CODE_SCALE }
    const css = fontString(font, size)
    const padding = { x: CODE_BLOCK_PADDING.x * size, y: CODE_BLOCK_PADDING.y * size }
    const top = this.open(BLOCK_MARGIN * size)
    const box: FillOp = {
      type: 'fill',
      x,
      y: top,
      width: 0,
      height: 0,
      radius: 0.25 * size,
      alpha: ALPHA.code
    }
    this.ops.push(box)
    let y = top + padding.y
    text
      .replace(/\t/g, '    ')
      .split('\n')
      .forEach((row, i) => {
        if (i) y += LEADING * size
        this.ops.push({
          type: 'text',
          x: x + padding.x,
          y: y + BASELINE * size,
          text: row,
          font: css
        })
        box.width = Math.max(box.width, measure(row, font, size) + 2 * padding.x)
        y += LINE_BOX * size
      })
    box.height = y + padding.y - top
    this.wide.push({ op: box, x })
    this.right = Math.max(this.right, x + box.width)
    this.close(top, top + box.height, (LEADING + BLOCK_MARGIN) * size)
  }

  private rule(x: number): void {
    const size = this.size
    const top = this.open(BLOCK_MARGIN * size)
    const height = LINE_BOX * size
    const thickness = 0.08 * size
    const bar: FillOp = {
      type: 'fill',
      x,
      y: top + (height - thickness) / 2,
      width: 3 * size,
      height: thickness,
      radius: thickness / 2,
      alpha: ALPHA.rule
    }
    this.ops.push(bar)
    this.wide.push({ op: bar, x })
    this.right = Math.max(this.right, x + bar.width)
    this.close(top, top + height, (LEADING + BLOCK_MARGIN) * size)
  }

  private table(table: Tokens.Table, x: number): void {
    const size = this.size
    const padding = { x: CELL_PADDING.x * size, y: CELL_PADDING.y * size }
    const lineAdvance = (LINE_BOX + LEADING) * size
    const rows = [table.header, ...table.rows].map((cells, r) =>
      cells.map((cell) =>
        splitLines(inline(cell.tokens, r === 0 ? { bold: true } : {})).map((pieces) =>
          measureLine(pieces, size, this.font)
        )
      )
    )
    const columns = table.header.map((_, c) =>
      Math.max(...rows.map((row) => Math.max(0, ...(row[c] ?? []).map((line) => line.width))))
    )
    const widths = columns.map((width) => width + 2 * padding.x)
    const heights = rows.map(
      (row) =>
        Math.max(1, ...row.map((lines) => lines.length)) * lineAdvance -
        LEADING * size +
        2 * padding.y
    )
    const width = widths.reduce((sum, w) => sum + w, 0)
    const top = this.open(BLOCK_MARGIN * size)
    const from = this.ops.length
    this.ops.push({
      type: 'fill',
      x,
      y: top,
      width,
      height: heights[0],
      radius: 0,
      alpha: ALPHA.header
    })

    let y = top
    rows.forEach((row, r) => {
      let left = x
      row.forEach((lines, c) => {
        const align = table.align[c]
        lines.forEach((line, i) => {
          const free = widths[c] - 2 * padding.x - line.width
          const offset = align === 'right' ? free : align === 'center' ? free / 2 : 0
          this.draw(line, left + padding.x + offset, y + padding.y + i * lineAdvance, size)
        })
        left += widths[c]
      })
      y += heights[r]
    })

    // The grid – its outer lines just inside the table's box.
    const thin = THIN * size
    const inside = (value: number, min: number, max: number): number =>
      Math.min(Math.max(value, min + thin / 2), max - thin / 2)
    const edges = (start: number, sizes: number[]): number[] =>
      sizes.reduce((list, s) => [...list, list[list.length - 1] + s], [start])
    const [left, right] = [inside(x, x, x + width), inside(x + width, x, x + width)]
    const [upper, lower] = [inside(top, top, y), inside(y, top, y)]
    for (const edge of edges(top, heights)) {
      const at = inside(edge, top, y)
      this.ops.push({
        type: 'stroke',
        points: [
          { x: left, y: at },
          { x: right, y: at }
        ],
        width: thin,
        alpha: ALPHA.grid
      })
    }
    for (const edge of edges(x, widths)) {
      const at = inside(edge, x, x + width)
      this.ops.push({
        type: 'stroke',
        points: [
          { x: at, y: upper },
          { x: at, y: lower }
        ],
        width: thin,
        alpha: ALPHA.grid
      })
    }

    this.aligned.push({ from, to: this.ops.length, right: x + width })
    this.right = Math.max(this.right, x + width)
    this.close(top, y, (LEADING + BLOCK_MARGIN) * size)
  }
}

/**
 * Lays out `source` for a text of `fontSize` (scene pixels) in `family` (a CSS font list) and
 * `weight`, its lines aligned by `align`.
 */
export function layoutMarkdown(
  source: string,
  fontSize: number,
  family: string,
  weight: number | string,
  align: TextAlign = 'left'
): MarkdownLayout {
  const layout = new Layout(fontSize, { family, weight, italic: false, scale: 1 }, align)
  layout.blocks(Lexer.lex(source, MARKDOWN), 0, 0)
  return layout.finish()
}

export function drawMarkdown(
  ctx: CanvasRenderingContext2D,
  layout: MarkdownLayout,
  color: string
): void {
  ctx.save()
  ctx.fillStyle = ctx.strokeStyle = color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const alpha = ctx.globalAlpha
  for (const op of layout.ops) {
    ctx.globalAlpha = alpha * (op.alpha ?? 1)
    switch (op.type) {
      case 'text':
        ctx.font = op.font
        ctx.fillText(op.text, op.x, op.y)
        break
      case 'fill':
        ctx.beginPath()
        ctx.roundRect(op.x, op.y, op.width, op.height, op.radius)
        ctx.fill()
        break
      case 'stroke':
        ctx.beginPath()
        op.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        if (op.closed) ctx.closePath()
        ctx.lineWidth = op.width
        ctx.stroke()
        break
      case 'dot':
        ctx.beginPath()
        ctx.arc(op.x, op.y, op.radius, 0, 2 * Math.PI)
        if (op.ring) {
          ctx.lineWidth = op.ring
          ctx.stroke()
        } else ctx.fill()
        break
    }
  }
  ctx.restore()
}

// ── The text object ─────────────────────────────────────────────────────────────

/** Strg+B / Strg+I put Markdown around the selected source. */
const FORMAT_KEYS: Record<string, string> = { KeyB: '**', KeyI: '_' }

/**
 * A text written in Markdown: drawn formatted, and as its source (with the size of plain text)
 * while it is typed. Saved as an IText – drawings from before become Markdown texts, and older
 * versions of the app show the source.
 */
export class MarkdownText extends IText<TOptions<ITextProps>> {
  /** The formatted text; none while the source is shown. (No initializer: the constructor of
   *  IText lays out the text already, a field initializer would run after it.) */
  declare private formatted: MarkdownLayout | undefined

  initDimensions(): void {
    super.initDimensions()
    this.formatted = this.isEditing
      ? undefined
      : layoutMarkdown(
          this.text,
          this.fontSize,
          this.fontFamily,
          this.fontWeight,
          isTextAlign(this.textAlign) ? this.textAlign : 'left'
        )
    if (this.formatted) {
      this.width = this.formatted.width
      this.height = this.formatted.height
    }
  }

  _render(ctx: CanvasRenderingContext2D): void {
    if (!this.formatted) return super._render(ctx)
    ctx.save()
    ctx.translate(-this.width / 2, -this.height / 2)
    drawMarkdown(ctx, this.formatted, typeof this.fill === 'string' ? this.fill : '#000000')
    ctx.restore()
  }

  enterEditingImpl(): void {
    super.enterEditingImpl()
    this.initDimensions()
    this.setCoords()
    this._updateTextarea()
  }

  // Before the events of leaving: the drawing is committed with the formatted size.
  exitEditingImpl(): void {
    super.exitEditingImpl()
    this.initDimensions()
    this.setCoords()
  }

  onKeyDown(e: KeyboardEvent): void {
    const marker =
      (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey ? FORMAT_KEYS[e.code] : undefined
    if (!this.isEditing || !marker) return super.onKeyDown(e)
    e.preventDefault()
    e.stopImmediatePropagation()
    this.toggleFormat(marker)
  }

  /** Puts `marker` around the selected source (or the cursor), or takes it away again. */
  private toggleFormat(marker: string): void {
    const area = this.hiddenTextarea
    if (!area) return
    const { value, selectionStart: start, selectionEnd: end } = area
    const n = marker.length
    const selected = value.slice(start, end)
    // The markers right around the selection, e.g. `**_` and `_**` around bold italic text.
    const before = value.slice(0, start).match(/[*_~]*$/)![0]
    const after = value.slice(end).match(/^[*_~]*/)![0]
    if (before.includes(marker) && after.includes(marker)) {
      const outside = before.replace(marker, '') + selected + after.replace(marker, '')
      this.replaceSource(start - before.length, end + after.length, outside, start - n, end - n)
    } else if (
      selected.length >= 2 * n &&
      selected.startsWith(marker) &&
      selected.endsWith(marker)
    ) {
      this.replaceSource(start, end, selected.slice(n, -n), start, end - 2 * n)
    } else {
      this.replaceSource(start, end, marker + selected + marker, start + n, end + n)
    }
  }

  /** Replaces `from`…`to` of the source with `text`, then selects `selectFrom`…`selectTo`. */
  private replaceSource(
    from: number,
    to: number,
    text: string,
    selectFrom: number,
    selectTo: number
  ): void {
    const area = this.hiddenTextarea!
    const select = (start: number, end: number): void => {
      area.setSelectionRange(start, end)
      Object.assign(this, this.fromStringToGraphemeSelection(start, end, area.value))
    }
    // Fabric's input handler compares against its own selection, so both must match.
    select(from, to)
    // Like typing: the browser's undo (Strg+Z while typing) keeps working, and fabric gets the
    // input event it updates the text from.
    if (!document.execCommand('insertText', false, text)) {
      area.setRangeText(text, from, to, 'end')
      ;(this as this & { hiddenTextarea: HTMLTextAreaElement }).onInput(new Event('input'))
    }
    select(selectFrom, selectTo)
    this._updateTextarea()
    this._fireSelectionChanged()
    this.canvas?.requestRenderAll()
  }
}

// Every IText read from a drawing becomes a Markdown text; its saved type stays 'IText'.
for (const type of ['IText', 'itext', 'i-text']) classRegistry.setClass(MarkdownText, type)
