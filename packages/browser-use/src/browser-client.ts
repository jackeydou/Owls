import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPichuLocalRpcClient } from '@pichu/local-rpc-client'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const BROWSER_ID = 'iab'
const SESSION_TAB_ID = 'session'

type SetupBrowserRuntimeOptions = {
  globals: Record<string, unknown>
}

type BrowserStatusResult = {
  sessionId: string
  open: boolean
  attached: boolean
  url: string | null
  title: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

type BrowserSnapshotResult = {
  text: string
  details: Record<string, unknown>
}

type BrowserScreenshotResult = {
  path: string
  mimeType: 'image/png'
  bytes: number
  url: string | null
  title: string | null
}

type SelectorParams = {
  css?: string
  text?: string
  role?: string
  name?: string
  label?: string
  testId?: string
}

type TextMatcher = string | RegExp

type LocatorWaitOptions = {
  timeoutMs?: number
  state?: 'attached' | 'detached' | 'visible' | 'hidden'
}

type LocatorActionOptions = {
  timeoutMs?: number
}

type BrowserCapability = {
  documentation(): Promise<string>
  get?(): Promise<unknown>
  list?(): Promise<Array<{ id: string; description: string }>>
  set?(value: boolean): Promise<void>
}

type BrowserUseAgent = {
  browsers: BrowserCollection
  documentation: DocumentationCollection
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

async function defaultDataRoot(): Promise<string> {
  const bootstrapPath = join(homedir(), '.pichu', 'pichu-bootstrap.json')
  try {
    const parsed = JSON.parse(await readFile(bootstrapPath, 'utf8')) as { dataRoot?: unknown }
    if (typeof parsed.dataRoot === 'string' && parsed.dataRoot.trim()) {
      const value = expandHome(parsed.dataRoot.trim())
      return isAbsolute(value) ? value : resolve(value)
    }
  } catch {
    // First-run and default-root installs may not have a bootstrap file yet.
  }
  return join(homedir(), '.pichu')
}

function sessionIdFromEnv(): string {
  const sessionId = process.env.PICHU_SESSION_ID
  if (!sessionId?.trim()) {
    throw new Error('Missing required browser session_id')
  }
  return sessionId.trim()
}

function textMatcherValue(value: TextMatcher): string {
  if (typeof value === 'string') return value
  throw new Error('RegExp text matchers are not supported by Owls Browser Use yet.')
}

function browserApiDocumentation(): string {
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

const browserClientScriptDir = dirname(fileURLToPath(import.meta.url))
const browserDocsCandidateDirs = [
  join(browserClientScriptDir, '..', 'docs'),
  join(browserClientScriptDir, 'docs')
]

function normalizeDocumentationName(name: string): string {
  const normalized = name.trim().replace(/\\/g, '/').replace(/\.md$/i, '')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error(`Unknown Browser Use documentation: ${name}`)
  }
  return normalized
}

class DocumentationCollection {
  async get(name: string): Promise<string> {
    const normalized = normalizeDocumentationName(name)
    for (const docsDir of browserDocsCandidateDirs) {
      try {
        return await readFile(join(docsDir, `${normalized}.md`), 'utf8')
      } catch {
        // Try the next packaged docs location.
      }
    }
    if (normalized === 'api') return browserApiDocumentation()
    throw new Error(`Unknown Browser Use documentation: ${name}`)
  }
}

class RpcBrowserClient {
  private clientPromise: ReturnType<typeof createPichuLocalRpcClient> | null = null
  private visible = true

  isVisible(): boolean {
    return this.visible
  }

  setVisible(visible: boolean): void {
    this.visible = visible
  }

  async call<TResult>(method: string, params: Record<string, unknown>): Promise<TResult> {
    if (!this.clientPromise) {
      this.clientPromise = createPichuLocalRpcClient({
        dataRoot: await defaultDataRoot(),
        timeoutMs: DEFAULT_TIMEOUT_MS,
        maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES
      })
    }
    return this.clientPromise.call<TResult>(method, {
      sessionId: sessionIdFromEnv(),
      ...params
    })
  }
}

class BrowserCapabilityCollection {
  constructor(private readonly rpc: RpcBrowserClient) {}

  async list(): Promise<Array<{ id: string; description: string }>> {
    return [
      {
        id: 'visibility',
        description: 'Show Owls session browser to the user.'
      }
    ]
  }

  async get(id: string): Promise<BrowserCapability> {
    if (id !== 'visibility') {
      throw new Error(`Unknown browser capability: ${id}`)
    }
    return {
      documentation: () => new DocumentationCollection().get('capabilities/browser/visibility'),
      get: async () => this.rpc.isVisible(),
      set: async (visible: boolean) => {
        this.rpc.setVisible(visible)
        await this.rpc.call<BrowserStatusResult>('browser.visibility', {
          visible
        })
      }
    }
  }
}

class EmptyCapabilityCollection {
  async list(): Promise<Array<{ id: string; description: string }>> {
    return []
  }

  async get(id: string): Promise<BrowserCapability> {
    throw new Error(`Unknown tab capability: ${id}`)
  }
}

class BrowserCollection {
  private readonly browser: Browser

  constructor(rpc: RpcBrowserClient, documentation: DocumentationCollection) {
    this.browser = new Browser(rpc, documentation)
  }

  async list(): Promise<
    Array<{
      capabilities: {
        browser?: Array<{ id: string; description: string }>
        tab?: Array<{ id: string; description: string }>
      }
      id: string
      name: string
      type: 'iab'
      metadata?: Record<string, string>
    }>
  > {
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

  async get(id: string): Promise<Browser> {
    if (id !== BROWSER_ID) {
      throw new Error(`Browser is not available: ${id}`)
    }
    return this.browser
  }
}

class Browser {
  readonly browserId = BROWSER_ID
  readonly capabilities: BrowserCapabilityCollection
  readonly tabs: Tabs
  readonly user: BrowserUser

  constructor(
    rpc: RpcBrowserClient,
    private readonly documentationCollection: DocumentationCollection
  ) {
    this.capabilities = new BrowserCapabilityCollection(rpc)
    this.tabs = new Tabs(rpc)
    this.user = new BrowserUser(rpc, this.tabs)
  }

  documentation(): Promise<string> {
    return this.documentationCollection.get('api')
  }

  async nameSession(_name: string): Promise<void> {
    return
  }
}

class BrowserUser {
  constructor(
    private readonly rpc: RpcBrowserClient,
    private readonly tabs: Tabs
  ) {}

  async openTabs(): Promise<
    Array<{ id: string; title?: string; url?: string; lastOpened?: string }>
  > {
    const status = await this.rpc.call<BrowserStatusResult>('browser.status', {})
    if (!status.open) return []
    return [
      {
        id: SESSION_TAB_ID,
        ...(status.title ? { title: status.title } : {}),
        ...(status.url ? { url: status.url } : {}),
        lastOpened: new Date().toISOString()
      }
    ]
  }

  async claimTab(tab: string | { id: string }): Promise<Tab> {
    const id = typeof tab === 'string' ? tab : tab.id
    return this.tabs.get(id)
  }
}

class Tabs {
  constructor(private readonly rpc: RpcBrowserClient) {}

  async selected(): Promise<Tab | undefined> {
    const status = await this.rpc.call<BrowserStatusResult>('browser.status', {})
    return status.open ? new Tab(this.rpc, SESSION_TAB_ID) : undefined
  }

  async list(): Promise<Array<{ id: string; title?: string; url?: string }>> {
    const status = await this.rpc.call<BrowserStatusResult>('browser.status', {})
    if (!status.open) return []
    return [
      {
        id: SESSION_TAB_ID,
        ...(status.title ? { title: status.title } : {}),
        ...(status.url ? { url: status.url } : {})
      }
    ]
  }

  async new(): Promise<Tab> {
    return new Tab(this.rpc, SESSION_TAB_ID)
  }

  async get(id: string): Promise<Tab> {
    if (id !== SESSION_TAB_ID) {
      throw new Error(`Tab is not available: ${id}`)
    }
    return new Tab(this.rpc, SESSION_TAB_ID)
  }

  async finalize(_options: { keep?: unknown[] } = {}): Promise<void> {
    return
  }
}

class Tab {
  readonly capabilities = new EmptyCapabilityCollection()
  readonly playwright: PlaywrightApi
  readonly cua: CuaApi
  readonly dom_cua: DomCuaApi
  readonly dev: TabDevApi
  readonly clipboard: TabClipboardApi

  constructor(
    private readonly rpc: RpcBrowserClient,
    readonly id: string
  ) {
    this.playwright = new PlaywrightApi(rpc)
    this.cua = new CuaApi(rpc)
    this.dom_cua = new DomCuaApi(rpc)
    this.dev = new TabDevApi()
    this.clipboard = new TabClipboardApi()
  }

  async goto(url: string): Promise<void> {
    await this.rpc.call<BrowserStatusResult>('browser.open', {
      url,
      visible: this.rpc.isVisible()
    })
  }

  async reload(): Promise<void> {
    const current = await this.url()
    if (!current) throw new Error('Cannot reload before a page is open.')
    await this.goto(current)
  }

  async url(): Promise<string | undefined> {
    return (await this.rpc.call<BrowserStatusResult>('browser.status', {})).url ?? undefined
  }

  async title(): Promise<string | undefined> {
    return (await this.rpc.call<BrowserStatusResult>('browser.status', {})).title ?? undefined
  }

  async screenshot(options: { fullPage?: boolean } = {}): Promise<Uint8Array> {
    const result = await this.rpc.call<BrowserScreenshotResult>('browser.screenshot', {
      fullPage: options.fullPage
    })
    return readFile(result.path)
  }

  async back(): Promise<void> {
    await this.rpc.call('browser.back', {})
  }

  async forward(): Promise<void> {
    await this.rpc.call('browser.forward', {})
  }

  async close(): Promise<void> {
    await this.rpc.call('browser.close', {})
  }

  async getJsDialog(): Promise<undefined> {
    return undefined
  }
}

class PlaywrightApi {
  constructor(private readonly rpc: RpcBrowserClient) {}

  async domSnapshot(): Promise<string> {
    return (await this.rpc.call<BrowserSnapshotResult>('browser.snapshot', {})).text
  }

  locator(selector: string): BrowserLocator {
    return new BrowserLocator(this.rpc, { css: selector })
  }

  getByText(text: TextMatcher, _options: { exact?: boolean } = {}): BrowserLocator {
    return new BrowserLocator(this.rpc, { text: textMatcherValue(text) })
  }

  getByLabel(text: TextMatcher, _options: { exact?: boolean } = {}): BrowserLocator {
    return new BrowserLocator(this.rpc, { label: textMatcherValue(text) })
  }

  getByRole(role: string, options: { exact?: boolean; name?: TextMatcher } = {}): BrowserLocator {
    return new BrowserLocator(this.rpc, {
      role,
      ...(options.name !== undefined ? { name: textMatcherValue(options.name) } : {})
    })
  }

  getByTestId(testId: string): BrowserLocator {
    return new BrowserLocator(this.rpc, { testId })
  }

  getByPlaceholder(text: TextMatcher, _options: { exact?: boolean } = {}): BrowserLocator {
    return new BrowserLocator(this.rpc, {
      css: `[placeholder="${cssString(textMatcherValue(text))}"]`
    })
  }

  async waitForLoadState(options: { timeoutMs?: number } = {}): Promise<void> {
    await this.rpc.call('browser.waitFor', {
      loadState: true,
      timeoutMs: options.timeoutMs
    })
  }

  async waitForURL(url: string, options: { timeoutMs?: number } = {}): Promise<void> {
    await this.rpc.call('browser.waitFor', {
      urlContains: url,
      timeoutMs: options.timeoutMs
    })
  }

  async waitForTimeout(timeoutMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, timeoutMs))
  }

  async expectNavigation<T>(
    action: () => Promise<T>,
    _options: { timeoutMs?: number; url?: string; waitUntil?: string } = {}
  ): Promise<T> {
    return action()
  }

  async evaluate<TResult, TArg>(_pageFunction: unknown, _arg?: TArg): Promise<TResult> {
    throw new Error(
      'playwright.evaluate is not exposed by Owls Browser Use because local RPC does not provide arbitrary page JavaScript execution.'
    )
  }

  frameLocator(_frameSelector: string): never {
    throw new Error('playwright.frameLocator is not implemented for Owls Browser Use yet.')
  }
}

class BrowserLocator {
  constructor(
    private readonly rpc: RpcBrowserClient,
    private readonly selector: SelectorParams
  ) {}

  async click(_options: LocatorActionOptions = {}): Promise<void> {
    await this.rpc.call('browser.click', { target: this.selector })
  }

  async dblclick(options: LocatorActionOptions = {}): Promise<void> {
    await this.click(options)
    await this.click(options)
  }

  async fill(value: string, _options: LocatorActionOptions = {}): Promise<void> {
    await this.rpc.call('browser.fill', {
      target: this.selector,
      value
    })
  }

  async type(value: string, options: LocatorActionOptions = {}): Promise<void> {
    await this.fill(value, options)
  }

  async press(value: string, _options: LocatorActionOptions = {}): Promise<void> {
    await this.rpc.call('browser.press', {
      target: this.selector,
      key: value
    })
  }

  async waitFor(options: LocatorWaitOptions = {}): Promise<void> {
    const hidden = options.state === 'hidden' || options.state === 'detached'
    await this.rpc.call('browser.waitFor', {
      ...(hidden ? { selectorHidden: this.selector } : { selectorVisible: this.selector }),
      timeoutMs: options.timeoutMs
    })
  }

  async isVisible(): Promise<boolean> {
    try {
      await this.waitFor({ timeoutMs: 1_000, state: 'visible' })
      return true
    } catch {
      return false
    }
  }

  async isEnabled(): Promise<boolean> {
    return this.isVisible()
  }

  async count(): Promise<number> {
    return (await this.isVisible()) ? 1 : 0
  }

  first(): BrowserLocator {
    return this
  }

  last(): BrowserLocator {
    return this
  }

  nth(_index: number): BrowserLocator {
    return this
  }

  filter(_options: unknown): BrowserLocator {
    return this
  }

  locator(selector: string, _options: unknown = {}): BrowserLocator {
    return new BrowserLocator(this.rpc, { css: selector })
  }

  getByText(text: TextMatcher, options: { exact?: boolean } = {}): BrowserLocator {
    return new PlaywrightApi(this.rpc).getByText(text, options)
  }

  getByLabel(text: TextMatcher, options: { exact?: boolean } = {}): BrowserLocator {
    return new PlaywrightApi(this.rpc).getByLabel(text, options)
  }

  getByRole(role: string, options: { exact?: boolean; name?: TextMatcher } = {}): BrowserLocator {
    return new PlaywrightApi(this.rpc).getByRole(role, options)
  }

  getByTestId(testId: string): BrowserLocator {
    return new PlaywrightApi(this.rpc).getByTestId(testId)
  }

  async innerText(_options: LocatorActionOptions = {}): Promise<string> {
    return (await this.rpc.call<BrowserSnapshotResult>('browser.snapshot', {})).text
  }

  async textContent(options: LocatorActionOptions = {}): Promise<string> {
    return this.innerText(options)
  }

  async allTextContents(options: LocatorActionOptions = {}): Promise<string[]> {
    return [await this.innerText(options)]
  }

  async all(): Promise<BrowserLocator[]> {
    return [this]
  }

  and(_locator: BrowserLocator): BrowserLocator {
    return this
  }

  or(_locator: BrowserLocator): BrowserLocator {
    return this
  }

  async getAttribute(_name: string, _options: LocatorActionOptions = {}): Promise<null> {
    return null
  }

  async check(options: LocatorActionOptions = {}): Promise<void> {
    await this.click(options)
  }

  async uncheck(options: LocatorActionOptions = {}): Promise<void> {
    await this.click(options)
  }

  async setChecked(_checked: boolean, options: LocatorActionOptions = {}): Promise<void> {
    await this.click(options)
  }

  async selectOption(_value: unknown, _options: LocatorActionOptions = {}): Promise<void> {
    throw new Error('locator.selectOption is not implemented for Owls Browser Use yet.')
  }
}

class CuaApi {
  constructor(private readonly rpc: RpcBrowserClient) {}

  async click(options: { x: number; y: number }): Promise<void> {
    await this.rpc.call('browser.cua.click', readPoint(options, 'cua.click'))
  }

  async double_click(options: { x: number; y: number }): Promise<void> {
    await this.rpc.call('browser.cua.double_click', readPoint(options, 'cua.double_click'))
  }

  async drag(options: { path: Array<{ x: number; y: number }> }): Promise<void> {
    await this.rpc.call('browser.cua.drag', {
      path: readPath(options, 'cua.drag')
    })
  }

  async keypress(options: { keys: string[] }): Promise<void> {
    await this.rpc.call('browser.cua.keypress', { keys: readKeys(options, 'cua.keypress') })
  }

  async move(options: { x: number; y: number }): Promise<void> {
    await this.rpc.call('browser.cua.move', readPoint(options, 'cua.move'))
  }

  async scroll(options: { x?: number; y?: number }): Promise<void> {
    await this.rpc.call('browser.cua.scroll', {
      x: finiteNumberOrUndefined(options?.x, 'cua.scroll.x'),
      y: finiteNumberOrUndefined(options?.y, 'cua.scroll.y')
    })
  }

  async type(options: { text: string }): Promise<void> {
    if (typeof options?.text !== 'string') {
      throw new Error('cua.type requires text')
    }
    await this.rpc.call('browser.cua.type', { text: options.text })
  }
}

class DomCuaApi {
  constructor(private readonly rpc: RpcBrowserClient) {}

  async get_visible_dom(): Promise<unknown> {
    return this.rpc.call<BrowserSnapshotResult>('browser.dom_cua.get_visible_dom', {})
  }

  async click(_options: unknown): Promise<void> {
    throw new Error(
      'dom_cua.click requires a stable DOM node-id contract, which Owls Browser Use does not expose yet.'
    )
  }
  async double_click(_options: unknown): Promise<void> {
    throw new Error(
      'dom_cua.double_click requires a stable DOM node-id contract, which Owls Browser Use does not expose yet.'
    )
  }
  async keypress(options: { keys: string[] }): Promise<void> {
    await this.rpc.call('browser.dom_cua.keypress', {
      keys: readKeys(options, 'dom_cua.keypress')
    })
  }

  async scroll(options: { x?: number; y?: number }): Promise<void> {
    await this.rpc.call('browser.dom_cua.scroll', {
      x: finiteNumberOrUndefined(options?.x, 'dom_cua.scroll.x'),
      y: finiteNumberOrUndefined(options?.y, 'dom_cua.scroll.y')
    })
  }

  async type(options: { text: string }): Promise<void> {
    if (typeof options?.text !== 'string') {
      throw new Error('dom_cua.type requires text')
    }
    await this.rpc.call('browser.dom_cua.type', { text: options.text })
  }
}

class TabDevApi {
  async logs(_options: unknown = {}): Promise<unknown[]> {
    return []
  }
}

class TabClipboardApi {
  async read(): Promise<unknown[]> {
    throw new Error('clipboard.read is not implemented for Owls Browser Use yet.')
  }
  async readText(): Promise<string> {
    throw new Error('clipboard.readText is not implemented for Owls Browser Use yet.')
  }
  async write(_items: unknown[]): Promise<void> {
    throw new Error('clipboard.write is not implemented for Owls Browser Use yet.')
  }
  async writeText(_text: string): Promise<void> {
    throw new Error('clipboard.writeText is not implemented for Owls Browser Use yet.')
  }
}

function cssString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}

function finiteNumberOrUndefined(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined
  return finiteNumber(value, label)
}

function readPoint(value: unknown, label: string): { x: number; y: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} requires a point object`)
  }
  const record = value as Record<string, unknown>
  return {
    x: finiteNumber(record.x, `${label}.x`),
    y: finiteNumber(record.y, `${label}.y`)
  }
}

function readPath(value: unknown, label: string): Array<{ x: number; y: number }> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} requires an options object`)
  }
  const path = (value as Record<string, unknown>).path
  if (!Array.isArray(path) || path.length < 2) {
    throw new Error(`${label}.path must contain at least two points`)
  }
  return path.map((point, index) => readPoint(point, `${label}.path.${index}`))
}

function readKeys(value: unknown, label: string): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} requires an options object`)
  }
  const keys = (value as Record<string, unknown>).keys
  if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string' || !key.trim())) {
    throw new Error(`${label}.keys must be a non-empty string array`)
  }
  return keys.map((key) => key.trim())
}

export async function setupBrowserRuntime(options: SetupBrowserRuntimeOptions): Promise<void> {
  const documentation = new DocumentationCollection()
  const rpc = new RpcBrowserClient()
  const browserAgent: BrowserUseAgent = {
    browsers: new BrowserCollection(rpc, documentation),
    documentation
  }
  const existingAgent =
    typeof options.globals.agent === 'object' && options.globals.agent !== null
      ? (options.globals.agent as Record<string, unknown>)
      : {}
  options.globals.agent = {
    ...existingAgent,
    ...browserAgent
  }
}
