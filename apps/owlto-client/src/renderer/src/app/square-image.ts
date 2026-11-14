/**
 * Crops a picked image to its centered square and scales it to `size`, so the stored data
 * URL stays small whatever the user picks. Falls back to JPEG when the PNG is over `limit`,
 * and rejects files it cannot decode or shrink below it.
 */
export async function squareImageFromFile(
  file: File,
  size: number,
  limit: number
): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No 2D canvas')
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size
    )
    const png = canvas.toDataURL('image/png')
    if (png.length <= limit) return png
    const jpeg = canvas.toDataURL('image/jpeg', 0.85)
    if (jpeg.length <= limit) return jpeg
    throw new Error('Image too large')
  } finally {
    bitmap.close()
  }
}
