// src/browser-client.ts
// ../local-rpc-client/dist/index.js
import { readFile, readFile as readFile2 } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { homedir, homedir as homedir2 } from 'node:os'
import { dirname, isAbsolute, join, join as join2, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

var DEFAULT_TIMEOUT_MS = 3e4
var DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024
var DEFAULT_PAGE = 1
var DEFAULT_PAGE_SIZE = 20
var PLUGIN_ADMIN_RPC_TIMEOUT_MS = 12e4
var nextRequestId = 1
var PichuLocalRpcError = class extends Error {
  code
  data
  constructor(error) {
    super(error.message)
    this.name = 'PichuLocalRpcError'
    this.code = error.code
    this.data = error.data
  }
}
var PichuLocalRpcConnectionError = class extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'PichuLocalRpcConnectionError'
  }
}
function defaultPichuDataRoot() {
  return join(homedir(), '.pichu')
}
function localRpcMetadataPath(dataRoot = defaultPichuDataRoot()) {
  return join(dataRoot, 'run', 'local-rpc.json')
}
function createRequestId() {
  const id = nextRequestId
  nextRequestId += 1
  return `pichu-local-rpc-${Date.now()}-${id}`
}
function assertRecord(value, message) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PichuLocalRpcConnectionError(message)
  }
  return value
}
async function readLocalRpcMetadata(options = {}) {
  const metadataPath = options.metadataPath ?? localRpcMetadataPath(options.dataRoot)
  let parsed
  try {
    parsed = JSON.parse(await readFile(metadataPath, 'utf8'))
  } catch (error) {
    throw new PichuLocalRpcConnectionError(
      `Failed to read Owls local RPC metadata at ${metadataPath}`,
      { cause: error }
    )
  }
  const metadata = assertRecord(parsed, 'Invalid Owls local RPC metadata')
  if (metadata.transport !== 'unix') {
    throw new PichuLocalRpcConnectionError(
      `Unsupported Owls local RPC transport: ${String(metadata.transport)}`
    )
  }
  if (typeof metadata.endpoint !== 'string' || !metadata.endpoint.trim()) {
    throw new PichuLocalRpcConnectionError('Owls local RPC metadata is missing endpoint')
  }
  return {
    version: typeof metadata.version === 'number' ? metadata.version : 1,
    transport: 'unix',
    endpoint: metadata.endpoint,
    protocol: typeof metadata.protocol === 'string' ? metadata.protocol : 'jsonrpc-2.0',
    framing: typeof metadata.framing === 'string' ? metadata.framing : 'ndjson',
    pid: typeof metadata.pid === 'number' ? metadata.pid : null,
    startedAt: typeof metadata.startedAt === 'string' ? metadata.startedAt : null
  }
}
function parseJsonRpcResponse(frame) {
  let parsed
  try {
    parsed = JSON.parse(frame)
  } catch (error) {
    throw new PichuLocalRpcConnectionError('Invalid JSON-RPC response from Owls Client', {
      cause: error
    })
  }
  const response = assertRecord(parsed, 'Invalid JSON-RPC response from Owls Client')
  if (response.jsonrpc !== '2.0') {
    throw new PichuLocalRpcConnectionError('Invalid JSON-RPC version from Owls Client')
  }
  if ('error' in response) {
    const error = assertRecord(response.error, 'Invalid JSON-RPC error from Owls Client')
    throw new PichuLocalRpcError({
      code: typeof error.code === 'number' ? error.code : -32603,
      message: typeof error.message === 'string' ? error.message : 'Owls local RPC error',
      data: error.data
    })
  }
  return response.result
}
var PichuLocalRpcClient = class {
  socketPath
  metadataPath
  dataRoot
  timeoutMs
  maxResponseBytes
  constructor(options = {}) {
    this.socketPath = options.socketPath
    this.metadataPath = options.metadataPath
    this.dataRoot = options.dataRoot
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  }
  metadata() {
    return readLocalRpcMetadata({
      dataRoot: this.dataRoot,
      metadataPath: this.metadataPath
    })
  }
  async endpoint() {
    if (this.socketPath?.trim()) return this.socketPath
    return (await this.metadata()).endpoint
  }
  async call(method, params = {}, options = {}) {
    if (typeof method !== 'string' || !method.trim()) {
      throw new PichuLocalRpcConnectionError('Local RPC method is required')
    }
    const socketPath = await this.endpoint()
    const request = {
      jsonrpc: '2.0',
      id: options.id ?? createRequestId(),
      method: method.trim(),
      ...(params === void 0 ? {} : { params })
    }
    return sendJsonRpcRequest(socketPath, request, {
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      maxResponseBytes: options.maxResponseBytes ?? this.maxResponseBytes
    })
  }
  discover() {
    return this.call('rpc.discover', {})
  }
  diagnostics() {
    return this.call('rpc.diagnostics', {})
  }
  appStatus() {
    return this.call('app.status', {})
  }
  focusApp() {
    return this.call('app.focus', {})
  }
  agentStatus() {
    return this.call('agent.status', {})
  }
  sessionList(params = {}) {
    return this.call('session.list', {
      page: params.page ?? DEFAULT_PAGE,
      pageSize: params.pageSize ?? DEFAULT_PAGE_SIZE
    })
  }
  sessionNew(params) {
    return this.call('session.new', params)
  }
  sessionContinue(params) {
    return this.call('session.continue', params)
  }
  sessionStatus(params = {}) {
    return this.call('session.status', params)
  }
  sessionMessages(params) {
    return this.call('session.messages', params)
  }
  pluginList() {
    return this.call('plugin.list', {})
  }
  pluginInstall(params) {
    return this.call('plugin.install', params)
  }
  pluginInstallLocal(params) {
    return this.call('plugin.installLocal', params)
  }
  pluginUpload(params) {
    return this.call('plugin.upload', params, {
      timeoutMs: PLUGIN_ADMIN_RPC_TIMEOUT_MS
    })
  }
  pluginUninstall(params) {
    return this.call('plugin.uninstall', params)
  }
}
function createPichuLocalRpcClient(options = {}) {
  return new PichuLocalRpcClient(options)
}
function sendJsonRpcRequest(socketPath, request, options) {
  return new Promise((resolve2, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    let responseBytes = 0
    let settled = false
    let timer = null
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
    }
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }
    const fail = (error) => {
      settle(reject, error)
    }
    timer = setTimeout(() => {
      fail(
        new PichuLocalRpcConnectionError(`Owls local RPC timed out after ${options.timeoutMs}ms`)
      )
    }, options.timeoutMs)
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}
`)
    })
    socket.on('data', (chunk) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      responseBytes += Buffer.byteLength(text)
      if (responseBytes > options.maxResponseBytes) {
        fail(new PichuLocalRpcConnectionError('Owls local RPC response exceeded maxResponseBytes'))
        return
      }
      buffer += text
      while (!settled) {
        const newlineIndex = buffer.indexOf('\n')
        if (newlineIndex < 0) return
        const frame = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (!frame) continue
        try {
          settle(resolve2, parseJsonRpcResponse(frame))
        } catch (error) {
          fail(error)
        }
      }
    })
    socket.on('error', (error) => {
      fail(
        new PichuLocalRpcConnectionError('Failed to connect to Owls local RPC socket', {
          cause: error
        })
      )
    })
    socket.on('end', () => {
      if (!settled) {
        fail(new PichuLocalRpcConnectionError('Owls local RPC socket closed before a response'))
      }
    })
  })
}

// src/browser-client.ts
var DEFAULT_TIMEOUT_MS2 = 12e4
var DEFAULT_MAX_RESPONSE_BYTES2 = 8 * 1024 * 1024
var BROWSER_ID = 'iab'
var SESSION_TAB_ID = 'session'
function expandHome(path) {
  if (path === '~') return homedir2()
  if (path.startsWith('~/')) return join2(homedir2(), path.slice(2))
  return path
}
async function defaultDataRoot() {
  const bootstrapPath = join2(homedir2(), '.pichu', 'pichu-bootstrap.json')
  try {
    const parsed = JSON.parse(await readFile2(bootstrapPath, 'utf8'))
    if (typeof parsed.dataRoot === 'string' && parsed.dataRoot.trim()) {
      const value = expandHome(parsed.dataRoot.trim())
      return isAbsolute(value) ? value : resolve(value)
    }
  } catch {}
  return join2(homedir2(), '.pichu')
}
function sessionIdFromEnv() {
  const sessionId = process.env.PICHU_SESSION_ID
  if (!sessionId?.trim()) {
    throw new Error('Missing required browser session_id')
  }
  return sessionId.trim()
}
function textMatcherValue(value) {
  if (typeof value === 'string') return value
  throw new Error('RegExp text matchers are not supported by Owls Browser Use yet.')
}
function browserApiDocumentation() {
  return `# Owls Browser Use

This runtime follows the Codex in-app Browser API shape and controls Owls's session browser through local RPC.

Bootstrap:
\`\`\`js
const { setupBrowserRuntime } = await import("<plugin root>/scripts/browser-client.mjs");
await setupBrowserRuntime({ globals: globalThis });
globalThis.browser = await agent.browsers.get("iab");
nodeRepl.write(await browser.documentation());
\`\`\`

Use \`await agent.browsers.get("iab")\` to select Owls's in-app browser. The current implementation exposes one session-scoped tab with id \`${SESSION_TAB_ID}\`.

Common operations:
\`\`\`js
const tab = (await browser.tabs.selected()) ?? await browser.tabs.new();
await tab.goto("https://example.com");
console.log(await tab.playwright.domSnapshot());
await tab.playwright.getByText("Sign in", { exact: false }).click({});
await tab.playwright.getByLabel("Email", { exact: false }).fill("name@example.com", {});
const png = await tab.screenshot({ fullPage: false });
\`\`\`

Visibility:
\`\`\`js
await (await browser.capabilities.get("visibility")).set(true);
\`\`\`

Unsupported Codex surfaces fail explicitly instead of silently falling back.`
}
var browserClientScriptDir = dirname(fileURLToPath(import.meta.url))
var browserDocsCandidateDirs = [
  join2(browserClientScriptDir, '..', 'docs'),
  join2(browserClientScriptDir, 'docs')
]
function normalizeDocumentationName(name) {
  const normalized = name.trim().replace(/\\/g, '/').replace(/\.md$/i, '')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error(`Unknown Browser Use documentation: ${name}`)
  }
  return normalized
}
var DocumentationCollection = class {
  async get(name) {
    const normalized = normalizeDocumentationName(name)
    for (const docsDir of browserDocsCandidateDirs) {
      try {
        return await readFile2(join2(docsDir, `${normalized}.md`), 'utf8')
      } catch {}
    }
    if (normalized === 'api') return browserApiDocumentation()
    throw new Error(`Unknown Browser Use documentation: ${name}`)
  }
}
var RpcBrowserClient = class {
  clientPromise = null
  visible = true
  isVisible() {
    return this.visible
  }
  setVisible(visible) {
    this.visible = visible
  }
  async call(method, params) {
    if (!this.clientPromise) {
      this.clientPromise = createPichuLocalRpcClient({
        dataRoot: await defaultDataRoot(),
        timeoutMs: DEFAULT_TIMEOUT_MS2,
        maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES2
      })
    }
    return this.clientPromise.call(method, {
      sessionId: sessionIdFromEnv(),
      ...params
    })
  }
}
var BrowserCapabilityCollection = class {
  constructor(rpc) {
    this.rpc = rpc
  }
  async list() {
    return [
      {
        id: 'visibility',
        description: 'Show Owls session browser to the user.'
      }
    ]
  }
  async get(id) {
    if (id !== 'visibility') {
      throw new Error(`Unknown browser capability: ${id}`)
    }
    return {
      documentation: () => new DocumentationCollection().get('capabilities/browser/visibility'),
      get: async () => this.rpc.isVisible(),
      set: async (visible) => {
        this.rpc.setVisible(visible)
        await this.rpc.call('browser.visibility', {
          visible
        })
      }
    }
  }
}
var EmptyCapabilityCollection = class {
  async list() {
    return []
  }
  async get(id) {
    throw new Error(`Unknown tab capability: ${id}`)
  }
}
var BrowserCollection = class {
  browser
  constructor(rpc, documentation) {
    this.browser = new Browser(rpc, documentation)
  }
  async list() {
    return [
      {
        id: BROWSER_ID,
        name: 'Owls In-App Browser',
        type: 'iab',
        capabilities: {
          browser: await this.browser.capabilities.list(),
          tab: []
        }
      }
    ]
  }
  async get(id) {
    if (id !== BROWSER_ID) {
      throw new Error(`Browser is not available: ${id}`)
    }
    return this.browser
  }
}
var Browser = class {
  constructor(rpc, documentationCollection) {
    this.documentationCollection = documentationCollection
    this.capabilities = new BrowserCapabilityCollection(rpc)
    this.tabs = new Tabs(rpc)
    this.user = new BrowserUser(rpc, this.tabs)
  }
  browserId = BROWSER_ID
  capabilities
  tabs
  user
  documentation() {
    return this.documentationCollection.get('api')
  }
  async nameSession(_name) {
    return
  }
}
var BrowserUser = class {
  constructor(rpc, tabs) {
    this.rpc = rpc
    this.tabs = tabs
  }
  async openTabs() {
    const status = await this.rpc.call('browser.status', {})
    if (!status.open) return []
    return [
      {
        id: SESSION_TAB_ID,
        ...(status.title ? { title: status.title } : {}),
        ...(status.url ? { url: status.url } : {}),
        lastOpened: /* @__PURE__ */ new Date().toISOString()
      }
    ]
  }
  async claimTab(tab) {
    const id = typeof tab === 'string' ? tab : tab.id
    return this.tabs.get(id)
  }
}
var Tabs = class {
  constructor(rpc) {
    this.rpc = rpc
  }
  async selected() {
    const status = await this.rpc.call('browser.status', {})
    return status.open ? new Tab(this.rpc, SESSION_TAB_ID) : void 0
  }
  async list() {
    const status = await this.rpc.call('browser.status', {})
    if (!status.open) return []
    return [
      {
        id: SESSION_TAB_ID,
        ...(status.title ? { title: status.title } : {}),
        ...(status.url ? { url: status.url } : {})
      }
    ]
  }
  async new() {
    return new Tab(this.rpc, SESSION_TAB_ID)
  }
  async get(id) {
    if (id !== SESSION_TAB_ID) {
      throw new Error(`Tab is not available: ${id}`)
    }
    return new Tab(this.rpc, SESSION_TAB_ID)
  }
  async finalize(_options = {}) {
    return
  }
}
var Tab = class {
  constructor(rpc, id) {
    this.rpc = rpc
    this.id = id
    this.playwright = new PlaywrightApi(rpc)
    this.cua = new CuaApi(rpc)
    this.dom_cua = new DomCuaApi(rpc)
    this.dev = new TabDevApi()
    this.clipboard = new TabClipboardApi()
  }
  capabilities = new EmptyCapabilityCollection()
  playwright
  cua
  dom_cua
  dev
  clipboard
  async goto(url) {
    await this.rpc.call('browser.open', {
      url,
      visible: this.rpc.isVisible()
    })
  }
  async reload() {
    const current = await this.url()
    if (!current) throw new Error('Cannot reload before a page is open.')
    await this.goto(current)
  }
  async url() {
    return (await this.rpc.call('browser.status', {})).url ?? void 0
  }
  async title() {
    return (await this.rpc.call('browser.status', {})).title ?? void 0
  }
  async screenshot(options = {}) {
    const result = await this.rpc.call('browser.screenshot', {
      fullPage: options.fullPage
    })
    return readFile2(result.path)
  }
  async back() {
    await this.rpc.call('browser.back', {})
  }
  async forward() {
    await this.rpc.call('browser.forward', {})
  }
  async close() {
    await this.rpc.call('browser.close', {})
  }
  async getJsDialog() {
    return void 0
  }
}
var PlaywrightApi = class {
  constructor(rpc) {
    this.rpc = rpc
  }
  async domSnapshot() {
    return (await this.rpc.call('browser.snapshot', {})).text
  }
  locator(selector) {
    return new BrowserLocator(this.rpc, { css: selector })
  }
  getByText(text, _options = {}) {
    return new BrowserLocator(this.rpc, { text: textMatcherValue(text) })
  }
  getByLabel(text, _options = {}) {
    return new BrowserLocator(this.rpc, { label: textMatcherValue(text) })
  }
  getByRole(role, options = {}) {
    return new BrowserLocator(this.rpc, {
      role,
      ...(options.name !== void 0 ? { name: textMatcherValue(options.name) } : {})
    })
  }
  getByTestId(testId) {
    return new BrowserLocator(this.rpc, { testId })
  }
  getByPlaceholder(text, _options = {}) {
    return new BrowserLocator(this.rpc, {
      css: `[placeholder="${cssString(textMatcherValue(text))}"]`
    })
  }
  async waitForLoadState(options = {}) {
    await this.rpc.call('browser.waitFor', {
      loadState: true,
      timeoutMs: options.timeoutMs
    })
  }
  async waitForURL(url, options = {}) {
    await this.rpc.call('browser.waitFor', {
      urlContains: url,
      timeoutMs: options.timeoutMs
    })
  }
  async waitForTimeout(timeoutMs) {
    await new Promise((resolve2) => setTimeout(resolve2, timeoutMs))
  }
  async expectNavigation(action, _options = {}) {
    return action()
  }
  async evaluate(_pageFunction, _arg) {
    throw new Error(
      'playwright.evaluate is not exposed by Owls Browser Use because local RPC does not provide arbitrary page JavaScript execution.'
    )
  }
  frameLocator(_frameSelector) {
    throw new Error('playwright.frameLocator is not implemented for Owls Browser Use yet.')
  }
}
var BrowserLocator = class _BrowserLocator {
  constructor(rpc, selector) {
    this.rpc = rpc
    this.selector = selector
  }
  async click(_options = {}) {
    await this.rpc.call('browser.click', { target: this.selector })
  }
  async dblclick(options = {}) {
    await this.click(options)
    await this.click(options)
  }
  async fill(value, _options = {}) {
    await this.rpc.call('browser.fill', {
      target: this.selector,
      value
    })
  }
  async type(value, options = {}) {
    await this.fill(value, options)
  }
  async press(value, _options = {}) {
    await this.rpc.call('browser.press', {
      target: this.selector,
      key: value
    })
  }
  async waitFor(options = {}) {
    const hidden = options.state === 'hidden' || options.state === 'detached'
    await this.rpc.call('browser.waitFor', {
      ...(hidden ? { selectorHidden: this.selector } : { selectorVisible: this.selector }),
      timeoutMs: options.timeoutMs
    })
  }
  async isVisible() {
    try {
      await this.waitFor({ timeoutMs: 1e3, state: 'visible' })
      return true
    } catch {
      return false
    }
  }
  async isEnabled() {
    return this.isVisible()
  }
  async count() {
    return (await this.isVisible()) ? 1 : 0
  }
  first() {
    return this
  }
  last() {
    return this
  }
  nth(_index) {
    return this
  }
  filter(_options) {
    return this
  }
  locator(selector, _options = {}) {
    return new _BrowserLocator(this.rpc, { css: selector })
  }
  getByText(text, options = {}) {
    return new PlaywrightApi(this.rpc).getByText(text, options)
  }
  getByLabel(text, options = {}) {
    return new PlaywrightApi(this.rpc).getByLabel(text, options)
  }
  getByRole(role, options = {}) {
    return new PlaywrightApi(this.rpc).getByRole(role, options)
  }
  getByTestId(testId) {
    return new PlaywrightApi(this.rpc).getByTestId(testId)
  }
  async innerText(_options = {}) {
    return (await this.rpc.call('browser.snapshot', {})).text
  }
  async textContent(options = {}) {
    return this.innerText(options)
  }
  async allTextContents(options = {}) {
    return [await this.innerText(options)]
  }
  async all() {
    return [this]
  }
  and(_locator) {
    return this
  }
  or(_locator) {
    return this
  }
  async getAttribute(_name, _options = {}) {
    return null
  }
  async check(options = {}) {
    await this.click(options)
  }
  async uncheck(options = {}) {
    await this.click(options)
  }
  async setChecked(_checked, options = {}) {
    await this.click(options)
  }
  async selectOption(_value, _options = {}) {
    throw new Error('locator.selectOption is not implemented for Owls Browser Use yet.')
  }
}
var CuaApi = class {
  constructor(rpc) {
    this.rpc = rpc
  }
  async click(options) {
    await this.rpc.call('browser.cua.click', readPoint(options, 'cua.click'))
  }
  async double_click(options) {
    await this.rpc.call('browser.cua.double_click', readPoint(options, 'cua.double_click'))
  }
  async drag(options) {
    await this.rpc.call('browser.cua.drag', {
      path: readPath(options, 'cua.drag')
    })
  }
  async keypress(options) {
    await this.rpc.call('browser.cua.keypress', { keys: readKeys(options, 'cua.keypress') })
  }
  async move(options) {
    await this.rpc.call('browser.cua.move', readPoint(options, 'cua.move'))
  }
  async scroll(options) {
    await this.rpc.call('browser.cua.scroll', {
      x: finiteNumberOrUndefined(options?.x, 'cua.scroll.x'),
      y: finiteNumberOrUndefined(options?.y, 'cua.scroll.y')
    })
  }
  async type(options) {
    if (typeof options?.text !== 'string') {
      throw new Error('cua.type requires text')
    }
    await this.rpc.call('browser.cua.type', { text: options.text })
  }
}
var DomCuaApi = class {
  constructor(rpc) {
    this.rpc = rpc
  }
  async get_visible_dom() {
    return this.rpc.call('browser.dom_cua.get_visible_dom', {})
  }
  async click(_options) {
    throw new Error(
      'dom_cua.click requires a stable DOM node-id contract, which Owls Browser Use does not expose yet.'
    )
  }
  async double_click(_options) {
    throw new Error(
      'dom_cua.double_click requires a stable DOM node-id contract, which Owls Browser Use does not expose yet.'
    )
  }
  async keypress(options) {
    await this.rpc.call('browser.dom_cua.keypress', {
      keys: readKeys(options, 'dom_cua.keypress')
    })
  }
  async scroll(options) {
    await this.rpc.call('browser.dom_cua.scroll', {
      x: finiteNumberOrUndefined(options?.x, 'dom_cua.scroll.x'),
      y: finiteNumberOrUndefined(options?.y, 'dom_cua.scroll.y')
    })
  }
  async type(options) {
    if (typeof options?.text !== 'string') {
      throw new Error('dom_cua.type requires text')
    }
    await this.rpc.call('browser.dom_cua.type', { text: options.text })
  }
}
var TabDevApi = class {
  async logs(_options = {}) {
    return []
  }
}
var TabClipboardApi = class {
  async read() {
    throw new Error('clipboard.read is not implemented for Owls Browser Use yet.')
  }
  async readText() {
    throw new Error('clipboard.readText is not implemented for Owls Browser Use yet.')
  }
  async write(_items) {
    throw new Error('clipboard.write is not implemented for Owls Browser Use yet.')
  }
  async writeText(_text) {
    throw new Error('clipboard.writeText is not implemented for Owls Browser Use yet.')
  }
}
function cssString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}
function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}
function finiteNumberOrUndefined(value, label) {
  if (value === void 0 || value === null) return void 0
  return finiteNumber(value, label)
}
function readPoint(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} requires a point object`)
  }
  const record = value
  return {
    x: finiteNumber(record.x, `${label}.x`),
    y: finiteNumber(record.y, `${label}.y`)
  }
}
function readPath(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} requires an options object`)
  }
  const path = value.path
  if (!Array.isArray(path) || path.length < 2) {
    throw new Error(`${label}.path must contain at least two points`)
  }
  return path.map((point, index) => readPoint(point, `${label}.path.${index}`))
}
function readKeys(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} requires an options object`)
  }
  const keys = value.keys
  if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string' || !key.trim())) {
    throw new Error(`${label}.keys must be a non-empty string array`)
  }
  return keys.map((key) => key.trim())
}
async function setupBrowserRuntime(options) {
  const documentation = new DocumentationCollection()
  const rpc = new RpcBrowserClient()
  const browserAgent = {
    browsers: new BrowserCollection(rpc, documentation),
    documentation
  }
  const existingAgent =
    typeof options.globals.agent === 'object' && options.globals.agent !== null
      ? options.globals.agent
      : {}
  options.globals.agent = {
    ...existingAgent,
    ...browserAgent
  }
}

export { setupBrowserRuntime }
