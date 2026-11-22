/**
 * Owlto's browser: tabs as WebContentsViews in the main window, laid over the right sidebar's
 * Browser panel. Worker tabs are driven through the CDP gate; the user's own tabs are not
 * exposed to it. See docs/RFC_OWLTO_IN_APP_BROWSER.md.
 */
import { randomUUID } from 'node:crypto'
import { type BrowserWindow, WebContentsView } from 'electron'
import type { AgentProvider } from '../../shared/agents.js'
import type { AppEvent } from '../../shared/app.js'
import type {
  BrowserAction,
  BrowserAsk,
  BrowserBounds,
  BrowserControl,
  BrowserSettings,
  BrowserSnapshot,
  BrowserTab,
  BrowserTabOwner
} from '../../shared/browser-panel.js'
import type { CdpGate, CdpParams, GateBackend, GateTab } from './cdp-gate.js'
import { BrowserProfile, type DownloadsReport } from './profile.js'
import { type AskAnswer, SitePolicy } from './site-policy.js'

/** Where a tab sits when the panel does not show it: off the window, so it keeps painting. */
const PARKED_X = -20_000
const DEFAULT_SIZE = { width: 1280, height: 800 }
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'about:', 'data:', 'blob:'])
/** An ask nobody answers counts as blocked after this long. */
const ASK_TIMEOUT_MS = 5 * 60_000

type PendingAsk = { ask: BrowserAsk; resolve: (answer: AskAnswer) => void; timer: NodeJS.Timeout }
type PendingHandoff = { resolve: (status: HandoffStatus) => void; timer: NodeJS.Timeout }

type Tab = {
  id: string
  /** The worker key that owns it, or null for the user's own tab. */
  key: string | null
  view: WebContentsView
  control: BrowserControl
  /** Input commands from the gate still in flight; the user's own input is let through then. */
  injecting: number
  pendingAsk: PendingAsk | null
  handoff: PendingHandoff | null
}

export type HandoffStatus = 'done' | 'closed' | 'timeout'
export type HandoffResult = { status: HandoffStatus; url: string } | { status: 'no-tab'; url: null }

/** What a worker's tab waits on the user for, so Owlto can tell them when they look away. */
export type BrowserNeed = { tabId: string; kind: 'handoff' | BrowserAsk['kind']; text: string }

export type BrowserOwnerInfo = { provider: AgentProvider; title: string }

type Waiter = { key: string; resolve: (ready: boolean) => void; timer: NodeJS.Timeout }

export class BrowserManager implements GateBackend {
  private readonly byId = new Map<string, Tab>()
  private activeId: string | null = null
  private bounds: BrowserBounds = null
  private size = DEFAULT_SIZE
  private window: BrowserWindow | null = null
  private gate: CdpGate | null = null
  private readonly profile: BrowserProfile
  private readonly policy: SitePolicy
  private policyInstalled = false
  private nextId = 1
  private waiters = new Set<Waiter>()
  private changeTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly deps: {
      /** Owlto's browser folder in the data root: its session lives here. */
      home: () => string
      /** The downloads folder: the user's choice, or Owlto's default. */
      downloadsRoot: () => string
      /** The worker behind a key, for its tab's label; null once it is gone. */
      owner: (key: string) => BrowserOwnerInfo | null
      changed: (snapshot: BrowserSnapshot) => void
      /** Settings → Browser, read on each request. */
      settings: () => BrowserSettings
      /** A worker's tab started or stopped waiting on the user; null when nothing waits. */
      needs: (key: string, need: BrowserNeed | null) => void
    }
  ) {
    this.profile = new BrowserProfile({
      home: deps.home,
      downloadsRoot: deps.downloadsRoot,
      ownerOf: (id) => this.tabFor(id)?.key ?? null
    })
    this.policy = new SitePolicy({
      settings: deps.settings,
      workerTab: (id) => {
        const tab = this.tabFor(id)
        return tab?.key && tab.control.kind === 'agent' ? { tabId: tab.id, key: tab.key } : null
      },
      ask: (tabId, ask) => this.ask(tabId, ask),
      signedIn: (url) => this.profile.signedIn(url)
    })
  }

  attachGate(gate: CdpGate): void {
    this.gate = gate
  }

  attachWindow(window: BrowserWindow): void {
    this.window = window
    for (const tab of this.byId.values()) window.contentView.addChildView(tab.view)
    this.layout()
    window.on('closed', () => {
      if (this.window === window) this.window = null
    })
  }

  snapshot(): BrowserSnapshot {
    return {
      tabs: [...this.byId.values()].map((tab) => this.describe(tab)),
      activeId: this.activeId
    }
  }

  // ─── The panel ────────────────────────────────────────────────────────────

  setBounds(bounds: BrowserBounds): void {
    this.bounds = bounds
    if (bounds && bounds.width > 0 && bounds.height > 0)
      this.size = { width: Math.round(bounds.width), height: Math.round(bounds.height) }
    this.layout()
  }

  activate(tabId: string): void {
    if (!this.byId.has(tabId) || this.activeId === tabId) return
    this.activeId = tabId
    this.layout()
    this.changed()
  }

  newUserTab(): BrowserTab {
    const tab = this.open(null)
    void tab.view.webContents.loadURL('about:blank').catch(() => {})
    this.activate(tab.id)
    return this.describe(tab)
  }

  navigate(tabId: string, input: string): void {
    const tab = this.userDriven(tabId)
    void tab.view.webContents.loadURL(normalizeUrl(input)).catch(() => {})
  }

  history(tabId: string, action: 'back' | 'forward' | 'reload'): void {
    const contents = this.userDriven(tabId).view.webContents
    if (action === 'reload') contents.reload()
    else if (action === 'back') contents.navigationHistory.goBack()
    else contents.navigationHistory.goForward()
  }

  takeOver(tabId: string): void {
    const tab = this.byId.get(tabId)
    if (!tab?.key || tab.control.kind === 'user') return
    tab.control = { kind: 'user' }
    this.changed()
    this.needsChanged(tab.key)
  }

  handBack(tabId: string): void {
    const tab = this.byId.get(tabId)
    if (!tab?.key || tab.control.kind === 'agent') return
    tab.control = { kind: 'agent', action: null }
    this.settleHandoff(tab, 'done')
    this.settleWaiters(tab.key)
    this.changed()
  }

  /** The tab's ask the user is answering, or null once it is gone or replaced. */
  pendingAsk(tabId: string, askId: string): BrowserAsk | null {
    const ask = this.byId.get(tabId)?.pendingAsk?.ask
    return ask?.id === askId ? ask : null
  }

  /** The user's answer to a tab's ask; a stale ask id does nothing. */
  answer(tabId: string, askId: string, answer: AskAnswer): void {
    const tab = this.byId.get(tabId)
    if (tab?.pendingAsk?.ask.id === askId) this.settleAsk(tab, answer)
  }

  /**
   * A worker hands its tab to the user for one step, such as a sign-in or a captcha, and
   * waits until they hand it back, close it, or `timeoutMs` passes.
   */
  handoff(key: string, reason: string, timeoutMs: number): Promise<HandoffResult> {
    const owned = [...this.byId.values()].filter((tab) => tab.key === key)
    const tab = owned.find((t) => t.id === this.activeId) ?? owned.at(-1)
    if (!tab) return Promise.resolve({ status: 'no-tab', url: null })
    this.settleHandoff(tab, 'timeout')
    tab.control = { kind: 'handoff', reason }
    this.activate(tab.id)
    this.changed()
    this.needsChanged(key)
    return new Promise<HandoffStatus>((resolve) => {
      tab.handoff = {
        resolve,
        timer: setTimeout(() => {
          if (tab.control.kind === 'handoff') tab.control = { kind: 'agent', action: null }
          this.settleHandoff(tab, 'timeout')
          this.settleWaiters(key)
          this.changed()
        }, timeoutMs)
      }
    }).then((status) => ({ status, url: this.urlOf(tab) }))
  }

  /** Downloads the worker's pages finished since its last call. */
  takeDownloads(key: string): DownloadsReport {
    return this.profile.takeDownloads(key)
  }

  clearSignIns(): Promise<void> {
    return this.profile.clearSignIns()
  }

  closeTabById(tabId: string): void {
    const tab = this.byId.get(tabId)
    if (tab) this.remove(tab)
  }

  /** Closes a worker's tabs once the worker or its thread is removed. */
  observe(event: AppEvent): void {
    if (event.type === 'worker' && event.worker.status === 'removed')
      this.forgetOwner(event.worker.id)
    if (event.type === 'thread-removed') for (const id of event.workerIds) this.forgetOwner(id)
  }

  /** Closes every tab a worker opened, once the worker is gone. */
  forgetOwner(key: string): void {
    for (const tab of [...this.byId.values()]) if (tab.key === key) this.remove(tab)
    this.gate?.revoke(key)
    this.policy.forgetWorker(key)
    this.profile.forgetWorker(key)
  }

  /**
   * Resolves true once none of the worker's tabs is held by the user, or false after
   * `timeoutMs`. A script waits here instead of fighting the user for the page.
   */
  waitForAgent(key: string, timeoutMs: number): Promise<boolean> {
    if (!this.heldByUser(key)) return Promise.resolve(true)
    return new Promise((resolve) => {
      const waiter: Waiter = {
        key,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          resolve(false)
        }, timeoutMs)
      }
      this.waiters.add(waiter)
    })
  }

  close(): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(false)
    }
    this.waiters.clear()
    for (const tab of [...this.byId.values()]) this.remove(tab)
  }

  // ─── GateBackend ──────────────────────────────────────────────────────────

  version(): { product: string; userAgent: string } {
    return {
      product: `Chrome/${process.versions.chrome}`,
      userAgent: this.session().getUserAgent()
    }
  }

  tabs(key: string): GateTab[] {
    return [...this.byId.values()].filter((tab) => tab.key === key).map((tab) => this.gateTab(tab))
  }

  async createTab(key: string, url: string): Promise<GateTab> {
    const tab = this.open(key)
    // A debugger command sent before the first load can stall until a navigation happens.
    await tab.view.webContents.loadURL('about:blank').catch(() => {})
    if (url !== 'about:blank') void tab.view.webContents.loadURL(url).catch(() => {})
    if (!this.activeId || !this.byId.has(this.activeId)) this.activate(tab.id)
    return this.gateTab(tab)
  }

  closeTab(key: string, tabId: string): boolean {
    const tab = this.byId.get(tabId)
    if (!tab || tab.key !== key) return false
    this.remove(tab)
    return true
  }

  activateTab(key: string, tabId: string): void {
    if (this.byId.get(tabId)?.key === key) this.activate(tabId)
  }

  agentMayDrive(tabId: string): boolean {
    return this.byId.get(tabId)?.control.kind === 'agent'
  }

  noteCommand(tabId: string, method: string, params: CdpParams): void {
    const tab = this.byId.get(tabId)
    if (!tab || tab.control.kind !== 'agent') return
    const action = actionFor(method, params)
    if (!action || sameAction(tab.control.action, action)) return
    tab.control = { kind: 'agent', action }
    this.changed()
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  /** A new tab with nothing loaded; the caller loads its first page. */
  private open(key: string | null): Tab {
    const view = new WebContentsView({
      webPreferences: {
        session: this.session(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Worker tabs keep running while the panel shows another tab.
        backgroundThrottling: false,
        spellcheck: false
      }
    })
    const tab: Tab = {
      id: `tab-${this.nextId++}`,
      key,
      view,
      control: key ? { kind: 'agent', action: null } : { kind: 'user' },
      injecting: 0,
      pendingAsk: null,
      handoff: null
    }
    this.byId.set(tab.id, tab)
    this.wire(tab)
    this.window?.contentView.addChildView(view)
    if (key) {
      view.webContents.debugger.attach('1.3')
      view.webContents.debugger.on('message', (_event, method, params, sessionId) =>
        this.gate?.tabEvent(tab.id, method, params as CdpParams, sessionId || undefined)
      )
      view.webContents.debugger.on('detach', () => this.gate?.tabRemoved(tab.id))
    }
    this.layout()
    this.changed()
    return tab
  }

  private wire(tab: Tab): void {
    const contents = tab.view.webContents
    const changed = () => this.changed()
    contents.on('did-start-loading', changed)
    contents.on('did-stop-loading', changed)
    contents.on('did-navigate', changed)
    contents.on('did-navigate-in-page', changed)
    contents.on('page-title-updated', changed)
    contents.setWindowOpenHandler(({ url }) => {
      // A pop-up becomes a tab of the same owner; workers' scripts see it through the gate.
      if (safeUrl(url)) {
        const opened = this.open(tab.key)
        void opened.view.webContents.loadURL(url).catch(() => {})
        if (opened.key) this.gate?.tabAdded(this.gateTab(opened))
        this.activate(opened.id)
      }
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event) => {
      if (!safeUrl(event.url)) event.preventDefault()
    })
    contents.on('will-redirect', (event) => {
      if (!safeUrl(event.url)) event.preventDefault()
    })
    // While a worker drives, the page ignores the user's keys and clicks; Take over hands
    // it to them. Input a script sends arrives while `injecting` is up, so it goes through.
    const blockUser = (event: Electron.Event) => {
      if (tab.key && tab.control.kind === 'agent' && tab.injecting === 0) event.preventDefault()
    }
    contents.on('before-input-event', blockUser)
    contents.on('before-mouse-event', blockUser)
    contents.on('destroyed', () => {
      if (this.byId.get(tab.id) === tab) this.forget(tab)
    })
  }

  private gateTab(tab: Tab): GateTab {
    const key = tab.key
    if (!key) throw new Error('The user’s own tabs are not available to workers.')
    return {
      id: tab.id,
      key,
      send: async (method, params, sessionId) => {
        const input = method.startsWith('Input.')
        if (input) tab.injecting += 1
        try {
          return await tab.view.webContents.debugger.sendCommand(method, params ?? {}, sessionId)
        } finally {
          if (input) tab.injecting -= 1
        }
      }
    }
  }

  private userDriven(tabId: string): Tab {
    const tab = this.byId.get(tabId)
    if (!tab) throw new Error('That tab is closed.')
    if (tab.key && tab.control.kind === 'agent')
      throw new Error('A worker is using this tab. Take over first.')
    return tab
  }

  private remove(tab: Tab): void {
    this.forget(tab)
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
  }

  private forget(tab: Tab): void {
    this.byId.delete(tab.id)
    this.settleAsk(tab, 'block')
    this.settleHandoff(tab, 'closed')
    this.gate?.tabRemoved(tab.id)
    this.window?.contentView.removeChildView(tab.view)
    if (tab.key) this.settleWaiters(tab.key)
    if (this.activeId === tab.id) this.activeId = [...this.byId.keys()].at(-1) ?? null
    this.layout()
    this.changed()
  }

  private layout(): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    for (const tab of this.byId.values()) {
      const shown = tab.id === this.activeId && this.bounds !== null
      if (shown && this.bounds) {
        // Re-adding raises the shown tab above the parked ones.
        window.contentView.addChildView(tab.view)
        tab.view.setBounds(roundBounds(this.bounds))
      } else tab.view.setBounds({ x: PARKED_X, y: 0, ...this.size })
    }
  }

  private heldByUser(key: string): boolean {
    return [...this.byId.values()].some((tab) => tab.key === key && tab.control.kind !== 'agent')
  }

  private ask(tabId: string, ask: Omit<BrowserAsk, 'id'>): Promise<AskAnswer> {
    const tab = this.byId.get(tabId)
    if (!tab?.key) return Promise.resolve('block')
    // A newer navigation replaces the one still waiting; the older one is dropped.
    this.settleAsk(tab, 'block')
    return new Promise<AskAnswer>((resolve) => {
      tab.pendingAsk = {
        ask: { ...ask, id: randomUUID().slice(0, 8) },
        resolve,
        timer: setTimeout(() => this.settleAsk(tab, 'block'), ASK_TIMEOUT_MS)
      }
      this.activate(tab.id)
      this.changed()
      if (tab.key) this.needsChanged(tab.key)
    })
  }

  private settleAsk(tab: Tab, answer: AskAnswer): void {
    const pending = tab.pendingAsk
    if (!pending) return
    tab.pendingAsk = null
    clearTimeout(pending.timer)
    pending.resolve(answer)
    this.changed()
    if (tab.key) this.needsChanged(tab.key)
  }

  private settleHandoff(tab: Tab, status: HandoffStatus): void {
    const pending = tab.handoff
    if (!pending) return
    tab.handoff = null
    clearTimeout(pending.timer)
    pending.resolve(status)
    if (tab.key) this.needsChanged(tab.key)
  }

  /** Tells Owlto what, if anything, the worker's tabs still wait on the user for. */
  private needsChanged(key: string): void {
    let need: BrowserNeed | null = null
    for (const tab of this.byId.values()) {
      if (tab.key !== key) continue
      if (tab.pendingAsk)
        need = { tabId: tab.id, kind: tab.pendingAsk.ask.kind, text: tab.pendingAsk.ask.host }
      else if (tab.handoff && tab.control.kind === 'handoff')
        need = { tabId: tab.id, kind: 'handoff', text: tab.control.reason }
    }
    this.deps.needs(key, need)
  }

  private tabFor(webContentsId: number): Tab | null {
    for (const tab of this.byId.values())
      if (!tab.view.webContents.isDestroyed() && tab.view.webContents.id === webContentsId)
        return tab
    return null
  }

  private urlOf(tab: Tab): string {
    const contents = tab.view.webContents
    return contents.isDestroyed() ? '' : contents.getURL()
  }

  private settleWaiters(key: string): void {
    if (this.heldByUser(key)) return
    for (const waiter of [...this.waiters])
      if (waiter.key === key) {
        clearTimeout(waiter.timer)
        this.waiters.delete(waiter)
        waiter.resolve(true)
      }
  }

  private describe(tab: Tab): BrowserTab {
    const contents = tab.view.webContents
    const url = contents.isDestroyed() ? '' : contents.getURL()
    const info = tab.key ? this.deps.owner(tab.key) : null
    const owner: BrowserTabOwner =
      tab.key && info
        ? { kind: 'worker', workerId: tab.key, provider: info.provider, title: info.title }
        : { kind: 'user' }
    return {
      id: tab.id,
      owner,
      url,
      title: contents.isDestroyed() ? '' : contents.getTitle() || url,
      secure: url.startsWith('https:'),
      loading: !contents.isDestroyed() && contents.isLoading(),
      canGoBack: !contents.isDestroyed() && contents.navigationHistory.canGoBack(),
      canGoForward: !contents.isDestroyed() && contents.navigationHistory.canGoForward(),
      control: tab.control,
      ask: tab.pendingAsk?.ask ?? null
    }
  }

  /** Coalesces bursts, such as a load's start, title, and stop, into one update. */
  private changed(): void {
    if (this.changeTimer) return
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null
      this.deps.changed(this.snapshot())
    }, 50)
  }

  private session() {
    const target = this.profile.session()
    if (!this.policyInstalled) {
      this.policy.install(target)
      this.policyInstalled = true
    }
    return target
  }
}

function safeUrl(url: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/** What the user typed in the address field: a URL, a host, or words to search for. */
export function normalizeUrl(input: string): string {
  const text = input.trim()
  if (/^(https?|about|data):/i.test(text)) return text
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(text)) return `http://${text}`
  if (/^[^\s/]+\.[^\s/]{2,}(\/.*)?$/.test(text)) return `https://${text}`
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`
}

function actionFor(method: string, params: CdpParams): BrowserAction | null {
  if (method === 'Page.navigate' && typeof params?.url === 'string') {
    try {
      return { kind: 'open', host: new URL(params.url).host }
    } catch {
      return null
    }
  }
  if (method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed')
    return { kind: 'click' }
  if (method === 'Input.insertText' || method === 'Input.dispatchKeyEvent') return { kind: 'type' }
  return null
}

function sameAction(a: BrowserAction | null, b: BrowserAction): boolean {
  if (!a || a.kind !== b.kind) return false
  return a.kind !== 'open' || (b.kind === 'open' && a.host === b.host)
}

function roundBounds(bounds: NonNullable<BrowserBounds>) {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  }
}
