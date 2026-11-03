import { listWindows, type MacWindow } from '@pichu/mac-window-list'
import { ipcMain, screen } from 'electron'
import type {
  ComputerUseAppStateElement,
  ComputerUseAppStateResult,
  ComputerUseAppTarget,
  ComputerUseCapturedWindow,
  ComputerUseClickToolParams,
  ComputerUseClickToolResult,
  ComputerUseDebugInventory,
  ComputerUseDragTestResult,
  ComputerUseModifier,
  ComputerUseOverlayAnimationResult,
  ComputerUseWindowTarget
} from '../../shared/computer-use.js'
import { getSettingsForRenderer } from '../stores/settings-store.js'
import {
  axPressNode,
  backgroundClick,
  backgroundDrag,
  backgroundPressKey,
  backgroundType,
  getFrontmostAppPid,
  readFocusedWindowAccessibilityTree
} from '../tools/computer-use/computer-input.js'
import {
  getCursorOverlayDebugProbe,
  getCursorOverlayDebugState,
  getCursorOverlayTargetWindowId,
  setCursorOverlayBoundsOverride,
  setCursorOverlayDebugBackdrop,
  setCursorOverlayTargetWindowId,
  withCursor
} from '../tools/computer-use/cursor-overlay.js'
import {
  captureAppWindow,
  listDisplays,
  listScreenSources,
  type WindowSourceInfo
} from '../tools/computer-use/screen-capture.js'

const DEBUG_SESSION_ID = 'computer-use-debug'
const appStateSnapshots = new Map<string, ComputerUseAppStateResult>()
const COMPUTER_AX_MAX_DEPTH = 200
const COMPUTER_AX_MAX_NODES = 10_000
let latestAppStateSnapshotId: string | null = null

function extractCgWindowId(sourceId: string): number | null {
  const match = /^window:(\d+):/.exec(sourceId)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function safeListNativeWindows(): MacWindow[] {
  if (process.platform !== 'darwin') return []
  try {
    return listWindows({ onScreenOnly: true, includeSystemChrome: true })
  } catch (error) {
    console.warn('[computer-use-debug] listWindows failed:', error)
    return []
  }
}

function displayInfoForBounds(bounds: { x: number; y: number; width: number; height: number }): {
  id: number | null
  label: string | null
} {
  try {
    const display = screen.getDisplayMatching({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height))
    })
    return {
      id: display.id,
      label: display.label || `Display ${display.id}`
    }
  } catch {
    return { id: null, label: null }
  }
}

function compareWindows(a: ComputerUseWindowTarget, b: ComputerUseWindowTarget): number {
  const titleA = a.title ?? ''
  const titleB = b.title ?? ''
  return (
    titleA.localeCompare(titleB) ||
    a.ownerName.localeCompare(b.ownerName) ||
    a.windowId - b.windowId
  )
}

function compareApps(a: ComputerUseAppTarget, b: ComputerUseAppTarget): number {
  return (
    Number(b.isFrontmostApp) - Number(a.isFrontmostApp) ||
    a.ownerName.localeCompare(b.ownerName) ||
    a.ownerPid - b.ownerPid
  )
}

async function listComputerUseInventory(): Promise<ComputerUseDebugInventory> {
  const displays = listDisplays()
  const nativeWindows = safeListNativeWindows()
  const frontmostPid = getFrontmostAppPid()

  let sourceWindows: WindowSourceInfo[] = []
  let sourceError: string | null = null

  try {
    const result = await listScreenSources({
      computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
      includeWindows: true
    })
    sourceWindows = result.windows
  } catch (error) {
    sourceError = error instanceof Error ? error.message : String(error)
  }

  const sourceByWindowId = new Map<number, WindowSourceInfo>()
  for (const source of sourceWindows) {
    const cgWindowId = extractCgWindowId(source.id)
    if (cgWindowId !== null) {
      sourceByWindowId.set(cgWindowId, source)
    }
  }

  const appMap = new Map<string, ComputerUseAppTarget>()

  for (const nativeWindow of nativeWindows) {
    const source = sourceByWindowId.get(nativeWindow.windowId)
    const displayInfo = displayInfoForBounds(nativeWindow.bounds)
    const windowTarget: ComputerUseWindowTarget = {
      windowId: nativeWindow.windowId,
      ownerPid: nativeWindow.ownerPid,
      ownerName: nativeWindow.ownerName,
      title: nativeWindow.title ?? null,
      bounds: {
        x: nativeWindow.bounds.x,
        y: nativeWindow.bounds.y,
        width: nativeWindow.bounds.width,
        height: nativeWindow.bounds.height
      },
      displayId: displayInfo.id,
      displayLabel: displayInfo.label,
      sourceId: source?.id ?? null,
      sourceName: source?.name ?? null,
      sourceDisplayId: source?.displayId ?? null,
      hasAppIcon: source?.appIcon ?? false,
      isFrontmostApp: frontmostPid === nativeWindow.ownerPid
    }

    const appId = `${nativeWindow.ownerPid}:${nativeWindow.ownerName}`
    const existing = appMap.get(appId)
    if (existing) {
      existing.isFrontmostApp ||= frontmostPid === nativeWindow.ownerPid
      existing.windows.push(windowTarget)
      continue
    }

    appMap.set(appId, {
      id: appId,
      ownerPid: nativeWindow.ownerPid,
      ownerName: nativeWindow.ownerName,
      isFrontmostApp: frontmostPid === nativeWindow.ownerPid,
      windows: [windowTarget]
    })
  }

  const apps = Array.from(appMap.values())
  for (const app of apps) {
    app.windows.sort(compareWindows)
  }
  apps.sort(compareApps)

  return {
    listedAt: new Date().toISOString(),
    displays,
    apps,
    sourceError
  }
}

function requireWindowTarget(windowId: number): MacWindow {
  const window = safeListNativeWindows().find((entry) => entry.windowId === windowId)
  if (!window) {
    throw new Error(`Window ${windowId} is no longer available. Reload the app list and try again.`)
  }
  return window
}

function clampMargin(size: number): number {
  return Math.max(18, Math.min(80, Math.round(size * 0.18)))
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * Math.max(0, max - min)
}

function pickRandomPoint(bounds: { x: number; y: number; width: number; height: number }): {
  x: number
  y: number
} {
  const marginX = Math.min(clampMargin(bounds.width), Math.max(1, bounds.width / 2 - 1))
  const marginY = Math.min(clampMargin(bounds.height), Math.max(1, bounds.height / 2 - 1))
  return {
    x: Math.round(randomBetween(bounds.x + marginX, bounds.x + bounds.width - marginX)),
    y: Math.round(randomBetween(bounds.y + marginY, bounds.y + bounds.height - marginY))
  }
}

function pickRandomPointPair(bounds: { x: number; y: number; width: number; height: number }): {
  from: { x: number; y: number }
  to: { x: number; y: number }
} {
  const from = pickRandomPoint(bounds)
  let to = pickRandomPoint(bounds)
  let attempts = 0
  while (Math.hypot(to.x - from.x, to.y - from.y) < 48 && attempts < 8) {
    to = pickRandomPoint(bounds)
    attempts += 1
  }
  return { from, to }
}

function buildCenterProbePoints(
  bounds: { x: number; y: number; width: number; height: number },
  count: number
): Array<{ x: number; y: number }> {
  const insetX = Math.max(24, Math.min(80, Math.round(bounds.width * 0.08)))
  const insetY = Math.max(24, Math.min(80, Math.round(bounds.height * 0.08)))
  const left = bounds.x + insetX
  const right = bounds.x + Math.max(insetX, bounds.width - insetX)
  const top = bounds.y + insetY
  const bottom = bounds.y + Math.max(insetY, bounds.height - insetY)
  const cornerLoop = [
    { x: left, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
    { x: right, y: top }
  ]

  return Array.from({ length: count }, (_, index) => cornerLoop[index % cornerLoop.length]).map(
    (point) => ({
      x: Math.round(point.x),
      y: Math.round(point.y)
    })
  )
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

async function animateOverlay(
  windowId: number,
  pointCount = 4
): Promise<ComputerUseOverlayAnimationResult> {
  const target = requireWindowTarget(windowId)
  const count = Math.max(2, Math.min(8, Math.round(pointCount)))
  const targetDisplay = screen.getDisplayMatching({
    x: Math.round(target.bounds.x),
    y: Math.round(target.bounds.y),
    width: Math.max(1, Math.round(target.bounds.width)),
    height: Math.max(1, Math.round(target.bounds.height))
  })
  const points = buildCenterProbePoints(target.bounds, count)
  const overlayBefore = getCursorOverlayDebugState()

  console.info(
    '[computer-use-debug] animateOverlay start windowId=%d owner=%s title=%s pointCount=%d display=%o overlay=%o points=%o',
    target.windowId,
    target.ownerName,
    target.title ?? '',
    count,
    {
      id: targetDisplay.id,
      label: targetDisplay.label,
      bounds: targetDisplay.bounds,
      scaleFactor: targetDisplay.scaleFactor
    },
    overlayBefore,
    points
  )

  console.info('[computer-use-debug] animateOverlay using scopedBounds=%o', target.bounds)

  const previousTargetWindowId = getCursorOverlayTargetWindowId()
  try {
    setCursorOverlayTargetWindowId(target.windowId)
    setCursorOverlayBoundsOverride(target.bounds)
    await withCursor(DEBUG_SESSION_ID, async (cursor) => {
      await setCursorOverlayDebugBackdrop(
        true,
        `Cursor overlay debug probe - ${target.ownerName}${target.title ? ` / ${target.title}` : ''}`
      )
      for (const point of points) {
        console.info(
          '[computer-use-debug] animateOverlay move windowId=%d point=(%d,%d)',
          target.windowId,
          point.x,
          point.y
        )
        await cursor.moveTo(point.x, point.y, { durationMs: 420 })
        await cursor.flashClick(point.x, point.y)
        await wait(220)
      }
    })
  } finally {
    await setCursorOverlayDebugBackdrop(false)
    setCursorOverlayBoundsOverride(null)
    setCursorOverlayTargetWindowId(previousTargetWindowId)
  }

  const overlayAfter = getCursorOverlayDebugState()
  const probe = await getCursorOverlayDebugProbe()
  console.info(
    '[computer-use-debug] animateOverlay done windowId=%d overlay=%o probe=%o',
    target.windowId,
    overlayAfter,
    {
      state: probe.state,
      dom: probe.dom,
      snapshot: probe.snapshot
        ? {
            width: probe.snapshot.width,
            height: probe.snapshot.height,
            bytes: probe.snapshot.data.length
          }
        : null
    }
  )

  return {
    targetWindowId: target.windowId,
    ownerName: target.ownerName,
    title: target.title ?? null,
    points,
    overlayBefore,
    overlayAfter,
    probe
  }
}

async function captureWindow(sourceId: string): Promise<ComputerUseCapturedWindow> {
  return captureAppWindow({
    computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
    sourceId
  })
}

async function dragWindow(windowId: number): Promise<ComputerUseDragTestResult> {
  const target = requireWindowTarget(windowId)
  const { from, to } = pickRandomPointPair(target.bounds)
  const result = await backgroundDrag({
    computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
    windowId,
    path: {
      space: 'cg-global-points',
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y
    }
  })
  return {
    from,
    to,
    result: result as unknown as Record<string, unknown>
  }
}

async function typeIntoWindow(
  windowId: number,
  text: string,
  perCharDelayMs?: number
): Promise<Record<string, unknown>> {
  const result = await backgroundType({
    computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
    windowId,
    text,
    perCharDelayMs
  })
  return result as unknown as Record<string, unknown>
}

async function pressKeyInWindow(
  windowId: number,
  key: string,
  modifiers?: ComputerUseModifier[]
): Promise<Record<string, unknown>> {
  const result = await backgroundPressKey({
    computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
    windowId,
    key,
    modifiers
  })
  return result as unknown as Record<string, unknown>
}

async function readInteractiveTree(
  windowId: number
): Promise<Awaited<ReturnType<typeof readFocusedWindowAccessibilityTree>>> {
  requireWindowTarget(windowId)
  return await readFocusedWindowAccessibilityTree({
    computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
    windowId,
    scope: 'focusedWindow',
    mode: 'interactive',
    maxDepth: COMPUTER_AX_MAX_DEPTH,
    maxNodes: COMPUTER_AX_MAX_NODES
  })
}

function compactText(value: string | undefined): string | null {
  const text = value?.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > 80 ? `${text.slice(0, 77)}...` : text
}

function formatAppStateElement(element: ComputerUseAppStateElement): string {
  const indent = '  '.repeat(element.depth)
  const roleDescription = compactText(element.roleDescription)
  const title = compactText(element.title)
  const value = compactText(element.value)
  const description = compactText(element.description)
  const label = title ?? description
  const parts = [`${indent}${element.ref}`, element.role]
  if (roleDescription && roleDescription !== element.role) {
    parts.push(`(${roleDescription})`)
  }
  if (label) {
    parts.push(JSON.stringify(label))
  }
  if (value && value !== label) {
    parts.push(`~ ${JSON.stringify(value)}`)
  }
  if (element.focused) {
    parts.push('[focused]')
  }
  if (element.availableActions.length > 0) {
    parts.push(`actions=[${element.availableActions.join(',')}]`)
  }
  return parts.join(' ')
}

async function getAppState(params: {
  windowId: number
  sourceId?: string | null
}): Promise<ComputerUseAppStateResult> {
  requireWindowTarget(params.windowId)
  if (!params.sourceId) {
    throw new Error(
      'Selected window does not have a capture source id. Reload targets and try again.'
    )
  }
  const screenshot = await captureWindow(params.sourceId)
  const tree = await readInteractiveTree(params.windowId)
  const elements: ComputerUseAppStateElement[] = tree.nodes.map((node) => ({
    ref: `e${node.id}`,
    nodeId: node.id,
    parentRef: node.parentId === undefined ? undefined : `e${node.parentId}`,
    depth: node.depth,
    role: node.role,
    roleDescription: node.roleDescription,
    subrole: node.subrole,
    title: node.title,
    description: node.description,
    value: node.value,
    identifier: node.identifier,
    focused: node.focused,
    frame: node.frame,
    availableActions: node.availableActions
  }))
  const focusedElementRef =
    tree.focusedElementId === null || tree.focusedElementId === undefined
      ? null
      : `e${tree.focusedElementId}`
  const snapshot: ComputerUseAppStateResult = {
    snapshotId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    pid: tree.pid,
    ownerName: tree.ownerName,
    windowId: params.windowId,
    focusedElementRef,
    nodeCount: tree.nodeCount,
    truncated: tree.truncated,
    text: elements.map(formatAppStateElement).join('\n'),
    elements,
    screenshot
  }
  appStateSnapshots.set(snapshot.snapshotId, snapshot)
  latestAppStateSnapshotId = snapshot.snapshotId
  while (appStateSnapshots.size > 20) {
    const oldest = appStateSnapshots.keys().next().value as string | undefined
    if (!oldest) break
    appStateSnapshots.delete(oldest)
  }
  return snapshot
}

function resolveSnapshot(snapshotId?: string): ComputerUseAppStateResult {
  const id = snapshotId ?? latestAppStateSnapshotId
  if (!id) {
    throw new Error('No app state snapshot is available. Click "Get app state" first.')
  }
  const snapshot = appStateSnapshots.get(id)
  if (!snapshot) {
    throw new Error(`Unknown or expired app state snapshot "${id}". Get app state again.`)
  }
  return snapshot
}

function actionCandidatesForElement(
  element: ComputerUseAppStateElement,
  preferredAction?: string
): string[] {
  const preferred = preferredAction?.trim()
  const candidates = [
    ...(preferred ? [preferred] : []),
    'AXPress',
    'AXPick',
    'AXConfirm',
    ...element.availableActions
  ]
  return candidates.filter((action, index) => action && candidates.indexOf(action) === index)
}

async function clickComputerUse(
  params: ComputerUseClickToolParams
): Promise<ComputerUseClickToolResult> {
  if (params.ref) {
    const snapshot = resolveSnapshot(params.snapshotId)
    const element = snapshot.elements.find((entry) => entry.ref === params.ref)
    if (!element) {
      throw new Error(`Ref "${params.ref}" was not found in snapshot ${snapshot.snapshotId}.`)
    }
    const triedActions: string[] = []
    let lastAxError: unknown = null
    for (const action of actionCandidatesForElement(element, params.action)) {
      triedActions.push(action)
      try {
        const result = await axPressNode({
          computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
          windowId: snapshot.windowId,
          nodeId: element.nodeId,
          action,
          maxDepth: COMPUTER_AX_MAX_DEPTH,
          maxNodes: COMPUTER_AX_MAX_NODES
        })
        return {
          strategy: 'ax',
          ref: params.ref,
          snapshotId: snapshot.snapshotId,
          triedActions,
          result: result as unknown as Record<string, unknown>
        }
      } catch (error) {
        lastAxError = error
      }
    }
    if (!element.frame) {
      const reason = lastAxError instanceof Error ? lastAxError.message : String(lastAxError)
      throw new Error(
        `AX click failed for ${params.ref} and no element frame is available for fallback. Last AX error: ${reason}`
      )
    }
    const result = await backgroundClick({
      computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
      windowId: snapshot.windowId,
      position: {
        space: 'cg-global-points',
        x: element.frame.x + element.frame.width / 2,
        y: element.frame.y + element.frame.height / 2
      },
      button: params.button,
      count: params.count,
      modifiers: params.modifiers,
      holdMs: params.holdMs
    })
    return {
      strategy: 'physical-fallback',
      ref: params.ref,
      snapshotId: snapshot.snapshotId,
      triedActions,
      axError: lastAxError instanceof Error ? lastAxError.message : String(lastAxError),
      result: result as unknown as Record<string, unknown>
    }
  }
  if (typeof params.windowId !== 'number' || !params.position) {
    throw new Error('Provide either `ref` or both `windowId` and `position`.')
  }
  requireWindowTarget(params.windowId)
  const result = await backgroundClick({
    computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
    windowId: params.windowId,
    position: params.position,
    button: params.button,
    count: params.count,
    modifiers: params.modifiers,
    holdMs: params.holdMs
  })
  return {
    strategy: 'physical',
    result: result as unknown as Record<string, unknown>
  }
}

export function registerComputerUseDebugIpc(): void {
  ipcMain.handle('computer-use-debug:list-targets', () => listComputerUseInventory())
  ipcMain.handle(
    'computer-use-debug:animate-overlay',
    (_, params: { windowId: number; pointCount?: number }) =>
      animateOverlay(params.windowId, params.pointCount)
  )
  ipcMain.handle('computer-use-debug:click', (_, params: ComputerUseClickToolParams) =>
    clickComputerUse(params)
  )
  ipcMain.handle('computer-use-debug:drag', (_, params: { windowId: number }) =>
    dragWindow(params.windowId)
  )
  ipcMain.handle(
    'computer-use-debug:type',
    (_, params: { windowId: number; text: string; perCharDelayMs?: number }) =>
      typeIntoWindow(params.windowId, params.text, params.perCharDelayMs)
  )
  ipcMain.handle(
    'computer-use-debug:press-key',
    (_, params: { windowId: number; key: string; modifiers?: ComputerUseModifier[] }) =>
      pressKeyInWindow(params.windowId, params.key, params.modifiers)
  )
  ipcMain.handle(
    'computer-use-debug:app-state',
    (_, params: { windowId: number; sourceId?: string | null }) => getAppState(params)
  )
}

export function disposeComputerUseDebug(): void {
  ipcMain.removeHandler('computer-use-debug:list-targets')
  ipcMain.removeHandler('computer-use-debug:animate-overlay')
  ipcMain.removeHandler('computer-use-debug:click')
  ipcMain.removeHandler('computer-use-debug:drag')
  ipcMain.removeHandler('computer-use-debug:type')
  ipcMain.removeHandler('computer-use-debug:press-key')
  ipcMain.removeHandler('computer-use-debug:app-state')
}
