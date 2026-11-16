/** A square part of an image, in the image's own pixels. */
export type SquareCrop = { x: number; y: number; side: number }

/** The centered square of an image `width` by `height`. */
export function centeredSquare(width: number, height: number): SquareCrop {
  const side = Math.min(width, height)
  return { x: (width - side) / 2, y: (height - side) / 2, side }
}

/**
 * Draws the `crop` square of an image scaled to `size`, so the stored data URL stays small
 * whatever the user picks. Falls back to JPEG when the PNG is over `limit`, and rejects
 * images it cannot shrink below it.
 */
export function squareImage(
  image: CanvasImageSource,
  crop: SquareCrop,
  size: number,
  limit: number
): string {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No 2D canvas')
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size)
  const png = canvas.toDataURL('image/png')
  if (png.length <= limit) return png
  const jpeg = canvas.toDataURL('image/jpeg', 0.85)
  if (jpeg.length <= limit) return jpeg
  throw new Error('Image too large')
}

/**
 * Crops a picked image to its centered square and scales it to `size`. Rejects files it
 * cannot decode or shrink below `limit`.
 */
export async function squareImageFromFile(
  file: File,
  size: number,
  limit: number
): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    return squareImage(bitmap, centeredSquare(bitmap.width, bitmap.height), size, limit)
  } finally {
    bitmap.close()
  }
}
