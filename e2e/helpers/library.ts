import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { crc32, deflateSync } from 'zlib'

/** Test picture: a soft gradient with a 100 px grid, so drawings and shifts show up clearly. */
export function testPicture(width = 1920, height = 1080): Buffer {
  const row = width * 3 + 1
  const raw = Buffer.alloc(row * height)
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const grid = x % 100 === 0 || y % 100 === 0
      const i = y * row + 1 + x * 3
      raw[i] = grid ? 40 : 60 + Math.round((x / width) * 150)
      raw[i + 1] = grid ? 40 : 80 + Math.round((y / height) * 120)
      raw[i + 2] = grid ? 40 : 170
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8 bit, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

export interface ImageOptions {
  /** Editable layers like CameraDraw writes them (`objects`, `capturedAt`, …). */
  layers?: Record<string, unknown>
  /** File modification time. */
  mtime?: Date
}

/** Puts an image (`Name.png` or `Project/Name.png`) into the library. */
export function addImage(library: string, path: string, options: ImageOptions = {}): string {
  const file = join(library, ...path.split('/'))
  mkdirSync(dirname(file), { recursive: true })
  const picture = testPicture()
  writeFileSync(file, picture)
  if (options.layers) {
    const layersDir = join(dirname(file), '.cameradraw')
    const stem = path
      .split('/')
      .pop()!
      .replace(/\.png$/, '')
    mkdirSync(layersDir, { recursive: true })
    writeFileSync(join(layersDir, `${stem}.base.png`), picture)
    writeFileSync(
      join(layersDir, `${stem}.json`),
      JSON.stringify({ version: 1, width: 1920, height: 1080, objects: [], ...options.layers })
    )
  }
  if (options.mtime) utimesSync(file, options.mtime, options.mtime)
  return file
}

/** The layers CameraDraw saved for an image. */
export function readLayers(
  library: string,
  path: string
): Record<string, unknown> & {
  objects: Record<string, unknown>[]
} {
  const parts = path.split('/')
  const stem = parts.pop()!.replace(/\.[^.]+$/, '')
  return JSON.parse(readFileSync(join(library, ...parts, '.cameradraw', `${stem}.json`), 'utf8'))
}

/** Width and height of a PNG file, from its header. */
export function pngSize(file: string): { width: number; height: number } {
  const header = readFileSync(file).subarray(16, 24)
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) }
}

/** Colour of the test picture (`testPicture`) at a point, away from the grid lines. */
export function testColor(x: number, y: number, width = 1920, height = 1080): number[] {
  return [60 + Math.round((x / width) * 150), 80 + Math.round((y / height) * 120), 170]
}
