/** Downscale an image blob so its longest edge is <= maxEdge, as JPEG. */
export async function downscaleImage(
  source: Blob,
  maxEdge: number,
  quality = 0.85,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0, w, h)
    return await canvasToJpeg(canvas, quality)
  } finally {
    bitmap.close()
  }
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      'image/jpeg',
      quality,
    )
  })
}
