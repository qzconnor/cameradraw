/** Encodes a canvas to bytes (PNG by default). */
export function canvasToBytes(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality?: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) return reject(new Error('Bild konnte nicht erzeugt werden'))
        resolve(new Uint8Array(await blob.arrayBuffer()))
      },
      type,
      quality
    )
  })
}

export function bytesToObjectUrl(bytes: Uint8Array, mime: string): string {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
}

/** Reads the natural size of an image URL. */
export function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'))
    img.src = url
  })
}

/** Output encoding matching a file name's extension (new files are PNG). */
export function encodingFor(name: string | null): { mime: string; quality?: number } {
  const ext = name?.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return { mime: 'image/jpeg', quality: 0.92 }
  if (ext === 'webp') return { mime: 'image/webp', quality: 0.92 }
  return { mime: 'image/png' }
}

/** `#rrggbb` → `rgba(r, g, b, alpha)` */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** `rgba(r, g, b, a)` or `#rrggbb` → `#rrggbb`; anything else (e.g. `transparent`) → ''. */
export function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase()
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color)
  if (!m) return ''
  return `#${m
    .slice(1, 4)
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')}`
}
