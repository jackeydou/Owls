import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { listWindows, type MacWindow } from '@pichu/mac-window-list'
import { desktopCapturer, nativeImage, screen, systemPreferences } from 'electron'
import { getDataRoot } from '../../pichu-paths.js'
import { isComputerUseHelperAvailable, sendComputerUseHelperRequest } from './helper-client.js'
import {
  assertComputerUseRuntimeAvailable,
  isInProcessComputerUseAllowed
} from './runtime-policy.js'

export type DisplayInfo = {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  primary: boolean
  internal: boolean
}

export type WindowSourceInfo = {
  id: string
  name: string
  /** Owning application name (e.g. "Safari", "Code"), from CGWindowListCopyWindowInfo. */
  ownerName: string | null
  /** Window title from CoreGraphics. May differ from `name` and is often more descriptive. */
  title: string | null
  appIcon: boolean
  displayId: string | null
}

/**
 * `desktopCapturer` source ids on macOS look like `window:<windowNumber>:<displayIndex>`.
 * We pull out the middle number to join with `CGWindowListCopyWindowInfo` results.
 */
function extractCgWindowId(sourceId: string): number | null {
  const match = /^window:(\d+):/.exec(sourceId)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) ? n : null
}

function safeListNativeWindows(): MacWindow[] {
  if (process.platform !== 'darwin') return []
  try {
    return listWindows({ onScreenOnly: true })
  } catch (error) {
    console.warn('[screen-capture] mac-window-list failed:', error)
    return []
  }
}

/**
 * Geometry metadata describing what the screenshot pixels actually map to.
 *
 * All `*Bounds` values are in macOS **points** in the **CoreGraphics global
 * coordinate space** (origin = top-left of the primary display, Y grows down).
 * To convert a point inside the screenshot back to a global point coordinate:
 *
 *   pointX = anchor.x + (pixelX / thumbnailScale) / displayScaleFactor
 *   pointY = anchor.y + (pixelY / thumbnailScale) / displayScaleFactor
 *
 * where `anchor` is `windowBounds` (for `region: 'window-frame'`) or
 * `displayBounds` (for `region: 'display-full'`).
 */
export type CaptureGeometry = {
  /** What the screenshot covers. `window-frame` includes title bar/shadow padding (CGWindowBounds), not just the content view. */
  region: 'window-frame' | 'display-full'
  coordinateSpace: 'cg-global'
  /** Unit of all `*Bounds` fields. macOS reports window/display geometry in points. */
  unit: 'point'
  originY: 'top'
  /** Display the screenshot was taken from, when known. */
  displayId?: number
  /** Display bounds in CG global points. */
  displayBounds?: { x: number; y: number; width: number; height: number }
  /** Backing scale factor (Retina). 2 means 1 point = 2 pixels along each axis. */
  displayScaleFactor: number
  /** Window outer bounds (frame, includes title bar) in CG global points. Only set for window captures. */
  windowBounds?: { x: number; y: number; width: number; height: number }
  /** Original (un-clamped) pixel size of the captured region, before `maxDimension` shrinking. */
  nativePixelSize: { width: number; height: number }
  /** Returned PNG pixel width / nativePixelSize.width. <= 1 when thumbnail was clamped. */
  thumbnailScale: number
}

export type CapturedImage = {
  data?: string
  path: string
  mimeType: 'image/png'
  /** PNG pixel width (already clamped by `maxDimension`). */
  width: number
  /** PNG pixel height (already clamped by `maxDimension`). */
  height: number
  source: { id: string; name: string; cgWindowId?: number }
  geometry: CaptureGeometry
}

const SCREEN_CAPTURE_DISABLED_MESSAGE =
  'Screen capture tools require Computer Use to be enabled, with macOS Screen Recording access granted when the tool is first used.'
const HELPER_CAPTURE_DIR_PREFIX = 'pichu-computer-use-capture-'

function screenshotDir(): string {
  return join(getDataRoot(), 'computer-use', 'screenshots')
}

function writeScreenshotFile(buffer: Buffer, prefix: string): string {
  const dir = screenshotDir()
  mkdirSync(dir, { recursive: true })
  const filePath = join(
    dir,
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  )
  writeFileSync(filePath, buffer)
  return filePath
}

function isPathInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${sep}`)
}

function readHelperCapturedPng(path: string, expectedPrefix: 'desktop' | 'window'): Buffer {
  const tempRoot = realpathSync(tmpdir())
  const captureDir = dirname(path)
  const realCaptureDir = realpathSync(captureDir)
  const realPath = realpathSync(path)
  if (
    !isPathInside(tempRoot, realCaptureDir) ||
    !isPathInside(realCaptureDir, realPath) ||
    !basename(realCaptureDir).startsWith(HELPER_CAPTURE_DIR_PREFIX) ||
    !basename(realPath).startsWith(`${expectedPrefix}-`) ||
    !basename(realPath).endsWith('.png')
  ) {
    throw new Error('Computer Use helper returned an unexpected capture path.')
  }

  try {
    return readFileSync(realPath)
  } finally {
    rmSync(realCaptureDir, { recursive: true, force: true })
  }
}

function ensureCaptureEnabled(opts: { computerUseEnabled: boolean }): void {
  if (!opts.computerUseEnabled) {
    throw new Error(SCREEN_CAPTURE_DISABLED_MESSAGE)
  }
  assertComputerUseRuntimeAvailable()
}

function ensureInProcessCaptureAllowed(opts: { computerUseEnabled: boolean }): void {
  ensureCaptureEnabled(opts)
  if (!isInProcessComputerUseAllowed()) {
    throw new Error(
      'Screen capture stable builds must route macOS capture through the Owls Computer Use helper.'
    )
  }
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen')
    if (status !== 'granted') {
      throw new Error(
        `macOS Screen Recording permission is "${status}". Open System Settings → Privacy & Security → Screen Recording and grant access to the process shown by macOS.`
      )
    }
  }
}

export function listDisplays(): DisplayInfo[] {
  const displays = screen.getAllDisplays()
  const primaryId = screen.getPrimaryDisplay().id
  return displays.map((display, index) => ({
    id: display.id,
    label: display.label || `Display ${index + 1}`,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor,
    primary: display.id === primaryId,
    internal: display.internal
  }))
}

function pickDisplay(displayId?: number): Electron.Display {
  if (displayId === undefined) return screen.getPrimaryDisplay()
  const match = screen.getAllDisplays().find((d) => d.id === displayId)
  if (!match) {
    throw new Error(
      `Display ${displayId} not found. Use listScreenSources to see available displays.`
    )
  }
  return match
}

function pixelSize(display: Electron.Display): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(display.size.width * display.scaleFactor)),
    height: Math.max(1, Math.round(display.size.height * display.scaleFactor))
  }
}

function clampThumbnailSize(
  size: { width: number; height: number },
  maxDimension?: number
): { width: number; height: number } {
  if (!maxDimension || maxDimension <= 0) return size
  const longest = Math.max(size.width, size.height)
  if (longest <= maxDimension) return size
  const scale = maxDimension / longest
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale))
  }
}

type RgbaColor = { r: number; g: number; b: number; a: number }

const PIXEL_REFERENCE_BAND = 18
const DIGIT_FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111']
}

function pickNiceStep(length: number): number {
  const target = Math.max(60, length / 8)
  const power = 10 ** Math.floor(Math.log10(target))
  const factors = [1, 2, 2.5, 5, 10]
  for (const factor of factors) {
    const step = factor * power
    if (step >= target) return Math.max(50, Math.round(step))
  }
  return Math.max(50, Math.round(10 * power))
}

function blendPixel(
  bitmap: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  color: RgbaColor
): void {
  if (x < 0 || y < 0 || x >= width || y >= height || color.a <= 0) return
  const index = (y * width + x) * 4
  const srcAlpha = color.a / 255
  const dstBlue = bitmap[index] ?? 0
  const dstGreen = bitmap[index + 1] ?? 0
  const dstRed = bitmap[index + 2] ?? 0
  bitmap[index] = Math.round(dstBlue * (1 - srcAlpha) + color.b * srcAlpha)
  bitmap[index + 1] = Math.round(dstGreen * (1 - srcAlpha) + color.g * srcAlpha)
  bitmap[index + 2] = Math.round(dstRed * (1 - srcAlpha) + color.r * srcAlpha)
  bitmap[index + 3] = 255
}

function fillRect(
  bitmap: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: RgbaColor
): void {
  const startX = Math.max(0, Math.floor(x))
  const startY = Math.max(0, Math.floor(y))
  const endX = Math.min(width, Math.ceil(x + rectWidth))
  const endY = Math.min(height, Math.ceil(y + rectHeight))
  for (let yy = startY; yy < endY; yy += 1) {
    for (let xx = startX; xx < endX; xx += 1) {
      blendPixel(bitmap, width, height, xx, yy, color)
    }
  }
}

function drawVerticalLine(
  bitmap: Buffer,
  width: number,
  height: number,
  x: number,
  y1: number,
  y2: number,
  color: RgbaColor
): void {
  const xx = Math.round(x)
  const start = Math.max(0, Math.min(Math.round(y1), Math.round(y2)))
  const end = Math.min(height - 1, Math.max(Math.round(y1), Math.round(y2)))
  for (let yy = start; yy <= end; yy += 1) {
    blendPixel(bitmap, width, height, xx, yy, color)
  }
}

function drawHorizontalLine(
  bitmap: Buffer,
  width: number,
  height: number,
  x1: number,
  x2: number,
  y: number,
  color: RgbaColor
): void {
  const yy = Math.round(y)
  const start = Math.max(0, Math.min(Math.round(x1), Math.round(x2)))
  const end = Math.min(width - 1, Math.max(Math.round(x1), Math.round(x2)))
  for (let xx = start; xx <= end; xx += 1) {
    blendPixel(bitmap, width, height, xx, yy, color)
  }
}

function drawDigit(
  bitmap: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  digit: string,
  color: RgbaColor,
  scale = 2
): number {
  const glyph = DIGIT_FONT[digit]
  if (!glyph) return 0
  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] === '1') {
        fillRect(bitmap, width, height, x + col * scale, y + row * scale, scale, scale, color)
      }
    }
  }
  return glyph[0].length * scale
}

function drawNumberLabel(
  bitmap: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  value: number,
  color: RgbaColor
): void {
  const text = String(Math.max(0, Math.round(value)))
  const scale = 2
  const charWidth = 3 * scale
  const spacing = scale
  const textWidth = text.length * charWidth + Math.max(0, text.length - 1) * spacing
  const textHeight = 5 * scale
  fillRect(bitmap, width, height, x - 2, y - 1, textWidth + 4, textHeight + 2, {
    r: 15,
    g: 23,
    b: 42,
    a: 150
  })
  let cursorX = x
  for (const digit of text) {
    cursorX += drawDigit(bitmap, width, height, cursorX, y, digit, color, scale) + spacing
  }
}

function addPixelReferenceOverlay(png: Buffer): Buffer {
  const image = nativeImage.createFromBuffer(png)
  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0) return png
  const bitmap = Buffer.from(image.toBitmap())
  const band = Math.min(
    PIXEL_REFERENCE_BAND,
    Math.max(12, Math.floor(Math.min(width, height) * 0.08))
  )
  const stepX = pickNiceStep(width)
  const stepY = pickNiceStep(height)
  const axisColor = { r: 56, g: 189, b: 248, a: 210 }
  const guideColor = { r: 56, g: 189, b: 248, a: 44 }
  const minorTickColor = { r: 255, g: 255, b: 255, a: 110 }
  const labelColor = { r: 255, g: 255, b: 255, a: 240 }

  fillRect(bitmap, width, height, 0, 0, width, band, { r: 15, g: 23, b: 42, a: 70 })
  fillRect(bitmap, width, height, 0, 0, band, height, { r: 15, g: 23, b: 42, a: 70 })
  fillRect(bitmap, width, height, 0, 0, band, band, { r: 15, g: 23, b: 42, a: 110 })

  drawHorizontalLine(bitmap, width, height, 0, width - 1, band, axisColor)
  drawVerticalLine(bitmap, width, height, band, 0, height - 1, axisColor)

  const minorStepX = Math.max(20, Math.round(stepX / 3))
  for (let x = Math.ceil(band / minorStepX) * minorStepX; x < width; x += minorStepX) {
    drawVerticalLine(bitmap, width, height, x, band - 4, band, minorTickColor)
  }
  const minorStepY = Math.max(20, Math.round(stepY / 3))
  for (let y = Math.ceil(band / minorStepY) * minorStepY; y < height; y += minorStepY) {
    drawHorizontalLine(bitmap, width, height, band - 4, band, y, minorTickColor)
  }

  for (let x = Math.ceil(band / stepX) * stepX; x < width; x += stepX) {
    drawVerticalLine(bitmap, width, height, x, 0, height - 1, guideColor)
    drawVerticalLine(bitmap, width, height, x, 0, band + 4, axisColor)
    const labelX = Math.min(width - 22, Math.max(band + 2, x + 3))
    drawNumberLabel(bitmap, width, height, labelX, 4, x, labelColor)
  }

  for (let y = Math.ceil(band / stepY) * stepY; y < height; y += stepY) {
    drawHorizontalLine(bitmap, width, height, 0, width - 1, y, guideColor)
    drawHorizontalLine(bitmap, width, height, 0, band + 4, y, axisColor)
    const labelY = Math.min(height - 12, Math.max(band + 2, y - 5))
    drawNumberLabel(bitmap, width, height, 3, labelY, y, labelColor)
  }

  drawNumberLabel(bitmap, width, height, band + 2, 4, 0, labelColor)
  drawNumberLabel(bitmap, width, height, 3, band + 2, 0, labelColor)

  return nativeImage
    .createFromBuffer(bitmap, {
      width,
      height,
      scaleFactor: 1
    })
    .toPNG()
}

export type ListSourcesOptions = {
  computerUseEnabled: boolean
  includeWindows?: boolean
}

export async function listScreenSources(
  options: ListSourcesOptions
): Promise<{ displays: DisplayInfo[]; windows: WindowSourceInfo[] }> {
  ensureCaptureEnabled({ computerUseEnabled: options.computerUseEnabled })

  const displays = listDisplays()

  if (!options.includeWindows) {
    return { displays, windows: [] }
  }

  if (!isInProcessComputerUseAllowed()) {
    return {
      displays,
      windows: safeListNativeWindows().map((window) => ({
        id: `window:${window.windowId}:helper`,
        name: `${window.ownerName}${window.title ? ` — ${window.title}` : ''}`,
        ownerName: window.ownerName,
        title: window.title ?? null,
        appIcon: false,
        displayId: null
      }))
    }
  }

  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false
  })

  const nativeById = new Map<number, MacWindow>()
  for (const w of safeListNativeWindows()) {
    nativeById.set(w.windowId, w)
  }

  const windows: WindowSourceInfo[] = sources
    .filter((s) => Boolean(s.name?.trim()))
    .map((s) => {
      const cgId = extractCgWindowId(s.id)
      const native = cgId !== null ? nativeById.get(cgId) : undefined
      return {
        id: s.id,
        name: s.name,
        ownerName: native?.ownerName ?? null,
        title: native?.title ?? null,
        appIcon: !s.appIcon?.isEmpty(),
        displayId: s.display_id || null
      }
    })

  return { displays, windows }
}

export type CaptureDesktopOptions = {
  computerUseEnabled: boolean
  displayId?: number
  maxDimension?: number
}

export async function captureDesktop(options: CaptureDesktopOptions): Promise<CapturedImage> {
  const display = pickDisplay(options.displayId)
  const fullSize = pixelSize(display)
  const thumbnailSize = clampThumbnailSize(fullSize, options.maxDimension ?? 1920)

  if (!isInProcessComputerUseAllowed()) {
    ensureCaptureEnabled({ computerUseEnabled: options.computerUseEnabled })
    if (!isComputerUseHelperAvailable()) {
      throw new Error('Owls Computer Use helper is not available for desktop capture.')
    }
    const result = await sendComputerUseHelperRequest({
      method: 'captureDesktopPng',
      params: { displayId: display.id }
    })
    if (result.type !== 'capturedPng') {
      throw new Error(`Computer Use helper returned ${result.type}; expected capturedPng.`)
    }
    const rawPng = readHelperCapturedPng(result.path, 'desktop')
    const image = resizeImageForMaxDimension(
      nativeImage.createFromBuffer(rawPng),
      options.maxDimension ?? 1920
    )
    const size = image.getSize()
    const annotatedPng = addPixelReferenceOverlay(image.toPNG())
    const thumbnailScale = fullSize.width > 0 ? size.width / fullSize.width : 1

    return {
      data: annotatedPng.toString('base64'),
      path: writeScreenshotFile(annotatedPng, 'desktop'),
      mimeType: 'image/png',
      width: size.width,
      height: size.height,
      source: { id: `screen:${display.id}:helper`, name: display.label || `Display ${display.id}` },
      geometry: {
        region: 'display-full',
        coordinateSpace: 'cg-global',
        unit: 'point',
        originY: 'top',
        displayId: display.id,
        displayBounds: {
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height
        },
        displayScaleFactor: display.scaleFactor,
        nativePixelSize: fullSize,
        thumbnailScale
      }
    }
  }

  ensureInProcessCaptureAllowed({ computerUseEnabled: options.computerUseEnabled })

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize,
    fetchWindowIcons: false
  })

  if (sources.length === 0) {
    throw new Error('No screen sources are available. Verify macOS Screen Recording permission.')
  }

  const targetIdSuffix = `:${display.id}`
  const match =
    sources.find((s) => s.display_id === String(display.id)) ??
    sources.find((s) => s.id.endsWith(targetIdSuffix))

  if (!match) {
    const available = sources
      .map((s) => `${s.name || '(unnamed)'} [id=${s.id}, display_id=${s.display_id || '(none)'}]`)
      .join('; ')
    throw new Error(
      `Screen source for display ${display.id} (${display.label || 'unlabeled'}) was not found. ` +
        `Available screen sources: ${available || '(none)'}. Use listScreenSources to refresh display ids.`
    )
  }

  const png = match.thumbnail.toPNG()
  const size = match.thumbnail.getSize()
  const thumbnailScale = fullSize.width > 0 ? size.width / fullSize.width : 1
  const annotatedPng = addPixelReferenceOverlay(png)

  return {
    data: annotatedPng.toString('base64'),
    path: writeScreenshotFile(annotatedPng, 'desktop'),
    mimeType: 'image/png',
    width: size.width,
    height: size.height,
    source: { id: match.id, name: match.name },
    geometry: {
      region: 'display-full',
      coordinateSpace: 'cg-global',
      unit: 'point',
      originY: 'top',
      displayId: display.id,
      displayBounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height
      },
      displayScaleFactor: display.scaleFactor,
      nativePixelSize: fullSize,
      thumbnailScale
    }
  }
}

export type CaptureWindowOptions = {
  computerUseEnabled: boolean
  windowId?: number
  query?: string
  sourceId?: string
  maxDimension?: number
}

type EnrichedSource = {
  source: Electron.DesktopCapturerSource
  native: MacWindow | undefined
}

/**
 * Matching priority (case-insensitive):
 *  1. exact match on owner app name (e.g. "Safari")
 *  2. exact match on window title (CG title) or `source.name`
 *  3. startsWith on owner name
 *  4. substring on owner name
 *  5. substring on window title / source name
 */
function matchEnriched(items: EnrichedSource[], query: string): EnrichedSource | undefined {
  const needle = query.trim().toLowerCase()
  if (!needle) return undefined

  const owner = (e: EnrichedSource) => e.native?.ownerName?.toLowerCase() ?? ''
  const title = (e: EnrichedSource) => (e.native?.title ?? e.source.name ?? '').toLowerCase()

  return (
    items.find((e) => owner(e) === needle) ??
    items.find((e) => title(e) === needle) ??
    items.find((e) => owner(e).startsWith(needle)) ??
    items.find((e) => owner(e).includes(needle)) ??
    items.find((e) => title(e).includes(needle))
  )
}

function matchNativeWindow(items: MacWindow[], query: string): MacWindow | undefined {
  const needle = query.trim().toLowerCase()
  if (!needle) return undefined

  const owner = (window: MacWindow) => window.ownerName.toLowerCase()
  const title = (window: MacWindow) => (window.title ?? '').toLowerCase()

  return (
    items.find((window) => owner(window) === needle) ??
    items.find((window) => title(window) === needle) ??
    items.find((window) => owner(window).startsWith(needle)) ??
    items.find((window) => owner(window).includes(needle)) ??
    items.find((window) => title(window).includes(needle))
  )
}

function displayForWindowBounds(windowBounds: MacWindow['bounds'] | undefined): Electron.Display {
  const primary = screen.getPrimaryDisplay()
  if (!windowBounds) return primary
  try {
    return screen.getDisplayMatching({
      x: Math.round(windowBounds.x),
      y: Math.round(windowBounds.y),
      width: Math.max(1, Math.round(windowBounds.width)),
      height: Math.max(1, Math.round(windowBounds.height))
    })
  } catch {
    return primary
  }
}

function resizeImageForMaxDimension(
  image: Electron.NativeImage,
  maxDimension?: number
): Electron.NativeImage {
  const currentSize = image.getSize()
  const targetSize = clampThumbnailSize(currentSize, maxDimension)
  if (targetSize.width === currentSize.width && targetSize.height === currentSize.height) {
    return image
  }
  return image.resize({ width: targetSize.width, height: targetSize.height, quality: 'best' })
}

async function captureWindowWithHelper(options: {
  computerUseEnabled: boolean
  windowId?: number
  query?: string
  sourceId?: string
  maxDimension?: number
}): Promise<CapturedImage> {
  ensureCaptureEnabled({ computerUseEnabled: options.computerUseEnabled })
  if (!isComputerUseHelperAvailable()) {
    throw new Error('Owls Computer Use helper is not available for window capture.')
  }

  const nativeWindows = safeListNativeWindows()
  const sourceWindowId = options.sourceId ? extractCgWindowId(options.sourceId) : null
  const windowId = options.windowId ?? sourceWindowId ?? null
  const match =
    windowId !== null
      ? nativeWindows.find((window) => window.windowId === windowId)
      : options.query
        ? matchNativeWindow(nativeWindows, options.query)
        : undefined

  if (!match) {
    const sample = nativeWindows
      .map((window) => `${window.ownerName} — ${window.title ?? `window ${window.windowId}`}`)
      .filter((label) => label.trim())
      .slice(0, 8)
      .join('; ')
    throw new Error(
      `No window matched ${
        windowId !== null ? `windowId ${windowId}` : `query "${options.query ?? ''}"`
      }. Open windows include: ${sample || '(none visible)'}.`
    )
  }

  const result = await sendComputerUseHelperRequest({
    method: 'captureWindowPng',
    params: { windowId: match.windowId }
  })
  if (result.type !== 'capturedPng') {
    throw new Error(`Computer Use helper returned ${result.type}; expected capturedPng.`)
  }

  const rawPng = readHelperCapturedPng(result.path, 'window')
  const image = resizeImageForMaxDimension(
    nativeImage.createFromBuffer(rawPng),
    options.maxDimension ?? 1920
  )
  const size = image.getSize()
  const png = image.toPNG()
  const annotatedPng = addPixelReferenceOverlay(png)
  const display = displayForWindowBounds(match.bounds)
  const nativePixelSize = {
    width: Math.max(1, Math.round(match.bounds.width * display.scaleFactor)),
    height: Math.max(1, Math.round(match.bounds.height * display.scaleFactor))
  }
  const thumbnailScale = nativePixelSize.width > 0 ? size.width / nativePixelSize.width : 1
  const friendlyName = `${match.ownerName}${match.title ? ` — ${match.title}` : ''}`

  return {
    data: annotatedPng.toString('base64'),
    path: writeScreenshotFile(annotatedPng, 'window'),
    mimeType: 'image/png',
    width: size.width,
    height: size.height,
    source: {
      id: `window:${match.windowId}:helper`,
      name: friendlyName,
      cgWindowId: match.windowId
    },
    geometry: {
      region: 'window-frame',
      coordinateSpace: 'cg-global',
      unit: 'point',
      originY: 'top',
      displayId: display.id,
      displayBounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height
      },
      displayScaleFactor: display.scaleFactor,
      windowBounds: {
        x: match.bounds.x,
        y: match.bounds.y,
        width: match.bounds.width,
        height: match.bounds.height
      },
      nativePixelSize,
      thumbnailScale
    }
  }
}

export async function captureAppWindow(options: CaptureWindowOptions): Promise<CapturedImage> {
  if (!isInProcessComputerUseAllowed()) {
    return await captureWindowWithHelper(options)
  }

  ensureInProcessCaptureAllowed({ computerUseEnabled: options.computerUseEnabled })

  if (!options.query?.trim() && !options.sourceId?.trim() && options.windowId === undefined) {
    throw new Error('Provide either a window query (app or title substring) or a sourceId.')
  }

  const maxDim = options.maxDimension ?? 1920
  const primary = screen.getPrimaryDisplay()
  const initialThumbnail = clampThumbnailSize(pixelSize(primary), maxDim)

  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: initialThumbnail,
    fetchWindowIcons: false
  })

  const nativeById = new Map<number, MacWindow>()
  for (const w of safeListNativeWindows()) {
    nativeById.set(w.windowId, w)
  }

  const enriched: EnrichedSource[] = sources.map((source) => {
    const cgId = extractCgWindowId(source.id)
    return { source, native: cgId !== null ? nativeById.get(cgId) : undefined }
  })

  const match =
    options.windowId !== undefined
      ? enriched.find((e) => extractCgWindowId(e.source.id) === options.windowId)
      : options.sourceId
        ? enriched.find((e) => e.source.id === options.sourceId)
        : matchEnriched(enriched, options.query ?? '')

  if (!match) {
    const sample = enriched
      .map((e) =>
        e.native?.ownerName
          ? `${e.native.ownerName} — ${e.native.title ?? e.source.name}`
          : e.source.name
      )
      .filter((label) => label.trim())
      .slice(0, 8)
      .join('; ')
    throw new Error(
      `No window matched ${
        options.sourceId ? `sourceId "${options.sourceId}"` : `query "${options.query}"`
      }. Open windows include: ${sample || '(none visible)'}.`
    )
  }

  const png = match.source.thumbnail.toPNG()
  const size = match.source.thumbnail.getSize()
  const annotatedPng = addPixelReferenceOverlay(png)
  const friendlyName = match.native?.ownerName
    ? `${match.native.ownerName}${match.native.title ? ` — ${match.native.title}` : ''}`
    : match.source.name

  const cgWindowId = extractCgWindowId(match.source.id) ?? undefined
  const windowBounds = match.native?.bounds

  // Pick the display the window lives on. desktopCapturer's display_id is the most
  // authoritative; fall back to a geometric match against windowBounds; finally
  // default to primary.
  let display: Electron.Display = primary
  const sourceDisplayIdNum = Number(match.source.display_id)
  if (Number.isFinite(sourceDisplayIdNum)) {
    const found = screen.getAllDisplays().find((d) => d.id === sourceDisplayIdNum)
    if (found) display = found
  } else if (windowBounds) {
    try {
      display = screen.getDisplayMatching({
        x: Math.round(windowBounds.x),
        y: Math.round(windowBounds.y),
        width: Math.max(1, Math.round(windowBounds.width)),
        height: Math.max(1, Math.round(windowBounds.height))
      })
    } catch {
      // keep primary
    }
  }

  // Native pixel size of the window itself (points × scaleFactor). Fall back to
  // the returned thumbnail size when we don't know the window bounds.
  const nativePixelSize = windowBounds
    ? {
        width: Math.max(1, Math.round(windowBounds.width * display.scaleFactor)),
        height: Math.max(1, Math.round(windowBounds.height * display.scaleFactor))
      }
    : { width: size.width, height: size.height }
  const thumbnailScale = nativePixelSize.width > 0 ? size.width / nativePixelSize.width : 1

  return {
    data: annotatedPng.toString('base64'),
    path: writeScreenshotFile(annotatedPng, 'window'),
    mimeType: 'image/png',
    width: size.width,
    height: size.height,
    source: { id: match.source.id, name: friendlyName, cgWindowId },
    geometry: {
      region: 'window-frame',
      coordinateSpace: 'cg-global',
      unit: 'point',
      originY: 'top',
      displayId: display.id,
      displayBounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height
      },
      displayScaleFactor: display.scaleFactor,
      windowBounds: windowBounds
        ? {
            x: windowBounds.x,
            y: windowBounds.y,
            width: windowBounds.width,
            height: windowBounds.height
          }
        : undefined,
      nativePixelSize,
      thumbnailScale
    }
  }
}
