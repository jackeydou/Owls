import { createRequire } from 'node:module'
import { type BrowserWindow, screen } from 'electron'

const require = createRequire(import.meta.url)

type NativeOverlayModule = {
  showOverlay(bounds: OverlayRect, level: CursorOverlayLevel): void
  hideOverlay(): void
  setOverlayBounds(bounds: OverlayRect): void
  setOverlayLevel(level: CursorOverlayLevel): void
  setAttachedWindowId(windowId?: number | null): void
  jumpCursor(point: CursorPoint): void
  flashClick(point: CursorPoint): void
  setCursorVisible(visible: boolean): void
  setCursorPressed(pressed: boolean): void
  setDebugBackdrop(visible: boolean, label?: string | null): void
  getOverlayState(): {
    hasWindow: boolean
    windowVisible: boolean
    cursorVisible: boolean
    debugBackdropVisible: boolean
    level: string
    bounds: OverlayRect
    cursorPosition: CursorPoint
  }
  disposeOverlay(): void
}

export type CursorPoint = { x: number; y: number }
type OverlayRect = { x: number; y: number; width: number; height: number }

export type CursorHandleOptions = {
  preservePosition?: boolean
  timeoutMs?: number
}

export type CursorHandle = {
  readonly sessionId: string
  readonly id: string
  moveTo(x: number, y: number, opts?: { durationMs?: number }): Promise<void>
  flashClick(x: number, y: number): Promise<void>
  moveAndClick(x: number, y: number, opts?: { durationMs?: number }): Promise<void>
  dragGlide(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs: number
  ): Promise<void>
  isActive(): boolean
  release(): void
}

export type CursorOverlayLevel =
  | 'normal'
  | 'floating'
  | 'torn-off-menu'
  | 'modal-panel'
  | 'main-menu'
  | 'status'
  | 'pop-up-menu'
  | 'screen-saver'

type LeaseToken = { id: string; sessionId: string; acquiredAt: number }
type Waiter = {
  sessionId: string
  resolve: (token: LeaseToken) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout | null
  cancelled: boolean
}

const DEFAULT_OVERLAY_LEVEL: CursorOverlayLevel = 'floating'
const AUTO_HIDE_AFTER_MS = 4000
const DEFAULT_LOCK_TIMEOUT_MS = 30_000
const FRAME_TIME_MS = 16
const MIN_MOVE_DURATION_MS = 440
const MAX_MOVE_DURATION_MS = 6000
const MOVE_MS_PER_POINT = 2.3

const nativeOverlay: NativeOverlayModule | null =
  process.platform === 'darwin'
    ? (() => {
        try {
          return require('@pichu/mac-cursor-overlay') as NativeOverlayModule
        } catch (error) {
          console.warn('[cursor-overlay] failed to load native overlay module:', error)
          return null
        }
      })()
    : null

let enabled = true
let hideTimer: NodeJS.Timeout | null = null
let currentLease: LeaseToken | null = null
const waitQueue: Waiter[] = []
let lastPosition: CursorPoint | null = null
let defaultOrigin: CursorPoint | null = null
let mainWindowGetter: () => BrowserWindow | null = () => null
let overlayLevel: CursorOverlayLevel = DEFAULT_OVERLAY_LEVEL
let overlayBoundsOverride: OverlayRect | null = null
let overlayTargetWindowId: number | null = null
let nativeWindowVisible = false

function getVirtualBounds(): OverlayRect {
  const displays = screen.getAllDisplays()
  if (displays.length === 0) {
    return { x: 0, y: 0, width: 1920, height: 1080 }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const display of displays) {
    const bounds = display.bounds
    if (bounds.x < minX) minX = bounds.x
    if (bounds.y < minY) minY = bounds.y
    if (bounds.x + bounds.width > maxX) maxX = bounds.x + bounds.width
    if (bounds.y + bounds.height > maxY) maxY = bounds.y + bounds.height
  }
  return {
    x: Math.floor(minX),
    y: Math.floor(minY),
    width: Math.ceil(maxX - minX),
    height: Math.ceil(maxY - minY)
  }
}

function getOverlayBounds(): OverlayRect {
  return overlayBoundsOverride ?? getVirtualBounds()
}

function toLocal(globalX: number, globalY: number): CursorPoint {
  const bounds = getOverlayBounds()
  return { x: globalX - bounds.x, y: globalY - bounds.y }
}

function distance(a: CursorPoint, b: CursorPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function durationFor(from: CursorPoint, to: CursorPoint, override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return Math.round(override)
  }
  const delta = distance(from, to)
  return Math.round(
    Math.max(MIN_MOVE_DURATION_MS, Math.min(MAX_MOVE_DURATION_MS, delta * MOVE_MS_PER_POINT))
  )
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

function controlPoint(a: CursorPoint, b: CursorPoint): CursorPoint {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1) return { x: a.x, y: a.y }
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const nx = -dy / dist
  const ny = dx / dist
  const offset = Math.min(260, dist * 0.24)
  const sign = ((Math.floor(a.x) ^ Math.floor(b.y)) & 1) !== 0 ? 1 : -1
  return { x: mx + nx * offset * sign, y: my + ny * offset * sign }
}

function bezier(t: number, a: CursorPoint, c: CursorPoint, b: CursorPoint): CursorPoint {
  const u = 1 - t
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

function isNativeOverlayAvailable(): boolean {
  return enabled && process.platform === 'darwin' && nativeOverlay !== null
}

function getNativeOverlay(): NativeOverlayModule {
  if (nativeOverlay == null) {
    throw new Error('Native cursor overlay module is unavailable.')
  }
  return nativeOverlay
}

function configureNativeOverlay(): void {
  if (!isNativeOverlayAvailable()) return
  const overlay = getNativeOverlay()
  overlay.setAttachedWindowId(overlayTargetWindowId)
  overlay.setOverlayBounds(getOverlayBounds())
  overlay.setOverlayLevel(overlayLevel)
}

function show(): void {
  if (!isNativeOverlayAvailable()) return
  const overlay = getNativeOverlay()
  overlay.showOverlay(getOverlayBounds(), overlayLevel)
  overlay.setCursorVisible(true)
  nativeWindowVisible = true
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function hide(): void {
  if (!isNativeOverlayAvailable()) return
  getNativeOverlay().hideOverlay()
  nativeWindowVisible = false
}

function scheduleAutoHide(): void {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    hideTimer = null
    hide()
  }, AUTO_HIDE_AFTER_MS)
}

function resolveOrigin(): CursorPoint {
  if (defaultOrigin) return defaultOrigin
  const mainWindow = mainWindowGetter()
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const bounds = mainWindow.getContentBounds()
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 56 }
    } catch {
      // fall through
    }
  }
  const primary = screen.getPrimaryDisplay().bounds
  return { x: primary.x + primary.width / 2, y: primary.y + primary.height - 100 }
}

async function setNativeCursorPosition(globalPoint: CursorPoint): Promise<void> {
  if (!isNativeOverlayAvailable()) return
  configureNativeOverlay()
  getNativeOverlay().jumpCursor(toLocal(globalPoint.x, globalPoint.y))
}

async function animateMove(from: CursorPoint, to: CursorPoint, durationMs: number): Promise<void> {
  if (!isNativeOverlayAvailable()) return
  const control = controlPoint(from, to)
  const steps = Math.max(1, Math.ceil(durationMs / FRAME_TIME_MS))
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps
    const point = bezier(easeInOutCubic(t), from, control, to)
    await setNativeCursorPosition(point)
    if (index < steps) {
      await sleep(durationMs / steps)
    }
  }
}

async function internalAnimateMoveTo(
  x: number,
  y: number,
  opts?: { durationMs?: number }
): Promise<void> {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !isNativeOverlayAvailable()) return
  show()
  const target = { x, y }
  const from = lastPosition ?? target
  const durationMs = durationFor(from, target, opts?.durationMs)

  if (lastPosition == null) {
    await setNativeCursorPosition(target)
    lastPosition = target
    return
  }

  await animateMove(from, target, durationMs)
  lastPosition = target
}

async function internalFlashClickAt(x: number, y: number): Promise<void> {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !isNativeOverlayAvailable()) return
  show()
  const point = { x, y }
  getNativeOverlay().flashClick(toLocal(point.x, point.y))
  lastPosition = point
  await sleep(80)
}

async function internalAnimateDragPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  durationMs: number
): Promise<void> {
  if (![fromX, fromY, toX, toY].every(Number.isFinite) || !isNativeOverlayAvailable()) return
  show()
  const from = { x: fromX, y: fromY }
  const to = { x: toX, y: toY }
  const overlay = getNativeOverlay()
  overlay.jumpCursor(toLocal(from.x, from.y))
  overlay.setCursorPressed(true)
  await animateMove(from, to, Math.max(60, Math.round(durationMs)))
  overlay.setCursorPressed(false)
  lastPosition = to
}

async function jumpTo(point: CursorPoint): Promise<void> {
  if (!isNativeOverlayAvailable()) return
  configureNativeOverlay()
  getNativeOverlay().jumpCursor(toLocal(point.x, point.y))
  lastPosition = point
}

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function acquireLease(sessionId: string, timeoutMs: number): Promise<LeaseToken> {
  if (currentLease == null) {
    currentLease = { id: makeId(), sessionId, acquiredAt: Date.now() }
    return Promise.resolve(currentLease)
  }
  return new Promise<LeaseToken>((resolve, reject) => {
    const waiter: Waiter = {
      sessionId,
      resolve,
      reject,
      cancelled: false,
      timer: null
    }
    if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      waiter.timer = setTimeout(() => {
        if (waiter.cancelled) return
        waiter.cancelled = true
        reject(
          new Error(
            `Cursor overlay is busy (held by session "${currentLease?.sessionId ?? '?'}"). Timed out after ${timeoutMs}ms waiting in queue.`
          )
        )
      }, timeoutMs)
    }
    waitQueue.push(waiter)
  })
}

function releaseLease(tokenId: string): void {
  if (currentLease?.id !== tokenId) return
  currentLease = null
  while (waitQueue.length > 0) {
    const next = waitQueue.shift()
    if (!next) break
    if (next.timer) clearTimeout(next.timer)
    if (next.cancelled) continue
    currentLease = { id: makeId(), sessionId: next.sessionId, acquiredAt: Date.now() }
    next.resolve(currentLease)
    return
  }
}

export function setCursorOverlayEnabled(value: boolean): void {
  enabled = value
  if (!enabled) hide()
}

export function isCursorOverlayEnabled(): boolean {
  return enabled
}

export function setCursorOriginHint(point: CursorPoint | null): void {
  if (point == null) {
    defaultOrigin = null
    return
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
  defaultOrigin = { x: point.x, y: point.y }
}

export function setCursorOverlayMainWindowGetter(getter: () => BrowserWindow | null): void {
  mainWindowGetter = getter
}

export function setCursorOverlayLevel(level: CursorOverlayLevel): void {
  overlayLevel = level
  if (isNativeOverlayAvailable()) {
    getNativeOverlay().setOverlayLevel(level)
  }
}

export function getCursorOverlayLevel(): CursorOverlayLevel {
  return overlayLevel
}

export function getCursorOverlayTargetWindowId(): number | null {
  return overlayTargetWindowId
}

export function getCursorOverlayDebugState(): {
  enabled: boolean
  platform: NodeJS.Platform
  pageReady: boolean
  hasWindow: boolean
  windowVisible: boolean
  level: CursorOverlayLevel
  currentLeaseSessionId: string | null
  lastPosition: CursorPoint | null
  defaultOrigin: CursorPoint | null
  targetWindowId: number | null
  overlayBounds: OverlayRect
  boundsOverride: OverlayRect | null
  virtualBounds: OverlayRect
} {
  const nativeState = isNativeOverlayAvailable() ? getNativeOverlay().getOverlayState() : null
  return {
    enabled,
    platform: process.platform,
    pageReady: nativeState !== null,
    hasWindow: nativeState?.hasWindow ?? false,
    windowVisible: nativeState?.windowVisible ?? nativeWindowVisible,
    level: overlayLevel,
    currentLeaseSessionId: currentLease?.sessionId ?? null,
    lastPosition,
    defaultOrigin,
    targetWindowId: overlayTargetWindowId,
    overlayBounds: getOverlayBounds(),
    boundsOverride: overlayBoundsOverride,
    virtualBounds: getVirtualBounds()
  }
}

export async function getCursorOverlayDebugProbe(): Promise<{
  state: ReturnType<typeof getCursorOverlayDebugState>
  dom: {
    hasApi: boolean
    wrapTransform: string | null
    cursorOpacity: string | null
    cursorRect: {
      x: number
      y: number
      width: number
      height: number
    } | null
  } | null
  snapshot: {
    mimeType: 'image/png'
    data: string
    width: number
    height: number
  } | null
}> {
  return {
    state: getCursorOverlayDebugState(),
    dom: null,
    snapshot: null
  }
}

export async function setCursorOverlayDebugBackdrop(
  visible: boolean,
  label = 'Cursor Overlay Debug'
): Promise<void> {
  if (!isNativeOverlayAvailable()) return
  getNativeOverlay().setDebugBackdrop(visible, label)
}

export function setCursorOverlayBoundsOverride(bounds: OverlayRect | null): void {
  overlayBoundsOverride = bounds
  if (isNativeOverlayAvailable()) {
    getNativeOverlay().setOverlayBounds(getOverlayBounds())
    if (lastPosition) {
      getNativeOverlay().jumpCursor(toLocal(lastPosition.x, lastPosition.y))
    }
  }
}

export function setCursorOverlayTargetWindowId(windowId: number | null): void {
  overlayTargetWindowId = Number.isInteger(windowId) && windowId && windowId > 0 ? windowId : null
  if (isNativeOverlayAvailable()) {
    configureNativeOverlay()
  }
}

export async function acquireCursor(
  sessionId: string,
  opts?: CursorHandleOptions
): Promise<CursorHandle> {
  if (!isNativeOverlayAvailable()) {
    console.warn(
      '[cursor-overlay] acquireCursor returning noop handle enabled=%s platform=%s session=%s',
      enabled,
      process.platform,
      sessionId
    )
    return makeNoopHandle(sessionId)
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
  console.info('[cursor-overlay] acquireCursor start session=%s timeoutMs=%d', sessionId, timeoutMs)
  const token = await acquireLease(sessionId, timeoutMs)

  try {
    const wasHidden = !nativeWindowVisible
    if (wasHidden && !opts?.preservePosition) {
      const origin = resolveOrigin()
      console.info(
        '[cursor-overlay] preparing origin session=%s origin=(%d,%d)',
        sessionId,
        Math.round(origin.x),
        Math.round(origin.y)
      )
      await jumpTo(origin)
    }

    show()
    console.info(
      '[cursor-overlay] acquireCursor ready session=%s visible=%s native=%s',
      sessionId,
      nativeWindowVisible,
      nativeOverlay !== null
    )
    return makeRealHandle(token)
  } catch (error) {
    releaseLease(token.id)
    console.error('[cursor-overlay] acquireCursor failed for session=%s:', sessionId, error)
    throw error
  }
}

function makeRealHandle(token: LeaseToken): CursorHandle {
  let released = false
  const isActive = (): boolean => !released && currentLease?.id === token.id

  return {
    sessionId: token.sessionId,
    id: token.id,
    isActive,
    async moveTo(x, y, moveOpts) {
      if (!isActive()) return
      await internalAnimateMoveTo(x, y, moveOpts)
    },
    async flashClick(x, y) {
      if (!isActive()) return
      await internalFlashClickAt(x, y)
    },
    async moveAndClick(x, y, moveOpts) {
      if (!isActive()) return
      await internalAnimateMoveTo(x, y, moveOpts)
      await internalFlashClickAt(x, y)
    },
    async dragGlide(fromX, fromY, toX, toY, durationMs) {
      if (!isActive()) return
      await internalAnimateDragPath(fromX, fromY, toX, toY, durationMs)
    },
    release() {
      if (released) return
      released = true
      releaseLease(token.id)
      if (currentLease == null) scheduleAutoHide()
    }
  }
}

function makeNoopHandle(sessionId: string): CursorHandle {
  return {
    sessionId,
    id: 'noop',
    isActive: () => false,
    async moveTo() {},
    async flashClick() {},
    async moveAndClick() {},
    async dragGlide() {},
    release() {}
  }
}

export async function withCursor<T>(
  sessionId: string,
  fn: (cursor: CursorHandle) => Promise<T>,
  opts?: CursorHandleOptions
): Promise<T> {
  const cursor = await acquireCursor(sessionId, opts)
  try {
    return await fn(cursor)
  } finally {
    cursor.release()
  }
}

export function disposeCursorOverlay(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  while (waitQueue.length > 0) {
    const waiter = waitQueue.shift()
    if (!waiter) break
    if (waiter.timer) clearTimeout(waiter.timer)
    if (!waiter.cancelled) {
      waiter.cancelled = true
      waiter.reject(new Error('Cursor overlay disposed during shutdown.'))
    }
  }
  currentLease = null
  lastPosition = null
  nativeWindowVisible = false
  if (nativeOverlay) {
    nativeOverlay.disposeOverlay()
  }
}
