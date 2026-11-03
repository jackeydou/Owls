import { executeCdp } from './cdp-backend.js'
import { enrichBackendNodeIds, ensureInjectedRuntime, type LocatorCandidate } from './locator.js'

type CdpFrame = {
  id: string
  parentId?: string
  url: string
  name?: string
  securityOrigin?: string
  mimeType?: string
}

type CdpFrameTree = {
  frame: CdpFrame
  childFrames?: CdpFrameTree[]
}

export type BrowserUseFrameSnapshot = {
  id: string
  parentId: string | null
  url: string
  name: string | null
}

export type BrowserUseDomNodeSnapshot = {
  backendNodeId: number | null
  token: string
  framePath: number[]
  tagName: string
  role: string | null
  name: string | null
  text: string
  value: string | null
  visible: boolean
  enabled: boolean
  editable: boolean
}

export type BrowserUseAccessibilityNodeSnapshot = {
  nodeId: string
  backendNodeId: number | null
  role: string | null
  name: string | null
  childIds: string[]
}

export type BrowserUseSnapshot = {
  url: string
  title: string
  frames: BrowserUseFrameSnapshot[]
  unsupportedFrames: string[]
  dom: BrowserUseDomNodeSnapshot[]
  accessibility: BrowserUseAccessibilityNodeSnapshot[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function pointFromRecord(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) return null
  const x = asNumber(value.x)
  const y = asNumber(value.y)
  return x === null || y === null ? null : { x, y }
}

function frameTreeFromResult(value: unknown): CdpFrameTree | null {
  if (!isRecord(value)) return null
  if (!isRecord(value.frameTree)) return null
  return readFrameTree(value.frameTree)
}

function readFrameTree(value: unknown): CdpFrameTree | null {
  if (!isRecord(value)) return null
  const frameValue = value.frame
  if (!isRecord(frameValue)) return null
  const id = asString(frameValue.id)
  const url = asString(frameValue.url)
  if (!id || url === null) return null
  const frame: CdpFrame = {
    id,
    url,
    parentId: asString(frameValue.parentId) ?? undefined,
    name: asString(frameValue.name) ?? undefined,
    securityOrigin: asString(frameValue.securityOrigin) ?? undefined,
    mimeType: asString(frameValue.mimeType) ?? undefined
  }
  const childFrames = Array.isArray(value.childFrames)
    ? value.childFrames.map(readFrameTree).filter((child): child is CdpFrameTree => child !== null)
    : undefined
  return { frame, childFrames }
}

function flattenFrames(tree: CdpFrameTree | null): BrowserUseFrameSnapshot[] {
  if (!tree) return []
  const frames: BrowserUseFrameSnapshot[] = []
  const visit = (node: CdpFrameTree) => {
    frames.push({
      id: node.frame.id,
      parentId: node.frame.parentId ?? null,
      url: node.frame.url,
      name: node.frame.name ?? null
    })
    for (const child of node.childFrames ?? []) {
      visit(child)
    }
  }
  visit(tree)
  return frames
}

function readAxNodes(value: unknown): BrowserUseAccessibilityNodeSnapshot[] {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return []
  return value.nodes
    .map((node): BrowserUseAccessibilityNodeSnapshot | null => {
      if (!isRecord(node) || node.ignored === true) return null
      const nodeId = asString(node.nodeId)
      if (!nodeId) return null
      const role = isRecord(node.role) ? asString(node.role.value) : null
      const name = isRecord(node.name) ? asString(node.name.value) : null
      if (!role && !name) return null
      const childIds = Array.isArray(node.childIds)
        ? node.childIds.filter((childId): childId is string => typeof childId === 'string')
        : []
      return {
        nodeId,
        backendNodeId: asNumber(node.backendDOMNodeId),
        role,
        name,
        childIds
      }
    })
    .filter((node): node is BrowserUseAccessibilityNodeSnapshot => node !== null)
    .slice(0, 200)
}

function toDomNode(candidate: LocatorCandidate): BrowserUseDomNodeSnapshot {
  return {
    backendNodeId: candidate.backendNodeId,
    token: candidate.token,
    framePath: candidate.framePath,
    tagName: candidate.tagName,
    role: candidate.role,
    name: candidate.name,
    text: candidate.text,
    value: candidate.value,
    visible: candidate.visible,
    enabled: candidate.enabled,
    editable: candidate.editable
  }
}

export async function captureBrowserUseSnapshot(sessionKey: string): Promise<BrowserUseSnapshot> {
  await ensureInjectedRuntime(sessionKey)
  const pageResult = await executeCdp(sessionKey, 'Page.getFrameTree')
  const frameTree = frameTreeFromResult(pageResult)
  const domResult = await executeCdp(sessionKey, 'Runtime.evaluate', {
    expression: 'window.__pichuBrowserUse.snapshot()',
    returnByValue: true,
    awaitPromise: true
  })
  const axResult = await executeCdp(sessionKey, 'Accessibility.getFullAXTree')
  const resultValue = isRecord(domResult.result) ? domResult.result.value : null
  const snapshotValue = isRecord(resultValue) ? resultValue : {}
  const nodes = Array.isArray(snapshotValue.nodes) ? snapshotValue.nodes : []
  const unsupportedFrames = Array.isArray(snapshotValue.unsupportedFrames)
    ? snapshotValue.unsupportedFrames.filter((frame): frame is string => typeof frame === 'string')
    : []
  const title = asString(snapshotValue.title) ?? ''
  const url = asString(snapshotValue.url) ?? ''

  const domCandidates = nodes
    .map((node): LocatorCandidate | null => {
      if (!isRecord(node)) return null
      return {
        token: asString(node.token) ?? '',
        framePath: Array.isArray(node.framePath)
          ? node.framePath.filter((index): index is number => Number.isInteger(index))
          : [],
        tagName: asString(node.tagName) ?? '',
        role: asString(node.role),
        name: asString(node.name),
        text: asString(node.text) ?? '',
        value: asString(node.value),
        visible: node.visible === true,
        enabled: node.enabled === true,
        editable: node.editable === true,
        backendNodeId: asNumber(node.backendNodeId),
        viewportPoint: pointFromRecord(node.viewportPoint)
      }
    })
    .filter((node): node is LocatorCandidate => node !== null && node.token.length > 0)

  return {
    url,
    title,
    frames: flattenFrames(frameTree),
    unsupportedFrames,
    dom: (await enrichBackendNodeIds(sessionKey, domCandidates)).map(toDomNode),
    accessibility: readAxNodes(axResult)
  }
}
