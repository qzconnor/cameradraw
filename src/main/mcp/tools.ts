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

Editor coordinates are image pixels (0,0 = top left; size in editor_state). The picture can be turned (editor_rotate), straightened from a perspective (editor_perspective, e.g. a chip photographed at an angle) and extended by plain space for notes (editor_extend) – all undoable, the original frame stays saved. Drawn objects are addressed by their index in stacking order (0 = bottom); indices change after deleting or arranging, so use the list the tools return. Sizes (strokeWidth, fontSize) are like the toolbar values, for a 1920 px wide image.

Texts are Markdown (GitHub flavour) and are drawn formatted: # headings, **bold**, _italic_, ~~strike-through~~, \`code\`, lists (-, 1., - [ ] / - [x] tasks, nested), > quotes, tables, fenced code blocks and --- rules. Every line break is kept and an empty line stays an empty line; lines only break where the text has a line break. Plain text stays plain (escape a literal *, _ or # with a backslash). editor_state returns the source; the box is the formatted size.

screenshot shows the window; click, drag, press_key and type_text operate it like a person (window coordinates in CSS pixels), e.g. for dialogs. App texts and messages are German.`

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
const filled = z.boolean().describe('Fill rectangles and ellipses with their colour')
const style = {
  color: color.optional(),
  strokeWidth: strokeWidth.optional(),
  fontSize: fontSize.optional(),
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
    at: point.describe('Top left corner'),
    text: markdown,
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
      return trackCall(() => run(args as z.infer<S>))
    })
  }

  const none = z.object({})

  // General
  add(
    'get_state',
    'What the app shows right now: camera or editor, open panel and dialogs, camera status and zoom, burst capture, the image in the editor, the save folder and the settings. Start here.',
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
    'Presses a key like on the keyboard, with modifiers: "Space", "Shift+Space", "Escape", "Delete", "Control+Z", "Control+Shift+S", "ArrowLeft", "+", "g". Uses the app\'s shortcuts (Space captures, G toggles the gallery, P pauses, V/P/M/E/L/A/R/O/T/D pick editor tools …).',
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
    'Opens a side panel (gallery, settings, modules, updates) or closes it ("none"). For the gallery, a project and a search can be shown.',
    z.object({
      panel: z.enum(['gallery', 'settings', 'modules', 'updates', 'none']),
      project: project.optional(),
      query: z.string().optional()
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
    'Pauses or resumes the camera picture and sets its zoom (1 = none, up to maxZoom from get_state).',
    z.object({ paused: z.boolean().optional(), zoom: z.number().min(1).optional() }),
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
    'set_burst',
    'Burst capture: while on, Space, the shutter and the photo button save each picture right away. Also sets the project the pictures go to (null = none).',
    z.object({ enabled: z.boolean().optional(), project: project.optional() }),
    CHANGES,
    (args) => remote('setBurst', args)
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
    'The image in the editor: path (null = new capture), size, unsaved changes, scale for measuring, tool and style, and every drawn object with its index, kind, bounding box, colour and text or measured length.',
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
    'Draws objects onto the image (image pixels; one undo step). Types: line, arrow (from → to, tip at "to"), rect, ellipse (corners), measure (measuring line with its length), pen and highlighter (points), text (at = top left; Markdown, e.g. a heading, a list or a table of findings). Colour and sizes default to the editor\'s current style.',
    z.object({ shapes: z.array(shape).min(1).max(200) }),
    CHANGES,
    (args) => remote('editorDraw', args)
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
    'Changes objects: colour, line width, text size, fill (rectangles, ellipses), the text (Markdown) of a text object, or moves them by moveBy image pixels.',
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
    'Turns the picture in the editor clockwise by 90, 180 or 270 degrees (-90 = a quarter to the left). Drawn objects turn along. Undoable; the original stays saved.',
    z.object({
      degrees: z.union([z.literal(90), z.literal(180), z.literal(270), z.literal(-90)])
    }),
    CHANGES,
    (args) => remote('editorRotate', args)
  )
  add(
    'editor_perspective',
    'Perspective crop: the quadrilateral with these four corners (image pixels, any order) becomes a straight rectangle, everything outside is cut off – e.g. the edges of a chip or a sheet photographed at an angle. The size is the longer of each pair of opposite edges unless width/height are given (e.g. for the real aspect ratio). Look at editor_image to find the corners. Drawn objects move along. Undoable; the original stays saved.',
    z.object({
      corners: z.array(point).length(4),
      width: z.number().int().min(1).max(12_000).optional(),
      height: z.number().int().min(1).max(12_000).optional()
    }),
    CHANGES,
    (args) => remote('editorPerspective', args)
  )
  add(
    'editor_extend',
    'Adds plain space around the picture (pixels per side), e.g. on the right to write notes there with editor_draw text. color: the fill, default white. Undoable.',
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
    'Undoes every turn, perspective crop and added space at once – back to the original frame; drawn objects move back.',
    none,
    CHANGES,
    () => remote('editorResetImage', {})
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
