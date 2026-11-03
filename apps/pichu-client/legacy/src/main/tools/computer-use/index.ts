import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { listWindows, type MacWindow } from '@pichu/mac-window-list'
import { Type } from 'typebox'
import { getSettingsForRenderer } from '../../stores/settings-store.js'
import {
  axPressNode as inputAxPressNode,
  backgroundClick as inputBackgroundClick,
  backgroundDrag as inputBackgroundDrag,
  backgroundPressKey as inputBackgroundPressKey,
  backgroundType as inputBackgroundType,
  readFocusedWindowAccessibilityTree as inputReadFocusedWindowAccessibilityTree,
  previewBackgroundClickPoint,
  previewBackgroundDragPath
} from './computer-input.js'
import {
  type CursorHandle,
  getCursorOverlayDebugState,
  getCursorOverlayTargetWindowId,
  setCursorOverlayBoundsOverride,
  setCursorOverlayTargetWindowId,
  withCursor as withCursorLock
} from './cursor-overlay.js'
import {
  type CapturedImage,
  captureAppWindow,
  captureDesktop,
  listScreenSources
} from './screen-capture.js'

const listScreenSourcesSchema = Type.Object({
  includeWindows: Type.Optional(
    Type.Boolean({
      description:
        'When true, also enumerate open application windows in addition to displays. Defaults to true.'
    })
  )
})

const captureDesktopSchema = Type.Object({
  displayId: Type.Optional(
    Type.Number({
      description:
        'Optional display id from listScreenSources. Omit to capture the primary display.'
    })
  ),
  maxDimension: Type.Optional(
    Type.Number({
      description:
        'Optional max width/height in pixels for the returned PNG. Defaults to 1920. Use a smaller value (e.g. 1280) to reduce token cost when full resolution is not needed.'
    })
  )
})

const computerEnsureAppSchema = Type.Object({
  query: Type.Optional(
    Type.String({
      description:
        'Human app name to find or launch, e.g. "Safari", "Workspace", "Cursor", "Visual Studio Code". Used to match window owner names and for `open -a` when launching.'
    })
  ),
  bundleId: Type.Optional(
    Type.String({
      description:
        'Optional macOS bundle identifier, e.g. "com.apple.Safari". Used for launching with `open -b`; pass `query` too when you want reliable window matching after launch.'
    })
  ),
  path: Type.Optional(
    Type.String({
      description:
        'Optional app path, e.g. "/Applications/Safari.app". Used for launching when query/bundleId is not sufficient.'
    })
  ),
  launchIfNotRunning: Type.Optional(
    Type.Boolean({
      description:
        'When true, launch the app if no matching window is currently visible. Defaults to true.'
    })
  ),
  waitForWindow: Type.Optional(
    Type.Boolean({
      description:
        'When true, wait briefly after launch for a normal app window to appear. Defaults to true.'
    })
  ),
  timeoutMs: Type.Optional(
    Type.Number({
      description: 'Maximum time to wait for a window after launch. Defaults to 8000ms.'
    })
  ),
  includeScreenSource: Type.Optional(
    Type.Boolean({
      description:
        'When true, also attach capture sourceId values for matching windows if Screen Recording allows it. Defaults to true.'
    })
  )
})

const modifierKeysSchema = Type.Optional(
  Type.Array(
    Type.Union([
      Type.Literal('shift'),
      Type.Literal('control'),
      Type.Literal('option'),
      Type.Literal('command'),
      Type.Literal('function')
    ]),
    {
      description:
        'Optional modifier keys held during the action. macOS names: "command" (Cmd), "option" (Alt), "control" (Ctrl), "shift", "function" (Fn).'
    }
  )
)

// All computer input tools route through the background path
// (`CGEventPostToPid` + per-window-id event tagging), so they NEVER bring
// the target app to the foreground — Owls stays frontmost throughout.

const computerWindowTargetField = Type.Number({
  description:
    'Target CGWindowID. Get this from `computerGetAppState.details.screenshot.source.cgWindowId` or listScreenSources. The pid is auto-resolved from the windowId.'
})

// `windowId` is preferred (it documents WHICH window of the app is targeted),
// but `pid` is accepted as a fallback for apps the agent already has the pid for.
const computerProcessTargetFields = {
  windowId: Type.Optional(computerWindowTargetField),
  pid: Type.Optional(
    Type.Number({
      description:
        'Fallback when no windowId is available. Process pid of the target app. Prefer `windowId`.'
    })
  )
}

const computerTargetIsActiveField = Type.Optional(
  Type.Boolean({
    description:
      'Override the auto-detection of whether the target app is already foreground. Auto-detected via NSWorkspace by default and reported for diagnostics.'
  })
)

// ---- Coordinate-input schemas (shared by computerClick + computerDrag) ----
//
// The screenshot tools return a `geometry` blob fully describing the
// pixel-to-point mapping. Instead of forcing the agent to compute
// `gx = anchor.x + (px / thumbnailScale) / displayScaleFactor` itself, the
// mouse tools accept the source coordinates in any of three spaces and the
// conversion happens server-side.

const captureCoordGeometrySchema = Type.Object(
  {
    region: Type.Union([Type.Literal('window-frame'), Type.Literal('display-full')], {
      description:
        '`window-frame` for `computerGetAppState` results (anchor = `windowBounds`); `display-full` for `captureDesktop` results (anchor = `displayBounds`).'
    }),
    displayScaleFactor: Type.Number({
      description:
        'Retina backing scale factor of the captured display (e.g. 2 means 1 point = 2 pixels).'
    }),
    thumbnailScale: Type.Number({
      description:
        'PNG width / nativePixelSize.width. ≤1 when the screenshot was clamped by `maxDimension`.'
    }),
    windowBounds: Type.Optional(
      Type.Object(
        {
          x: Type.Number(),
          y: Type.Number(),
          width: Type.Number(),
          height: Type.Number()
        },
        {
          description:
            'Window CGWindowBounds in CG global points. Required when region="window-frame".'
        }
      )
    ),
    displayBounds: Type.Optional(
      Type.Object(
        {
          x: Type.Number(),
          y: Type.Number(),
          width: Type.Number(),
          height: Type.Number()
        },
        { description: 'Display bounds in CG global points. Required when region="display-full".' }
      )
    )
  },
  {
    description:
      'Copy this object verbatim from `computerGetAppState.details.screenshot.geometry` or `captureDesktop.details.geometry`. Required only when `space="screenshot-pixels"`.'
  }
)

const cgGlobalPointPositionSchema = Type.Object(
  {
    space: Type.Literal('cg-global-points'),
    x: Type.Number({
      description: 'X in CG global points (top-left origin of primary display, Y grows down).'
    }),
    y: Type.Number({ description: 'Y in CG global points.' })
  },
  {
    description:
      'Direct CG global point coordinates. Use when you already have global points (e.g. from `@pichu/mac-window-list` window bounds).'
  }
)

const windowPointPositionSchema = Type.Object(
  {
    space: Type.Literal('window-points'),
    x: Type.Number({
      description:
        "X in points relative to the target window's top-left corner (CGWindowBounds origin)."
    }),
    y: Type.Number({
      description: "Y in points relative to the target window's top-left (Y grows down)."
    })
  },
  {
    description:
      "Window-local point coordinates. Owls looks up the window's global origin from `windowId` automatically — pass coords as if the window started at (0, 0)."
  }
)

const screenshotPixelPositionSchema = Type.Object(
  {
    space: Type.Literal('screenshot-pixels'),
    px: Type.Number({
      description:
        'X pixel inside the screenshot PNG returned by `computerGetAppState` or `captureDesktop` (top-left origin of the PNG).'
    }),
    py: Type.Number({ description: 'Y pixel inside the screenshot PNG (Y grows down).' }),
    geometry: captureCoordGeometrySchema
  },
  {
    description:
      'Pixel coordinates inside a screenshot. Pass the `geometry` blob verbatim from the screenshot tool result; Owls converts to CG global points using `gx = anchor.x + (px / thumbnailScale) / displayScaleFactor`.'
  }
)

const computerClickPositionSchema = Type.Union(
  [cgGlobalPointPositionSchema, windowPointPositionSchema, screenshotPixelPositionSchema],
  {
    description:
      'Click position. Pick one of three coordinate spaces — Owls converts to CG global points internally so you do NOT need to do screenshot-pixel math yourself.'
  }
)

const cgGlobalPointPathSchema = Type.Object(
  {
    space: Type.Literal('cg-global-points'),
    fromX: Type.Number({ description: 'Start X in CG global points.' }),
    fromY: Type.Number({ description: 'Start Y in CG global points (Y grows down).' }),
    toX: Type.Number({ description: 'End X in CG global points.' }),
    toY: Type.Number({ description: 'End Y in CG global points.' })
  },
  { description: 'Direct CG global point path.' }
)

const windowPointPathSchema = Type.Object(
  {
    space: Type.Literal('window-points'),
    fromX: Type.Number({ description: "Start X in points relative to the window's top-left." }),
    fromY: Type.Number({ description: "Start Y in points relative to the window's top-left." }),
    toX: Type.Number({ description: "End X in points relative to the window's top-left." }),
    toY: Type.Number({ description: "End Y in points relative to the window's top-left." })
  },
  { description: 'Window-local path. Both endpoints share the same window origin.' }
)

const screenshotPixelPathSchema = Type.Object(
  {
    space: Type.Literal('screenshot-pixels'),
    fromX: Type.Number({ description: 'Start X pixel inside the screenshot PNG.' }),
    fromY: Type.Number({ description: 'Start Y pixel inside the screenshot PNG.' }),
    toX: Type.Number({ description: 'End X pixel inside the screenshot PNG.' }),
    toY: Type.Number({ description: 'End Y pixel inside the screenshot PNG.' }),
    geometry: captureCoordGeometrySchema
  },
  {
    description:
      'Pixel-coord path. Both endpoints share the same `geometry` (one screenshot). Owls converts each endpoint to CG global points.'
  }
)

const computerDragPathSchema = Type.Union(
  [cgGlobalPointPathSchema, windowPointPathSchema, screenshotPixelPathSchema],
  {
    description:
      'Drag path. Both endpoints must be inside the target window. Pick one coordinate space for both endpoints.'
  }
)

const computerGetAppStateSchema = Type.Object({
  windowId: Type.Optional(computerWindowTargetField),
  query: Type.Optional(
    Type.String({
      description:
        'Case-insensitive substring to match when windowId/sourceId is not provided, e.g. "Safari", "Code", or "Workspace".'
    })
  ),
  sourceId: Type.Optional(
    Type.String({
      description: 'Exact window source id from listScreenSources, e.g. "window:12345:0".'
    })
  ),
  maxDimension: Type.Optional(
    Type.Number({
      description:
        'Optional max width/height in pixels for the stored screenshot. Defaults to 1920.'
    })
  )
})

const computerClickSchema = Type.Object({
  snapshotId: Type.Optional(
    Type.String({
      description:
        'Snapshot id returned by computerGetAppState. Optional when using the most recent snapshot.'
    })
  ),
  ref: Type.Optional(
    Type.String({
      description:
        'Element ref from computerGetAppState, e.g. "e62". When supplied, Owls tries AX actions first and falls back to a physical click at the element frame.'
    })
  ),
  action: Type.Optional(
    Type.String({
      description:
        'Optional AX action to try first for ref clicks, copied from the element actions shown in computerGetAppState axTree.text, e.g. "AXPress" or "AXShowMenu". If omitted, Owls auto-tries common AX actions plus the element actions.'
    })
  ),
  windowId: Type.Optional(computerWindowTargetField),
  position: Type.Optional(computerClickPositionSchema),
  button: Type.Optional(
    Type.Union([Type.Literal('left'), Type.Literal('right'), Type.Literal('middle')], {
      description: 'Mouse button. Defaults to "left".'
    })
  ),
  count: Type.Optional(
    Type.Number({
      description: '1 = single, 2 = double, 3 = triple. Defaults to 1.'
    })
  ),
  modifiers: modifierKeysSchema,
  targetIsActive: computerTargetIsActiveField,
  holdMs: Type.Optional(
    Type.Number({
      description: 'Optional ms to hold the button between down and up. Defaults to 0.'
    })
  )
})

const computerDragSchema = Type.Object({
  windowId: computerWindowTargetField,
  path: computerDragPathSchema,
  button: Type.Optional(
    Type.Union([Type.Literal('left'), Type.Literal('right'), Type.Literal('middle')], {
      description: 'Mouse button held during the drag. Defaults to "left".'
    })
  ),
  steps: Type.Optional(
    Type.Number({
      description:
        'Number of intermediate `mouseDragged` events. Higher = smoother but slower. Defaults to 20.'
    })
  ),
  durationMs: Type.Optional(
    Type.Number({
      description: 'Total drag duration in ms (spread evenly across `steps`). Defaults to 250.'
    })
  ),
  modifiers: modifierKeysSchema,
  targetIsActive: computerTargetIsActiveField
})

const computerTypeSchema = Type.Object({
  ...computerProcessTargetFields,
  text: Type.String({
    description:
      "Literal Unicode text to insert into the target app's focused field. Does NOT trigger IME — characters appear exactly as provided. The target window must already have key focus inside its app — usually achieved by issuing `computerClick` on the input field first."
  }),
  perCharDelayMs: Type.Optional(
    Type.Number({
      description:
        'Optional per-character delay in ms. Defaults to 0 (instant). Use 5–15 for apps that drop characters on rapid input.'
    })
  )
})

const computerPressKeySchema = Type.Object({
  ...computerProcessTargetFields,
  key: Type.String({
    description:
      'Named key (case-insensitive): "return"/"enter", "escape"/"esc", "tab", "space", "delete"/"backspace", "forwarddelete", "left"/"right"/"up"/"down", "home", "end", "pageup", "pagedown", "f1".."f20", "a".."z", "0".."9", or punctuation like ",", ".", "/", "-". Also accepts a numeric kVK_ keycode as a string (e.g. "36" = Return). For typing prose use computerType instead.'
  }),
  modifiers: modifierKeysSchema
})

function imageContentFromCapture(image: CapturedImage): {
  type: 'text'
  text: string
} {
  return { type: 'text', text: `Screenshot saved locally: ${image.path}` }
}

type AppStateAxNode = Awaited<
  ReturnType<typeof inputReadFocusedWindowAccessibilityTree>
>['nodes'][number]

type ComputerAppStateElement = {
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

type ComputerAppStateSnapshot = {
  snapshotId: string
  capturedAt: string
  pid: number
  ownerName: string | null
  windowId: number
  focusedElementRef: string | null
  text: string
  elements: ComputerAppStateElement[]
  screenshot: {
    path: string
    mimeType: CapturedImage['mimeType']
    width: number
    height: number
    source: CapturedImage['source']
    geometry: CapturedImage['geometry']
  }
}

const appStateSnapshots = new Map<string, ComputerAppStateSnapshot>()
const MAX_APP_STATE_SNAPSHOTS = 20
const COMPUTER_AX_MAX_DEPTH = 200
const COMPUTER_AX_MAX_NODES = 10_000
let latestAppStateSnapshotId: string | null = null

function rememberAppStateSnapshot(snapshot: ComputerAppStateSnapshot): void {
  appStateSnapshots.set(snapshot.snapshotId, snapshot)
  latestAppStateSnapshotId = snapshot.snapshotId
  while (appStateSnapshots.size > MAX_APP_STATE_SNAPSHOTS) {
    const oldest = appStateSnapshots.keys().next().value as string | undefined
    if (!oldest) break
    appStateSnapshots.delete(oldest)
  }
}

function compactText(value: string | undefined): string | null {
  const text = value?.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > 80 ? `${text.slice(0, 77)}...` : text
}

function axNodeToElement(node: AppStateAxNode): ComputerAppStateElement {
  return {
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
  }
}

function formatAppStateElement(element: ComputerAppStateElement): string {
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

function extractWindowIdFromSourceId(sourceId: string): number | null {
  const match = /^window:(\d+):/.exec(sourceId)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

type EnsuredAppWindow = {
  windowId: number
  ownerName: string
  ownerPid: number
  title: string | null
  bounds: { x: number; y: number; width: number; height: number }
  sourceId: string | null
  sourceName: string | null
}

function compactAppQuery(value: string | undefined): string | null {
  const text = value?.trim()
  return text ? text.toLocaleLowerCase() : null
}

function appNameFromPath(path: string | undefined): string | null {
  if (!path) return null
  const name = basename(path)
    .replace(/\.app$/i, '')
    .trim()
  return name || null
}

function appWindowMatches(
  window: { ownerName: string; title?: string },
  query: string | null
): boolean {
  if (!query) return false
  return (
    window.ownerName.toLocaleLowerCase().includes(query) ||
    (window.title?.toLocaleLowerCase().includes(query) ?? false)
  )
}

function normalAppWindows(): MacWindow[] {
  if (process.platform !== 'darwin') return []
  try {
    return listWindows({ onScreenOnly: true, includeSystemChrome: false })
  } catch {
    return []
  }
}

function visibleAppWindows(query: string | null): MacWindow[] {
  if (!query) return []
  return normalAppWindows().filter((window) => appWindowMatches(window, query))
}

function openApplication(params: {
  query?: string
  bundleId?: string
  path?: string
}): Promise<void> {
  const args = ['-g']
  if (params.bundleId?.trim()) {
    args.push('-b', params.bundleId.trim())
  } else if (params.path?.trim()) {
    args.push(params.path.trim())
  } else if (params.query?.trim()) {
    args.push('-a', params.query.trim())
  } else {
    throw new Error('Provide query, bundleId, or path.')
  }
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', args, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function sourceInfoByWindowId(): Promise<{
  sources: Map<number, { id: string; name: string }>
  error: string | null
}> {
  try {
    const result = await listScreenSources({
      computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
      includeWindows: true
    })
    const sources = new Map<number, { id: string; name: string }>()
    for (const window of result.windows) {
      const windowId = extractWindowIdFromSourceId(window.id)
      if (windowId !== null) {
        sources.set(windowId, { id: window.id, name: window.name })
      }
    }
    return { sources, error: null }
  } catch (error) {
    return {
      sources: new Map(),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function formatEnsuredAppWindows(
  windows: MacWindow[],
  includeScreenSource: boolean
): Promise<{ windows: EnsuredAppWindow[]; sourceError: string | null }> {
  const sourceLookup = includeScreenSource ? await sourceInfoByWindowId() : null
  return {
    windows: windows.map((window) => {
      const source = sourceLookup?.sources.get(window.windowId)
      return {
        windowId: window.windowId,
        ownerName: window.ownerName,
        ownerPid: window.ownerPid,
        title: window.title ?? null,
        bounds: window.bounds,
        sourceId: source?.id ?? null,
        sourceName: source?.name ?? null
      }
    }),
    sourceError: sourceLookup?.error ?? null
  }
}

async function ensureComputerApp(params: {
  query?: string
  bundleId?: string
  path?: string
  launchIfNotRunning?: boolean
  waitForWindow?: boolean
  timeoutMs?: number
  includeScreenSource?: boolean
}): Promise<{
  query: string | null
  bundleId: string | null
  path: string | null
  appName: string | null
  isRunning: boolean
  wasLaunched: boolean
  windows: EnsuredAppWindow[]
  sourceError: string | null
}> {
  const displayQuery = params.query?.trim() || appNameFromPath(params.path) || null
  const matchQuery = compactAppQuery(displayQuery ?? undefined)
  if (!matchQuery && !params.bundleId?.trim() && !params.path?.trim()) {
    throw new Error('Provide query, bundleId, or path.')
  }

  const beforeLaunchWindowIds = new Set(normalAppWindows().map((window) => window.windowId))
  let wasLaunched = false
  let matchingWindows = visibleAppWindows(matchQuery)
  const launchIfNotRunning = params.launchIfNotRunning ?? true
  if (matchingWindows.length === 0 && launchIfNotRunning) {
    await openApplication(params)
    wasLaunched = true
    if (params.waitForWindow ?? true) {
      const deadline = Date.now() + Math.max(0, Math.round(params.timeoutMs ?? 8000))
      do {
        await new Promise((resolve) => setTimeout(resolve, 250))
        matchingWindows = matchQuery
          ? visibleAppWindows(matchQuery)
          : normalAppWindows().filter((window) => !beforeLaunchWindowIds.has(window.windowId))
      } while (matchingWindows.length === 0 && Date.now() < deadline)
    } else {
      await new Promise((resolve) => setTimeout(resolve, 500))
      matchingWindows = matchQuery
        ? visibleAppWindows(matchQuery)
        : normalAppWindows().filter((window) => !beforeLaunchWindowIds.has(window.windowId))
    }
  }

  const formatted = await formatEnsuredAppWindows(
    matchingWindows,
    params.includeScreenSource ?? true
  )
  const appName = formatted.windows[0]?.ownerName ?? displayQuery
  return {
    query: displayQuery,
    bundleId: params.bundleId?.trim() || null,
    path: params.path?.trim() || null,
    appName,
    isRunning: matchingWindows.length > 0,
    wasLaunched,
    windows: formatted.windows,
    sourceError: formatted.sourceError
  }
}

const computerEnsureAppTool: AgentTool<typeof computerEnsureAppSchema> = {
  name: 'computerEnsureApp',
  label: 'Ensure App',
  description:
    'Find a Mac app for Computer Use and optionally launch it in the background if no matching visible window exists. ' +
    'Use this as the first step for app-specific tasks, before computerGetAppState. ' +
    'Pass a human `query` such as "Safari", "Workspace", or "Cursor"; optional `bundleId`/`path` can make launching more precise. ' +
    'Returns matching visible windows with `windowId` values suitable for computerGetAppState/computerClick/computerType. ' +
    'When Screen Recording metadata is available, also returns each window capture `sourceId`. Launch uses `open -g` so Owls should remain foreground.',
  parameters: computerEnsureAppSchema,
  async execute(_toolCallId, params) {
    const result = await ensureComputerApp(params)
    const windowLines = result.windows.map((window) => {
      const title = window.title ? ` — ${window.title}` : ''
      const source = window.sourceId ? ` sourceId=${window.sourceId}` : ''
      return `- windowId=${window.windowId} pid=${window.ownerPid} ${window.ownerName}${title}${source}`
    })
    const launchNote = result.wasLaunched ? ' Launched the app in the background.' : ''
    const sourceNote = result.sourceError
      ? `\n\nCapture source metadata unavailable: ${result.sourceError}`
      : ''
    return {
      content: [
        {
          type: 'text',
          text:
            `${result.appName ?? result.query ?? result.bundleId ?? result.path ?? 'App'}: ` +
            `${result.windows.length} visible matching window${result.windows.length === 1 ? '' : 's'} found.${launchNote}\n` +
            (windowLines.length
              ? windowLines.join('\n')
              : 'No visible matching window found yet.') +
            sourceNote
        }
      ],
      details: result
    }
  }
}

const listScreenSourcesTool: AgentTool<typeof listScreenSourcesSchema> = {
  name: 'listScreenSources',
  label: 'List Screen Sources',
  description:
    "List the displays connected to the user's Mac and (optionally) the open application windows that can be captured. " +
    'This is an advanced capture/display diagnostic tool. For normal app tasks, use computerEnsureApp first and then computerGetAppState. ' +
    'Use listScreenSources only when you need available displayId values or raw capture source ids. ' +
    'Requires Computer Use to be enabled with macOS Screen Recording permission.',
  parameters: listScreenSourcesSchema,
  async execute(_toolCallId, params) {
    const result = await listScreenSources({
      computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
      includeWindows: params.includeWindows ?? true
    })

    const displayLines = result.displays.map(
      (d) =>
        `- id=${d.id} ${d.primary ? '(primary) ' : ''}${d.label} ` +
        `origin=(${d.bounds.x},${d.bounds.y}) size=${d.bounds.width}x${d.bounds.height}pt @${d.scaleFactor}x`
    )
    const windowLines = result.windows.map((w) => {
      const owner = w.ownerName ? `${w.ownerName} ` : ''
      const title = w.title ?? w.name
      return `- ${owner}— ${title}  [sourceId=${w.id}]`
    })

    const text = [
      `Displays (${result.displays.length}):`,
      ...(displayLines.length ? displayLines : ['  (none)']),
      '',
      `Windows (${result.windows.length}):`,
      ...(windowLines.length ? windowLines : ['  (none — pass includeWindows=true to enumerate)'])
    ].join('\n')

    return {
      content: [{ type: 'text', text }],
      details: result
    }
  }
}

const captureDesktopTool: AgentTool<typeof captureDesktopSchema> = {
  name: 'captureDesktop',
  label: 'Capture Desktop',
  description:
    "Take a screenshot of the user's Mac desktop and store it as a local PNG file. " +
    'Captures the primary display by default; pass displayId from listScreenSources to target another monitor. ' +
    'The returned PNG includes light pixel reference rulers and numeric tick labels along the top/left edges for easier visual coordinate estimation. ' +
    'The tool result returns the local screenshot path plus geometry instead of embedding base64 image data. ' +
    'Requires Computer Use to be enabled with macOS Screen Recording permission. ' +
    'Use this when the user asks "what do you see on my screen", to inspect a UI before taking action, ' +
    'or to gather visual evidence about the desktop state.',
  parameters: captureDesktopSchema,
  async execute(_toolCallId, params) {
    const image = await captureDesktop({
      computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
      displayId: params.displayId,
      maxDimension: params.maxDimension
    })
    const bounds = image.geometry.displayBounds
    const boundsLabel = bounds
      ? `bounds (${bounds.x},${bounds.y}) ${bounds.width}x${bounds.height}pt, `
      : ''
    return {
      content: [
        {
          type: 'text',
          text:
            `Captured desktop "${image.source.name}" (${image.width}x${image.height} px, ` +
            `display ${image.geometry.displayId} @${image.geometry.displayScaleFactor}x, ` +
            boundsLabel +
            `thumbnail scale ${image.geometry.thumbnailScale.toFixed(3)}). ` +
            `Bounds in CG global points (top-left origin). PNG includes light pixel reference rulers.`
        },
        imageContentFromCapture(image)
      ],
      details: {
        path: image.path,
        width: image.width,
        height: image.height,
        source: image.source,
        geometry: image.geometry
      }
    }
  }
}

const computerGetAppStateTool: AgentTool<typeof computerGetAppStateSchema> = {
  name: 'computerGetAppState',
  label: 'Get App State',
  description:
    'Inspect a target app window and return a Computer Use state split into `screenshot` and `axTree`. `axTree.text` contains compact refs such as `e62 AXTextField ~ "Message" [focused]`. ' +
    'Use this as the default first step before clicking or typing in another app. Pass `windowId`, `sourceId`, or a `query` such as "Safari" or "Workspace". ' +
    'Use refs from `axTree.text` with `computerClick({ ref })`; pass `axTree.snapshotId` if you need to target this exact snapshot.',
  parameters: computerGetAppStateSchema,
  async execute(_toolCallId, params) {
    const sourceId =
      typeof params.sourceId === 'string' && params.sourceId.trim()
        ? params.sourceId.trim()
        : undefined
    const image = await captureAppWindow({
      computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
      windowId: params.windowId,
      query: params.query,
      sourceId,
      maxDimension: params.maxDimension
    })
    const windowId = params.windowId ?? image.source.cgWindowId
    if (!windowId) {
      throw new Error(
        'Captured window did not expose a CGWindowID; use listScreenSources and retry.'
      )
    }
    const axTree = await inputReadFocusedWindowAccessibilityTree({
      computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
      windowId,
      maxDepth: COMPUTER_AX_MAX_DEPTH,
      maxNodes: COMPUTER_AX_MAX_NODES
    })
    const elements = axTree.nodes.map(axNodeToElement)
    const focusedElementRef =
      axTree.focusedElementId === null || axTree.focusedElementId === undefined
        ? null
        : `e${axTree.focusedElementId}`
    const text = elements.map(formatAppStateElement).join('\n')
    const snapshot: ComputerAppStateSnapshot = {
      snapshotId: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      pid: axTree.pid,
      ownerName: axTree.ownerName,
      windowId,
      focusedElementRef,
      text,
      elements,
      screenshot: {
        path: image.path,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        source: image.source,
        geometry: image.geometry
      }
    }
    rememberAppStateSnapshot(snapshot)
    return {
      content: [
        {
          type: 'text',
          text:
            `App state for "${image.source.name}"\n\n` +
            `Screenshot: ${image.path}\n\n` +
            `AX tree text (snapshot ${snapshot.snapshotId}):\n${text || '(No AX elements collected.)'}`
        }
      ],
      details: {
        screenshot: snapshot.screenshot,
        axTree: {
          snapshotId: snapshot.snapshotId,
          capturedAt: snapshot.capturedAt,
          windowId: snapshot.windowId,
          pid: snapshot.pid,
          ownerName: snapshot.ownerName,
          focusedRef: snapshot.focusedElementRef,
          nodeCount: axTree.nodeCount,
          truncated: axTree.truncated,
          maxDepth: COMPUTER_AX_MAX_DEPTH,
          maxNodes: COMPUTER_AX_MAX_NODES,
          text
        }
      }
    }
  }
}

// All four computer input tools below route 100% through the background
// path: `CGEventPostToPid` (+ per-window-id event tagging for mouse).
// The Owls app NEVER yields the foreground; the target app is not
// activated. The cursor overlay only renders a transparent "ghost cursor"
// indicator over the click point — the user's real cursor never moves.
//
// Cursor-overlay session contract
// --------------------------------
// Every computer-use tool's first step is to acquire the global cursor
// lease via `withComputerCursor(...)`. The returned Promise resolves only
// after the overlay has rendered the cursor on screen (at the input
// position by default) — so the tool body never runs while the cursor is
// being dispatched. If another session is already holding the cursor the
// acquire blocks in a FIFO queue. The helper also guarantees release on
// success or failure via try/finally, so the queue cannot wedge.

let getComputerUseSessionId: () => string | null = () => null

function withComputerCursor<T>(fn: (cursor: CursorHandle) => Promise<T>): Promise<T> {
  return withCursorLock(getComputerUseSessionId() ?? 'agent', fn)
}

const COMPUTER_CLICK_SETTLE_DELAY_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

function resolveCursorScopeBounds(
  windowId: number
): { x: number; y: number; width: number; height: number } | null {
  if (!Number.isInteger(windowId) || windowId <= 0 || process.platform !== 'darwin') {
    return null
  }
  try {
    const window = listWindows({ onScreenOnly: true, includeSystemChrome: true }).find(
      (entry) => entry.windowId === windowId
    )
    return window
      ? {
          x: window.bounds.x,
          y: window.bounds.y,
          width: window.bounds.width,
          height: window.bounds.height
        }
      : null
  } catch {
    return null
  }
}

async function withComputerCursorForWindow<T>(
  windowId: number,
  fn: (cursor: CursorHandle) => Promise<T>
): Promise<T> {
  const previousBounds = getCursorOverlayDebugState().boundsOverride
  const previousTargetWindowId = getCursorOverlayTargetWindowId()
  const scopedBounds = resolveCursorScopeBounds(windowId)
  if (scopedBounds) {
    setCursorOverlayTargetWindowId(windowId)
    setCursorOverlayBoundsOverride(scopedBounds)
  }
  try {
    return await withComputerCursor(fn)
  } finally {
    setCursorOverlayBoundsOverride(previousBounds)
    setCursorOverlayTargetWindowId(previousTargetWindowId)
  }
}

async function withComputerCursorAttachedAcrossDisplays<T>(
  windowId: number,
  fn: (cursor: CursorHandle) => Promise<T>
): Promise<T> {
  const previousBounds = getCursorOverlayDebugState().boundsOverride
  const previousTargetWindowId = getCursorOverlayTargetWindowId()
  setCursorOverlayBoundsOverride(null)
  setCursorOverlayTargetWindowId(windowId)
  try {
    return await withComputerCursor(fn)
  } finally {
    setCursorOverlayBoundsOverride(previousBounds)
    setCursorOverlayTargetWindowId(previousTargetWindowId)
  }
}

function describePosition(
  source:
    | { space: 'cg-global-points'; x: number; y: number }
    | { space: 'window-points'; x: number; y: number }
    | { space: 'screenshot-pixels'; px: number; py: number }
): string {
  if (source.space === 'cg-global-points') return `cg-global (${source.x}, ${source.y})`
  if (source.space === 'window-points') return `window (${source.x}, ${source.y})`
  return `screenshot px (${source.px}, ${source.py})`
}

function resolveSnapshot(snapshotId?: string): ComputerAppStateSnapshot {
  const id = snapshotId ?? latestAppStateSnapshotId
  if (!id) {
    throw new Error('No app state snapshot is available. Call computerGetAppState first.')
  }
  const snapshot = appStateSnapshots.get(id)
  if (!snapshot) {
    throw new Error(
      `Unknown or expired app state snapshot "${id}". Call computerGetAppState again.`
    )
  }
  return snapshot
}

function actionCandidatesForElement(
  element: ComputerAppStateElement,
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

function centerPositionForElementFrame(
  element: ComputerAppStateElement
): { space: 'cg-global-points'; x: number; y: number } | null {
  if (!element.frame) return null
  const x = element.frame.x + element.frame.width / 2
  const y = element.frame.y + element.frame.height / 2
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { space: 'cg-global-points', x, y }
}

const computerClickTool: AgentTool<typeof computerClickSchema> = {
  name: 'computerClick',
  label: 'Click',
  description:
    'Click a target in another app WITHOUT activating it. Prefer `ref` from `computerGetAppState`, e.g. `{ ref: "e62" }`: Owls tries AX actions first, then falls back to a plain physical click at the element frame center. ' +
    'If `axTree.text` shows actions for the ref, pass `action` to try a specific AX action first; otherwise Owls auto-selects. ' +
    'For coordinate fallback, pass `windowId` plus `position` in screenshot pixels, window points, or CG global points. ' +
    'Physical clicks use plain `CGEventPostToPid` mouseDown/mouseUp events with no synthetic Command/Option delivery bypass; target apps only see modifiers you explicitly pass. ' +
    'The result reports the resolved `globalX`/`globalY` and `windowLocalX`/`windowLocalY` so you can verify the conversion. ' +
    'After the click, take a fresh `computerGetAppState` screenshot to verify the UI actually changed; do not trust the click result alone. ' +
    'Requires Computer Use enabled and macOS Accessibility permission.',
  parameters: computerClickSchema,
  async execute(_toolCallId, params) {
    if (params.ref) {
      const snapshot = resolveSnapshot(params.snapshotId)
      const element = snapshot.elements.find((entry) => entry.ref === params.ref)
      if (!element) {
        throw new Error(`Ref "${params.ref}" was not found in snapshot ${snapshot.snapshotId}.`)
      }
      return withComputerCursorAttachedAcrossDisplays(snapshot.windowId, async (cursor) => {
        const triedActions: string[] = []
        let lastAxError: unknown = null
        const framePosition = centerPositionForElementFrame(element)
        if (framePosition) {
          await cursor.moveTo(framePosition.x, framePosition.y)
          await sleep(COMPUTER_CLICK_SETTLE_DELAY_MS)
        }
        for (const action of actionCandidatesForElement(element, params.action)) {
          triedActions.push(action)
          try {
            const result = await inputAxPressNode({
              computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
              windowId: snapshot.windowId,
              nodeId: element.nodeId,
              action,
              maxDepth: COMPUTER_AX_MAX_DEPTH,
              maxNodes: COMPUTER_AX_MAX_NODES
            })
            if (framePosition) {
              await cursor.flashClick(framePosition.x, framePosition.y)
            }
            return {
              content: [
                {
                  type: 'text',
                  text: `Performed ${result.action} on ${params.ref} (${element.role}) in snapshot ${snapshot.snapshotId}.`
                }
              ],
              details: {
                strategy: 'ax',
                ref: params.ref,
                snapshotId: snapshot.snapshotId,
                triedActions,
                result
              }
            }
          } catch (error) {
            lastAxError = error
          }
        }
        if (!element.frame) {
          const reason = lastAxError instanceof Error ? lastAxError.message : String(lastAxError)
          throw new Error(
            `AX click failed for ${params.ref} and the element has no frame for physical fallback. Last AX error: ${reason}`
          )
        }
        const position = framePosition ?? {
          space: 'cg-global-points' as const,
          x: element.frame.x + element.frame.width / 2,
          y: element.frame.y + element.frame.height / 2
        }
        const preview = previewBackgroundClickPoint({
          windowId: snapshot.windowId,
          position
        })
        await cursor.moveTo(preview.globalX, preview.globalY)
        await sleep(COMPUTER_CLICK_SETTLE_DELAY_MS)
        const result = await inputBackgroundClick({
          computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
          windowId: snapshot.windowId,
          position,
          button: params.button,
          count: params.count,
          modifiers: params.modifiers,
          targetIsActive: params.targetIsActive,
          holdMs: params.holdMs
        })
        await cursor.flashClick(result.globalX, result.globalY)
        return {
          content: [
            {
              type: 'text',
              text:
                `AX actions [${triedActions.join(', ')}] failed for ${params.ref}; ` +
                `fell back to plain physical click at global (${Math.round(result.globalX)}, ${Math.round(result.globalY)}).`
            }
          ],
          details: {
            strategy: 'physical-fallback',
            ref: params.ref,
            snapshotId: snapshot.snapshotId,
            triedActions,
            axError: lastAxError instanceof Error ? lastAxError.message : String(lastAxError),
            result
          }
        }
      })
    }
    if (typeof params.windowId !== 'number' || !params.position) {
      throw new Error(
        'Provide either `ref` from computerGetAppState or both `windowId` and `position`.'
      )
    }
    const windowId = params.windowId
    const position = params.position
    return withComputerCursorAttachedAcrossDisplays(windowId, async (cursor) => {
      // 1. Resolve target coords up-front (without firing the click) so the
      //    visual ghost cursor can glide to the exact spot it'll land on.
      //    Throws here mean the subsequent backgroundClick would have thrown
      //    too — same validation path.
      const preview = previewBackgroundClickPoint({
        windowId,
        position
      })

      // 2. Glide the ghost cursor BEFORE the real click — the user sees A → B
      //    motion, then a press + ripple after the click resolves.
      await cursor.moveTo(preview.globalX, preview.globalY)
      await sleep(COMPUTER_CLICK_SETTLE_DELAY_MS)

      // 3. Fire the actual background click.
      const result = await inputBackgroundClick({
        computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
        windowId,
        position,
        button: params.button,
        count: params.count,
        modifiers: params.modifiers,
        targetIsActive: params.targetIsActive,
        holdMs: params.holdMs
      })

      // 4. Press + ripple visual feedback at the resolved point.
      await cursor.flashClick(result.globalX, result.globalY)

      const titleLabel = result.title ? ` — ${result.title}` : ''
      const modLabel =
        params.modifiers && params.modifiers.length > 0
          ? ` with modifiers [${params.modifiers.join('+')}]`
          : ''
      const countLabel = result.count > 1 ? ` x${result.count}` : ''
      return {
        content: [
          {
            type: 'text',
            text:
              `${result.button} click${countLabel}${modLabel} from ${describePosition(result.source)} ` +
              `→ global (${Math.round(result.globalX)}, ${Math.round(result.globalY)}) ` +
              `→ window-local (${Math.round(result.windowLocalX)}, ${Math.round(result.windowLocalY)}) ` +
              `on "${result.ownerName}"${titleLabel} (pid ${result.pid}, windowId ${result.windowId}) with plain CGEventPostToPid delivery.`
          }
        ],
        details: { strategy: 'physical', result }
      }
    })
  }
}

function describeDragEndpoints(source: {
  space: 'cg-global-points' | 'window-points' | 'screenshot-pixels'
  fromX: number
  fromY: number
  toX: number
  toY: number
}): string {
  if (source.space === 'screenshot-pixels') {
    return `screenshot px (${source.fromX}, ${source.fromY}) → (${source.toX}, ${source.toY})`
  }
  const label = source.space === 'cg-global-points' ? 'cg-global' : 'window'
  return `${label} (${source.fromX}, ${source.fromY}) → (${source.toX}, ${source.toY})`
}

const computerDragTool: AgentTool<typeof computerDragSchema> = {
  name: 'computerDrag',
  label: 'Drag',
  description:
    'Drag inside a specific window WITHOUT activating its app. ' +
    'Issues a mouse-down at the start, intermediate `mouseDragged` events along the path, then mouse-up at the end — every event is posted via `CGEventPostToPid` with the target windowId tagged into the CGEvent fields. ' +
    'Both endpoints must be inside the target window (drag is window-local). ' +
    '`path` accepts ANY of three coordinate spaces (both endpoints share the same space): ' +
    '(1) `cg-global-points` for global coords, (2) `window-points` for window-local points, (3) `screenshot-pixels` — pass `fromX`/`fromY`/`toX`/`toY` as PNG pixels plus the `geometry` blob copied verbatim from `computerGetAppState.details.screenshot.geometry` or `captureDesktop.details.geometry`. ' +
    'Use for selecting text inside the target app, moving sliders, dragging items between panes of the same window. ' +
    'Drag events use the explicit modifiers you pass and do not add a synthetic Command/Option delivery bypass. ' +
    'Requires Computer Use enabled and macOS Accessibility permission.',
  parameters: computerDragSchema,
  async execute(_toolCallId, params) {
    return withComputerCursorForWindow(params.windowId, async (cursor) => {
      const dragDurationMs = Math.max(0, Math.round(params.durationMs ?? 250))

      // Resolve the drag endpoints up-front so the cursor can glide to the
      // start point BEFORE the real mouse-down fires.
      const preview = previewBackgroundDragPath({
        windowId: params.windowId,
        path: params.path
      })

      // 1. Glide the ghost cursor to the drag origin.
      await cursor.moveTo(preview.fromGlobalX, preview.fromGlobalY)

      // 2. Kick off the drag visual + the native drag in parallel so the
      //    pressed-cursor animation tracks the actual mouse-drag path. Both
      //    use the same `dragDurationMs` so they finish together.
      const dragVisual = cursor.dragGlide(
        preview.fromGlobalX,
        preview.fromGlobalY,
        preview.toGlobalX,
        preview.toGlobalY,
        dragDurationMs
      )
      const result = await inputBackgroundDrag({
        computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
        windowId: params.windowId,
        path: params.path,
        button: params.button,
        steps: params.steps,
        durationMs: dragDurationMs,
        modifiers: params.modifiers,
        targetIsActive: params.targetIsActive
      })
      await dragVisual

      const titleLabel = result.title ? ` — ${result.title}` : ''
      return {
        content: [
          {
            type: 'text',
            text:
              `${result.button} drag from ${describeDragEndpoints(result.source)} ` +
              `→ global (${Math.round(result.fromGlobalX)}, ${Math.round(result.fromGlobalY)}) → (${Math.round(result.toGlobalX)}, ${Math.round(result.toGlobalY)}) ` +
              `over ${result.durationMs}ms on "${result.ownerName}"${titleLabel} (pid ${result.pid}, windowId ${result.windowId}) with plain CGEventPostToPid delivery.`
          }
        ],
        details: result
      }
    })
  }
}

const computerTypeTool: AgentTool<typeof computerTypeSchema> = {
  name: 'computerType',
  label: 'Type Text',
  description:
    "Type Unicode text into another app's focused input WITHOUT activating that app — Owls stays frontmost. " +
    'Posts keyboard events directly to the target process via `CGEventPostToPid`. ' +
    'Pass either `windowId` (preferred — pid is auto-resolved) or `pid`. ' +
    'Uses the Unicode input path so any character (CJK, emoji, accents) is inserted exactly as written, regardless of the active keyboard layout. Does NOT trigger an IME — characters are inserted literally. ' +
    '**Important**: the target window must already have key focus *inside* its app for text to land in the right field — usually achieved by calling `computerClick` on that input first. ' +
    'For shortcuts (Cmd+S, Tab, Escape) use computerPressKey instead. ' +
    'Requires Computer Use enabled and macOS Accessibility permission.',
  parameters: computerTypeSchema,
  async execute(_toolCallId, params) {
    // Type/pressKey don't move the cursor, but per the cursor-overlay
    // contract every computer-use tool acquires the lease so the ghost
    // cursor stays visible at its current position (or at the input origin
    // if this is the first acquire) for the entire run.
    return withComputerCursor(async () => {
      const result = await inputBackgroundType({
        computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
        windowId: params.windowId,
        pid: params.pid,
        text: params.text,
        perCharDelayMs: params.perCharDelayMs
      })
      const preview = params.text.length > 60 ? `${params.text.slice(0, 57)}…` : params.text
      const targetLabel = result.windowId
        ? `windowId ${result.windowId}${result.ownerName ? ` ("${result.ownerName}")` : ''}`
        : `pid ${result.pid}`
      const focusNote = result.windowId
        ? result.windowFocused
          ? ' (target window AX-focused first)'
          : ' (AX-focus failed — keystrokes may have landed in a different window of the same app)'
        : ''
      return {
        content: [
          {
            type: 'text',
            text: `Typed ${result.length} character(s) ${JSON.stringify(preview)} into ${targetLabel} (pid ${result.pid}) without activating it${focusNote}.`
          }
        ],
        details: result
      }
    })
  }
}

const computerPressKeyTool: AgentTool<typeof computerPressKeySchema> = {
  name: 'computerPressKey',
  label: 'Press Key',
  description:
    'Press a single named key (with optional modifiers) targeting another app WITHOUT activating it — Owls stays frontmost. ' +
    'Posts keyboard events directly to the target process via `CGEventPostToPid`. ' +
    'Pass either `windowId` (preferred) or `pid`. ' +
    'Use for shortcuts (key="s" + modifiers=["command"] for Cmd+S), navigation (arrow keys, tab, enter, escape), and special keys (function keys, page up/down). ' +
    'For typing arbitrary text, use computerType — pressKey is per-key and assumes a US/ANSI layout for letter/digit names. ' +
    'For shortcuts that depend on a specific window having key focus, run `computerClick` on the target control first when AX exposes it. ' +
    'Requires Computer Use enabled and macOS Accessibility permission.',
  parameters: computerPressKeySchema,
  async execute(_toolCallId, params) {
    return withComputerCursor(async () => {
      const result = await inputBackgroundPressKey({
        computerUseEnabled: getSettingsForRenderer().computerUseEnabled,
        windowId: params.windowId,
        pid: params.pid,
        key: params.key,
        modifiers: params.modifiers
      })
      const modLabel = result.modifiers.length > 0 ? `${result.modifiers.join('+')}+` : ''
      const targetLabel = result.windowId
        ? `windowId ${result.windowId}${result.ownerName ? ` ("${result.ownerName}")` : ''}`
        : `pid ${result.pid}`
      const focusNote = result.windowId
        ? result.windowFocused
          ? ' (target window AX-focused first)'
          : ' (AX-focus failed — keystroke may have landed in a different window of the same app)'
        : ''
      return {
        content: [
          {
            type: 'text',
            text: `Pressed ${modLabel}${result.key} on ${targetLabel} (pid ${result.pid}) without activating it${focusNote}.`
          }
        ],
        details: result
      }
    })
  }
}

export function createComputerUseTools(options: { getCurrentSessionId: () => string | null }) {
  getComputerUseSessionId = options.getCurrentSessionId
  return [
    listScreenSourcesTool,
    captureDesktopTool,
    computerEnsureAppTool,
    computerGetAppStateTool,
    computerClickTool,
    computerDragTool,
    computerTypeTool,
    computerPressKeyTool
  ]
}
