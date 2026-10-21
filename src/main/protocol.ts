import { nativeImage, net, protocol } from 'electron'
import { stat } from 'fs/promises'
import { pathToFileURL } from 'url'
import { MEDIA_SCHEME } from '@shared/types'
import { resolveInLibrary } from './library'

const THUMB_WIDTH = 480
const thumbCache = new Map<string, Buffer>()

/** Must run before the app is ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

async function createThumbnail(file: string): Promise<Buffer> {
  const { mtimeMs } = await stat(file)
  const key = `${file}|${mtimeMs}`
  const cached = thumbCache.get(key)
  if (cached) return cached

  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) throw new Error('Bild konnte nicht gelesen werden')
  const { width } = image.getSize()
  const thumb = (
    width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH, quality: 'good' }) : image
  ).toJPEG(82)

  // Drop stale entries for the same file (older mtime).
  for (const k of thumbCache.keys()) if (k.startsWith(`${file}|`)) thumbCache.delete(k)
  thumbCache.set(key, thumb)
  return thumb
}

/**
 * Serves images from the save folder and its projects:
 *   cdraw://media/<path>  – original file
 *   cdraw://thumb/<path>  – downscaled JPEG thumbnail
 * `<path>` is the URL-encoded image path (`<file>` or `<project>/<file>`).
 */
export function handleMediaProtocol(getSaveDir: () => string | null): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const dir = getSaveDir()
    if (!dir) return new Response(null, { status: 404 })

    const url = new URL(request.url)
    let file: string
    try {
      file = resolveInLibrary(dir, decodeURIComponent(url.pathname.slice(1)))
    } catch {
      return new Response(null, { status: 400 })
    }

    try {
      if (url.host === 'thumb') {
        const body = await createThumbnail(file)
        return new Response(new Uint8Array(body), {
          headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000, immutable' }
        })
      }
      if (url.host === 'media') return await net.fetch(pathToFileURL(file).toString())
    } catch {
      return new Response(null, { status: 404 })
    }
    return new Response(null, { status: 404 })
  })
}
