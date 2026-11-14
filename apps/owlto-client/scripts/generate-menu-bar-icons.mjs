#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(scriptDir, '..')
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const defaultSource = resolve(packageDir, 'resources/icon.png')
const defaultOutput = resolve(packageDir, 'resources/owlto-menu-barTemplate.png')

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    source: defaultSource,
    output: defaultOutput,
    width: 18,
    height: 18,
    threshold: 16
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') continue
    const value = args[index + 1]
    if (!value) throw new Error(`${arg} requires a value`)
    index += 1
    if (arg === '--source') options.source = resolve(value)
    else if (arg === '--output') options.output = resolve(value)
    else if (arg === '--width') options.width = Number.parseInt(value, 10)
    else if (arg === '--height') options.height = Number.parseInt(value, 10)
    else if (arg === '--threshold') options.threshold = Number.parseInt(value, 10)
    else throw new Error(`Unknown option: ${arg}`)
  }

  for (const key of ['width', 'height', 'threshold']) {
    if (!Number.isFinite(options[key])) throw new Error(`${key} must be a number`)
  }

  return options
}

function makeCrcTable() {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
}

const crcTable = makeCrcTable()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function readChunks(buffer) {
  if (!buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error('Source is not a PNG file')
  }

  const chunks = []
  let offset = pngSignature.length
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    chunks.push({ type, data })
    offset += 12 + length
    if (type === 'IEND') break
  }
  return chunks
}

function paethPredictor(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function decodePng(buffer) {
  const chunks = readChunks(buffer)
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR')?.data
  if (!ihdr) throw new Error('PNG is missing IHDR')

  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const bitDepth = ihdr[8]
  const colorType = ihdr[9]
  const compression = ihdr[10]
  const filter = ihdr[11]
  const interlace = ihdr[12]
  if (
    bitDepth !== 8 ||
    (colorType !== 2 && colorType !== 6) ||
    compression !== 0 ||
    filter !== 0 ||
    interlace !== 0
  ) {
    throw new Error('Only 8-bit non-interlaced RGB and RGBA PNG files are supported')
  }

  const compressed = Buffer.concat(
    chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data)
  )
  const inflated = inflateSync(compressed)
  const bytesPerPixel = colorType === 6 ? 4 : 3
  const stride = width * bytesPerPixel
  const decodedPixels = Buffer.alloc(width * height * bytesPerPixel)
  let inputOffset = 0

  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[inputOffset]
    inputOffset += 1
    const row = inflated.subarray(inputOffset, inputOffset + stride)
    inputOffset += stride
    const outputOffset = y * stride
    const previousOffset = outputOffset - stride

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? decodedPixels[outputOffset + x - bytesPerPixel] : 0
      const up = y > 0 ? decodedPixels[previousOffset + x] : 0
      const upLeft =
        y > 0 && x >= bytesPerPixel ? decodedPixels[previousOffset + x - bytesPerPixel] : 0
      let value = row[x]
      if (filterType === 1) value = (value + left) & 0xff
      else if (filterType === 2) value = (value + up) & 0xff
      else if (filterType === 3) value = (value + Math.floor((left + up) / 2)) & 0xff
      else if (filterType === 4) value = (value + paethPredictor(left, up, upLeft)) & 0xff
      else if (filterType !== 0) throw new Error(`Unsupported PNG filter: ${filterType}`)
      decodedPixels[outputOffset + x] = value
    }
  }

  const pixels = Buffer.alloc(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    const sourceOffset = index * bytesPerPixel
    const outputOffset = index * 4
    const red = decodedPixels[sourceOffset]
    const green = decodedPixels[sourceOffset + 1]
    const blue = decodedPixels[sourceOffset + 2]
    pixels[outputOffset] = red
    pixels[outputOffset + 1] = green
    pixels[outputOffset + 2] = blue
    pixels[outputOffset + 3] =
      colorType === 6 ? decodedPixels[sourceOffset + 3] : 255 - Math.round((red + green + blue) / 3)
  }

  return { width, height, pixels }
}

function writeChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const output = Buffer.alloc(12 + data.length)
  output.writeUInt32BE(data.length, 0)
  typeBuffer.copy(output, 4)
  data.copy(output, 8)
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length)
  return output
}

function encodePng({ width, height, pixels }) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1)
    raw[rowOffset] = 0
    pixels.copy(raw, rowOffset + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    pngSignature,
    writeChunk('IHDR', ihdr),
    writeChunk('IDAT', deflateSync(raw)),
    writeChunk('IEND', Buffer.alloc(0))
  ])
}

function findAlphaBounds(image, threshold) {
  let minX = image.width
  let minY = image.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.pixels[(y * image.width + x) * 4 + 3]
      if (alpha <= threshold) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < 0 || maxY < 0) throw new Error('Source has no non-background pixels')
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function alphaAt(image, x, y) {
  const clampedX = Math.max(0, Math.min(image.width - 1, x))
  const clampedY = Math.max(0, Math.min(image.height - 1, y))
  const x0 = Math.floor(clampedX)
  const y0 = Math.floor(clampedY)
  const x1 = Math.min(image.width - 1, x0 + 1)
  const y1 = Math.min(image.height - 1, y0 + 1)
  const tx = clampedX - x0
  const ty = clampedY - y0
  const a00 = image.pixels[(y0 * image.width + x0) * 4 + 3]
  const a10 = image.pixels[(y0 * image.width + x1) * 4 + 3]
  const a01 = image.pixels[(y1 * image.width + x0) * 4 + 3]
  const a11 = image.pixels[(y1 * image.width + x1) * 4 + 3]
  const top = a00 * (1 - tx) + a10 * tx
  const bottom = a01 * (1 - tx) + a11 * tx
  return top * (1 - ty) + bottom * ty
}

function renderIcon(source, width, height, threshold) {
  const bounds = findAlphaBounds(source, threshold)
  let targetWidth = Math.round((bounds.width * height) / bounds.height)
  let targetHeight = height
  if (targetWidth > width) {
    targetWidth = width
    targetHeight = Math.round((bounds.height * width) / bounds.width)
  }

  const pixels = Buffer.alloc(width * height * 4)
  const offsetX = Math.floor((width - targetWidth) / 2)
  const offsetY = Math.floor((height - targetHeight) / 2)
  const scaleX = bounds.width / targetWidth
  const scaleY = bounds.height / targetHeight
  const samplesPerAxis = 4

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      let alpha = 0
      for (let sampleY = 0; sampleY < samplesPerAxis; sampleY += 1) {
        for (let sampleX = 0; sampleX < samplesPerAxis; sampleX += 1) {
          alpha += alphaAt(
            source,
            bounds.minX + (x + (sampleX + 0.5) / samplesPerAxis) * scaleX,
            bounds.minY + (y + (sampleY + 0.5) / samplesPerAxis) * scaleY
          )
        }
      }
      alpha /= samplesPerAxis * samplesPerAxis
      if (alpha <= threshold) continue
      const outputOffset = ((offsetY + y) * width + offsetX + x) * 4
      pixels[outputOffset] = 0
      pixels[outputOffset + 1] = 0
      pixels[outputOffset + 2] = 0
      pixels[outputOffset + 3] = Math.round(alpha)
    }
  }

  return { width, height, pixels }
}

function colorSummary(image) {
  const colors = new Map()
  for (let index = 0; index < image.pixels.length; index += 4) {
    const alpha = image.pixels[index + 3]
    if (alpha === 0) continue
    const color = [0, 1, 2].map((offset) => Math.round(image.pixels[index + offset] / 8) * 8)
    const key = `rgb(${color.join(', ')})`
    colors.set(key, (colors.get(key) ?? 0) + 1)
  }
  return [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
}

const options = parseArgs()
const source = decodePng(readFileSync(options.source))
const oneX = renderIcon(source, options.width, options.height, options.threshold)
const twoX = renderIcon(source, options.width * 2, options.height * 2, options.threshold)
const twoXOutput = options.output.replace(/(\.[^.]+)$/, '@2x$1')

writeFileSync(options.output, encodePng(oneX))
writeFileSync(twoXOutput, encodePng(twoX))

console.log(`Source: ${options.source}`)
console.log('Detected source colors:')
for (const [color, count] of colorSummary(source)) {
  console.log(`  ${color}: ${count}`)
}
console.log(`Wrote: ${options.output} (${options.width}x${options.height})`)
console.log(`Wrote: ${twoXOutput} (${options.width * 2}x${options.height * 2})`)
