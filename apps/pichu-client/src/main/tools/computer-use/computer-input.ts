import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ModifierFlags } from '@pichu/mac-input'
import {
  checkAccessibility,
  activateApp as nativeActivateApp,
  axPressNode as nativeAxPressNode,
  backgroundClick as nativeBackgroundClick,
  backgroundDrag as nativeBackgroundDrag,
  backgroundPressKey as nativeBackgroundPressKey,
  backgroundType as nativeBackgroundType,
  getFocusedWindowAccessibilityTree as nativeGetFocusedWindowAccessibilityTree,
  getFrontmostAppPid as nativeGetFrontmostAppPid,
  isAppActive as nativeIsAppActive,
  mouseClick as nativeMouseClick,
  mouseDrag as nativeMouseDrag,
  mouseMove as nativeMouseMove,
  pressKey as nativePressKey,
  typeText as nativeTypeText
} from '@pichu/mac-input'
import { listWindows } from '@pichu/mac-window-list'
import { screen } from 'electron'
import { getDataRoot } from '../../pichu-paths.js'
import { isComputerUseHelperAvailable, sendComputerUseHelperRequest } from './helper-client.js'
import {
  assertComputerUseRuntimeAvailable,
  isInProcessComputerUseAllowed
} from './runtime-policy.js'

/**
 * Coordinate space contract.
 *
 * All x/y values accepted by the mouse helpers are in the **CoreGraphics
 * global point space** — origin at top-left of the primary display, Y grows
 * down, units are macOS points (not pixels). This is the same space used by:
 *
 *   - `screen.getAllDisplays()[…].bounds` (Electron)
 *   - `kCGWindowBounds` from `@pichu/mac-window-list`
 *   - `geometry.windowBounds` / `geometry.displayBounds` returned by
 *     `screen-capture.ts` (the screenshot tools)
 *
 * To convert a screenshot pixel back to a global point, use the formula
 * documented in `CaptureGeometry`:
 *
 *   gx = anchor.x + (px / thumbnailScale) / displayScaleFactor
 */

export type ComputerInputModifier = 'shift' | 'control' | 'option' | 'command' | 'function'
export type ComputerInputButton = 'left' | 'right' | 'middle'
export type ClickDeliveryBypassMode = 'none'
export type ClickDeliveryBypassModifier = 'command' | 'option'
export type AccessibilityTreeScope = 'focusedWindow' | 'app'
export type AccessibilityTreeMode = 'interactive' | 'raw'

// ---------- Coordinate inputs ----------
//
// The screenshot tools (`captureAppWindow`, `captureDesktop`) hand back a
// `geometry` blob that fully describes how PNG pixels map back to CG global
// points. Instead of forcing the caller to do that math, the mouse helpers
// accept several coordinate spaces and the conversion happens here.

export type CoordSpace = 'cg-global-points' | 'window-points' | 'screenshot-pixels'

/**
 * Geometry blob accepted by `screenshot-pixels` coordinates. Same shape as
 * `CaptureGeometry` returned by `screen-capture.ts` — the agent can copy the
 * `geometry` field verbatim from a screenshot tool result.
 */
export type CoordCaptureGeometry = {
  region: 'window-frame' | 'display-full'
  displayScaleFactor: number
  thumbnailScale: number
  windowBounds?: { x: number; y: number; width: number; height: number }
  displayBounds?: { x: number; y: number; width: number; height: number }
}

export type ScreenPoint = { space: 'cg-global-points'; x: number; y: number }
export type WindowPoint = { space: 'window-points'; x: number; y: number }
export type ScreenshotPixel = {
  space: 'screenshot-pixels'
  px: number
  py: number
  geometry: CoordCaptureGeometry
}

export type ClickPosition = ScreenPoint | WindowPoint | ScreenshotPixel

export type DragPath =
  | { space: 'cg-global-points'; fromX: number; fromY: number; toX: number; toY: number }
  | { space: 'window-points'; fromX: number; fromY: number; toX: number; toY: number }
  | {
      space: 'screenshot-pixels'
      fromX: number
      fromY: number
      toX: number
      toY: number
      geometry: CoordCaptureGeometry
    }

/**
 * Result of converting an arbitrary `ClickPosition` to CG global points. Also
 * surfaces the source values so we can echo them back in tool results for
 * traceability.
 */
export type ResolvedPoint = {
  /** CG global point (top-left origin of primary display, Y down). */
  globalX: number
  globalY: number
  /** Echo of how the caller specified the coordinate. */
  source: ClickPosition
}

type BoundsRect = { x: number; y: number; width: number; height: number }

type WindowOwnerInfo = {
  pid: number
  windowOriginX: number
  windowOriginY: number
  windowBounds: BoundsRect
  ownerName: string
  title: string | null
}

function pickAnchor(geometry: CoordCaptureGeometry): {
  x: number
  y: number
  width: number
  height: number
} {
  const anchor = geometry.region === 'window-frame' ? geometry.windowBounds : geometry.displayBounds
  if (!anchor) {
    throw new Error(
      `screenshot-pixels geometry is missing the anchor for region="${geometry.region}". ` +
        `Pass the geometry blob exactly as returned by captureAppWindow / captureDesktop.`
    )
  }
  return anchor
}

function pixelsToGlobalPoint(
  px: number,
  py: number,
  geometry: CoordCaptureGeometry
): { x: number; y: number } {
  if (!Number.isFinite(geometry.thumbnailScale) || geometry.thumbnailScale <= 0) {
    throw new Error(
      `screenshot-pixels geometry has invalid thumbnailScale=${geometry.thumbnailScale}.`
    )
  }
  if (!Number.isFinite(geometry.displayScaleFactor) || geometry.displayScaleFactor <= 0) {
    throw new Error(
      `screenshot-pixels geometry has invalid displayScaleFactor=${geometry.displayScaleFactor}.`
    )
  }
  const anchor = pickAnchor(geometry)
  // PNG pixel → native pixel → point
  return {
    x: anchor.x + px / geometry.thumbnailScale / geometry.displayScaleFactor,
    y: anchor.y + py / geometry.thumbnailScale / geometry.displayScaleFactor
  }
}

/**
 * Resolve a `ClickPosition` (any supported coord space) to CG global points.
 * `windowOriginX/Y` is required for `window-points`; pass the values the
 * mac-window-list lookup already produced for the target windowId.
 */
export function resolvePoint(
  position: ClickPosition,
  windowOriginX: number,
  windowOriginY: number
): ResolvedPoint {
  if (position.space === 'cg-global-points') {
    return { globalX: position.x, globalY: position.y, source: position }
  }
  if (position.space === 'window-points') {
    return {
      globalX: windowOriginX + position.x,
      globalY: windowOriginY + position.y,
      source: position
    }
  }
  if (position.space === 'screenshot-pixels') {
    const { x, y } = pixelsToGlobalPoint(position.px, position.py, position.geometry)
    return { globalX: x, globalY: y, source: position }
  }
  // Exhaustiveness — should be unreachable.
  const _exhaustive: never = position
  throw new Error(`Unknown coordinate space: ${JSON.stringify(_exhaustive)}`)
}

const COMPUTER_INPUT_DISABLED_MESSAGE =
  'Computer input tools require Computer Use to be enabled, with macOS Accessibility access granted when the tool is first used.'

const ACCESSIBILITY_NOT_TRUSTED_MESSAGE =
  'macOS Accessibility permission has not been granted. Open System Settings → Privacy & Security → Accessibility and grant access to the process shown by macOS.'

const COMPUTER_USE_LOG_PATH = () => join(getDataRoot(), 'computer-use.log')

type ComputerUseLogStage = 'start' | 'resolved' | 'success' | 'error'

const WINDOW_BOUNDS_TOLERANCE_PT = 1

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    }
  }
  return {
    message: typeof error === 'string' ? error : JSON.stringify(error)
  }
}

function writeComputerUseLog(
  tool: 'backgroundClick' | 'backgroundDrag' | 'backgroundType' | 'backgroundPressKey',
  stage: ComputerUseLogStage,
  details: Record<string, unknown>
): void {
  try {
    mkdirSync(getDataRoot(), { recursive: true })
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      tool,
      stage,
      details
    })
    appendFileSync(COMPUTER_USE_LOG_PATH(), `${line}\n`, 'utf8')
  } catch {
    // Logging must never break Computer Use itself.
  }
}

function preserveFrontmost<T>(
  tool: 'backgroundClick' | 'backgroundDrag' | 'backgroundType' | 'backgroundPressKey',
  action: () => T
): T {
  const before = nativeGetFrontmostAppPid().pid ?? null
  try {
    return action()
  } finally {
    if (before !== null) {
      const after = nativeGetFrontmostAppPid().pid ?? null
      if (after !== null && after !== before) {
        const restored = nativeActivateApp(before)
        writeComputerUseLog(tool, 'resolved', {
          focusPreservation: {
            before,
            after,
            restored
          }
        })
      }
    }
  }
}

function ensureInputAllowed(opts: { computerUseEnabled: boolean }): void {
  ensureComputerUseEnabled(opts)
  if (!isInProcessComputerUseAllowed()) {
    throw new Error(
      'Computer Use stable builds must route macOS input through the Owls Computer Use helper.'
    )
  }
  ensureDarwinInputRuntime()
  // Without Accessibility, posted CGEvents are silently dropped by the
  // WindowServer — fail loudly here so the agent gets a clear signal.
  if (!checkAccessibility().trusted) {
    throw new Error(ACCESSIBILITY_NOT_TRUSTED_MESSAGE)
  }
}

function ensureComputerUseEnabled(opts: { computerUseEnabled: boolean }): void {
  if (opts.computerUseEnabled !== true) {
    throw new Error(COMPUTER_INPUT_DISABLED_MESSAGE)
  }
  assertComputerUseRuntimeAvailable()
}

function ensureDarwinInputRuntime(): void {
  if (process.platform !== 'darwin') {
    throw new Error('Computer input tools are only available on macOS.')
  }
}

function shouldUseComputerUseHelper(): boolean {
  return isComputerUseHelperAvailable()
}

function assertHelperResult<T extends { type: string }>(
  result: { type: string },
  type: T['type']
): T {
  if (result.type !== type) {
    throw new Error(`Computer Use helper returned ${result.type}; expected ${type}.`)
  }
  return result as T
}

async function ensureHelperInputAllowed(opts: { computerUseEnabled: boolean }): Promise<void> {
  ensureComputerUseEnabled(opts)
  ensureDarwinInputRuntime()
  const result = assertHelperResult<{ type: 'accessibilityStatus'; trusted: boolean }>(
    await sendComputerUseHelperRequest({ method: 'accessibilityStatus' }),
    'accessibilityStatus'
  )
  if (!result.trusted) {
    throw new Error(ACCESSIBILITY_NOT_TRUSTED_MESSAGE)
  }
}

async function getTargetIsActive(
  pid: number,
  targetIsActiveInput: boolean | undefined
): Promise<{ targetIsActive: boolean; targetIsActiveAutoDetected: boolean }> {
  if (targetIsActiveInput !== undefined) {
    return { targetIsActive: targetIsActiveInput === true, targetIsActiveAutoDetected: false }
  }
  if (shouldUseComputerUseHelper()) {
    const result = assertHelperResult<{ type: 'boolean'; value: boolean }>(
      await sendComputerUseHelperRequest({ method: 'isAppActive', params: { pid } }),
      'boolean'
    )
    return { targetIsActive: result.value, targetIsActiveAutoDetected: true }
  }
  ensureDarwinInputRuntime()
  return { targetIsActive: nativeIsAppActive(pid), targetIsActiveAutoDetected: true }
}

/**
 * Sanity-check that the target point is inside one of the connected displays.
 * Posting events to off-screen coordinates is harmless (the cursor just
 * clamps), but it usually indicates a coordinate-space bug in the caller, so
 * we surface a useful error instead of silently sending a no-op.
 */
function formatBounds(bounds: BoundsRect): string {
  return `${Math.round(bounds.x)},${Math.round(bounds.y)} ${Math.round(bounds.width)}×${Math.round(bounds.height)} pt`
}

function connectedDisplaySummary(displays = screen.getAllDisplays()): string {
  return displays.map((d) => `#${d.id} ${formatBounds(d.bounds)}`).join('; ') || '(none)'
}

function findDisplayForPoint(x: number, y: number): Electron.Display | null {
  const displays = screen.getAllDisplays()
  return (
    displays.find(
      (d) =>
        x >= d.bounds.x &&
        x <= d.bounds.x + d.bounds.width &&
        y >= d.bounds.y &&
        y <= d.bounds.y + d.bounds.height
    ) ?? null
  )
}

function assertOnScreen(x: number, y: number): { displayId: number; scaleFactor: number } {
  if (process.platform !== 'darwin') {
    throw new Error('Computer input tools are only available on macOS.')
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`Coordinates must be finite numbers (got x=${x}, y=${y}).`)
  }
  const hit = findDisplayForPoint(x, y)
  if (!hit) {
    throw new Error(
      `Point (${x}, ${y}) is not inside any connected display. Connected displays: ${connectedDisplaySummary()} — coordinates must be in CG global points.`
    )
  }
  return { displayId: hit.id, scaleFactor: hit.scaleFactor }
}

function describePositionSource(source: ClickPosition): string {
  if (source.space === 'cg-global-points') {
    return `cg-global-points(${source.x}, ${source.y})`
  }
  if (source.space === 'window-points') {
    return `window-points(${source.x}, ${source.y})`
  }
  return `screenshot-pixels(${source.px}, ${source.py}, region=${source.geometry.region})`
}

function isPointInsideBounds(x: number, y: number, bounds: BoundsRect, tolerance = 0): boolean {
  return (
    x >= bounds.x - tolerance &&
    x <= bounds.x + bounds.width + tolerance &&
    y >= bounds.y - tolerance &&
    y <= bounds.y + bounds.height + tolerance
  )
}

function validateResolvedPointForWindow(
  label: string,
  windowId: number,
  owner: WindowOwnerInfo,
  resolved: ResolvedPoint
): void {
  if (!Number.isFinite(resolved.globalX) || !Number.isFinite(resolved.globalY)) {
    throw new Error(
      `Resolved ${label} coordinates must be finite numbers (got x=${resolved.globalX}, y=${resolved.globalY}) from ${describePositionSource(resolved.source)}.`
    )
  }

  const display = findDisplayForPoint(resolved.globalX, resolved.globalY)
  if (!display) {
    throw new Error(
      `Resolved ${label} from ${describePositionSource(resolved.source)} to global ` +
        `(${resolved.globalX}, ${resolved.globalY}), but that point is not inside any connected display. ` +
        `Target window ${windowId} bounds: ${formatBounds(owner.windowBounds)}. ` +
        `Connected displays: ${connectedDisplaySummary()}.`
    )
  }

  if (
    !isPointInsideBounds(
      resolved.globalX,
      resolved.globalY,
      owner.windowBounds,
      WINDOW_BOUNDS_TOLERANCE_PT
    )
  ) {
    throw new Error(
      `Resolved ${label} from ${describePositionSource(resolved.source)} to global ` +
        `(${resolved.globalX}, ${resolved.globalY}) on display #${display.id}, but that point is outside ` +
        `target window ${windowId} bounds (${formatBounds(owner.windowBounds)}). ` +
        `Connected displays: ${connectedDisplaySummary()}.`
    )
  }
}

function buildModifiers(mods?: ComputerInputModifier[]): ModifierFlags | undefined {
  if (!mods || mods.length === 0) return undefined
  const flags: ModifierFlags = {}
  for (const m of mods) {
    if (m === 'shift') flags.shift = true
    else if (m === 'control') flags.control = true
    else if (m === 'option') flags.option = true
    else if (m === 'command') flags.command = true
    else if (m === 'function') flags.function = true
  }
  return flags
}

function buttonToNative(b?: ComputerInputButton): 'Left' | 'Right' | 'Middle' {
  if (b === 'right') return 'Right'
  if (b === 'middle') return 'Middle'
  return 'Left'
}

function deliveryBypassModifierToNative(
  modifier: ClickDeliveryBypassModifier
): 'Command' | 'Option' {
  return modifier === 'option' ? 'Option' : 'Command'
}

// ---------- Public API ----------

export type MoveMouseInput = {
  computerUseEnabled: boolean
  x: number
  y: number
}

export async function moveMouse(input: MoveMouseInput): Promise<{
  x: number
  y: number
  displayId: number
}> {
  if (shouldUseComputerUseHelper()) {
    await ensureHelperInputAllowed(input)
  } else {
    ensureInputAllowed(input)
  }
  const { displayId } = assertOnScreen(input.x, input.y)
  if (shouldUseComputerUseHelper()) {
    assertHelperResult(
      await sendComputerUseHelperRequest({
        method: 'mouseMove',
        params: { x: input.x, y: input.y }
      }),
      'ok'
    )
  } else {
    nativeMouseMove({ x: input.x, y: input.y })
  }
  return { x: input.x, y: input.y, displayId }
}

export type ClickInput = {
  computerUseEnabled: boolean
  x: number
  y: number
  button?: ComputerInputButton
  count?: number
  modifiers?: ComputerInputModifier[]
  holdMs?: number
}

export async function click(input: ClickInput): Promise<{
  x: number
  y: number
  button: ComputerInputButton
  count: number
  displayId: number
}> {
  if (shouldUseComputerUseHelper()) {
    await ensureHelperInputAllowed(input)
  } else {
    ensureInputAllowed(input)
  }
  const { displayId } = assertOnScreen(input.x, input.y)
  const button = input.button ?? 'left'
  const count = Math.min(3, Math.max(1, Math.round(input.count ?? 1)))
  const nativeInput = {
    x: input.x,
    y: input.y,
    button: buttonToNative(button) as never,
    count,
    modifiers: buildModifiers(input.modifiers),
    holdMs: input.holdMs
  }
  if (shouldUseComputerUseHelper()) {
    assertHelperResult(
      await sendComputerUseHelperRequest({ method: 'mouseClick', params: nativeInput }),
      'ok'
    )
  } else {
    nativeMouseClick(nativeInput)
  }
  return { x: input.x, y: input.y, button, count, displayId }
}

export type DragInput = {
  computerUseEnabled: boolean
  fromX: number
  fromY: number
  toX: number
  toY: number
  button?: ComputerInputButton
  steps?: number
  durationMs?: number
}

export async function drag(input: DragInput): Promise<{
  fromX: number
  fromY: number
  toX: number
  toY: number
  durationMs: number
}> {
  if (shouldUseComputerUseHelper()) {
    await ensureHelperInputAllowed(input)
  } else {
    ensureInputAllowed(input)
  }
  assertOnScreen(input.fromX, input.fromY)
  assertOnScreen(input.toX, input.toY)
  const durationMs = Math.max(0, Math.round(input.durationMs ?? 250))
  const nativeInput = {
    fromX: input.fromX,
    fromY: input.fromY,
    toX: input.toX,
    toY: input.toY,
    button: buttonToNative(input.button) as never,
    steps: input.steps,
    durationMs
  }
  if (shouldUseComputerUseHelper()) {
    assertHelperResult(
      await sendComputerUseHelperRequest({ method: 'mouseDrag', params: nativeInput }),
      'ok'
    )
  } else {
    nativeMouseDrag(nativeInput)
  }
  return {
    fromX: input.fromX,
    fromY: input.fromY,
    toX: input.toX,
    toY: input.toY,
    durationMs
  }
}

export type TypeTextInput = {
  computerUseEnabled: boolean
  text: string
  perCharDelayMs?: number
}

export async function typeText(input: TypeTextInput): Promise<{ length: number }> {
  if (shouldUseComputerUseHelper()) {
    await ensureHelperInputAllowed(input)
  } else {
    ensureInputAllowed(input)
  }
  if (typeof input.text !== 'string') {
    throw new Error('text must be a string.')
  }
  if (input.text.length === 0) {
    throw new Error('text must not be empty.')
  }
  const nativeInput = { text: input.text, perCharDelayMs: input.perCharDelayMs }
  if (shouldUseComputerUseHelper()) {
    assertHelperResult(
      await sendComputerUseHelperRequest({ method: 'typeText', params: nativeInput }),
      'ok'
    )
  } else {
    nativeTypeText(nativeInput)
  }
  return { length: input.text.length }
}

export type PressKeyInput = {
  computerUseEnabled: boolean
  key: string
  modifiers?: ComputerInputModifier[]
}

export async function pressKey(input: PressKeyInput): Promise<{
  key: string
  modifiers: ComputerInputModifier[]
}> {
  if (shouldUseComputerUseHelper()) {
    await ensureHelperInputAllowed(input)
  } else {
    ensureInputAllowed(input)
  }
  if (!input.key || typeof input.key !== 'string') {
    throw new Error(
      'key must be a non-empty string (e.g. "return", "f5", "a", or a numeric kVK_ code).'
    )
  }
  const nativeInput = {
    key: input.key,
    modifiers: buildModifiers(input.modifiers)
  }
  if (shouldUseComputerUseHelper()) {
    assertHelperResult(
      await sendComputerUseHelperRequest({ method: 'pressKey', params: nativeInput }),
      'ok'
    )
  } else {
    nativePressKey(nativeInput)
  }
  return { key: input.key, modifiers: input.modifiers ?? [] }
}

// ---------- Background click (no app activation) ----------
//
// Click a window owned by another app **without bringing it to the
// foreground**. Uses `CGEventPostToPid` plus the window-id-tagged event
// pattern documented in the bgclick-rev skill. The WindowServer routes the
// event directly to the target window.
//
// Key trade-off: when the target app is NOT the foreground app, a synthetic
// modifier flag is OR'd into the event as a delivery-filter bypass — the target app
// will see it in `NSEvent.modifierFlags`. For most click targets (buttons,
// fields, table rows) this is harmless. For hyperlinks in browsers /
// shortcut-bound widgets it can change behaviour (Cmd+click opens new tab,
// etc.). Production clicks now avoid that bypass entirely and rely on
// CGEventPostToPid + window-location tagging to deliver a plain click.

function findOwnerInfoFromWindowId(windowId: number): WindowOwnerInfo | null {
  if (process.platform !== 'darwin') return null
  let windows: ReturnType<typeof listWindows>
  try {
    windows = listWindows({ onScreenOnly: true, includeSystemChrome: true })
  } catch {
    return null
  }
  const hit = windows.find((w) => w.windowId === windowId)
  if (!hit) return null
  return {
    pid: hit.ownerPid,
    windowOriginX: hit.bounds.x,
    windowOriginY: hit.bounds.y,
    windowBounds: {
      x: hit.bounds.x,
      y: hit.bounds.y,
      width: hit.bounds.width,
      height: hit.bounds.height
    },
    ownerName: hit.ownerName,
    title: hit.title ?? null
  }
}

export type BackgroundClickInput = {
  computerUseEnabled: boolean
  /**
   * The CGWindowID of the target window. Same number the screenshot tools
   * surface as `details.source.cgWindowId`, and as `MacWindow.windowId`.
   */
  windowId: number
  /**
   * Click position in any supported coordinate space. The wrapper resolves
   * it to CG global points using `resolvePoint()`. Caller no longer needs
   * to know the screenshot → global conversion math.
   */
  position: ClickPosition
  button?: ComputerInputButton
  count?: number
  modifiers?: ComputerInputModifier[]
  /**
   * Legacy/debug field. Production clicks never apply a synthetic modifier
   * delivery bypass, so this only accepts `none`.
   */
  deliveryBypass?: ClickDeliveryBypassMode
  /**
   * Synthetic modifier used for the delivery bypass. Defaults to `command` for
   * backwards compatibility. Use `option` when Command-click semantics would
   * change the target app behavior.
   */
  deliveryBypassModifier?: ClickDeliveryBypassModifier
  /**
   * Set to true when the target app is already the foreground app — skips
   * the delivery bypass so the click does not arrive with a synthetic modifier.
   * Defaults to false (background delivery).
   */
  targetIsActive?: boolean
  holdMs?: number
}

export type BackgroundClickResult = {
  windowId: number
  pid: number
  ownerName: string
  title: string | null
  /** Resolved CG global points used for the call. */
  globalX: number
  globalY: number
  /** Echo of the original position so the agent can confirm interpretation. */
  source: ClickPosition
  windowLocalX: number
  windowLocalY: number
  button: ComputerInputButton
  count: number
  deliveryBypass: ClickDeliveryBypassMode
  deliveryBypassModifier: ClickDeliveryBypassModifier
  /** Resolved value used for the call — either echoed from the input or auto-detected via `isAppActive(pid)`. */
  targetIsActive: boolean
  /** Whether a synthetic-modifier delivery bypass was applied. Always false for production clicks. */
  bypassFlagApplied: boolean
  /** True when `targetIsActive` was not provided by the caller and we resolved it via NSWorkspace. */
  targetIsActiveAutoDetected: boolean
}

/**
 * Resolve a background click position to CG global points **without** firing
 * any native event. Used by the cursor-overlay layer so the visual ghost
 * cursor can glide to the target before the real click is dispatched.
 *
 * Validates the same way `backgroundClick` does so the caller gets identical
 * error semantics — i.e. throwing here means the subsequent `backgroundClick`
 * with the same input would also throw.
 */
export function previewBackgroundClickPoint(input: { windowId: number; position: ClickPosition }): {
  globalX: number
  globalY: number
  windowOriginX: number
  windowOriginY: number
} {
  if (process.platform !== 'darwin') {
    throw new Error('Computer input tools are only available on macOS.')
  }
  if (!Number.isInteger(input.windowId) || input.windowId <= 0) {
    throw new Error(`windowId must be a positive integer CGWindowID (got ${input.windowId}).`)
  }
  const owner = findOwnerInfoFromWindowId(input.windowId)
  if (!owner) {
    throw new Error(
      `Window ${input.windowId} not found among on-screen windows. Use listScreenSources or @pichu/mac-window-list to discover valid window ids.`
    )
  }
  const resolved = resolvePoint(input.position, owner.windowOriginX, owner.windowOriginY)
  validateResolvedPointForWindow('click point', input.windowId, owner, resolved)
  return {
    globalX: resolved.globalX,
    globalY: resolved.globalY,
    windowOriginX: owner.windowOriginX,
    windowOriginY: owner.windowOriginY
  }
}

export async function backgroundClick(input: BackgroundClickInput): Promise<BackgroundClickResult> {
  writeComputerUseLog('backgroundClick', 'start', {
    windowId: input.windowId,
    position: input.position,
    button: input.button ?? 'left',
    count: input.count ?? 1,
    modifiers: input.modifiers ?? [],
    deliveryBypass: input.deliveryBypass ?? 'none',
    deliveryBypassModifier: input.deliveryBypassModifier ?? 'command',
    targetIsActive: input.targetIsActive ?? null,
    holdMs: input.holdMs ?? 0
  })
  try {
    if (shouldUseComputerUseHelper()) {
      await ensureHelperInputAllowed(input)
    } else {
      ensureInputAllowed(input)
    }
    if (!Number.isInteger(input.windowId) || input.windowId <= 0) {
      throw new Error(`windowId must be a positive integer CGWindowID (got ${input.windowId}).`)
    }

    const owner = findOwnerInfoFromWindowId(input.windowId)
    if (!owner) {
      throw new Error(
        `Window ${input.windowId} not found among on-screen windows. Use listScreenSources or @pichu/mac-window-list to discover valid window ids.`
      )
    }

    const resolved = resolvePoint(input.position, owner.windowOriginX, owner.windowOriginY)
    validateResolvedPointForWindow('click point', input.windowId, owner, resolved)

    const button = input.button ?? 'left'
    const count = Math.min(3, Math.max(1, Math.round(input.count ?? 1)))

    // Auto-detect targetIsActive for diagnostics only. Production delivery no
    // longer adds synthetic Command/Option flags for background targets.
    const deliveryBypass = input.deliveryBypass ?? 'none'
    const deliveryBypassModifier = input.deliveryBypassModifier ?? 'command'
    const { targetIsActive, targetIsActiveAutoDetected } = await getTargetIsActive(
      owner.pid,
      input.targetIsActive
    )
    const bypassFlagApplied = false

    writeComputerUseLog('backgroundClick', 'resolved', {
      pid: owner.pid,
      ownerName: owner.ownerName,
      title: owner.title,
      windowId: input.windowId,
      windowOriginX: owner.windowOriginX,
      windowOriginY: owner.windowOriginY,
      globalX: resolved.globalX,
      globalY: resolved.globalY,
      windowLocalX: resolved.globalX - owner.windowOriginX,
      windowLocalY: resolved.globalY - owner.windowOriginY,
      deliveryBypass,
      deliveryBypassModifier,
      targetIsActive,
      targetIsActiveAutoDetected,
      bypassFlagApplied
    })

    const nativeInput = {
      pid: owner.pid,
      windowId: input.windowId,
      windowOriginX: owner.windowOriginX,
      windowOriginY: owner.windowOriginY,
      x: resolved.globalX,
      y: resolved.globalY,
      button: buttonToNative(button) as never,
      count,
      modifiers: buildModifiers(input.modifiers),
      useCommandDeliveryBypass: false,
      deliveryBypassModifier: deliveryBypassModifierToNative(deliveryBypassModifier) as never,
      targetIsActive,
      holdMs: input.holdMs
    }
    if (shouldUseComputerUseHelper()) {
      assertHelperResult(
        await sendComputerUseHelperRequest({ method: 'backgroundClick', params: nativeInput }),
        'ok'
      )
    } else {
      preserveFrontmost('backgroundClick', () =>
        nativeBackgroundClick({
          ...nativeInput,
          button: nativeInput.button,
          deliveryBypassModifier: nativeInput.deliveryBypassModifier
        })
      )
    }

    const result = {
      windowId: input.windowId,
      pid: owner.pid,
      ownerName: owner.ownerName,
      title: owner.title,
      globalX: resolved.globalX,
      globalY: resolved.globalY,
      source: resolved.source,
      windowLocalX: resolved.globalX - owner.windowOriginX,
      windowLocalY: resolved.globalY - owner.windowOriginY,
      button,
      count,
      deliveryBypass,
      deliveryBypassModifier,
      targetIsActive,
      bypassFlagApplied,
      targetIsActiveAutoDetected
    }

    writeComputerUseLog('backgroundClick', 'success', result as Record<string, unknown>)
    return result
  } catch (error) {
    writeComputerUseLog('backgroundClick', 'error', {
      windowId: input.windowId,
      position: input.position,
      error: serializeError(error)
    })
    throw error
  }
}

// ---------- Background drag (no app activation) ----------

export type BackgroundDragInput = {
  computerUseEnabled: boolean
  windowId: number
  /**
   * Drag path in any supported coordinate space. Both endpoints share the
   * same space (a drag never crosses spaces). `screenshot-pixels` requires
   * the geometry blob from the screenshot tool result.
   */
  path: DragPath
  button?: ComputerInputButton
  steps?: number
  durationMs?: number
  modifiers?: ComputerInputModifier[]
  targetIsActive?: boolean
}

export type BackgroundDragResult = {
  windowId: number
  pid: number
  ownerName: string
  title: string | null
  /** Resolved CG global points used for the call. */
  fromGlobalX: number
  fromGlobalY: number
  toGlobalX: number
  toGlobalY: number
  /** Echo of the original path so the agent can confirm interpretation. */
  source: DragPath
  fromWindowLocalX: number
  fromWindowLocalY: number
  toWindowLocalX: number
  toWindowLocalY: number
  button: ComputerInputButton
  durationMs: number
  steps: number
  targetIsActive: boolean
  bypassFlagApplied: boolean
  targetIsActiveAutoDetected: boolean
}

function dragPathToPositions(path: DragPath): { from: ClickPosition; to: ClickPosition } {
  if (path.space === 'screenshot-pixels') {
    return {
      from: { space: 'screenshot-pixels', px: path.fromX, py: path.fromY, geometry: path.geometry },
      to: { space: 'screenshot-pixels', px: path.toX, py: path.toY, geometry: path.geometry }
    }
  }
  return {
    from: { space: path.space, x: path.fromX, y: path.fromY },
    to: { space: path.space, x: path.toX, y: path.toY }
  }
}

/**
 * Resolve a background drag path to CG global endpoints **without** firing
 * any native event. Used by the cursor-overlay layer so the ghost cursor can
 * glide to the drag origin before the real drag begins.
 */
export function previewBackgroundDragPath(input: { windowId: number; path: DragPath }): {
  fromGlobalX: number
  fromGlobalY: number
  toGlobalX: number
  toGlobalY: number
} {
  if (process.platform !== 'darwin') {
    throw new Error('Computer input tools are only available on macOS.')
  }
  if (!Number.isInteger(input.windowId) || input.windowId <= 0) {
    throw new Error(`windowId must be a positive integer CGWindowID (got ${input.windowId}).`)
  }
  const owner = findOwnerInfoFromWindowId(input.windowId)
  if (!owner) {
    throw new Error(
      `Window ${input.windowId} not found among on-screen windows. Use listScreenSources or @pichu/mac-window-list to discover valid window ids.`
    )
  }
  const { from, to } = dragPathToPositions(input.path)
  const fromResolved = resolvePoint(from, owner.windowOriginX, owner.windowOriginY)
  const toResolved = resolvePoint(to, owner.windowOriginX, owner.windowOriginY)
  validateResolvedPointForWindow('drag start point', input.windowId, owner, fromResolved)
  validateResolvedPointForWindow('drag end point', input.windowId, owner, toResolved)
  return {
    fromGlobalX: fromResolved.globalX,
    fromGlobalY: fromResolved.globalY,
    toGlobalX: toResolved.globalX,
    toGlobalY: toResolved.globalY
  }
}

export async function backgroundDrag(input: BackgroundDragInput): Promise<BackgroundDragResult> {
  writeComputerUseLog('backgroundDrag', 'start', {
    windowId: input.windowId,
    path: input.path,
    button: input.button ?? 'left',
    steps: input.steps ?? 20,
    durationMs: input.durationMs ?? 250,
    modifiers: input.modifiers ?? [],
    targetIsActive: input.targetIsActive ?? null
  })
  try {
    if (shouldUseComputerUseHelper()) {
      await ensureHelperInputAllowed(input)
    } else {
      ensureInputAllowed(input)
    }
    if (!Number.isInteger(input.windowId) || input.windowId <= 0) {
      throw new Error(`windowId must be a positive integer CGWindowID (got ${input.windowId}).`)
    }

    const owner = findOwnerInfoFromWindowId(input.windowId)
    if (!owner) {
      throw new Error(
        `Window ${input.windowId} not found among on-screen windows. Use listScreenSources or @pichu/mac-window-list to discover valid window ids.`
      )
    }

    const { from, to } = dragPathToPositions(input.path)
    const fromResolved = resolvePoint(from, owner.windowOriginX, owner.windowOriginY)
    const toResolved = resolvePoint(to, owner.windowOriginX, owner.windowOriginY)
    validateResolvedPointForWindow('drag start point', input.windowId, owner, fromResolved)
    validateResolvedPointForWindow('drag end point', input.windowId, owner, toResolved)

    const button = input.button ?? 'left'
    const steps = Math.max(1, Math.round(input.steps ?? 20))
    const durationMs = Math.max(0, Math.round(input.durationMs ?? 250))
    const { targetIsActive, targetIsActiveAutoDetected } = await getTargetIsActive(
      owner.pid,
      input.targetIsActive
    )

    writeComputerUseLog('backgroundDrag', 'resolved', {
      pid: owner.pid,
      ownerName: owner.ownerName,
      title: owner.title,
      windowId: input.windowId,
      windowOriginX: owner.windowOriginX,
      windowOriginY: owner.windowOriginY,
      fromGlobalX: fromResolved.globalX,
      fromGlobalY: fromResolved.globalY,
      toGlobalX: toResolved.globalX,
      toGlobalY: toResolved.globalY,
      fromWindowLocalX: fromResolved.globalX - owner.windowOriginX,
      fromWindowLocalY: fromResolved.globalY - owner.windowOriginY,
      toWindowLocalX: toResolved.globalX - owner.windowOriginX,
      toWindowLocalY: toResolved.globalY - owner.windowOriginY,
      targetIsActive,
      targetIsActiveAutoDetected,
      bypassFlagApplied: false
    })

    const nativeInput = {
      pid: owner.pid,
      windowId: input.windowId,
      windowOriginX: owner.windowOriginX,
      windowOriginY: owner.windowOriginY,
      fromX: fromResolved.globalX,
      fromY: fromResolved.globalY,
      toX: toResolved.globalX,
      toY: toResolved.globalY,
      button: buttonToNative(button) as never,
      steps,
      durationMs,
      modifiers: buildModifiers(input.modifiers),
      targetIsActive
    }
    if (shouldUseComputerUseHelper()) {
      assertHelperResult(
        await sendComputerUseHelperRequest({ method: 'backgroundDrag', params: nativeInput }),
        'ok'
      )
    } else {
      preserveFrontmost('backgroundDrag', () =>
        nativeBackgroundDrag({
          ...nativeInput,
          button: nativeInput.button
        })
      )
    }

    const result = {
      windowId: input.windowId,
      pid: owner.pid,
      ownerName: owner.ownerName,
      title: owner.title,
      fromGlobalX: fromResolved.globalX,
      fromGlobalY: fromResolved.globalY,
      toGlobalX: toResolved.globalX,
      toGlobalY: toResolved.globalY,
      source: input.path,
      fromWindowLocalX: fromResolved.globalX - owner.windowOriginX,
      fromWindowLocalY: fromResolved.globalY - owner.windowOriginY,
      toWindowLocalX: toResolved.globalX - owner.windowOriginX,
      toWindowLocalY: toResolved.globalY - owner.windowOriginY,
      button,
      durationMs,
      steps,
      targetIsActive,
      bypassFlagApplied: false,
      targetIsActiveAutoDetected
    }

    writeComputerUseLog('backgroundDrag', 'success', result as Record<string, unknown>)
    return result
  } catch (error) {
    writeComputerUseLog('backgroundDrag', 'error', {
      windowId: input.windowId,
      path: input.path,
      error: serializeError(error)
    })
    throw error
  }
}

// ---------- Background keyboard input (no app activation) ----------

export type BackgroundTypeInput = {
  computerUseEnabled: boolean
  /**
   * Either the target window's CGWindowID (preferred — pid is resolved
   * automatically) or a raw process pid. CGWindowID is preferred because
   * it documents *which* window of the app is being targeted.
   */
  windowId?: number
  pid?: number
  text: string
  perCharDelayMs?: number
}

export type BackgroundTypeResult = {
  pid: number
  ownerName: string | null
  windowId: number | null
  length: number
  /**
   * True when the AX `AXRaise` action successfully focused the target window
   * inside its app before posting keystrokes. Only ever true when `windowId`
   * was provided. When false, the keystrokes were still posted, but they
   * landed wherever the target app's current key window happens to be.
   */
  windowFocused: boolean
}

function resolveBackgroundTarget(input: { windowId?: number; pid?: number }): {
  pid: number
  ownerName: string | null
  windowId: number | null
} {
  if (
    typeof input.windowId === 'number' &&
    Number.isInteger(input.windowId) &&
    input.windowId > 0
  ) {
    const owner = findOwnerInfoFromWindowId(input.windowId)
    if (!owner) {
      throw new Error(
        `Window ${input.windowId} not found among on-screen windows. Use listScreenSources or @pichu/mac-window-list to discover valid window ids.`
      )
    }
    return { pid: owner.pid, ownerName: owner.ownerName, windowId: input.windowId }
  }
  if (typeof input.pid === 'number' && Number.isInteger(input.pid) && input.pid > 0) {
    return { pid: input.pid, ownerName: null, windowId: null }
  }
  throw new Error('Provide either a positive `windowId` (preferred) or a positive `pid`.')
}

export type FocusedWindowAccessibilityTreeNode = {
  id: number
  parentId?: number
  depth: number
  role: string
  roleDescription?: string
  subrole?: string
  title?: string
  description?: string
  identifier?: string
  value?: string
  url?: string
  enabled?: boolean
  position?: { x: number; y: number }
  size?: { width: number; height: number }
  frame?: { x: number; y: number; width: number; height: number }
  availableAttributes: string[]
  availableActions: string[]
  focused: boolean
}

export type FocusedWindowAccessibilityTreeResult = {
  pid: number
  ownerName: string | null
  targetWindowId: number | null
  scope: AccessibilityTreeScope
  mode: AccessibilityTreeMode
  windowTitle: string | null
  focusedElementId: number | null
  nodeCount: number
  truncated: boolean
  text: string
  nodes: FocusedWindowAccessibilityTreeNode[]
}

export type AxPressNodeResult = {
  pid: number
  ownerName: string | null
  targetWindowId: number | null
  nodeId: number
  action: string
  role: string
  title: string | null
  identifier: string | null
  description: string | null
}

export type GetFocusedWindowAccessibilityTreeInput = {
  computerUseEnabled: boolean
  windowId?: number
  pid?: number
  scope?: AccessibilityTreeScope
  mode?: AccessibilityTreeMode
  maxDepth?: number
  maxNodes?: number
}

export function readFocusedWindowAccessibilityTree(
  input: GetFocusedWindowAccessibilityTreeInput
): Promise<FocusedWindowAccessibilityTreeResult> {
  return readFocusedWindowAccessibilityTreeAsync(input)
}

async function readFocusedWindowAccessibilityTreeAsync(
  input: GetFocusedWindowAccessibilityTreeInput
): Promise<FocusedWindowAccessibilityTreeResult> {
  if (shouldUseComputerUseHelper()) {
    await ensureHelperInputAllowed(input)
  } else {
    ensureInputAllowed(input)
  }
  const target = resolveBackgroundTarget(input)
  const native = shouldUseComputerUseHelper()
    ? assertHelperResult<{
        type: 'focusedWindowAccessibilityTree'
        value: {
          pid: number
          windowTitle?: string
          mode: string
          focusedElementId?: number
          nodeCount: number
          truncated: boolean
          text: string
          nodes: Array<Record<string, unknown>>
        }
      }>(
        await sendComputerUseHelperRequest({
          method: 'getFocusedWindowAccessibilityTree',
          params: {
            pid: target.pid,
            scope: input.scope,
            mode: input.mode,
            maxDepth: input.maxDepth,
            maxNodes: input.maxNodes
          }
        }),
        'focusedWindowAccessibilityTree'
      ).value
    : nativeGetFocusedWindowAccessibilityTree({
        pid: target.pid,
        scope: input.scope,
        mode: input.mode,
        maxDepth: input.maxDepth,
        maxNodes: input.maxNodes
      })
  return {
    pid: native.pid,
    ownerName: target.ownerName,
    targetWindowId: target.windowId,
    scope: input.scope ?? 'focusedWindow',
    mode: (native.mode as AccessibilityTreeMode | undefined) ?? input.mode ?? 'interactive',
    windowTitle: native.windowTitle ?? null,
    focusedElementId: native.focusedElementId ?? null,
    nodeCount: native.nodeCount,
    truncated: native.truncated,
    text: native.text,
    nodes: native.nodes as FocusedWindowAccessibilityTreeNode[]
  }
}

export async function axPressNode(input: {
  computerUseEnabled: boolean
  windowId?: number
  pid?: number
  nodeId: number
  action?: string
  scope?: AccessibilityTreeScope
  mode?: AccessibilityTreeMode
  maxDepth?: number
  maxNodes?: number
}): Promise<AxPressNodeResult> {
  if (shouldUseComputerUseHelper()) {
    await ensureHelperInputAllowed(input)
  } else {
    ensureInputAllowed(input)
  }
  if (!Number.isInteger(input.nodeId) || input.nodeId < 0) {
    throw new Error(`nodeId must be a non-negative integer (got ${input.nodeId}).`)
  }
  const target = resolveBackgroundTarget(input)
  const native = shouldUseComputerUseHelper()
    ? assertHelperResult<{
        type: 'axPressNode'
        value: {
          pid: number
          nodeId: number
          action: string
          role: string
          title?: string
          identifier?: string
          description?: string
        }
      }>(
        await sendComputerUseHelperRequest({
          method: 'axPressNode',
          params: {
            pid: target.pid,
            nodeId: input.nodeId,
            action: input.action,
            scope: input.scope,
            mode: input.mode,
            maxDepth: input.maxDepth,
            maxNodes: input.maxNodes
          }
        }),
        'axPressNode'
      ).value
    : nativeAxPressNode({
        pid: target.pid,
        nodeId: input.nodeId,
        action: input.action,
        scope: input.scope,
        mode: input.mode,
        maxDepth: input.maxDepth,
        maxNodes: input.maxNodes
      })
  return {
    pid: native.pid,
    ownerName: target.ownerName,
    targetWindowId: target.windowId,
    nodeId: native.nodeId,
    action: native.action,
    role: native.role,
    title: native.title ?? null,
    identifier: native.identifier ?? null,
    description: native.description ?? null
  }
}

export async function backgroundType(input: BackgroundTypeInput): Promise<BackgroundTypeResult> {
  writeComputerUseLog('backgroundType', 'start', {
    windowId: input.windowId ?? null,
    pid: input.pid ?? null,
    textLength: typeof input.text === 'string' ? input.text.length : null,
    perCharDelayMs: input.perCharDelayMs ?? 0
  })
  try {
    if (shouldUseComputerUseHelper()) {
      await ensureHelperInputAllowed(input)
    } else {
      ensureInputAllowed(input)
    }
    if (typeof input.text !== 'string') {
      throw new Error('text must be a string.')
    }
    if (input.text.length === 0) {
      throw new Error('text must not be empty.')
    }
    const target = resolveBackgroundTarget(input)
    writeComputerUseLog('backgroundType', 'resolved', {
      pid: target.pid,
      ownerName: target.ownerName,
      windowId: target.windowId,
      textLength: input.text.length,
      perCharDelayMs: input.perCharDelayMs ?? 0
    })
    const nativeInput = {
      pid: target.pid,
      // Pass windowId through so the native side can AX-raise the target
      // window inside its app before typing — keystrokes land in the right
      // window even if the target app's last-focused window was different.
      windowId: target.windowId ?? undefined,
      text: input.text,
      perCharDelayMs: input.perCharDelayMs
    }
    const native = shouldUseComputerUseHelper()
      ? assertHelperResult<{
          type: 'backgroundType'
          windowFocused: boolean
          charactersPosted: number
        }>(
          await sendComputerUseHelperRequest({ method: 'backgroundType', params: nativeInput }),
          'backgroundType'
        )
      : preserveFrontmost('backgroundType', () =>
          nativeBackgroundType({
            ...nativeInput
          })
        )
    const result = { ...target, length: input.text.length, windowFocused: native.windowFocused }
    writeComputerUseLog('backgroundType', 'success', result as Record<string, unknown>)
    return result
  } catch (error) {
    writeComputerUseLog('backgroundType', 'error', {
      windowId: input.windowId ?? null,
      pid: input.pid ?? null,
      textLength: typeof input.text === 'string' ? input.text.length : null,
      error: serializeError(error)
    })
    throw error
  }
}

export type BackgroundPressKeyInput = {
  computerUseEnabled: boolean
  windowId?: number
  pid?: number
  key: string
  modifiers?: ComputerInputModifier[]
}

export type BackgroundPressKeyResult = {
  pid: number
  ownerName: string | null
  windowId: number | null
  key: string
  modifiers: ComputerInputModifier[]
  /** See `BackgroundTypeResult.windowFocused`. */
  windowFocused: boolean
}

export async function backgroundPressKey(
  input: BackgroundPressKeyInput
): Promise<BackgroundPressKeyResult> {
  writeComputerUseLog('backgroundPressKey', 'start', {
    windowId: input.windowId ?? null,
    pid: input.pid ?? null,
    key: input.key,
    modifiers: input.modifiers ?? []
  })
  try {
    if (shouldUseComputerUseHelper()) {
      await ensureHelperInputAllowed(input)
    } else {
      ensureInputAllowed(input)
    }
    if (!input.key || typeof input.key !== 'string') {
      throw new Error(
        'key must be a non-empty string (e.g. "return", "f5", "a", or a numeric kVK_ code).'
      )
    }
    const target = resolveBackgroundTarget(input)
    writeComputerUseLog('backgroundPressKey', 'resolved', {
      pid: target.pid,
      ownerName: target.ownerName,
      windowId: target.windowId,
      key: input.key,
      modifiers: input.modifiers ?? []
    })
    const nativeInput = {
      pid: target.pid,
      windowId: target.windowId ?? undefined,
      key: input.key,
      modifiers: buildModifiers(input.modifiers)
    }
    const native = shouldUseComputerUseHelper()
      ? assertHelperResult<{ type: 'backgroundPressKey'; windowFocused: boolean }>(
          await sendComputerUseHelperRequest({
            method: 'backgroundPressKey',
            params: nativeInput
          }),
          'backgroundPressKey'
        )
      : preserveFrontmost('backgroundPressKey', () => nativeBackgroundPressKey(nativeInput))
    const result = {
      ...target,
      key: input.key,
      modifiers: input.modifiers ?? [],
      windowFocused: native.windowFocused
    }
    writeComputerUseLog('backgroundPressKey', 'success', result as Record<string, unknown>)
    return result
  } catch (error) {
    writeComputerUseLog('backgroundPressKey', 'error', {
      windowId: input.windowId ?? null,
      pid: input.pid ?? null,
      key: input.key,
      modifiers: input.modifiers ?? [],
      error: serializeError(error)
    })
    throw error
  }
}

// ---------- Diagnostics ----------

/** Re-exported for diagnostics — pi-handler can surface this in tool errors. */
export function getAccessibilityStatus(): { trusted: boolean } {
  if (process.platform !== 'darwin') return { trusted: false }
  if (!isInProcessComputerUseAllowed()) return { trusted: false }
  return checkAccessibility()
}

/** Pid of the current foreground app, or null if it can't be determined. */
export function getFrontmostAppPid(): number | null {
  if (process.platform !== 'darwin') return null
  return nativeGetFrontmostAppPid().pid ?? null
}

/** True when the given pid is the current foreground app. */
export function isAppActive(pid: number): boolean {
  if (process.platform !== 'darwin') return false
  if (!Number.isInteger(pid) || pid <= 0) return false
  return nativeIsAppActive(pid)
}
