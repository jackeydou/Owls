import type { WebContents } from 'electron'

import { type BrowserSessionRuntime, getBrowserManager } from './browser-manager.js'

type CdpParams = Record<string, unknown>
type CdpResult = Record<string, unknown>

type ConsoleLogRecord = {
  method: 'Runtime.consoleAPICalled'
  params: unknown
  capturedAt: string
}

type RuntimeExceptionRecord = {
  method: 'Runtime.exceptionThrown'
  params: unknown
  capturedAt: string
}

type NetworkEventRecord = {
  method: string
  params: unknown
  capturedAt: string
}

type NavigationWaitOptions = {
  timeoutMs?: number
}

type CdpScreenshotOptions = {
  fromSurface?: boolean
  fullPage?: boolean
}

type CdpContentSize = {
  x: number
  y: number
  width: number
  height: number
}

const CDP_PROTOCOL_VERSION = '1.3'
const DEFAULT_CDP_COMMAND_TIMEOUT_MS = 30_000
const DEFAULT_NAVIGATION_WAIT_TIMEOUT_MS = 10_000
const MAX_LOG_RECORDS = 200
const cdpEventBindings = new WeakSet<WebContents>()

function pushBounded(target: unknown[], value: unknown): void {
  target.push(value)
  if (target.length > MAX_LOG_RECORDS) {
    target.splice(0, target.length - MAX_LOG_RECORDS)
  }
}

function resultRecord(value: unknown): CdpResult {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as CdpResult
  }
  return {}
}

function readFiniteNumber(record: CdpResult, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`CDP layout metrics missing numeric ${key}.`)
  }
  return value
}

function contentSizeFromLayoutMetrics(metrics: CdpResult): CdpContentSize {
  const rawSize = metrics.cssContentSize ?? metrics.contentSize
  const size = resultRecord(rawSize)
  const width = Math.ceil(readFiniteNumber(size, 'width'))
  const height = Math.ceil(readFiniteNumber(size, 'height'))
  if (width <= 0 || height <= 0) {
    throw new Error('CDP layout metrics returned an empty page size.')
  }
  return {
    x: Math.floor(readFiniteNumber(size, 'x')),
    y: Math.floor(readFiniteNumber(size, 'y')),
    width,
    height
  }
}

function cdpAttachError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(
    `Browser Use could not attach to the page debugger. Close DevTools or other browser debugging tools and retry. Details: ${detail}`
  )
}

function requireRuntime(sessionKey: string): BrowserSessionRuntime {
  const manager = getBrowserManager()
  if (!manager) {
    throw new Error('Browser manager is not initialized.')
  }
  return manager.requireSession(sessionKey)
}

function bindCdpEventCapture(runtime: BrowserSessionRuntime): void {
  const webContents = runtime.webContents
  if (cdpEventBindings.has(webContents)) return
  cdpEventBindings.add(webContents)

  webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Runtime.consoleAPICalled') {
      const record: ConsoleLogRecord = {
        method,
        params,
        capturedAt: new Date().toISOString()
      }
      pushBounded(runtime.consoleLogs, record)
      return
    }
    if (method === 'Runtime.exceptionThrown') {
      const record: RuntimeExceptionRecord = {
        method,
        params,
        capturedAt: new Date().toISOString()
      }
      pushBounded(runtime.consoleLogs, record)
      return
    }
    if (method.startsWith('Network.')) {
      const record: NetworkEventRecord = {
        method,
        params,
        capturedAt: new Date().toISOString()
      }
      pushBounded(runtime.networkEvents, record)
    }
  })

  webContents.debugger.on('detach', () => {
    runtime.debuggerAttached = false
  })

  const reenable = () => {
    if (!runtime.debuggerAttached || webContents.isDestroyed()) return
    void enableCdpDomains(runtime).catch(() => {
      runtime.debuggerAttached = false
    })
  }

  webContents.on('did-finish-load', reenable)
  webContents.on('did-frame-finish-load', reenable)
  webContents.on('did-navigate', reenable)
}

async function enableCdpDomains(runtime: BrowserSessionRuntime): Promise<void> {
  await sendCdp(runtime, 'Page.enable')
  await sendCdp(runtime, 'Runtime.enable')
  await sendCdp(runtime, 'DOM.enable')
  await sendCdp(runtime, 'Accessibility.enable')
  await sendCdp(runtime, 'Network.enable')
}

async function sendCdp(
  runtime: BrowserSessionRuntime,
  method: string,
  params?: CdpParams,
  timeoutMs = DEFAULT_CDP_COMMAND_TIMEOUT_MS
): Promise<CdpResult> {
  const result = await withTimeout(
    runtime.webContents.debugger.sendCommand(method, params),
    timeoutMs,
    `Browser Use CDP command timed out after ${timeoutMs}ms: ${method}`
  )
  return resultRecord(result)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

async function withAttachedRuntime<T>(
  sessionKey: string,
  action: (runtime: BrowserSessionRuntime) => Promise<T>
): Promise<T> {
  const manager = getBrowserManager()
  if (!manager) {
    throw new Error('Browser manager is not initialized.')
  }
  return manager.enqueueForSession(sessionKey, async () => {
    const runtime = await ensureCdpAttached(sessionKey)
    return action(runtime)
  })
}

export async function ensureCdpAttached(sessionKey: string): Promise<BrowserSessionRuntime> {
  const runtime = requireRuntime(sessionKey)
  const webContents = runtime.webContents
  if (webContents.isDestroyed()) {
    throw new Error(`Browser session ${sessionKey} webContents is destroyed.`)
  }
  if (webContents.isDevToolsOpened()) {
    throw new Error('Browser Use cannot attach while DevTools is open. Close DevTools and retry.')
  }

  bindCdpEventCapture(runtime)

  if (!webContents.debugger.isAttached()) {
    try {
      webContents.debugger.attach(CDP_PROTOCOL_VERSION)
    } catch (error) {
      runtime.debuggerAttached = false
      throw cdpAttachError(error)
    }
  }

  runtime.debuggerAttached = true
  await enableCdpDomains(runtime)
  return runtime
}

export async function executeCdp(
  sessionKey: string,
  method: string,
  params?: CdpParams
): Promise<CdpResult> {
  return withAttachedRuntime(sessionKey, (runtime) => sendCdp(runtime, method, params))
}

export async function captureCdpScreenshot(
  sessionKey: string,
  options: CdpScreenshotOptions = {}
): Promise<string> {
  const result = await withAttachedRuntime(sessionKey, async (runtime) => {
    const params: CdpParams = {
      format: 'png',
      fromSurface: options.fromSurface ?? true
    }
    if (options.fullPage) {
      const metrics = await sendCdp(runtime, 'Page.getLayoutMetrics')
      const contentSize = contentSizeFromLayoutMetrics(metrics)
      return sendCdp(runtime, 'Page.captureScreenshot', {
        ...params,
        captureBeyondViewport: true,
        fromSurface: true,
        clip: {
          x: 0,
          y: 0,
          width: contentSize.width,
          height: contentSize.height,
          scale: 1
        }
      })
    }
    return sendCdp(runtime, 'Page.captureScreenshot', params)
  })
  const data = result.data
  if (typeof data !== 'string') {
    throw new Error('CDP screenshot did not return image data.')
  }
  return data
}

export async function dispatchMouseClick(
  sessionKey: string,
  point: { x: number; y: number }
): Promise<void> {
  await withAttachedRuntime(sessionKey, async (runtime) => {
    await sendCdp(runtime, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'none',
      buttons: 0
    })
    await sendCdp(runtime, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    })
    await sendCdp(runtime, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    })
  })
}

export async function dispatchMouseMove(
  sessionKey: string,
  point: { x: number; y: number }
): Promise<void> {
  await withAttachedRuntime(sessionKey, async (runtime) => {
    await sendCdp(runtime, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'none',
      buttons: 0
    })
  })
}

export async function dispatchMouseDrag(
  sessionKey: string,
  path: Array<{ x: number; y: number }>
): Promise<void> {
  if (path.length < 2) {
    throw new Error('Browser Use drag requires at least two path points.')
  }
  await withAttachedRuntime(sessionKey, async (runtime) => {
    const [start, ...rest] = path
    await sendCdp(runtime, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: start.x,
      y: start.y,
      button: 'none',
      buttons: 0
    })
    await sendCdp(runtime, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: start.x,
      y: start.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    })
    for (const point of rest) {
      await sendCdp(runtime, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y,
        button: 'left',
        buttons: 1
      })
    }
    const end = rest.at(-1) ?? start
    await sendCdp(runtime, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: end.x,
      y: end.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    })
  })
}

export async function insertCdpText(sessionKey: string, text: string): Promise<void> {
  await withAttachedRuntime(sessionKey, async (runtime) => {
    await sendCdp(runtime, 'Input.insertText', { text })
  })
}

export async function dispatchCdpKeyPress(sessionKey: string, key: string): Promise<void> {
  await withAttachedRuntime(sessionKey, async (runtime) => {
    await sendCdp(runtime, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key
    })
    await sendCdp(runtime, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: key
    })
  })
}

export async function viewportPointForBackendNode(
  sessionKey: string,
  backendNodeId: number
): Promise<{ x: number; y: number }> {
  return withAttachedRuntime(sessionKey, async (runtime) => {
    await sendCdp(runtime, 'DOM.scrollIntoViewIfNeeded', { backendNodeId })
    const result = await sendCdp(runtime, 'DOM.getContentQuads', { backendNodeId })
    const quads = result.quads
    if (!Array.isArray(quads) || !Array.isArray(quads[0])) {
      throw new Error(`No viewport quad found for backend node ${backendNodeId}.`)
    }
    const quad = quads[0].filter((value): value is number => typeof value === 'number')
    if (quad.length < 8) {
      throw new Error(`Invalid viewport quad for backend node ${backendNodeId}.`)
    }
    return {
      x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
      y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4
    }
  })
}

export function waitForBrowserNavigation(
  sessionKey: string,
  options: NavigationWaitOptions = {}
): Promise<void> {
  const runtime = requireRuntime(sessionKey)
  const webContents = runtime.webContents
  const timeoutMs = options.timeoutMs ?? DEFAULT_NAVIGATION_WAIT_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      webContents.removeListener('did-finish-load', handleDone)
      webContents.removeListener('did-navigate-in-page', handleDone)
      webContents.removeListener('did-fail-load', handleFail)
      webContents.removeListener('destroyed', handleDestroyed)
    }

    const handleDone = () => {
      cleanup()
      resolve()
    }

    const handleFail = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedURL: string
    ) => {
      if (errorDescription === 'ERR_ABORTED') return
      cleanup()
      reject(
        new Error(
          `Browser navigation failed for ${validatedURL}: ${errorDescription} (${errorCode})`
        )
      )
    }

    const handleDestroyed = () => {
      cleanup()
      reject(new Error(`Browser session ${sessionKey} was destroyed while waiting for navigation.`))
    }

    webContents.once('did-finish-load', handleDone)
    webContents.once('did-navigate-in-page', handleDone)
    webContents.once('did-fail-load', handleFail)
    webContents.once('destroyed', handleDestroyed)
  })
}

export function detachCdp(sessionKey: string): void {
  const runtime = requireRuntime(sessionKey)
  const webContents = runtime.webContents
  if (!webContents.isDestroyed() && webContents.debugger.isAttached()) {
    webContents.debugger.detach()
  }
  runtime.debuggerAttached = false
}
