import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { normalizeWebTargetUrl } from '../../shared/web-targets.js'
import {
  animateEmbeddedBrowserCursorClick,
  animateEmbeddedBrowserCursorMove,
  closeEmbeddedBrowserSession,
  ensureEmbeddedBrowserVisible,
  openEmbeddedBrowserUrl,
  runWithEmbeddedBrowserWebContentsResumed,
  setActiveEmbeddedBrowserSession
} from '../ipc-handlers/embedded-browser-handler.js'
import { getSessionById } from '../stores/settings-store.js'
import { getBrowserManager } from './browser-manager.js'
import {
  captureCdpScreenshot,
  dispatchCdpKeyPress,
  dispatchMouseClick,
  dispatchMouseDrag,
  dispatchMouseMove,
  executeCdp,
  insertCdpText
} from './cdp-backend.js'
import {
  browserUsePickDate,
  browserUseScrollUntil,
  browserUseSelectOption,
  browserUseTreeSelect
} from './complex-components.js'
import { getBrowserUseTraces, runBrowserUseTrace } from './diagnostics.js'
import {
  type BrowserUseActionExpectation,
  type BrowserUseSelector,
  browserUseClick,
  browserUseDispatchClick,
  browserUseFill,
  browserUseWaitFor
} from './locator.js'
import { browserSessionKeyForSession } from './session-key.js'
import { captureBrowserUseSnapshot } from './snapshot.js'

export type BrowserUseSelectorParams = {
  css?: string
  text?: string
  role?: string
  name?: string
  label?: string
  testId?: string
}

export type BrowserUseExpectationParams = {
  urlContains?: string
  textVisible?: string
  selectorVisible?: BrowserUseSelectorParams
  selectorHidden?: BrowserUseSelectorParams
  valueSelector?: BrowserUseSelectorParams
  valueEquals?: string
}

export type BrowserUseServiceParams = {
  sessionId: string
}

export type BrowserUseStatusResult = {
  sessionId: string
  open: boolean
  attached: boolean
  url: string | null
  title: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

type EmbeddedBrowserOpenStatus = Awaited<ReturnType<typeof openEmbeddedBrowserUrl>>

export type BrowserUseScreenshotResult = {
  path: string
  mimeType: 'image/png'
  bytes: number
  url: string | null
  title: string | null
}

const DEFAULT_SNAPSHOT_ELEMENTS = 80
const DEFAULT_SCROLL_Y = 600

function requireManager() {
  const manager = getBrowserManager()
  if (!manager) {
    throw new Error('Browser manager is not initialized.')
  }
  return manager
}

function browserUseStatusFromEmbeddedStatus(
  sessionId: string,
  status: EmbeddedBrowserOpenStatus
): BrowserUseStatusResult {
  return {
    sessionId,
    open: status.open,
    attached: status.attached,
    url: status.url,
    title: status.title,
    loading: status.loading,
    canGoBack: status.canGoBack,
    canGoForward: status.canGoForward
  }
}

function waitForNextRenderTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50))
}

function normalizeBrowserUrl(value: string): string {
  const url = normalizeWebTargetUrl(value)
  if (!url) {
    throw new Error('Browser URL is required.')
  }
  return url
}

function selectorFromParams(value: unknown): BrowserUseSelector {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Browser Use target selector is required.')
  }
  const params = value as Record<string, unknown>
  if (typeof params.css === 'string' && params.css.trim()) {
    return { type: 'css', value: params.css }
  }
  if (typeof params.text === 'string' && params.text.trim()) {
    return { type: 'text', value: params.text }
  }
  if (typeof params.role === 'string' && params.role.trim()) {
    return {
      type: 'role',
      role: params.role,
      name: typeof params.name === 'string' && params.name.trim() ? params.name : undefined
    }
  }
  if (typeof params.label === 'string' && params.label.trim()) {
    return { type: 'label', value: params.label }
  }
  if (typeof params.testId === 'string' && params.testId.trim()) {
    return { type: 'testId', value: params.testId }
  }
  throw new Error('Browser Use selector must include one of css, text, role, label, or testId.')
}

function expectationFromParams(value: unknown): BrowserUseActionExpectation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const params = value as Record<string, unknown>
  const expectation: BrowserUseActionExpectation = {}
  if (typeof params.urlContains === 'string') expectation.urlContains = params.urlContains
  if (typeof params.textVisible === 'string') expectation.textVisible = params.textVisible
  if (params.selectorVisible) {
    expectation.selectorVisible = selectorFromParams(params.selectorVisible)
  }
  if (params.selectorHidden) {
    expectation.selectorHidden = selectorFromParams(params.selectorHidden)
  }
  if (params.valueSelector && typeof params.valueEquals === 'string') {
    expectation.valueEquals = {
      selector: selectorFromParams(params.valueSelector),
      value: params.valueEquals
    }
  }
  return Object.keys(expectation).length > 0 ? expectation : undefined
}

async function runTracedBrowserUse<T>(
  sessionId: string,
  action: string,
  input: unknown,
  run: () => Promise<T>
): Promise<T> {
  return runBrowserUseTrace(sessionId, action, input, run)
}

function formatSnapshotText(
  snapshot: Awaited<ReturnType<typeof captureBrowserUseSnapshot>>,
  maxElements: number
): string {
  const selectorForElement = (element: (typeof snapshot.dom)[number]): string => {
    if (element.role && element.name) {
      return JSON.stringify({ role: element.role, name: element.name })
    }
    if (element.role && element.text) {
      return JSON.stringify({ role: element.role, name: element.text })
    }
    if (element.name && element.editable) {
      return JSON.stringify({ label: element.name })
    }
    if (element.text) {
      return JSON.stringify({ text: element.text })
    }
    return JSON.stringify({ css: element.tagName })
  }

  const frames = snapshot.frames.length
    ? snapshot.frames
        .map((frame, index) => {
          const parent = frame.parentId ? ` parent=${frame.parentId}` : ''
          return `  ${index + 1}. frame id=${frame.id}${parent}\n     url=${frame.url}`
        })
        .join('\n')
    : '  (none)'
  const elements = snapshot.dom
    .slice(0, maxElements)
    .map((element, index) => {
      const label = element.name || element.text || element.value || element.tagName
      const role = element.role ? ` role=${element.role}` : ''
      const editable = element.editable ? ' editable' : ''
      const disabled = element.enabled ? '' : ' disabled'
      const frame = element.framePath.length > 0 ? ` frame=${element.framePath.join('.')}` : ''
      return `  ${index + 1}. ${element.tagName}${role}${editable}${disabled}${frame}\n     text=${JSON.stringify(label)}\n     target=${selectorForElement(element)}`
    })
    .join('\n')
  const unsupportedFrames = snapshot.unsupportedFrames.map((frame) => `  - ${frame}`).join('\n')

  return [
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    '',
    'Frames:',
    frames,
    '',
    'Interactive elements:',
    elements || '  (none found)',
    ...(unsupportedFrames ? ['', 'Unsupported cross-origin frames:', unsupportedFrames] : [])
  ]
    .filter(Boolean)
    .join('\n')
}

function snapshotDetailsSummary(
  snapshot: Awaited<ReturnType<typeof captureBrowserUseSnapshot>>,
  returnedElements: number
): Record<string, unknown> {
  return {
    url: snapshot.url,
    title: snapshot.title,
    frameCount: snapshot.frames.length,
    interactiveElementCount: snapshot.dom.length,
    accessibilityNodeCount: snapshot.accessibility.length,
    returnedElements,
    unsupportedFrames: snapshot.unsupportedFrames
  }
}

function sessionScreenshotPath(sessionId: string): string {
  const session = getSessionById(sessionId)
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`)
  }
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  return join(session.cwd, `browser-screenshot-${stamp}.png`)
}

function sanitizeTrace(trace: ReturnType<typeof getBrowserUseTraces>[number]) {
  return {
    ...trace,
    screenshotPngBase64: undefined,
    hasScreenshot: Boolean(trace.screenshotPngBase64)
  }
}

export async function browserUseStatus(
  params: BrowserUseServiceParams
): Promise<BrowserUseStatusResult> {
  const manager = requireManager()
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  const runtime = manager.getSession(browserSessionKey)
  if (runtime) {
    manager.touchSession(browserSessionKey)
  }
  return {
    sessionId: params.sessionId,
    open: Boolean(runtime),
    attached: manager.isSessionDisplayed(browserSessionKey),
    url: runtime?.url ?? null,
    title: runtime?.title ?? null,
    loading: runtime?.loading ?? false,
    canGoBack: runtime?.canGoBack ?? false,
    canGoForward: runtime?.canGoForward ?? false
  }
}

export async function browserUseOpen(
  params: BrowserUseServiceParams & {
    url: string
    waitUntilLoaded?: boolean
    visible?: boolean
  }
): Promise<BrowserUseStatusResult> {
  const url = normalizeBrowserUrl(params.url)
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  return runTracedBrowserUse(browserSessionKey, 'browser.open', params, async () => {
    setActiveEmbeddedBrowserSession(browserSessionKey)
    const status = await openEmbeddedBrowserUrl(url, {
      sessionKey: browserSessionKey,
      waitUntilLoaded: params.waitUntilLoaded ?? true,
      visible: params.visible ?? true
    })
    return browserUseStatusFromEmbeddedStatus(params.sessionId, status)
  })
}

export async function browserUseSetVisibility(
  params: BrowserUseServiceParams & {
    visible: boolean
  }
): Promise<BrowserUseStatusResult> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  return runTracedBrowserUse(browserSessionKey, 'browser.visibility', params, async () => {
    setActiveEmbeddedBrowserSession(browserSessionKey)
    if (!params.visible) {
      return browserUseStatus(params)
    }
    const status = await ensureEmbeddedBrowserVisible(browserSessionKey)
    return browserUseStatusFromEmbeddedStatus(params.sessionId, status)
  })
}

export async function browserUseBack(
  params: BrowserUseServiceParams
): Promise<BrowserUseStatusResult> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  return runTracedBrowserUse(browserSessionKey, 'browser.back', params, async () => {
    const runtime = requireManager().requireSession(browserSessionKey)
    if (runtime.webContents.navigationHistory.canGoBack()) {
      runtime.webContents.navigationHistory.goBack()
      await waitForNextRenderTurn()
    }
    return browserUseStatus(params)
  })
}

export async function browserUseForward(
  params: BrowserUseServiceParams
): Promise<BrowserUseStatusResult> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  return runTracedBrowserUse(browserSessionKey, 'browser.forward', params, async () => {
    const runtime = requireManager().requireSession(browserSessionKey)
    if (runtime.webContents.navigationHistory.canGoForward()) {
      runtime.webContents.navigationHistory.goForward()
      await waitForNextRenderTurn()
    }
    return browserUseStatus(params)
  })
}

export async function browserUseClose(params: BrowserUseServiceParams): Promise<{ closed: true }> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  return runTracedBrowserUse(browserSessionKey, 'browser.close', params, async () => {
    closeEmbeddedBrowserSession(browserSessionKey)
    return { closed: true }
  })
}

export async function browserUseSnapshot(
  params: BrowserUseServiceParams & {
    maxElements?: number
  }
): Promise<{ text: string; details: Record<string, unknown> }> {
  const maxElements = params.maxElements ?? DEFAULT_SNAPSHOT_ELEMENTS
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  const snapshot = await runTracedBrowserUse(browserSessionKey, 'browser.snapshot', params, () =>
    captureBrowserUseSnapshot(browserSessionKey)
  )
  return {
    text: formatSnapshotText(snapshot, maxElements),
    details: snapshotDetailsSummary(snapshot, maxElements)
  }
}

export async function browserUseDomCuaGetVisibleDom(
  params: BrowserUseServiceParams & {
    maxElements?: number
  }
): Promise<{ text: string; details: Record<string, unknown> }> {
  const maxElements = params.maxElements ?? DEFAULT_SNAPSHOT_ELEMENTS
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  const snapshot = await runTracedBrowserUse(
    browserSessionKey,
    'browser.dom_cua.get_visible_dom',
    params,
    () => captureBrowserUseSnapshot(browserSessionKey)
  )
  return {
    text: formatSnapshotText(snapshot, maxElements),
    details: snapshotDetailsSummary(snapshot, maxElements)
  }
}

export async function browserUseClickRpc(
  params: BrowserUseServiceParams & {
    target: BrowserUseSelectorParams
  }
) {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  return runTracedBrowserUse(browserSessionKey, 'browser.click', params, () =>
    browserUseDispatchClick(browserSessionKey, selectorFromParams(params.target))
  )
}

export async function browserUseFillRpc(
  params: BrowserUseServiceParams & {
    target: BrowserUseSelectorParams
    value: string
    expect?: BrowserUseExpectationParams
  }
) {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  return runTracedBrowserUse(browserSessionKey, 'browser.fill', params, () =>
    browserUseFill(
      browserSessionKey,
      selectorFromParams(params.target),
      params.value,
      expectationFromParams(params.expect)
    )
  )
}

export async function browserUsePress(
  params: BrowserUseServiceParams & {
    target?: BrowserUseSelectorParams
    key: string
  }
): Promise<{ key: string }> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  await runTracedBrowserUse(browserSessionKey, 'browser.press', params, async () => {
    if (params.target) {
      await browserUseClick(browserSessionKey, selectorFromParams(params.target))
    }
    await dispatchCdpKeyPress(browserSessionKey, params.key)
  })
  return { key: params.key }
}

export async function browserUseCuaType(
  params: BrowserUseServiceParams & {
    text: string
  }
): Promise<{ textLength: number }> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  await runTracedBrowserUse(browserSessionKey, 'browser.cua.type', params, () =>
    insertCdpText(browserSessionKey, params.text)
  )
  return { textLength: params.text.length }
}

export async function browserUseCuaClick(
  params: BrowserUseServiceParams & {
    x: number
    y: number
    button?: number
  }
): Promise<{ x: number; y: number; button: number }> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  const point = { x: params.x, y: params.y }
  await runTracedBrowserUse(browserSessionKey, 'browser.cua.click', params, async () => {
    await animateEmbeddedBrowserCursorClick(browserSessionKey, point)
    await dispatchMouseClick(browserSessionKey, point)
  })
  return { ...point, button: params.button ?? 1 }
}

export async function browserUseCuaDoubleClick(
  params: BrowserUseServiceParams & {
    x: number
    y: number
    button?: number
  }
): Promise<{ x: number; y: number; button: number }> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  const point = { x: params.x, y: params.y }
  await runTracedBrowserUse(browserSessionKey, 'browser.cua.double_click', params, async () => {
    await animateEmbeddedBrowserCursorClick(browserSessionKey, point)
    await dispatchMouseClick(browserSessionKey, point)
    await dispatchMouseClick(browserSessionKey, point)
  })
  return { ...point, button: params.button ?? 1 }
}

export async function browserUseCuaMove(
  params: BrowserUseServiceParams & {
    x: number
    y: number
  }
): Promise<{ x: number; y: number }> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  const point = { x: params.x, y: params.y }
  await runTracedBrowserUse(browserSessionKey, 'browser.cua.move', params, async () => {
    await animateEmbeddedBrowserCursorMove(browserSessionKey, point)
    await dispatchMouseMove(browserSessionKey, point)
  })
  return point
}

export async function browserUseCuaDrag(
  params: BrowserUseServiceParams & {
    path: Array<{ x: number; y: number }>
  }
): Promise<{ points: number }> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  await runTracedBrowserUse(browserSessionKey, 'browser.cua.drag', params, () =>
    dispatchMouseDrag(browserSessionKey, params.path)
  )
  return { points: params.path.length }
}

export async function browserUseCuaKeypress(
  params: BrowserUseServiceParams & {
    keys: string[]
  }
): Promise<{ keys: string[] }> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  await runTracedBrowserUse(browserSessionKey, 'browser.cua.keypress', params, async () => {
    for (const key of params.keys) {
      await dispatchCdpKeyPress(browserSessionKey, key)
    }
  })
  return { keys: params.keys }
}

async function browserUseScrollWithAction(
  params: BrowserUseServiceParams & {
    x?: number
    y?: number
  },
  action: string
): Promise<{ x: number; y: number }> {
  const x = params.x ?? 0
  const y = params.y ?? DEFAULT_SCROLL_Y
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  await runTracedBrowserUse(browserSessionKey, action, params, () =>
    executeCdp(browserSessionKey, 'Runtime.evaluate', {
      expression: `window.scrollBy(${JSON.stringify({ left: x, top: y, behavior: 'instant' })})`,
      awaitPromise: true,
      returnByValue: true
    })
  )
  return { x, y }
}

export async function browserUseScroll(
  params: BrowserUseServiceParams & {
    x?: number
    y?: number
  }
): Promise<{ x: number; y: number }> {
  return browserUseScrollWithAction(params, 'browser.scroll')
}

export async function browserUseCuaScroll(
  params: BrowserUseServiceParams & {
    x?: number
    y?: number
  }
): Promise<{ x: number; y: number }> {
  return browserUseScrollWithAction(params, 'browser.cua.scroll')
}

export async function browserUseDomCuaScroll(
  params: BrowserUseServiceParams & {
    x?: number
    y?: number
  }
): Promise<{ x: number; y: number }> {
  return browserUseScrollWithAction(params, 'browser.dom_cua.scroll')
}

export async function browserUseDomCuaKeypress(
  params: BrowserUseServiceParams & {
    keys: string[]
  }
): Promise<{ keys: string[] }> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  await runTracedBrowserUse(browserSessionKey, 'browser.dom_cua.keypress', params, async () => {
    for (const key of params.keys) {
      await dispatchCdpKeyPress(browserSessionKey, key)
    }
  })
  return { keys: params.keys }
}

export async function browserUseDomCuaType(
  params: BrowserUseServiceParams & {
    text: string
  }
): Promise<{ textLength: number }> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  await runTracedBrowserUse(browserSessionKey, 'browser.dom_cua.type', params, () =>
    insertCdpText(browserSessionKey, params.text)
  )
  return { textLength: params.text.length }
}

export async function browserUseWaitForRpc(
  params: BrowserUseServiceParams & {
    selectorVisible?: BrowserUseSelectorParams
    selectorHidden?: BrowserUseSelectorParams
    textVisible?: string
    urlContains?: string
    loadState?: boolean
    timeoutMs?: number
  }
) {
  const timeout = { timeoutMs: params.timeoutMs }
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  return runTracedBrowserUse(browserSessionKey, 'browser.waitFor', params, () => {
    if (params.selectorVisible) {
      return browserUseWaitFor(
        browserSessionKey,
        { type: 'selectorVisible', selector: selectorFromParams(params.selectorVisible) },
        timeout
      )
    }
    if (params.selectorHidden) {
      return browserUseWaitFor(
        browserSessionKey,
        { type: 'selectorHidden', selector: selectorFromParams(params.selectorHidden) },
        timeout
      )
    }
    if (typeof params.textVisible === 'string') {
      return browserUseWaitFor(
        browserSessionKey,
        { type: 'textVisible', value: params.textVisible },
        timeout
      )
    }
    if (typeof params.urlContains === 'string') {
      return browserUseWaitFor(
        browserSessionKey,
        { type: 'urlContains', value: params.urlContains },
        timeout
      )
    }
    if (params.loadState) {
      return browserUseWaitFor(browserSessionKey, { type: 'loadState' }, timeout)
    }
    throw new Error(
      'browser.waitFor requires selectorVisible, selectorHidden, textVisible, urlContains, or loadState.'
    )
  })
}

export async function browserUseScreenshot(
  params: BrowserUseServiceParams & {
    fullPage?: boolean
  }
): Promise<BrowserUseScreenshotResult> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  const buffer = await runTracedBrowserUse(
    browserSessionKey,
    'browser.screenshot',
    params,
    async () => {
      await waitForNextRenderTurn()
      return runWithEmbeddedBrowserWebContentsResumed(browserSessionKey, async () => {
        if (params.fullPage) {
          return Buffer.from(
            await captureCdpScreenshot(browserSessionKey, { fullPage: true }),
            'base64'
          )
        }
        return Buffer.from(await captureCdpScreenshot(browserSessionKey), 'base64')
      })
    }
  )
  const path = sessionScreenshotPath(params.sessionId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, buffer)
  const runtime = requireManager().getSession(browserSessionKey)
  return {
    path,
    mimeType: 'image/png',
    bytes: buffer.byteLength,
    url: runtime?.url ?? null,
    title: runtime?.title ?? null
  }
}

export async function browserUseSelect(
  params: BrowserUseServiceParams & {
    trigger: BrowserUseSelectorParams
    option: BrowserUseSelectorParams
    valueSelector?: BrowserUseSelectorParams
    value?: string
    expect?: BrowserUseExpectationParams
    timeoutMs?: number
  }
) {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  return runTracedBrowserUse(browserSessionKey, 'browser.select', params, () =>
    browserUseSelectOption(browserSessionKey, {
      trigger: selectorFromParams(params.trigger),
      option: selectorFromParams(params.option),
      valueSelector: params.valueSelector ? selectorFromParams(params.valueSelector) : undefined,
      value: params.value,
      expect: expectationFromParams(params.expect),
      timeoutMs: params.timeoutMs
    })
  )
}

export async function browserUsePickDateRpc(
  params: BrowserUseServiceParams & {
    input: BrowserUseSelectorParams
    value: string
    calendarDay?: BrowserUseSelectorParams
    expect?: BrowserUseExpectationParams
    timeoutMs?: number
  }
) {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  return runTracedBrowserUse(browserSessionKey, 'browser.pickDate', params, () =>
    browserUsePickDate(browserSessionKey, {
      input: selectorFromParams(params.input),
      value: params.value,
      calendarDay: params.calendarDay ? selectorFromParams(params.calendarDay) : undefined,
      expect: expectationFromParams(params.expect),
      timeoutMs: params.timeoutMs
    })
  )
}

export async function browserUseTreeSelectRpc(
  params: BrowserUseServiceParams & {
    trigger: BrowserUseSelectorParams
    item: BrowserUseSelectorParams
    checkbox?: BrowserUseSelectorParams
    tagText?: string
    expect?: BrowserUseExpectationParams
    timeoutMs?: number
  }
) {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  return runTracedBrowserUse(browserSessionKey, 'browser.treeSelect', params, () =>
    browserUseTreeSelect(browserSessionKey, {
      trigger: selectorFromParams(params.trigger),
      item: selectorFromParams(params.item),
      checkbox: params.checkbox ? selectorFromParams(params.checkbox) : undefined,
      tagText: params.tagText,
      expect: expectationFromParams(params.expect),
      timeoutMs: params.timeoutMs
    })
  )
}

export async function browserUseScrollUntilRpc(
  params: BrowserUseServiceParams & {
    target: BrowserUseSelectorParams
    container?: BrowserUseSelectorParams
    timeoutMs?: number
    stepPx?: number
    maxScrolls?: number
  }
) {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  return runTracedBrowserUse(browserSessionKey, 'browser.scrollUntil', params, () =>
    browserUseScrollUntil(browserSessionKey, {
      target: selectorFromParams(params.target),
      container: params.container ? selectorFromParams(params.container) : undefined,
      timeoutMs: params.timeoutMs,
      stepPx: params.stepPx,
      maxScrolls: params.maxScrolls
    })
  )
}

export async function browserUseDiagnostics(
  params: BrowserUseServiceParams & {
    limit?: number
  }
): Promise<{ traces: ReturnType<typeof sanitizeTrace>[] }> {
  const browserSessionKey = browserSessionKeyForSession(params.sessionId)
  const traces = getBrowserUseTraces(browserSessionKey)
    .slice(-(params.limit ?? 5))
    .map(sanitizeTrace)
  return { traces }
}
