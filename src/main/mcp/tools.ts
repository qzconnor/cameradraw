import { app } from 'electron'
import { readFile } from 'fs/promises'
import {
  CLIENT_INFO_META_KEY,
  McpServer,
  type CallToolResult,
  type StandardSchemaWithJSON,
  type ToolAnnotations
} from '@modelcontextprotocol/server'
import { z } from 'zod'
import { MCP_SERVER_NAME, type RemoteAction, type RemoteActionArgs } from '@shared/mcp'
import { loadImage, resolveInLibrary } from '../library'
import { getSettings, isWritableDir } from '../settings'
import { callRenderer } from './bridge'
import {
  click,
  drag,
  encodeBytes,
  pressKeys,
  screenshot,
  typeText,
  type EncodedImage
} from './input'
import { noteClient, trackCall } from './status'

const INSTRUCTIONS = `CameraDraw shows the live picture of a camera (USB microscope or webcam). Pictures are frozen ("captured"), drawn on and saved into a library of projects. Everything happens visibly in the app window – the user watches.

Typical flow: get_state → capture (freezes the picture and opens it in the editor, or with mode "save" stores it right away) → editor_draw / editor_update … → editor_save. Saved images: list_library, get_image, open_image.

Editor coordinates are image pixels of the canvas (0,0 = top left; size in editor_state). The picture can be turned (editor_rotate), straightened from a perspective (editor_perspective, e.g. a chip photographed at an angle) and extended by plain space for notes (editor_extend) – all undoable, the original frame stays saved. Drawn objects are addressed by their index in stacking order (0 = bottom); indices change after deleting or arranging, so use the list the tools return. Sizes (strokeWidth, fontSize) are like the toolbar values, for a 1920 px wide image.

The picture has layers (editor_state → layers, bottom first): image layers (the frame, and pictures pulled in from the library with editor_insert_image – each can be cropped and turned on its own, also later), space added beside the picture, and drawing layers holding the drawn objects. The user works in their own layers; draw into layers of your own: editor_draw without layer uses the layer you used last (a new one of yours on top the first time). Make as many as you need with editor_layers add (e.g. one for labels, one for measurements), switch with editor_layers use or the layer parameter of editor_draw, and reorder, hide, rename, copy or delete them with editor_layers.

Numbered markers (type "marker") are filled circles with a number – for findings that a text beside the picture refers to ("1: cold solder joint"). Without label they count on (1, 2, 3 … – one more than the highest so far); with tip a line leads from the circle to the spot, so the circle does not cover it. Their size is fontSize, their colour the circle's.

Texts are Markdown (GitHub flavour) and are drawn formatted: # headings, **bold**, _italic_, ~~strike-through~~, \`code\`, lists (-, 1., - [ ] / - [x] tasks, nested), > quotes, tables, fenced code blocks and --- rules. Every line break is kept and an empty line stays an empty line; lines only break where the text has a line break. Plain text stays plain (escape a literal *, _ or # with a backslash). editor_state returns the source; the box is the formatted size. Texts can use any installed font (fontFamily, see list_fonts; default "Geist", the app's own) and be aligned left, center or right (textAlign): the lines line up that way, and the text's "at" point is its top left, top middle or top right corner.

screenshot shows the window; click, drag, press_key and type_text operate it like a person (window coordinates in CSS pixels), e.g. for dialogs. While you work, the app shows the user a glowing frame, what you are doing and a pointer with your name where you click – they are not part of the app's content. App texts and messages are German.`

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false }
const CHANGES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false
}
const DELETES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false
}

/** Longer side of pictures sent to the client, unless it asks for another size. */
const DEFAULT_IMAGE_SIZE = 1568

const json = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value ?? null) }]
})

const text = (value: string): CallToolResult => ({ content: [{ type: 'text', text: value }] })

const picture = (image: EncodedImage, note: string): CallToolResult => ({
  content: [
    { type: 'image', data: image.data, mimeType: image.mimeType },
    { type: 'text', text: note }
  ]
})

/** Runs an action on the live app and returns its result as JSON. */
const remote = <A extends RemoteAction>(
  action: A,
  args: RemoteActionArgs[A]
): Promise<CallToolResult> => callRenderer(action, args).then(json)

// ── Schemas ───────────────────────────────────────────────────────────────────

const point = z.object({ x: z.number(), y: z.number() })
const controlMode = z.enum(['continuous', 'manual'])
const cameraControls = z.object({
  exposureMode: controlMode.optional(),
  exposureTime: z.number().positive().optional().describe('Units of 100 µs, e.g. 156.25 = 1/64 s'),
  whiteBalanceMode: controlMode.optional(),
  colorTemperature: z.number().positive().optional().describe('Kelvin'),
  focusMode: controlMode.optional(),
  focusDistance: z.number().optional(),
  brightness: z.number().optional(),
  contrast: z.number().optional(),
  saturation: z.number().optional(),
  sharpness: z.number().optional(),
  powerLineFrequency: z
    .union([z.literal(0), z.literal(50), z.literal(60)])
    .optional()
    .describe('Anti-flicker filter: mains frequency of the lamps in Hz, 0 = off')
})
const indices = z
  .array(z.number().int().min(0))
  .describe('Object indices from editor_state (0 = bottom of the stack)')
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .describe('Colour as #rrggbb')
const strokeWidth = z
  .number()
  .min(1)
  .max(100)
  .describe('Line width as in the toolbar (2, 4, 8, 14, 24 …)')
const fontSize = z.number().min(6).max(400).describe('Text size as in the toolbar (24 … 112)')
const fontFamily = z
  .string()
  .min(1)
  .max(200)
  .describe('Font of texts: "Geist" (the app\'s own) or an installed font from list_fonts')
const textAlign = z
  .enum(['left', 'center', 'right'])
  .describe('How the lines of texts line up – and where "at" is: top left, middle or right')
const filled = z.boolean().describe('Fill rectangles and ellipses with their colour')
const style = {
  color: color.optional(),
  strokeWidth: strokeWidth.optional(),
  fontSize: fontSize.optional(),
  fontFamily: fontFamily.optional(),
  textAlign: textAlign.optional(),
  filled: filled.optional()
}
const project = z
  .string()
  .nullable()
  .describe('Project (sub folder of the save folder); null = no project')
const imagePath = z
  .string()
  .describe('Image path from list_library: "<file>" or "<project>/<file>"')
const maxSize = z
  .number()
  .int()
  .min(64)
  .max(4096)
  .optional()
  .describe(`Longer side of the returned picture in pixels (default ${DEFAULT_IMAGE_SIZE})`)

const markdown = z
  .string()
  .min(1)
  .describe('Markdown, drawn formatted (see the server instructions); line breaks are kept')

const layerId = z.string().describe('Layer id from editor_state (layers)')

const shape = z.union([
  z.object({
    type: z.enum(['line', 'arrow', 'rect', 'ellipse', 'measure']),
    from: point,
    to: point,
    ...style
  }),
  z.object({
    type: z.enum(['pen', 'highlighter']),
    points: z.array(point).min(2).describe('Freehand path'),
    ...style
  }),
  z.object({
    type: z.literal('text'),
    at: point.describe('Top left corner – top middle or top right with textAlign center or right'),
    text: markdown,
    ...style
  }),
  z.object({
    type: z.literal('marker'),
    at: point.describe('Middle of the circle'),
    tip: point.optional().describe('The spot it marks – a line leads there from the circle'),
    label: z
      .string()
      .min(1)
      .max(4)
      .optional()
      .describe('Default: the next number (one more than the highest so far)'),
    ...style
  })
])

const tool = z.enum([
  'select',
  'pen',
  'highlighter',
  'line',
  'arrow',
  'rect',
  'ellipse',
  'text',
  'marker',
  'eraser',
  'measure'
])

// ── Tools ─────────────────────────────────────────────────────────────────────

/** One server per request (the SDK serves stateless); the tools act on the one app window. */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, title: 'CameraDraw', version: app.getVersion() },
    { instructions: INSTRUCTIONS }
  )

  function add<S extends z.ZodObject>(
    name: string,
    description: string,
    inputSchema: S,
    annotations: ToolAnnotations,
    run: (args: z.infer<S>) => Promise<CallToolResult>
  ): void {
    // The SDK has checked the arguments against the schema before the call.
    const schema: StandardSchemaWithJSON = inputSchema
    server.registerTool(name, { description, inputSchema: schema, annotations }, (args, ctx) => {
      // Clients of the 2026 protocol name themselves in every request.
      noteClient(ctx.mcpReq.envelope?.[CLIENT_INFO_META_KEY]?.name ?? null)
      return trackCall(name, () => run(args as z.infer<S>))
    })
  }

  const none = z.object({})

  // General
  add(
    'get_state',
    'What the app shows right now: camera or editor, open panel and dialogs, camera status, zoom, resolution and picture controls (exposure, white balance, focus … with their ranges), burst capture, the image in the editor, the save folder and the settings. Start here.',
    none,
    READ_ONLY,
    () => remote('state', {})
  )
  add(
    'screenshot',
    'Picture of the app window as the user sees it. Its pixels are window coordinates for click and drag (unless maxWidth scales it down – then divide by the scale given).',
    z.object({ maxWidth: z.number().int().min(320).max(4096).optional() }),
    READ_ONLY,
    async ({ maxWidth }) => {
      const shot = await screenshot(maxWidth)
      return picture(
        shot,
        `Window ${shot.width}×${shot.height}` +
          (shot.scale < 1 ? ` (scale ${shot.scale.toFixed(3)} of window coordinates)` : '')
      )
    }
  )
  add(
    'press_key',
    'Presses a key like on the keyboard, with modifiers: "Space", "Shift+Space", "Escape", "Delete", "Control+Z", "Control+Shift+S", "ArrowLeft", "+", "g". Uses the app\'s shortcuts (Space captures, G toggles the gallery, P pauses, V/P/M/E/L/A/R/O/T/N/D pick editor tools …).',
    z.object({
      keys: z.string().min(1),
      times: z.number().int().min(1).max(50).optional()
    }),
    CHANGES,
    async ({ keys, times }) => {
      await pressKeys(keys, times)
      return text(`Pressed ${keys}${times && times > 1 ? ` ×${times}` : ''}.`)
    }
  )
  add(
    'click',
    'Clicks into the window at window coordinates (CSS pixels, as in screenshot). Right button opens context menus.',
    z.object({
      x: z.number(),
      y: z.number(),
      button: z.enum(['left', 'right', 'middle']).optional(),
      clickCount: z.number().int().min(1).max(3).optional().describe('2 = double click')
    }),
    CHANGES,
    async ({ x, y, button, clickCount }) => {
      await click({ x, y }, button, clickCount)
      return text(`Clicked at ${x},${y}.`)
    }
  )
  add(
    'drag',
    'Drags with the mouse from one window point to another (CSS pixels), e.g. to draw with the current editor tool or to drop an image onto a project in the gallery.',
    z.object({
      from: point,
      to: point,
      button: z.enum(['left', 'right', 'middle']).optional(),
      steps: z.number().int().min(1).max(100).optional()
    }),
    CHANGES,
    async ({ from, to, button, steps }) => {
      await drag(from, to, button, steps)
      return text(`Dragged from ${from.x},${from.y} to ${to.x},${to.y}.`)
    }
  )
  add(
    'type_text',
    'Types text into the focused field (e.g. a name in a dialog or a text being written in the editor).',
    z.object({ text: z.string() }),
    CHANGES,
    async (args) => {
      await typeText(args.text)
      return text('Typed.')
    }
  )
  add(
    'show_panel',
    'Opens a side panel (gallery, settings, modules, updates) or closes it ("none"). For the gallery, a project and a search can be shown; for the settings a tab: general (save folder, ambient light), camera (camera, resolution, mirroring, zoom), picture (exposure, white balance, focus, brightness … of the camera), ai (this MCP server).',
    z.object({
      panel: z.enum(['gallery', 'settings', 'modules', 'updates', 'none']),
      project: project.optional(),
      query: z.string().optional(),
      tab: z.enum(['general', 'camera', 'picture', 'ai']).optional()
    }),
    CHANGES,
    (args) => remote('showPanel', args)
  )
  add(
    'update_settings',
    "Changes settings: save folder (must exist and be writable), mirroring the camera picture, ambient light, using the camera's own zoom, switching the camera off while it is not shown.",
    z.object({
      saveDir: z.string().optional(),
      mirror: z.boolean().optional(),
      ambientLight: z.boolean().optional(),
      preferCameraZoom: z.boolean().optional(),
      stopCameraWhenHidden: z.boolean().optional()
    }),
    CHANGES,
    (args) => remote('updateSettings', args)
  )

  // Camera
  add(
    'list_cameras',
    'Cameras that are connected, the chosen one and its status.',
    z.object({ refresh: z.boolean().optional().describe('Search for cameras again first') }),
    READ_ONLY,
    (args) => remote('listCameras', args)
  )
  add(
    'select_camera',
    'Switches to another camera (by id or label from list_cameras).',
    z.object({ id: z.string().optional(), label: z.string().optional() }),
    CHANGES,
    (args) => remote('selectCamera', args)
  )
  add(
    'set_camera',
    'Pauses or resumes the camera picture, sets its zoom (1 = none, up to maxZoom from get_state) and resolution ("standard": up to Full HD, "max": the largest the camera offers, see maxResolution – reopens the camera). controls sets what the camera itself adjusts – only those listed in get_state → camera.controls, within their min/max: exposure, white balance and focus each have a mode ("continuous" = automatic, "manual") and a value used in manual mode (exposureTime in units of 100 µs, colorTemperature in Kelvin, focusDistance in units of the camera) – a value alone switches to manual; brightness, contrast, saturation and sharpness are numbers in units of the camera; powerLineFrequency is the anti-flicker filter (50 or 60 Hz, the mains frequency of the lamps; 0 = off where its options allow it). The camera may round a value; the result shows what it uses. CameraDraw remembers them for this camera. resetControls: true restores the values the camera had before CameraDraw changed them (applied before controls). softContrast: true shows and captures the picture of this camera in the TV range 16–235 like Logi Capture – calmer colours, highlights do not burn out.',
    z.object({
      paused: z.boolean().optional(),
      zoom: z.number().min(1).optional(),
      resolution: z.enum(['standard', 'max']).optional(),
      softContrast: z.boolean().optional(),
      controls: cameraControls.optional(),
      resetControls: z.boolean().optional()
    }),
    CHANGES,
    (args) => remote('setCamera', args)
  )
  add(
    'capture',
    'Freezes the camera picture. mode "edit" (default) opens it in the editor to draw on it; mode "save" saves it right away like burst capture (name with the time, into the burst project – the one picked last, see set_burst) and stays in the live view. Needs the live view (close the editor first).',
    z.object({ mode: z.enum(['edit', 'save']).optional() }),
    CHANGES,
    (args) => remote('capture', args)
  )
  add(
    'set_focus_peaking',
    'The focus aid of the live view ("Schärfehilfe"): enabled shows focus peaking – edges that are in focus light up in color – and a meter of how sharp the picture is. level: how readily edges light up (low, medium, high); color: of the edges, #rrggbb (the app offers #ff2d55, #39ff14, #ffe600, #00b4ff). The result (like get_state → camera.focusPeaking) has the sharpness of the middle of the picture, measured now also while the aid is off: higher is sharper, but it only compares pictures of the same scene – e.g. to find the sharpest focusDistance with set_camera; best is the highest of the last seconds while the aid is on.',
    z.object({
      enabled: z.boolean().optional(),
      level: z.enum(['low', 'medium', 'high']).optional(),
      color: color.optional()
    }),
    CHANGES,
    (args) => remote('setFocusPeaking', args)
  )
  add(
    'set_reference',
    'A reference picture over the live view ("Referenzbild"): an image taken before lies over the camera picture, so the sample can be put back exactly where it was – e.g. for an "after" picture that matches the "before". path: an image of the library (null hides it), latest: the newest image (usually the one just taken). It shows the original camera frame, which lines up with the live picture (same camera, mirroring and zoom), or with drawing: true the image as saved with its drawing (markers show where to look). opacity 0.1–1; mode "blend" (see-through) or "difference" (what lines up turns black – compare with screenshot). Only shown, never part of a capture.',
    z.object({
      path: imagePath.nullable().optional(),
      latest: z.boolean().optional(),
      opacity: z.number().min(0.1).max(1).optional(),
      mode: z.enum(['blend', 'difference']).optional(),
      drawing: z.boolean().optional()
    }),
    CHANGES,
    (args) => remote('setReference', args)
  )
  add(
    'set_burst',
    'Burst capture: while on, Space, the shutter and the photo button save each picture right away. Also sets the project the pictures go to (null = none).',
    z.object({ enabled: z.boolean().optional(), project: project.optional() }),
    CHANGES,
    (args) => remote('setBurst', args)
  )

  add(
    'list_fonts',
    'Fonts texts can use: "Geist" (the app\'s own, the default) and the fonts installed on the computer, sorted by name. query: only those whose name contains it.',
    z.object({ query: z.string().optional() }),
    READ_ONLY,
    (args) => remote('listFonts', args)
  )

  // Library
  add(
    'list_library',
    'Projects and images of the save folder, newest first. project: only images of that project (null = only those without project); query: filters by name; limit: at most that many images (default 100).',
    z.object({
      project: project.optional(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(5000).optional()
    }),
    READ_ONLY,
    (args) => remote('listLibrary', args)
  )
  add(
    'get_image',
    'Shows a saved image as a picture – as saved (with its drawing) or the original camera frame without drawing.',
    z.object({
      path: imagePath,
      original: z.boolean().optional().describe('The frame without the drawing'),
      maxSize
    }),
    READ_ONLY,
    async ({ path, original, maxSize: size }) => {
      const dir = getSettings().saveDir
      if (!isWritableDir(dir)) throw new Error('Der Speicherordner ist nicht verfügbar.')
      const bytes = original
        ? (await loadImage(dir, path)).base
        : await readFile(resolveInLibrary(dir, path))
      const image = encodeBytes(bytes, size ?? DEFAULT_IMAGE_SIZE)
      return picture(
        image,
        `${path}${original ? ' (original)' : ''}, ${image.width}×${image.height}`
      )
    }
  )
  add(
    'open_image',
    'Opens a saved image in the editor to draw on it. With unsaved changes in the editor it fails unless discard is true.',
    z.object({ path: imagePath, discard: z.boolean().optional() }),
    CHANGES,
    (args) => remote('openImage', args)
  )
  add(
    'create_project',
    'Creates a project (a sub folder of the save folder).',
    z.object({ name: z.string().min(1) }),
    CHANGES,
    (args) => remote('createProject', args)
  )
  add(
    'rename_project',
    'Renames a project.',
    z.object({ name: z.string(), newName: z.string().min(1) }),
    CHANGES,
    (args) => remote('renameProject', args)
  )
  add(
    'delete_project',
    'Moves a project with all its images to the trash.',
    z.object({ name: z.string() }),
    DELETES,
    (args) => remote('deleteProject', args)
  )
  add(
    'rename_image',
    'Renames an image (its layers move along). Without an extension the old one is kept.',
    z.object({ path: imagePath, newName: z.string().min(1) }),
    CHANGES,
    (args) => remote('renameImage', args)
  )
  add(
    'move_image',
    'Moves an image into a project (null = out of its project). A taken name gets a number.',
    z.object({ path: imagePath, project }),
    CHANGES,
    (args) => remote('moveImage', args)
  )
  add(
    'delete_image',
    'Moves an image with its layers to the trash.',
    z.object({ path: imagePath }),
    DELETES,
    (args) => remote('deleteImage', args)
  )
  add(
    'copy_image',
    'Puts a saved image (with its drawing) on the clipboard, e.g. to paste it into a document.',
    z.object({ path: imagePath }),
    CHANGES,
    (args) => remote('copyImage', args)
  )

  // Editor
  add(
    'editor_state',
    'The image in the editor: path (null = new capture), canvas size, unsaved changes, scale for measuring, tool and style, its layers (bottom first: id, type image / fill / drawing, name, visible, locked, owner "ai" for yours, the one the user works on, objects of drawing layers, box and adjustments of images), the layer you draw into by default (aiLayer), and every drawn object with its index, layer, kind, bounding box, colour and text (the label of a marker, with tip: the spot its line leads to) or measured length.',
    none,
    READ_ONLY,
    () => remote('editorState', {})
  )
  add(
    'editor_image',
    'The image in the editor as a picture, with the current (also unsaved) drawing or without it.',
    z.object({ drawing: z.boolean().optional().describe('Default true'), maxSize }),
    READ_ONLY,
    async ({ drawing, maxSize: size }) => {
      const { png } = (await callRenderer('editorImage', { drawing })) as { png: Uint8Array }
      const image = encodeBytes(png, size ?? DEFAULT_IMAGE_SIZE)
      return picture(
        image,
        `Editor ${drawing === false ? 'without' : 'with'} drawing, ${image.width}×${image.height}`
      )
    }
  )
  add(
    'editor_draw',
    'Draws objects onto the image (image pixels; one undo step) – into a drawing layer of your own: the one you used last, or layer (any drawing layer, yours from then on). Types: line, arrow (from → to, tip at "to"), rect, ellipse (corners), measure (measuring line with its length), pen and highlighter (points), text (at = top left, or top middle / top right with textAlign center / right; Markdown, e.g. a heading, a list or a table of findings; fontFamily from list_fonts), marker (numbered circle at "at", counting on unless label is given; tip: a line to the spot it marks; size = fontSize). Colour, sizes, font and alignment default to the editor\'s current style.',
    z.object({
      shapes: z.array(shape).min(1).max(200),
      layer: layerId.optional()
    }),
    CHANGES,
    (args) => remote('editorDraw', args)
  )
  add(
    'editor_layers',
    'Layers of the picture. add: a new drawing layer of yours on top (name optional) – your next drawings go there; use: draw into that drawing layer from now on; update: name, visible, locked (locked layers cannot be picked in the picture); move: to an index (0 = bottom) or up, down, top, bottom; duplicate, copy (with its pictures, also for other images), paste (what was copied last – layers or objects), delete. Undoable.',
    z.object({
      action: z.enum(['add', 'use', 'update', 'move', 'duplicate', 'copy', 'paste', 'delete']),
      layer: layerId.optional().describe('The layer to act on (all actions but add and paste)'),
      name: z.string().min(1).max(80).optional(),
      visible: z.boolean().optional(),
      locked: z.boolean().optional(),
      to: z.union([z.number().int().min(0), z.enum(['up', 'down', 'top', 'bottom'])]).optional()
    }),
    CHANGES,
    (args) => remote('editorLayers', args)
  )
  add(
    'editor_insert_image',
    'Pulls a saved image (as saved, with its drawing) into the picture in the editor as an image layer of its own – e.g. to show several pictures side by side or an overview with a detail. at: its middle (canvas pixels, default the middle), width: its width in the canvas (default: fitting into half of it). Extend the canvas first (editor_extend) to place it beside the frame. It can be cropped or turned on its own (editor_perspective / editor_rotate with layer).',
    z.object({
      path: imagePath,
      at: point.optional(),
      width: z.number().min(8).max(12_000).optional()
    }),
    CHANGES,
    (args) => remote('editorInsertImage', args)
  )
  add(
    'editor_select',
    'Selects objects (shows them selected in the editor) – all, some, or none with an empty list.',
    z.object({ indices: indices.optional(), all: z.boolean().optional() }),
    CHANGES,
    (args) => remote('editorSelect', args)
  )
  add(
    'editor_update',
    'Changes objects: colour, line width, size, font and alignment of texts (a text stays where it is), fill (rectangles, ellipses), the text (Markdown) of a text object or the label of a marker (fontSize is its size), or moves them by moveBy image pixels.',
    z.object({
      indices,
      ...style,
      text: markdown.optional(),
      moveBy: point.optional()
    }),
    CHANGES,
    (args) => remote('editorUpdate', args)
  )
  add(
    'editor_delete',
    'Deletes objects – the given ones, or all with all: true (undoable).',
    z.object({ indices: indices.optional(), all: z.boolean().optional() }),
    DELETES,
    (args) => remote('editorDelete', args)
  )
  add(
    'editor_arrange',
    'Brings objects in front of all others or behind them.',
    z.object({ indices, where: z.enum(['front', 'back']) }),
    CHANGES,
    (args) => remote('editorArrange', args)
  )
  add(
    'editor_clipboard',
    'Copy, cut, paste and duplicate objects like Ctrl+C/X/V/D – copied objects can be pasted into another image too. paste: at = centre of the pasted objects (default: slightly offset).',
    z.object({
      action: z.enum(['copy', 'cut', 'paste', 'duplicate']),
      indices: indices.optional().describe('For copy, cut, duplicate'),
      at: point.optional()
    }),
    CHANGES,
    (args) => remote('editorClipboard', args)
  )
  add(
    'editor_history',
    'Undo or redo the last steps.',
    z.object({
      action: z.enum(['undo', 'redo']),
      steps: z.number().int().min(1).max(100).optional()
    }),
    CHANGES,
    (args) => remote('editorHistory', args)
  )
  add(
    'editor_set_tool',
    "Picks the tool and style in the editor's toolbar – used for drawing by hand and as the default style of editor_draw. Changing the style also restyles selected objects.",
    z.object({ tool: tool.optional(), ...style }),
    CHANGES,
    (args) => remote('editorSetTool', args)
  )
  add(
    'editor_set_view',
    'Zooms the editor view (1 = whole image, up to 8) and centres it on an image point.',
    z.object({ zoom: z.number().min(1).max(8).optional(), center: point.optional() }),
    CHANGES,
    (args) => remote('editorSetView', args)
  )
  add(
    'editor_set_scale',
    'Sets the scale for measuring: micronsPerPixel directly (null removes it), or calibrate with a measuring line of known length – like "Als Maßstab verwenden". remember: also for new pictures of this camera.',
    z.object({
      micronsPerPixel: z.number().positive().nullable().optional(),
      calibrate: z
        .object({
          index: z.number().int().min(0).describe('Index of a measuring line'),
          length: z.number().positive(),
          unit: z.enum(['µm', 'mm']),
          remember: z.boolean().optional()
        })
        .optional()
    }),
    CHANGES,
    (args) => remote('editorSetScale', args)
  )
  add(
    'editor_rotate',
    'Turns the picture in the editor clockwise by 90, 180 or 270 degrees (-90 = a quarter to the left) – the whole canvas with every layer, or with layer only that image layer. Drawn objects turn along. Undoable; the original stays saved.',
    z.object({
      degrees: z.union([z.literal(90), z.literal(180), z.literal(270), z.literal(-90)]),
      layer: layerId.optional().describe('An image layer to turn on its own')
    }),
    CHANGES,
    (args) => remote('editorRotate', args)
  )
  add(
    'editor_perspective',
    "Perspective crop of an image layer (default: the frame, the bottom image): the quadrilateral with these four corners (canvas pixels, any order) becomes a straight rectangle, the rest of that picture is cut off – e.g. the edges of a chip or a sheet photographed at an angle. Space and other layers beside the frame stay; the canvas follows the frame's new size. The size is the longer of each pair of opposite edges unless width/height are given (in the picture's own pixels, e.g. for the real aspect ratio). Look at editor_image to find the corners. Drawn objects on it move along. Undoable; the original stays saved.",
    z.object({
      corners: z.array(point).length(4),
      width: z.number().int().min(1).max(12_000).optional(),
      height: z.number().int().min(1).max(12_000).optional(),
      layer: layerId.optional().describe('An image layer (default: the frame)')
    }),
    CHANGES,
    (args) => remote('editorPerspective', args)
  )
  add(
    'editor_extend',
    'Adds plain space around the canvas (pixels per side) as layers of their own, e.g. on the right to write notes there with editor_draw text or to place an image with editor_insert_image. color: the fill, default white. Undoable.',
    z.object({
      top: z.number().int().min(0).optional(),
      right: z.number().int().min(0).optional(),
      bottom: z.number().int().min(0).optional(),
      left: z.number().int().min(0).optional(),
      color: color.optional()
    }),
    CHANGES,
    (args) => remote('editorExtend', args)
  )
  add(
    'editor_reset_image',
    'Undoes every turn and perspective crop of an image layer at once (default: the frame) – back to its original picture; drawn objects on it move back. Added space stays (delete its layer with editor_layers).',
    z.object({ layer: layerId.optional() }),
    CHANGES,
    (args) => remote('editorResetImage', args)
  )
  add(
    'editor_save',
    'Saves the image in the editor. A new capture gets name (without extension, default with the time) and project (default: the one picked last). A saved image is saved in place, or renamed/moved with name/project, or as a new copy with asCopy. close: back to the camera afterwards (default: true for new captures, false otherwise).',
    z.object({
      name: z.string().min(1).optional(),
      project: project.optional(),
      asCopy: z.boolean().optional(),
      close: z.boolean().optional()
    }),
    CHANGES,
    (args) => remote('editorSave', args)
  )
  add(
    'editor_copy_image',
    'Puts the image in the editor with its drawing on the clipboard (Ctrl+Shift+C).',
    none,
    CHANGES,
    () => remote('editorCopyImage', {})
  )
  add(
    'editor_close',
    'Closes the editor and returns to the live camera. With unsaved changes it fails unless discard is true.',
    z.object({ discard: z.boolean().optional() }),
    DELETES,
    (args) => remote('editorClose', args)
  )

  return server
}
