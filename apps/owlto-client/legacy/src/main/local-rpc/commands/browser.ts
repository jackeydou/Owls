import {
  type BrowserUseExpectationParams,
  type BrowserUseSelectorParams,
  type BrowserUseServiceParams,
  browserUseBack,
  browserUseClickRpc,
  browserUseClose,
  browserUseCuaClick,
  browserUseCuaDoubleClick,
  browserUseCuaDrag,
  browserUseCuaKeypress,
  browserUseCuaMove,
  browserUseCuaScroll,
  browserUseCuaType,
  browserUseDiagnostics,
  browserUseDomCuaGetVisibleDom,
  browserUseDomCuaKeypress,
  browserUseDomCuaScroll,
  browserUseDomCuaType,
  browserUseFillRpc,
  browserUseForward,
  browserUseOpen,
  browserUsePickDateRpc,
  browserUsePress,
  browserUseScreenshot,
  browserUseScroll,
  browserUseScrollUntilRpc,
  browserUseSelect,
  browserUseSetVisibility,
  browserUseSnapshot,
  browserUseStatus,
  browserUseTreeSelectRpc,
  browserUseWaitForRpc
} from '../../browser-use/service.js'
import type { LocalRpcCommandRegistry } from '../command-registry.js'
import { JSON_RPC_INVALID_PARAMS, LocalRpcError } from '../errors.js'
import { requireAuthenticatedLocalRpc, requireKnownSession } from '../guards.js'
import { isRecord } from '../schemas.js'
import type { LocalRpcContext } from '../types.js'

type BrowserStatusParams = BrowserUseServiceParams
type BrowserOpenParams = BrowserUseServiceParams & {
  url: string
  waitUntilLoaded?: boolean
  visible?: boolean
}
type BrowserVisibilityParams = BrowserUseServiceParams & {
  visible: boolean
}
type BrowserSnapshotParams = BrowserUseServiceParams & {
  maxElements?: number
}
type BrowserTargetParams = BrowserUseServiceParams & {
  target: BrowserUseSelectorParams
  expect?: BrowserUseExpectationParams
}
type BrowserClickParams = BrowserUseServiceParams & {
  target: BrowserUseSelectorParams
}
type BrowserFillParams = BrowserTargetParams & {
  value: string
}
type BrowserPressParams = BrowserUseServiceParams & {
  target?: BrowserUseSelectorParams
  key: string
}
type BrowserTextParams = BrowserUseServiceParams & {
  text: string
}
type BrowserPointParams = BrowserUseServiceParams & {
  x: number
  y: number
}
type BrowserDragParams = BrowserUseServiceParams & {
  path: Array<{ x: number; y: number }>
}
type BrowserKeypressParams = BrowserUseServiceParams & {
  keys: string[]
}
type BrowserScrollParams = BrowserUseServiceParams & {
  x?: number
  y?: number
}
type BrowserScreenshotParams = BrowserUseServiceParams & {
  fullPage?: boolean
}
type BrowserWaitForParams = BrowserUseServiceParams & {
  selectorVisible?: BrowserUseSelectorParams
  selectorHidden?: BrowserUseSelectorParams
  textVisible?: string
  urlContains?: string
  loadState?: boolean
  timeoutMs?: number
}
type BrowserSelectParams = BrowserUseServiceParams & {
  trigger: BrowserUseSelectorParams
  option: BrowserUseSelectorParams
  valueSelector?: BrowserUseSelectorParams
  value?: string
  expect?: BrowserUseExpectationParams
  timeoutMs?: number
}
type BrowserPickDateParams = BrowserUseServiceParams & {
  input: BrowserUseSelectorParams
  value: string
  calendarDay?: BrowserUseSelectorParams
  expect?: BrowserUseExpectationParams
  timeoutMs?: number
}
type BrowserTreeSelectParams = BrowserUseServiceParams & {
  trigger: BrowserUseSelectorParams
  item: BrowserUseSelectorParams
  checkbox?: BrowserUseSelectorParams
  tagText?: string
  expect?: BrowserUseExpectationParams
  timeoutMs?: number
}
type BrowserScrollUntilParams = BrowserUseServiceParams & {
  target: BrowserUseSelectorParams
  container?: BrowserUseSelectorParams
  timeoutMs?: number
  stepPx?: number
  maxScrolls?: number
}
type BrowserDiagnosticsParams = BrowserUseServiceParams & {
  limit?: number
}

function invalidParams(message: string): never {
  throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, message)
}

function readParams(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    invalidParams('Expected params object')
  }
  return value
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    invalidParams(`${fieldName} is required`)
  }
  return value.trim()
}

function readOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    invalidParams(`${fieldName} must be a string`)
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

function readOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') {
    invalidParams(`${fieldName} must be a boolean`)
  }
  return value
}

function readOptionalNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalidParams(`${fieldName} must be a finite number`)
  }
  return value
}

function readSessionParams(value: unknown): BrowserUseServiceParams {
  const params = readParams(value)
  return {
    sessionId: readRequiredString(params.sessionId, 'sessionId')
  }
}

function readSelector(value: unknown, fieldName: string): BrowserUseSelectorParams {
  if (!isRecord(value)) {
    invalidParams(`${fieldName} selector is required`)
  }
  return {
    ...(readOptionalString(value.css, `${fieldName}.css`) ? { css: String(value.css).trim() } : {}),
    ...(readOptionalString(value.text, `${fieldName}.text`)
      ? { text: String(value.text).trim() }
      : {}),
    ...(readOptionalString(value.role, `${fieldName}.role`)
      ? { role: String(value.role).trim() }
      : {}),
    ...(readOptionalString(value.name, `${fieldName}.name`)
      ? { name: String(value.name).trim() }
      : {}),
    ...(readOptionalString(value.label, `${fieldName}.label`)
      ? { label: String(value.label).trim() }
      : {}),
    ...(readOptionalString(value.testId, `${fieldName}.testId`)
      ? { testId: String(value.testId).trim() }
      : {})
  }
}

function readOptionalSelector(
  value: unknown,
  fieldName: string
): BrowserUseSelectorParams | undefined {
  if (value === undefined || value === null) return undefined
  return readSelector(value, fieldName)
}

function readExpectation(value: unknown): BrowserUseExpectationParams | undefined {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) {
    invalidParams('expect must be an object')
  }
  return {
    ...(readOptionalString(value.urlContains, 'expect.urlContains')
      ? { urlContains: String(value.urlContains).trim() }
      : {}),
    ...(readOptionalString(value.textVisible, 'expect.textVisible')
      ? { textVisible: String(value.textVisible).trim() }
      : {}),
    ...(value.selectorVisible
      ? { selectorVisible: readSelector(value.selectorVisible, 'expect.selectorVisible') }
      : {}),
    ...(value.selectorHidden
      ? { selectorHidden: readSelector(value.selectorHidden, 'expect.selectorHidden') }
      : {}),
    ...(value.valueSelector
      ? { valueSelector: readSelector(value.valueSelector, 'expect.valueSelector') }
      : {}),
    ...(readOptionalString(value.valueEquals, 'expect.valueEquals')
      ? { valueEquals: String(value.valueEquals).trim() }
      : {})
  }
}

function parseStatusParams(value: unknown): BrowserStatusParams {
  return readSessionParams(value)
}

function parseOpenParams(value: unknown): BrowserOpenParams {
  const params = readParams(value)
  return {
    ...readSessionParams(value),
    url: readRequiredString(params.url, 'url'),
    waitUntilLoaded: readOptionalBoolean(params.waitUntilLoaded, 'waitUntilLoaded'),
    visible: readOptionalBoolean(params.visible, 'visible')
  }
}

function parseSnapshotParams(value: unknown): BrowserSnapshotParams {
  const params = readParams(value)
  return {
    ...readSessionParams(value),
    maxElements: readOptionalNumber(params.maxElements, 'maxElements')
  }
}

function parseVisibilityParams(value: unknown): BrowserVisibilityParams {
  const params = readParams(value)
  if (typeof params.visible !== 'boolean') {
    invalidParams('visible must be a boolean')
  }
  return {
    ...readSessionParams(value),
    visible: params.visible
  }
}

function parseClickParams(value: unknown): BrowserClickParams {
  const params = readParams(value)
  return {
    ...readSessionParams(value),
    target: readSelector(params.target, 'target')
  }
}

function parseFillParams(value: unknown): BrowserFillParams {
  const params = readParams(value)
  if (typeof params.value !== 'string') {
    invalidParams('value is required')
  }
  return {
    ...readSessionParams(value),
    target: readSelector(params.target, 'target'),
    expect: readExpectation(params.expect),
    value: params.value
  }
}

function parsePressParams(value: unknown): BrowserPressParams {
  const params = readParams(value)
  return {
    ...readSessionParams(value),
    key: readRequiredString(params.key, 'key'),
    target: readOptionalSelector(params.target, 'target')
  }
}

function parseTextParams(value: unknown): BrowserTextParams {
  const params = readParams(value)
  return {
    ...readSessionParams(value),
    text: readRequiredString(params.text, 'text')
  }
}

function parsePointParams(value: unknown): BrowserPointParams {
  const params = readParams(value)
  return {
    ...readSessionParams(value),
    x: readOptionalNumber(params.x, 'x') ?? invalidParams('x is required'),
    y: readOptionalNumber(params.y, 'y') ?? invalidParams('y is required')
  }
}

function readPoint(value: unknown, fieldName: string): { x: number; y: number } {
  if (!isRecord(value)) {
    invalidParams(`${fieldName} must be a point object`)
  }
  return {
    x: readOptionalNumber(value.x, `${fieldName}.x`) ?? invalidParams(`${fieldName}.x is required`),
    y: readOptionalNumber(value.y, `${fieldName}.y`) ?? invalidParams(`${fieldName}.y is required`)
  }
}

function parseDragParams(value: unknown): BrowserDragParams {
  const params = readParams(value)
  if (!Array.isArray(params.path) || params.path.length < 2) {
    invalidParams('path must contain at least two points')
  }
  return {
    ...readSessionParams(value),
    path: params.path.map((point, index) => readPoint(point, `path.${index}`))
  }
}

function parseKeypressParams(value: unknown): BrowserKeypressParams {
  const params = readParams(value)
  if (!Array.isArray(params.keys) || params.keys.length === 0) {
    invalidParams('keys must contain at least one key')
  }
  const keys = params.keys.map((key, index) => readRequiredString(key, `keys.${index}`))
  return {
    ...readSessionParams(value),
    keys
  }
}

function parseScrollParams(value: unknown): BrowserScrollParams {
  const params = readParams(value)
  return {
    ...readSessionParams(value),
    x: readOptionalNumber(params.x, 'x'),
    y: readOptionalNumber(params.y, 'y')
  }
}

function parseScreenshotParams(value: unknown): BrowserScreenshotParams {
  const params = readParams(value)
  return {
    ...readSessionParams(value),
    fullPage: readOptionalBoolean(params.fullPage, 'fullPage')
  }
}

function parseWaitForParams(value: unknown): BrowserWaitForParams {
  const params = readParams(value)
  return {
    ...readSessionParams(value),
    selectorVisible: readOptionalSelector(params.selectorVisible, 'selectorVisible'),
    selectorHidden: readOptionalSelector(params.selectorHidden, 'selectorHidden'),
    textVisible: readOptionalString(params.textVisible, 'textVisible'),
    urlContains: readOptionalString(params.urlContains, 'urlContains'),
    loadState: readOptionalBoolean(params.loadState, 'loadState'),
    timeoutMs: readOptionalNumber(params.timeoutMs, 'timeoutMs')
  }
}

function parseSelectParams(value: unknown): BrowserSelectParams {
  const params = readParams(value)
  return {
    ...readSessionParams(value),
    trigger: readSelector(params.trigger, 'trigger'),
    option: readSelector(params.option, 'option'),
    valueSelector: readOptionalSelector(params.valueSelector, 'valueSelector'),
    value: readOptionalString(params.value, 'value'),
    expect: readExpectation(params.expect),
    timeoutMs: readOptionalNumber(params.timeoutMs, 'timeoutMs')
  }
}

function parsePickDateParams(value: unknown): BrowserPickDateParams {
  const params = readParams(value)
  return {
    ...readSessionParams(value),
    input: readSelector(params.input, 'input'),
    value: readRequiredString(params.value, 'value'),
    calendarDay: readOptionalSelector(params.calendarDay, 'calendarDay'),
    expect: readExpectation(params.expect),
    timeoutMs: readOptionalNumber(params.timeoutMs, 'timeoutMs')
  }
}

function parseTreeSelectParams(value: unknown): BrowserTreeSelectParams {
  const params = readParams(value)
  return {
    ...readSessionParams(value),
    trigger: readSelector(params.trigger, 'trigger'),
    item: readSelector(params.item, 'item'),
    checkbox: readOptionalSelector(params.checkbox, 'checkbox'),
    tagText: readOptionalString(params.tagText, 'tagText'),
    expect: readExpectation(params.expect),
    timeoutMs: readOptionalNumber(params.timeoutMs, 'timeoutMs')
  }
}

function parseScrollUntilParams(value: unknown): BrowserScrollUntilParams {
  const params = readParams(value)
  return {
    ...readSessionParams(value),
    target: readSelector(params.target, 'target'),
    container: readOptionalSelector(params.container, 'container'),
    timeoutMs: readOptionalNumber(params.timeoutMs, 'timeoutMs'),
    stepPx: readOptionalNumber(params.stepPx, 'stepPx'),
    maxScrolls: readOptionalNumber(params.maxScrolls, 'maxScrolls')
  }
}

function parseDiagnosticsParams(value: unknown): BrowserDiagnosticsParams {
  const params = readParams(value)
  return {
    ...readSessionParams(value),
    limit: readOptionalNumber(params.limit, 'limit')
  }
}

function authorizeBrowserCommand(context: LocalRpcContext, sessionId: string): void {
  requireAuthenticatedLocalRpc(context)
  requireKnownSession(sessionId)
}

export function registerBrowserLocalRpcCommands(
  registry: LocalRpcCommandRegistry<LocalRpcContext>
): void {
  registry.register({
    method: 'browser.status',
    description: 'Return status for the session browser runtime.',
    parseParams: parseStatusParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseStatus(params)
    }
  })

  registry.register({
    method: 'browser.open',
    description:
      'Open a URL in the hidden or visible session browser runtime for page reading, interaction, login/session state, screenshots, or UI automation.',
    parseParams: parseOpenParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseOpen(params)
    }
  })

  registry.register({
    method: 'browser.visibility',
    description: 'Show or background the session browser runtime when supported.',
    parseParams: parseVisibilityParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseSetVisibility(params)
    }
  })

  registry.register({
    method: 'browser.back',
    description: 'Navigate the session browser back in history.',
    parseParams: parseStatusParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseBack(params)
    }
  })

  registry.register({
    method: 'browser.forward',
    description: 'Navigate the session browser forward in history.',
    parseParams: parseStatusParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseForward(params)
    }
  })

  registry.register({
    method: 'browser.close',
    description: 'Close the session browser runtime.',
    parseParams: parseStatusParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseClose(params)
    }
  })

  registry.register({
    method: 'browser.snapshot',
    description:
      'Capture a compact DOM, accessibility, and frame snapshot for page reading or browser interaction.',
    parseParams: parseSnapshotParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseSnapshot(params)
    }
  })

  registry.register({
    method: 'browser.click',
    description: 'Click a strict browser target.',
    parseParams: parseClickParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseClickRpc(params)
    }
  })

  registry.register({
    method: 'browser.fill',
    description: 'Fill a strict editable browser target.',
    parseParams: parseFillParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseFillRpc(params)
    }
  })

  registry.register({
    method: 'browser.press',
    description: 'Press a key in the session browser.',
    parseParams: parsePressParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUsePress(params)
    }
  })

  registry.register({
    method: 'browser.cua.click',
    description: 'Left-click a viewport coordinate in the session browser.',
    parseParams: parsePointParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseCuaClick(params)
    }
  })

  registry.register({
    method: 'browser.cua.double_click',
    description: 'Double-click a viewport coordinate in the session browser.',
    parseParams: parsePointParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseCuaDoubleClick(params)
    }
  })

  registry.register({
    method: 'browser.cua.drag',
    description: 'Drag the browser pointer along a viewport-coordinate path.',
    parseParams: parseDragParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseCuaDrag(params)
    }
  })

  registry.register({
    method: 'browser.cua.keypress',
    description: 'Press one or more keys in the session browser.',
    parseParams: parseKeypressParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseCuaKeypress(params)
    }
  })

  registry.register({
    method: 'browser.cua.move',
    description: 'Move the browser pointer to a viewport coordinate.',
    parseParams: parsePointParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseCuaMove(params)
    }
  })

  registry.register({
    method: 'browser.cua.scroll',
    description: 'Scroll the session browser viewport for the CUA API.',
    parseParams: parseScrollParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseCuaScroll(params)
    }
  })

  registry.register({
    method: 'browser.cua.type',
    description: 'Insert text at the current browser focus for the CUA API.',
    parseParams: parseTextParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseCuaType(params)
    }
  })

  registry.register({
    method: 'browser.scroll',
    description: 'Scroll the session browser viewport.',
    parseParams: parseScrollParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseScroll(params)
    }
  })

  registry.register({
    method: 'browser.scrollUntil',
    description: 'Scroll until a strict target is visible.',
    parseParams: parseScrollUntilParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseScrollUntilRpc(params)
    }
  })

  registry.register({
    method: 'browser.dom_cua.get_visible_dom',
    description: 'Capture the visible DOM payload for the DOM-CUA API.',
    parseParams: parseSnapshotParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseDomCuaGetVisibleDom(params)
    }
  })

  registry.register({
    method: 'browser.dom_cua.keypress',
    description: 'Press one or more keys in the session browser for the DOM-CUA API.',
    parseParams: parseKeypressParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseDomCuaKeypress(params)
    }
  })

  registry.register({
    method: 'browser.dom_cua.scroll',
    description: 'Scroll the session browser viewport for the DOM-CUA API.',
    parseParams: parseScrollParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseDomCuaScroll(params)
    }
  })

  registry.register({
    method: 'browser.dom_cua.type',
    description: 'Insert text at the current browser focus for the DOM-CUA API.',
    parseParams: parseTextParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseDomCuaType(params)
    }
  })

  registry.register({
    method: 'browser.waitFor',
    description: 'Wait for selector, text, URL, or load state.',
    parseParams: parseWaitForParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseWaitForRpc(params)
    }
  })

  registry.register({
    method: 'browser.screenshot',
    description:
      'Capture a PNG screenshot to the session working directory. Pass fullPage=true to capture the full webpage.',
    parseParams: parseScreenshotParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseScreenshot(params)
    }
  })

  registry.register({
    method: 'browser.select',
    description: 'Select an option from a custom select-like component.',
    parseParams: parseSelectParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseSelect(params)
    }
  })

  registry.register({
    method: 'browser.pickDate',
    description: 'Set a date input or date picker.',
    parseParams: parsePickDateParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUsePickDateRpc(params)
    }
  })

  registry.register({
    method: 'browser.treeSelect',
    description: 'Choose an item from a tree-select component.',
    parseParams: parseTreeSelectParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseTreeSelectRpc(params)
    }
  })

  registry.register({
    method: 'browser.diagnostics',
    description: 'Return recent sanitized Browser Use traces.',
    parseParams: parseDiagnosticsParams,
    run: (params, context) => {
      authorizeBrowserCommand(context, params.sessionId)
      return browserUseDiagnostics(params)
    }
  })
}
