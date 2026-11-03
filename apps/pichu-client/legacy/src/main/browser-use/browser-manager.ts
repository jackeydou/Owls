import { listWindows } from '@pichu/mac-window-list'
import {
  type BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  type Rectangle,
  shell,
  type WebContents
} from 'electron'
import { normalizeWebTargetUrl } from '../../shared/web-targets.js'

export const DEFAULT_BROWSER_PROFILE_PARTITION = 'persist:pichu-browser-profile-default'

export type BrowserProfile = {
  id: 'default'
  partition: typeof DEFAULT_BROWSER_PROFILE_PARTITION
}

export type BrowserBounds = Rectangle

export type BrowserSessionRuntime = {
  sessionKey: string
  webContents: WebContents
  url: string | null
  title: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  debuggerAttached: boolean
  visibleBounds: BrowserBounds | null
  consoleLogs: unknown[]
  networkEvents: unknown[]
  traces: BrowserUseTraceRecord[]
  lastActivityAt: string
}

export type BrowserUseTraceRecord = {
  action: string
  status: 'ok' | 'error'
  url: string | null
  title: string | null
  startedAt: string
  finishedAt: string
  input: unknown
  error: string | null
  screenshotPngBase64: string | null
  snapshot: unknown
  consoleLogs: unknown[]
}

const DEFAULT_BROWSER_PROFILE: BrowserProfile = {
  id: 'default',
  partition: DEFAULT_BROWSER_PROFILE_PARTITION
}

const managedWebContentsBindings = new WeakSet<WebContents>()

function isBrowserNavigationUrl(value: string): boolean {
  const url = normalizeWebTargetUrl(value)
  return url?.startsWith('http://') === true || url?.startsWith('https://') === true
}

function selectionSnippetForContextMenu(selectionText: string): string {
  const snippet = selectionText.replace(/\s+/g, ' ').trim()
  return snippet.length > 32 ? `${snippet.slice(0, 31)}...` : snippet
}

function statusFromWebContents(
  webContents: WebContents
): Pick<BrowserSessionRuntime, 'url' | 'title' | 'loading' | 'canGoBack' | 'canGoForward'> {
  return {
    url: webContents.getURL() || null,
    title: webContents.getTitle() || null,
    loading: webContents.isLoading(),
    canGoBack: webContents.navigationHistory.canGoBack(),
    canGoForward: webContents.navigationHistory.canGoForward()
  }
}

function intersectionArea(a: BrowserBounds, b: BrowserBounds): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

export class BrowserManager {
  readonly profile = DEFAULT_BROWSER_PROFILE

  private readonly sessionsByKey = new Map<string, BrowserSessionRuntime>()
  private readonly operationQueuesByKey = new Map<string, Promise<unknown>>()
  private getWindow: () => BrowserWindow | null

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow
  }

  setWindowGetter(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow
  }

  registerSessionWebContents(sessionKey: string, webContents: WebContents): BrowserSessionRuntime {
    const existing = this.sessionsByKey.get(sessionKey)
    if (existing?.webContents.id === webContents.id && !webContents.isDestroyed()) {
      this.refreshRuntimeStatus(existing)
      return existing
    }

    const runtime: BrowserSessionRuntime = {
      sessionKey,
      webContents,
      ...statusFromWebContents(webContents),
      debuggerAttached: false,
      visibleBounds: existing?.visibleBounds ?? null,
      consoleLogs: existing?.consoleLogs ?? [],
      networkEvents: existing?.networkEvents ?? [],
      traces: existing?.traces ?? [],
      lastActivityAt: new Date().toISOString()
    }

    this.sessionsByKey.set(sessionKey, runtime)
    this.bindWebContentsEvents(runtime)
    return runtime
  }

  detachSessionWebContents(sessionKey: string, webContentsId: number): void {
    const runtime = this.sessionsByKey.get(sessionKey)
    if (!runtime || runtime.webContents.id !== webContentsId) return
    this.sessionsByKey.delete(sessionKey)
    if (!runtime.webContents.isDestroyed() && runtime.webContents.debugger.isAttached()) {
      runtime.webContents.debugger.detach()
    }
  }

  getSession(sessionKey: string): BrowserSessionRuntime | null {
    const runtime = this.sessionsByKey.get(sessionKey) ?? null
    if (!runtime) return null
    if (runtime.webContents.isDestroyed()) {
      this.sessionsByKey.delete(sessionKey)
      return null
    }
    this.refreshRuntimeStatus(runtime)
    return runtime
  }

  requireSession(sessionKey: string): BrowserSessionRuntime {
    const runtime = this.getSession(sessionKey)
    if (!runtime) {
      throw new Error(
        `Browser session ${sessionKey} is not attached. Open the Browser panel for this session and retry.`
      )
    }
    return runtime
  }

  enqueueForSession<T>(sessionKey: string, action: () => Promise<T>): Promise<T> {
    const previous = this.operationQueuesByKey.get(sessionKey) ?? Promise.resolve()
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        const runtime = this.getSession(sessionKey)
        if (runtime) {
          this.touchSession(sessionKey)
        }
        return action()
      })
    this.operationQueuesByKey.set(
      sessionKey,
      run.catch(() => undefined)
    )
    return run
  }

  getWebContents(sessionKey: string): WebContents {
    return this.requireSession(sessionKey).webContents
  }

  getWebContentsId(sessionKey: string): number | null {
    const runtime = this.getSession(sessionKey)
    return runtime?.webContents.id ?? null
  }

  getSessionKeyForWebContentsId(webContentsId: number): string | null {
    for (const [sessionKey, runtime] of this.sessionsByKey) {
      if (!runtime.webContents.isDestroyed() && runtime.webContents.id === webContentsId) {
        return sessionKey
      }
    }
    return null
  }

  touchSession(sessionKey: string): boolean {
    const runtime = this.getSession(sessionKey)
    if (!runtime) return false
    runtime.lastActivityAt = new Date().toISOString()
    return true
  }

  viewportPointToScreenPoint(
    sessionKey: string,
    point: { x: number; y: number }
  ): { x: number; y: number } | null {
    const bounds = this.getSessionScreenBounds(sessionKey)
    if (!bounds) return null
    return {
      x: bounds.x + point.x,
      y: bounds.y + point.y
    }
  }

  getSessionScreenBounds(sessionKey: string): BrowserBounds | null {
    const runtime = this.getSession(sessionKey)
    const bounds = runtime?.visibleBounds
    const window = this.getWindow()
    if (!runtime || !bounds || !window || window.isDestroyed()) {
      return null
    }
    const contentBounds = window.getContentBounds()
    return {
      x: contentBounds.x + bounds.x,
      y: contentBounds.y + bounds.y,
      width: bounds.width,
      height: bounds.height
    }
  }

  isSessionDisplayed(sessionKey: string): boolean {
    return Boolean(this.getSession(sessionKey)?.visibleBounds)
  }

  getHostNativeWindowId(): number | null {
    if (process.platform !== 'darwin') return null
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return null

    const frameBounds = window.getBounds()
    const contentBounds = window.getContentBounds()

    try {
      const candidates = listWindows({ onScreenOnly: true, includeSystemChrome: true })
        .filter((entry) => entry.ownerPid === process.pid && entry.layer === 0)
        .map((entry) => {
          const bounds = {
            x: entry.bounds.x,
            y: entry.bounds.y,
            width: entry.bounds.width,
            height: entry.bounds.height
          }
          return {
            windowId: entry.windowId,
            score: intersectionArea(bounds, frameBounds) + intersectionArea(bounds, contentBounds)
          }
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.windowId - b.windowId)

      return candidates[0]?.windowId ?? null
    } catch (error) {
      console.warn('[browser-use] failed to resolve host native window id:', error)
      return null
    }
  }

  setSessionBounds(sessionKey: string, bounds: BrowserBounds | null): BrowserSessionRuntime | null {
    const runtime = this.getSession(sessionKey)
    if (!runtime) return null
    runtime.visibleBounds = bounds
    return runtime
  }

  destroySession(sessionKey: string): void {
    const runtime = this.getSession(sessionKey)
    if (
      runtime &&
      !runtime.webContents.isDestroyed() &&
      runtime.webContents.debugger.isAttached()
    ) {
      runtime.webContents.debugger.detach()
    }
    this.sessionsByKey.delete(sessionKey)
    this.operationQueuesByKey.delete(sessionKey)
  }

  destroyAll(): void {
    for (const sessionKey of Array.from(this.sessionsByKey.keys())) {
      this.destroySession(sessionKey)
    }
    this.sessionsByKey.clear()
    this.operationQueuesByKey.clear()
  }

  private bindWebContentsEvents(runtime: BrowserSessionRuntime): void {
    const { webContents } = runtime
    if (managedWebContentsBindings.has(webContents)) return
    managedWebContentsBindings.add(webContents)

    const currentRuntime = (): BrowserSessionRuntime | null => {
      const current = this.sessionsByKey.get(runtime.sessionKey) ?? null
      if (!current) return null
      return current.webContents.id === webContents.id ? current : null
    }

    const refresh = () => {
      const current = currentRuntime()
      if (!current) return
      this.refreshRuntimeStatus(current)
    }

    const setLoading = (loading: boolean) => {
      const current = currentRuntime()
      if (!current) return
      this.refreshRuntimeStatus(current)
      current.loading = loading
    }
    const handleFrameFinish = (_event: Electron.Event, isMainFrame: boolean) => {
      if (isMainFrame) setLoading(false)
    }
    const handleFail = (
      _event: Electron.Event,
      _errorCode: number,
      _errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean
    ) => {
      if (isMainFrame) setLoading(false)
    }

    webContents.on('did-start-loading', () => setLoading(true))
    webContents.on('did-stop-loading', () => setLoading(false))
    webContents.on('did-finish-load', () => setLoading(false))
    webContents.on('did-frame-finish-load', handleFrameFinish)
    webContents.on('dom-ready', () => setLoading(false))
    webContents.on('did-navigate', refresh)
    webContents.on('did-navigate-in-page', refresh)
    webContents.on('page-title-updated', refresh)
    webContents.on('did-fail-load', handleFail)
    webContents.on('context-menu', (event, params) => {
      const current = currentRuntime()
      if (!current) return
      const window = this.getWindow()
      if (!window || window.isDestroyed()) return

      const selectedText = params.selectionText.trim()
      const items: MenuItemConstructorOptions[] = []

      if (params.isEditable) {
        items.push(
          { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
          { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
          { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste }
        )
      } else if (selectedText) {
        if (process.platform === 'darwin') {
          items.push({
            label: `Look Up "${selectionSnippetForContextMenu(selectedText)}"`,
            click: () => webContents.showDefinitionForSelection()
          })
          items.push({ type: 'separator' })
        }
        items.push({
          label: 'Search with Google',
          click: () => {
            void shell.openExternal(
              `https://www.google.com/search?q=${encodeURIComponent(selectedText)}`
            )
          }
        })
        items.push({ type: 'separator' })
        items.push({
          label: 'Copy',
          role: 'copy',
          enabled: params.editFlags.canCopy || selectedText.length > 0
        })
      }

      if (items.length === 0) return

      event.preventDefault()
      const bounds = current.visibleBounds ?? { x: 0, y: 0, width: 0, height: 0 }
      Menu.buildFromTemplate(items).popup({
        window,
        frame: params.frame ?? undefined,
        x: bounds.x + params.x,
        y: bounds.y + params.y,
        sourceType: params.menuSourceType
      })
    })
    webContents.setWindowOpenHandler((details) => {
      const url = normalizeWebTargetUrl(details.url)
      if (url && isBrowserNavigationUrl(url)) {
        void webContents.loadURL(url).catch((error) => {
          console.warn('[browser-use] failed to load popup URL:', url, error)
        })
      }
      return { action: 'deny' }
    })
    webContents.once('destroyed', () => {
      if (currentRuntime()) {
        this.sessionsByKey.delete(runtime.sessionKey)
      }
    })
  }

  private refreshRuntimeStatus(runtime: BrowserSessionRuntime): void {
    Object.assign(runtime, statusFromWebContents(runtime.webContents))
  }
}

let browserManager: BrowserManager | null = null

export function initBrowserManager(getWindow: () => BrowserWindow | null): BrowserManager {
  if (!browserManager) {
    browserManager = new BrowserManager(getWindow)
    return browserManager
  }
  browserManager.setWindowGetter(getWindow)
  return browserManager
}

export function getBrowserManager(): BrowserManager | null {
  return browserManager
}

export function disposeBrowserManager(): void {
  browserManager?.destroyAll()
  browserManager = null
}
