export type ComputerUseModifier = 'shift' | 'control' | 'option' | 'command' | 'function'

export type ComputerUseDisplayInfo = {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  primary: boolean
  internal: boolean
}

export type ComputerUseWindowTarget = {
  windowId: number
  ownerPid: number
  ownerName: string
  title: string | null
  bounds: { x: number; y: number; width: number; height: number }
  displayId: number | null
  displayLabel: string | null
  sourceId: string | null
  sourceName: string | null
  sourceDisplayId: string | null
  hasAppIcon: boolean
  isFrontmostApp: boolean
}

export type ComputerUseAppTarget = {
  id: string
  ownerPid: number
  ownerName: string
  isFrontmostApp: boolean
  windows: ComputerUseWindowTarget[]
}

export type ComputerUseDebugInventory = {
  listedAt: string
  displays: ComputerUseDisplayInfo[]
  apps: ComputerUseAppTarget[]
  sourceError: string | null
}

export type ComputerUseCaptureGeometry = {
  region: 'window-frame' | 'display-full'
  coordinateSpace: 'cg-global'
  unit: 'point'
  originY: 'top'
  displayId?: number
  displayBounds?: { x: number; y: number; width: number; height: number }
  displayScaleFactor: number
  windowBounds?: { x: number; y: number; width: number; height: number }
  nativePixelSize: { width: number; height: number }
  thumbnailScale: number
}

export type ComputerUseCapturedWindow = {
  data?: string
  path: string
  mimeType: 'image/png'
  width: number
  height: number
  source: { id: string; name: string; cgWindowId?: number }
  geometry: ComputerUseCaptureGeometry
}

export type ComputerUseOverlayDebugState = {
  enabled: boolean
  platform: NodeJS.Platform
  pageReady: boolean
  hasWindow: boolean
  windowVisible: boolean
  level: string
  currentLeaseSessionId: string | null
  lastPosition: { x: number; y: number } | null
  defaultOrigin: { x: number; y: number } | null
  targetWindowId: number | null
  overlayBounds: { x: number; y: number; width: number; height: number }
  boundsOverride: { x: number; y: number; width: number; height: number } | null
  virtualBounds: { x: number; y: number; width: number; height: number }
}

export type ComputerUseOverlayDebugProbe = {
  state: ComputerUseOverlayDebugState
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
}

export type ComputerUseOverlayAnimationResult = {
  targetWindowId: number
  ownerName: string
  title: string | null
  points: Array<{ x: number; y: number }>
  overlayBefore: ComputerUseOverlayDebugState
  overlayAfter: ComputerUseOverlayDebugState
  probe: ComputerUseOverlayDebugProbe
}

export type ComputerUseDragTestResult = {
  from: { x: number; y: number }
  to: { x: number; y: number }
  result: Record<string, unknown>
}

export type ComputerUseClickPosition =
  | { space: 'cg-global-points'; x: number; y: number }
  | { space: 'window-points'; x: number; y: number }
  | {
      space: 'screenshot-pixels'
      px: number
      py: number
      geometry: ComputerUseCaptureGeometry
    }

export type ComputerUseClickToolParams = {
  snapshotId?: string
  ref?: string
  action?: string
  windowId?: number
  position?: ComputerUseClickPosition
  button?: 'left' | 'right' | 'middle'
  count?: number
  modifiers?: ComputerUseModifier[]
  holdMs?: number
}

export type ComputerUseClickToolResult = {
  strategy: 'ax' | 'physical' | 'physical-fallback'
  ref?: string
  snapshotId?: string
  triedActions?: string[]
  result: Record<string, unknown>
  axError?: string
}

export type ComputerUseAppStateElement = {
  ref: string
  nodeId: number
  parentRef?: string
  depth: number
  role: string
  roleDescription?: string
  subrole?: string
  title?: string
  description?: string
  value?: string
  identifier?: string
  focused: boolean
  frame?: { x: number; y: number; width: number; height: number }
  availableActions: string[]
}

export type ComputerUseAppStateResult = {
  snapshotId: string
  capturedAt: string
  pid: number
  ownerName: string | null
  windowId: number
  focusedElementRef: string | null
  nodeCount: number
  truncated: boolean
  text: string
  elements: ComputerUseAppStateElement[]
  screenshot: ComputerUseCapturedWindow
}
