import './process-limits.js'
import { existsSync } from 'node:fs'
import { basename, join, normalize, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  type NativeImage,
  nativeImage,
  net,
  powerSaveBlocker,
  protocol,
  type Session,
  session,
  shell,
  Tray,
  type WebContents
} from 'electron'
import defaultAppIcon from '../../resources/icon.png?asset'
import macMenuBarIcon2x from '../../resources/pichu-menu-barTemplate@2x.png?asset'
import macMenuBarIcon from '../../resources/pichu-menu-barTemplate.png?asset'
import { type AppHotkeyCommand, appHotkeyCommandForInput } from '../shared/app-hotkeys.js'
import { isDebugPackage } from '../shared/build-mode.js'
import type { SessionImportDeeplinkStatus } from '../shared/session-import-deeplink.js'
import { normalizeWebTargetUrl } from '../shared/web-targets.js'
import {
  disposeAgent,
  getAgentStatusSnapshot,
  localRpcAcceptNewSessionPrompt,
  localRpcAcceptSessionPrompt,
  localRpcGetSessionStatus,
  registerPiIpc,
  runDetachedSessionPrompt,
  setPiWebContentsGetter
} from './agent/index.js'
import { registerAppIpc, setAppWindowGetter } from './app-handler.js'
import {
  type AppQuitBlockers,
  type AppQuitDialogLanguage,
  appQuitDialogCopy,
  hasAppQuitBlockers
} from './app-quit-confirmation.js'
import { registerAttachmentIpc } from './attachment-handler.js'
import {
  disposeAutoUpdater,
  initializeAutoUpdater,
  refreshAutoUpdaterChannel
} from './auto-updater.js'
import {
  forceTerminateAllBackgroundTerminals,
  installBackgroundTerminalExitCleanup,
  listBackgroundTerminals
} from './background-terminals.js'
import {
  DEFAULT_BROWSER_PROFILE_PARTITION,
  disposeBrowserManager,
  initBrowserManager
} from './browser-use/browser-manager.js'
import { disposeCron, registerCronIpc, setCronWebContentsGetter } from './cron/cron-handler.js'
import { initCronScheduler, setCronJobRunner } from './cron/cron-scheduler.js'
import { configureDevAppInstanceProfile } from './dev-app-instance.js'
import { registerDiagnosticsIpc } from './diagnostics.js'
import {
  cleanBackgroundTerminalsForRenderer,
  listBackgroundTerminalsForRenderer,
  registerBackgroundTerminalsIpcHandlers,
  terminateBackgroundTerminalForRenderer
} from './ipc-handlers/background-terminals-ipc-handler.js'
import {
  disposeComputerUseDebug,
  registerComputerUseDebugIpc
} from './ipc-handlers/computer-use-debug-handler.js'
import {
  disposeEmbeddedBrowser,
  hideEmbeddedBrowserForRendererReset,
  registerEmbeddedBrowserIpc,
  setEmbeddedBrowserWebContentsGetter
} from './ipc-handlers/embedded-browser-handler.js'
import { registerFeatureGatesIpcHandlers } from './ipc-handlers/feature-gates-ipc-handler.js'
import {
  disposePermissions,
  registerPermissionsIpc,
  setNotificationWindowGetter
} from './ipc-handlers/permissions-handler.js'
import { disposeLocalRpc, startLocalRpc } from './local-rpc/index.js'
import {
  disposeTeam,
  registerTeamIpc,
  setTeamWebContentsGetter
} from './multi-agent/team-handler.js'
import { getDataRoot } from './pichu-paths.js'
import { listAvailablePluginEntries } from './plugins/marketplace-loader.js'
import { disposePluginMcpRuntimeAsync } from './plugins/mcp-runtime.js'
import {
  installPluginDirectoryToLocalDev,
  uploadPluginVersionToLocalDev
} from './plugins/plugin-admin-local-dev.js'
import {
  isAllowedPluginAssetPath,
  pluginAssetPathFromUrl
} from './plugins/plugin-asset-protocol.js'
import { registerPluginIpc } from './plugins/plugin-handler.js'
import {
  autoUpgradeInstalledPlugins,
  installDefaultMarketplacePlugins,
  installPlugin,
  listInstalledPluginsAsync,
  uninstallPlugin
} from './plugins/plugin-registry.js'
import { registerSessionInspectorIpc } from './session-inspector.js'
import { importSessionJsonlFromUrl, registerSessionTransferIpc } from './session-transfer.js'
import { registerSopIpcHandlers } from './sop/ipc-handler.js'
import {
  expireSideSessionsFromIndex,
  getAgentRunStatus,
  getSessionById,
  getSessionIndex,
  getSessionMessages,
  getSettingsForRenderer,
  getUnreadSessionIds,
  initSettingsStore,
  setSettingsUpdatedCallback,
  setUnreadSessionIds
} from './stores/settings-store.js'
import {
  disposeCursorOverlay,
  setCursorOverlayMainWindowGetter
} from './tools/computer-use/cursor-overlay.js'
import { disposeComputerUseHelper } from './tools/computer-use/helper-client.js'
import { initializeDeviceId } from './utils/device-id.js'
import { registerWorkbenchIpc } from './workbench/ipc-handler.js'

function installConsolePipeErrorGuard(): void {
  const handleStreamError = (error: Error): void => {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPIPE') {
      return
    }

    // stdout/stderr are diagnostic channels. Do not let logging crash the app.
  }

  process.stdout.on('error', handleStreamError)
  process.stderr.on('error', handleStreamError)
}

installConsolePipeErrorGuard()

let mainWindow: BrowserWindow | null = null
let sessionInspectorWindow: BrowserWindow | null = null
let menuBarTray: Tray | null = null
let menuBarUnreadSessionIds: string[] = []
type AppCloseIntent = 'none' | 'quit' | 'update'
let appCloseIntent: AppCloseIntent = 'none'
let appCloseLifecycleStarted = false
let appQuitConfirmed = false
let appQuitConfirmationPromise: Promise<boolean> | null = null
let appLifecycleReady = false
let pendingSecondInstanceFocus = false
let rendererReady = false

function isMainWindowWebContents(webContents: WebContents): boolean {
  return Boolean(
    mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id === webContents.id
  )
}

function installEmbeddedBrowserWebviewGuards(webContents: WebContents): void {
  webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isMainWindowWebContents(webContents)) {
      event.preventDefault()
      return
    }

    const src = typeof params.src === 'string' ? params.src : ''
    const normalizedUrl = src === 'about:blank' ? src : normalizeWebTargetUrl(src)
    if (!normalizedUrl) {
      event.preventDefault()
      return
    }
    params.src = normalizedUrl

    webPreferences.preload = join(__dirname, '../preload/browser-annotation.js')
    webPreferences.partition = DEFAULT_BROWSER_PROFILE_PARTITION
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.nodeIntegrationInWorker = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.webviewTag = false
    webPreferences.plugins = false
    // This webview has a user-facing "Open DevTools" action in packaged builds too.
    webPreferences.devTools = true
  })
}
let pendingNavigationPath: string | null = null
let automationKeepAwakeBlockerId: number | null = null
const appHotkeyWebContents = new WeakSet<WebContents>()
const textContextMenuWebContents = new WeakSet<WebContents>()
const APP_NAME = 'Owls'
const CLIENT_PROTOCOL = 'pichu-client'
const LEGACY_CLIENT_PROTOCOL = 'pix-client'
const CLIENT_PROTOCOLS = [CLIENT_PROTOCOL, LEGACY_CLIENT_PROTOCOL] as const
const SCREENSHOT_PROTOCOL = 'pichu-screenshot'
const PLUGIN_ASSET_PROTOCOL = 'pichu-plugin-asset'
const MAIN_WINDOW_DEFAULT_WIDTH = 1280
const MAIN_WINDOW_DEFAULT_HEIGHT = 860
const SESSION_INSPECTOR_WINDOW_WIDTH = 1440
const SESSION_INSPECTOR_WINDOW_HEIGHT = 900
const SESSION_IMPORT_MIN_VISIBLE_MS = 600
const APP_ZOOM_LEVEL_STEP = 0.5
const APP_ZOOM_MIN_LEVEL = -4
const APP_ZOOM_MAX_LEVEL = 4
const MAX_MENU_BAR_UNREAD_COUNT = 99
const MENU_BAR_SECTION_LIMIT = 5
const pendingClientUrls: string[] = []
const pendingOpenSessionIds: string[] = []
const pendingSessionImportUrls: string[] = []
let clientUrlReady = false
let sessionImportDeeplinkStatus: SessionImportDeeplinkStatus = { state: 'idle' }

function isDisconnectedStdioError(error: Error): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EIO' || code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED'
}

function installStdioErrorGuard(): void {
  const handleError = (error: Error): void => {
    if (isDisconnectedStdioError(error)) {
      return
    }
    throw error
  }

  process.stdout.on('error', handleError)
  process.stderr.on('error', handleError)
}

installStdioErrorGuard()

const devAppInstance = configureDevAppInstanceProfile()
// Keep the released Electron profile across the public product rename.
if (app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'Pichu'))
}
function devDisplayName(label: string): string {
  const cleanLabel = label.trim().replace(/^dev(?:elopment)?[\s_-]+/i, '')
  return cleanLabel ? `${APP_NAME} Dev - ${cleanLabel}` : `${APP_NAME} Dev`
}

const APP_DISPLAY_NAME = devAppInstance ? devDisplayName(devAppInstance.label) : APP_NAME

function beginAppClose(intent: Exclude<AppCloseIntent, 'none'>): void {
  appCloseIntent = intent
}

function cancelAppClose(intent: Exclude<AppCloseIntent, 'none'>): void {
  if (appCloseIntent !== intent || appCloseLifecycleStarted) {
    return
  }

  appCloseIntent = 'none'
}

function isAppClosing(): boolean {
  return appCloseIntent !== 'none'
}

function shouldHideMainWindowOnClose(): boolean {
  return process.platform === 'darwin' && !isAppClosing() && getSettingsForRenderer().showInMenuBar
}

function activeAgentWorkCount(): number {
  const status = getAgentStatusSnapshot()
  return new Set([...status.runningSessionIds, ...status.waitingSessionIds]).size
}

function appQuitBlockers(): AppQuitBlockers {
  return {
    runningAgentCount: activeAgentWorkCount(),
    backgroundTerminalCount: listBackgroundTerminals().length
  }
}

function appQuitDialogLanguage(): AppQuitDialogLanguage {
  const language = getSettingsForRenderer().language
  if (language === 'zh-CN') return 'zh-CN'
  if (language === 'auto' && app.getLocale().toLowerCase().startsWith('zh')) return 'zh-CN'
  return 'en'
}

function appQuitDialogIcon(): NativeImage | undefined {
  const icon = nativeImage.createFromPath(defaultAppIcon)
  return icon.isEmpty() ? undefined : icon
}

async function confirmAppQuitIfNeeded(): Promise<boolean> {
  if (appQuitConfirmed) return true
  if (appQuitConfirmationPromise) return appQuitConfirmationPromise
  const blockers = appQuitBlockers()
  if (!hasAppQuitBlockers(blockers)) return true

  appQuitConfirmationPromise = (async () => {
    const copy = appQuitDialogCopy(blockers, appQuitDialogLanguage())
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: [copy.cancelLabel, copy.confirmLabel],
      defaultId: 1,
      cancelId: 0,
      message: copy.message,
      detail: copy.detail,
      icon: appQuitDialogIcon(),
      noLink: true
    }
    try {
      const result =
        mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
          ? await dialog.showMessageBox(mainWindow, options)
          : await dialog.showMessageBox(options)
      appQuitConfirmed = result.response === 1
      return appQuitConfirmed
    } catch (error) {
      console.warn('[app] Failed to show quit confirmation dialog', error)
      appQuitConfirmed = false
      return false
    }
  })()
  try {
    return await appQuitConfirmationPromise
  } finally {
    appQuitConfirmationPromise = null
  }
}

function startConfirmedAppQuit(): void {
  appQuitConfirmed = true
  beginAppClose('quit')
  app.quit()
}

// Electron 41 selects the macOS Keychain / Linux secret-store identity before
// ready. Keep that identity stable; applyAppBranding sets the visible name later.
app.setName(APP_DISPLAY_NAME.replace(/^Owls/, 'Pichu'))
process.title = APP_DISPLAY_NAME
installBackgroundTerminalExitCleanup()

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
  process.exit(0)
}

console.log('In app node version: ', process.versions.node)

function isConsoleWriteEio(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as NodeJS.ErrnoException).code
  if (code !== 'EIO') return false
  return error.stack?.includes('node:internal/console') ?? false
}

function logMainProcessError(label: string, error: unknown): void {
  if (isConsoleWriteEio(error)) {
    return
  }
  try {
    console.error(label, error)
  } catch {
    // Avoid Electron's default uncaught-exception dialog when stdout/stderr is already broken.
  }
}

function normalizeUnhandledRejectionReason(reason: unknown): unknown {
  return reason === undefined ? new Error('Promise rejected without a reason.') : reason
}

let fatalMainProcessShutdownScheduled = false

function scheduleFatalMainProcessShutdown(label: string, error: unknown): void {
  if (isConsoleWriteEio(error)) {
    return
  }
  logMainProcessError(label, error)
  if (isAppClosing()) {
    return
  }
  if (fatalMainProcessShutdownScheduled) {
    return
  }

  fatalMainProcessShutdownScheduled = true
  beginAppClose('quit')
  setImmediate(() => {
    app.relaunch()
    app.exit(1)
  })
}

process.on('uncaughtException', (error) => {
  scheduleFatalMainProcessShutdown('[main] uncaught exception', error)
})

process.on('unhandledRejection', (reason) => {
  const error = normalizeUnhandledRejectionReason(reason)
  if (is.dev) {
    logMainProcessError('[main] unhandled rejection', error)
    return
  }
  scheduleFatalMainProcessShutdown('[main] unhandled rejection', error)
})

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCREENSHOT_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  },
  {
    scheme: PLUGIN_ASSET_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
])

function screenshotRoot(): string {
  return normalize(join(getDataRoot(), 'computer-use', 'screenshots'))
}

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = normalize(parent)
  const normalizedChild = normalize(child)
  return (
    normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${sep}`)
  )
}

function registerScreenshotProtocol(): void {
  protocol.handle(SCREENSHOT_PROTOCOL, (request) => {
    const url = new URL(request.url)
    const requestedPath = normalize(decodeURIComponent(url.pathname.slice(1)))
    const root = screenshotRoot()
    if (!isPathInside(root, requestedPath) || !existsSync(requestedPath)) {
      return new Response('Screenshot not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(requestedPath).toString())
  })
}

function registerPluginAssetProtocol(): void {
  protocol.handle(PLUGIN_ASSET_PROTOCOL, async (request) => {
    const requestedPath = pluginAssetPathFromUrl(request.url)
    if (!(await isAllowedPluginAssetPath(requestedPath)) || !existsSync(requestedPath)) {
      return new Response('Plugin asset not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(requestedPath).toString())
  })
}

type PermissionGuardOptions = {
  allowEmbeddedBrowserClipboardWrite?: boolean
}

function permissionRequestingUrl(
  details:
    | Electron.PermissionRequest
    | Electron.FilesystemPermissionRequest
    | Electron.MediaAccessPermissionRequest
    | Electron.OpenExternalPermissionRequest
    | undefined
): string | undefined {
  if (!details || typeof details !== 'object') return undefined
  return 'requestingUrl' in details ? details.requestingUrl : undefined
}

function isClipboardWritePermission(permission: string): boolean {
  return permission === 'clipboard-sanitized-write'
}

function originFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

function canAllowEmbeddedBrowserClipboardWrite(params: {
  permission: string
  options: PermissionGuardOptions
}): boolean {
  if (!params.options.allowEmbeddedBrowserClipboardWrite) return false
  return isClipboardWritePermission(params.permission)
}

function installPermissionRequestGuard(
  targetSession: Session,
  options: PermissionGuardOptions = {}
): void {
  const requestingOriginForWebContents = (webContents: WebContents): string | undefined => {
    try {
      return new URL(webContents.getURL()).origin
    } catch {
      return undefined
    }
  }

  const logDeniedPermissionRequest = (permission: string, requestingOrigin?: string): void => {
    console.warn('[permissions] denied renderer permission request', {
      permission,
      requestingOrigin
    })
  }

  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = permissionRequestingUrl(details)
    const requestingOrigin =
      originFromUrl(requestingUrl) ?? requestingOriginForWebContents(webContents)
    if (
      canAllowEmbeddedBrowserClipboardWrite({
        permission,
        options
      })
    ) {
      callback(true)
      return
    }

    logDeniedPermissionRequest(permission, requestingOrigin)
    callback(false)
  })
  targetSession.setPermissionCheckHandler((_webContents, permission) => {
    if (
      canAllowEmbeddedBrowserClipboardWrite({
        permission,
        options
      })
    ) {
      return true
    }
    return false
  })
}

function installAppPermissionRequestGuards(): void {
  installPermissionRequestGuard(session.defaultSession)
  const embeddedBrowserSession = session.fromPartition(DEFAULT_BROWSER_PROFILE_PARTITION)
  installPermissionRequestGuard(embeddedBrowserSession, {
    allowEmbeddedBrowserClipboardWrite: true
  })
}

function isDebugSurfaceEnabled(): boolean {
  return isDebugPackage || app.getVersion().includes('-beta')
}

async function installDefaultPluginsOnStartup(): Promise<void> {
  const result = await installDefaultMarketplacePlugins()
  const upgradeResult = await autoUpgradeInstalledPlugins()
  console.info('[plugins] startup plugin sync completed', {
    installed: result.installed.map((plugin) => plugin.id),
    skipped: result.skipped,
    failed: result.failed,
    upgraded: upgradeResult.upgraded.map((plugin) => plugin.id),
    upgradeSkipped: upgradeResult.skipped,
    upgradeFailed: upgradeResult.failed
  })
}

function registerClientProtocol(): void {
  for (const clientProtocol of CLIENT_PROTOCOLS) {
    if (process.defaultApp && process.argv[1]) {
      app.setAsDefaultProtocolClient(clientProtocol, process.execPath, [resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient(clientProtocol)
    }
  }
}

function isClientProtocol(protocolName: string): boolean {
  return CLIENT_PROTOCOLS.some((clientProtocol) => protocolName === `${clientProtocol}:`)
}

function isClientUrlArg(value: string): boolean {
  return CLIENT_PROTOCOLS.some((clientProtocol) => value.startsWith(`${clientProtocol}://`))
}

function summarizeClientUrl(value: string): Record<string, unknown> {
  try {
    const url = new URL(value)
    const queryValueLengths = Object.fromEntries(
      [...url.searchParams.entries()]
        .map(([key, queryValue]) => [key, queryValue.length] as const)
        .sort(([left], [right]) => left.localeCompare(right))
    )

    return {
      length: value.length,
      protocol: url.protocol,
      hostname: url.hostname,
      pathname: url.pathname,
      queryKeys: Object.keys(queryValueLengths),
      queryValueLengths,
      flow: url.searchParams.get('flow') ?? null
    }
  } catch {
    return {
      length: value.length,
      parseError: true
    }
  }
}

type ClientSessionUrl = { type: 'open'; sessionId: string } | { type: 'import'; url: string }

function buildOpenSessionPayload(sessionId: string): {
  sessionId: string
  sessionKind?: 'main' | 'side'
  parentSessionId?: string | null
  cwd?: string
} {
  const entry = getSessionById(sessionId)
  return {
    sessionId,
    sessionKind: entry?.sessionKind,
    parentSessionId: entry?.parentSessionId ?? null,
    cwd: entry?.cwd
  }
}

function parseClientSessionUrl(urlString: string): ClientSessionUrl | null {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return null
  }

  if (!isClientProtocol(url.protocol) || url.hostname !== 'session') {
    return null
  }

  if (url.pathname === '/import') {
    const importUrl = url.searchParams.get('url')?.trim()
    return importUrl ? { type: 'import', url: importUrl } : null
  }

  const sessionId = decodeURIComponent(url.pathname.replace(/^\/+/, '')).trim()
  return sessionId ? { type: 'open', sessionId } : null
}

function openSessionFromClientUrl(sessionId: string): void {
  showMainWindow()
  const webContents = mainWindow?.webContents
  if (!webContents || webContents.isLoadingMainFrame() || !rendererReady) {
    pendingOpenSessionIds.push(sessionId)
    return
  }
  webContents.send('app:open-session', buildOpenSessionPayload(sessionId))
}

function flushPendingOpenSessions(): void {
  const sessionIds = pendingOpenSessionIds.splice(0)
  for (const sessionId of sessionIds) {
    openSessionFromClientUrl(sessionId)
  }
}

function mainRendererCanReceiveEvents(): boolean {
  const webContents = mainWindow?.webContents
  return Boolean(
    webContents && !webContents.isDestroyed() && !webContents.isLoadingMainFrame() && rendererReady
  )
}

function emitSessionImportDeeplinkStatus(status: SessionImportDeeplinkStatus): void {
  sessionImportDeeplinkStatus = status
  const webContents = mainWindow?.webContents
  if (!mainRendererCanReceiveEvents() || !webContents) {
    return
  }
  webContents.send('agent:session-import-deeplink-status', status)
}

function waitForSessionImportMinimumVisibleTime(startedAt: number): Promise<void> {
  const remainingMs = SESSION_IMPORT_MIN_VISIBLE_MS - (Date.now() - startedAt)
  if (remainingMs <= 0) {
    return Promise.resolve()
  }
  return new Promise((resolveWait) => setTimeout(resolveWait, remainingMs))
}

function runSessionImportFromClientUrl(url: string): void {
  const startedAt = Date.now()
  void importSessionJsonlFromUrl(url)
    .then((result) => {
      return waitForSessionImportMinimumVisibleTime(startedAt).then(() => result)
    })
    .then((result) => {
      emitSessionImportDeeplinkStatus({
        state: 'completed',
        sessionId: result.status === 'duplicate' ? result.existingSessionId : result.sessionId,
        title: result.title,
        messageCount: result.messageCount
      })
      openSessionFromClientUrl(
        result.status === 'duplicate' ? result.existingSessionId : result.sessionId
      )
    })
    .catch(async (error) => {
      await waitForSessionImportMinimumVisibleTime(startedAt)
      console.error('[client-url] Failed to import shared session:', error)
      emitSessionImportDeeplinkStatus({
        state: 'failed',
        message: error instanceof Error ? error.message : String(error)
      })
    })
}

function importSessionFromClientUrl(url: string): void {
  showMainWindow()
  emitSessionImportDeeplinkStatus({ state: 'importing' })
  if (!mainRendererCanReceiveEvents()) {
    pendingSessionImportUrls.push(url)
    return
  }
  runSessionImportFromClientUrl(url)
}

function flushPendingSessionImports(): void {
  const urls = pendingSessionImportUrls.splice(0)
  for (const url of urls) {
    importSessionFromClientUrl(url)
  }
}

function handleClientUrl(urlString: string): void {
  console.info('[client-url] Handling client URL', summarizeClientUrl(urlString))

  if (!clientUrlReady) {
    console.info('[client-url] Queued client URL until the app is ready')
    pendingClientUrls.push(urlString)
    return
  }

  const sessionUrl = parseClientSessionUrl(urlString)
  if (sessionUrl?.type === 'open') {
    console.info('[client-url] Client URL is a session deeplink', {
      sessionIdLength: sessionUrl.sessionId.length
    })
    openSessionFromClientUrl(sessionUrl.sessionId)
    return
  }
  if (sessionUrl?.type === 'import') {
    console.info('[client-url] Client URL is a shared session import deeplink', {
      importUrlLength: sessionUrl.url.length
    })
    importSessionFromClientUrl(sessionUrl.url)
    return
  }

  console.warn(
    '[client-url] Client URL did not match supported deeplink shape',
    summarizeClientUrl(urlString)
  )
}

function handleClientArgv(argv: string[]): void {
  for (const arg of argv) {
    if (isClientUrlArg(arg)) {
      console.info('[client-url] Found client URL in argv', summarizeClientUrl(arg))
      handleClientUrl(arg)
    }
  }
}

function flushPendingClientUrls(): void {
  clientUrlReady = true
  const urls = pendingClientUrls.splice(0)
  for (const url of urls) {
    handleClientUrl(url)
  }
  flushPendingOpenSessions()
}

function openAllowedExternalUrl(value: string): void {
  const url = new URL(value)
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return
  void shell.openExternal(url.toString())
}

function applyAppBranding(): void {
  app.setName(APP_DISPLAY_NAME)
  app.setAboutPanelOptions({ applicationName: APP_DISPLAY_NAME })

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(defaultAppIcon))
    refreshDockUnreadBadge()
  }
}

function handleSettingsUpdated(): void {
  applyAppBranding()
  applyAutomationKeepAwake()
  refreshAutoUpdaterChannel()
  updateMenuBarTray()
}

function applyAutomationKeepAwake(): void {
  const enabled = getSettingsForRenderer().automationKeepAwake
  if (enabled && automationKeepAwakeBlockerId === null) {
    automationKeepAwakeBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    return
  }

  if (!enabled && automationKeepAwakeBlockerId !== null) {
    if (powerSaveBlocker.isStarted(automationKeepAwakeBlockerId)) {
      powerSaveBlocker.stop(automationKeepAwakeBlockerId)
    }
    automationKeepAwakeBlockerId = null
  }
}

function loadRendererWindow(window: BrowserWindow, sessionInspectorOnly = false): void {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (sessionInspectorOnly) {
      url.searchParams.set('sessionInspectorWindow', '1')
    }
    window.loadURL(url.toString())
    return
  }

  if (sessionInspectorOnly) {
    window.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { sessionInspectorWindow: '1' }
    })
    return
  }

  window.loadFile(join(__dirname, '../renderer/index.html'))
}

function bindDevRendererDiagnostics(window: BrowserWindow): void {
  if (!is.dev) return

  window.webContents.on('console-message', (details) => {
    if (details.level !== 'warning' && details.level !== 'error') return
    console.warn('[renderer]', {
      level: details.level,
      message: details.message,
      sourceId: details.sourceId,
      line: details.lineNumber
    })
  })
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      console.warn('[renderer] did-fail-load', {
        errorCode,
        errorDescription,
        validatedURL
      })
    }
  )
  window.webContents.on('render-process-gone', (_event, details) => {
    console.warn('[renderer] render-process-gone', details)
    if (!isAppClosing() && !window.isDestroyed()) {
      window.reload()
    }
  })
}

function createWindow(): void {
  if (isAppClosing()) {
    return
  }

  rendererReady = false
  mainWindow = new BrowserWindow({
    title: APP_DISPLAY_NAME,
    width: MAIN_WINDOW_DEFAULT_WIDTH,
    height: MAIN_WINDOW_DEFAULT_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    icon: defaultAppIcon,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 18, y: 14 }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })
  const sendFullScreenChange = (): void => {
    const window = mainWindow
    if (!window || window.isDestroyed()) return
    window.webContents.send('app:full-screen-change', {
      isFullScreen: window.isFullScreen()
    })
  }
  mainWindow.on('enter-full-screen', sendFullScreenChange)
  mainWindow.on('leave-full-screen', sendFullScreenChange)

  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      rendererReady = false
      hideEmbeddedBrowserForRendererReset()
    }
  })
  mainWindow.webContents.on('render-process-gone', () => {
    rendererReady = false
    hideEmbeddedBrowserForRendererReset()
  })
  bindDevRendererDiagnostics(mainWindow)
  installEmbeddedBrowserWebviewGuards(mainWindow.webContents)

  mainWindow.on('close', (event) => {
    if (!shouldHideMainWindowOnClose()) {
      if (process.platform !== 'darwin' && !isAppClosing() && !appQuitConfirmed) {
        const blockers = appQuitBlockers()
        if (hasAppQuitBlockers(blockers)) {
          event.preventDefault()
          void confirmAppQuitIfNeeded().then((confirmed) => {
            if (confirmed) {
              startConfirmedAppQuit()
            } else {
              cancelAppClose('quit')
            }
          })
        }
      }
      return
    }

    event.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  installAppHotkeys(mainWindow.webContents)
  installTextContextMenu(mainWindow.webContents)

  loadRendererWindow(mainWindow)

  setPiWebContentsGetter(() => mainWindow?.webContents ?? null)
  setTeamWebContentsGetter(() => mainWindow?.webContents ?? null)
  setCronWebContentsGetter(() => mainWindow?.webContents ?? null)
  setEmbeddedBrowserWebContentsGetter(() => mainWindow?.webContents ?? null)
  initBrowserManager(() => mainWindow)
  setAppWindowGetter(() => mainWindow)
  setNotificationWindowGetter(() => mainWindow)
  setCursorOverlayMainWindowGetter(() => mainWindow)
}

function createSessionInspectorWindow(): void {
  if (sessionInspectorWindow && !sessionInspectorWindow.isDestroyed()) {
    sessionInspectorWindow.show()
    sessionInspectorWindow.focus()
    return
  }

  sessionInspectorWindow = new BrowserWindow({
    title: 'Session Inspector',
    width: SESSION_INSPECTOR_WINDOW_WIDTH,
    height: SESSION_INSPECTOR_WINDOW_HEIGHT,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    icon: defaultAppIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: false
    }
  })

  sessionInspectorWindow.on('ready-to-show', () => {
    sessionInspectorWindow?.show()
  })

  sessionInspectorWindow.on('closed', () => {
    sessionInspectorWindow = null
  })

  sessionInspectorWindow.webContents.setWindowOpenHandler((details) => {
    try {
      openAllowedExternalUrl(details.url)
    } catch {
      // Ignore malformed URLs from the isolated debug window.
    }
    return { action: 'deny' }
  })

  loadRendererWindow(sessionInspectorWindow, true)
}

function showMainWindow(): void {
  if (isAppClosing()) {
    return
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
  }
  if (mainWindow?.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow?.show()
  mainWindow?.focus()
}

function focusPrimaryInstance(): void {
  if (!appLifecycleReady) {
    pendingSecondInstanceFocus = true
    return
  }
  showMainWindow()
}

function handleSecondInstance(argv: string[]): void {
  handleClientArgv(argv)
  focusPrimaryInstance()
}

function navigateApp(path: string): void {
  showMainWindow()
  const webContents = mainWindow?.webContents
  if (!webContents || webContents.isLoadingMainFrame() || !rendererReady) {
    pendingNavigationPath = path
    return
  }
  webContents.send('app:navigate', { path })
}

function createMenuBarTrayImage(): NativeImage {
  const trayImage = nativeImage.createEmpty()
  trayImage.addRepresentation({
    scaleFactor: 1,
    dataURL: nativeImage.createFromPath(macMenuBarIcon).toDataURL()
  })
  trayImage.addRepresentation({
    scaleFactor: 2,
    dataURL: nativeImage.createFromPath(macMenuBarIcon2x).toDataURL()
  })
  trayImage.setTemplateImage(true)
  return trayImage
}

function menuBarUnreadTitle(count: number): string {
  if (count <= 0) return ''
  if (count > MAX_MENU_BAR_UNREAD_COUNT) return `${MAX_MENU_BAR_UNREAD_COUNT}+`
  return String(count)
}

function refreshMenuBarTrayUnreadTitle(): void {
  if (process.platform !== 'darwin' || !menuBarTray) return
  menuBarTray.setTitle(menuBarUnreadTitle(menuBarUnreadSessionIds.length), {
    fontType: 'monospacedDigit'
  })
}

function refreshDockUnreadBadge(): void {
  if (process.platform !== 'darwin') return
  const count = menuBarUnreadSessionIds.length
  app.setBadgeCount(count)
}

function loadPersistedUnreadSessionIds(): void {
  menuBarUnreadSessionIds = setUnreadSessionIds(
    getUnreadSessionIds().filter((sessionId) => getSessionById(sessionId)?.sessionKind === 'main')
  )
  refreshMenuBarTrayUnreadTitle()
  refreshDockUnreadBadge()
}

function updateMenuBarUnreadSessionIds(value: unknown): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('Menu bar unread session ids must be a string array.')
  }

  menuBarUnreadSessionIds = setUnreadSessionIds(value)
  refreshMenuBarTrayUnreadTitle()
  refreshDockUnreadBadge()
}

function menuBarSessionSublabel(cwd: string): string {
  const label = basename(cwd.trim())
  return label || cwd
}

function showSessionFromMenuBar(sessionId: string): void {
  openSessionFromClientUrl(sessionId)
}

function menuBarSessionItem(
  entry: ReturnType<typeof getSessionIndex>[number]
): MenuItemConstructorOptions {
  return {
    label: entry.title || 'New chat',
    sublabel: menuBarSessionSublabel(entry.cwd),
    click: () => showSessionFromMenuBar(entry.sessionId)
  }
}

function appendMenuBarSessionSection(params: {
  items: MenuItemConstructorOptions[]
  label: string
  entries: ReturnType<typeof getSessionIndex>
  showMore?: boolean
}): void {
  if (params.entries.length === 0) return

  params.items.push({ type: 'header', label: params.label })
  const visibleEntries = params.entries.slice(0, MENU_BAR_SECTION_LIMIT)
  params.items.push(...visibleEntries.map(menuBarSessionItem))
  const hiddenEntries = params.entries.slice(MENU_BAR_SECTION_LIMIT)
  if (params.showMore && hiddenEntries.length > 0) {
    params.items.push({
      label: 'More',
      submenu: hiddenEntries.map(menuBarSessionItem)
    })
  }
  params.items.push({ type: 'separator' })
}

function buildMenuBarTrayMenu(): Menu {
  const sessions = getSessionIndex()
  const sessionById = new Map(sessions.map((session) => [session.sessionId, session]))
  const status = getAgentStatusSnapshot()
  const runningSessionIds = new Set(
    status.runningSessionIds.filter((sessionId) => {
      const runId = status.activeRunIdsBySession[sessionId]
      return Boolean(runId && getAgentRunStatus(runId) === 'running')
    })
  )
  const unreadSessionIdSet = new Set(menuBarUnreadSessionIds)
  const sortedByUpdated = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const sortedPinned = sessions
    .filter((session) => session.pinned)
    .sort((a, b) => (b.pinnedOrder ?? 0) - (a.pinnedOrder ?? 0))
  const items: MenuItemConstructorOptions[] = []

  appendMenuBarSessionSection({
    items,
    label: 'Running',
    entries: sortedByUpdated.filter((session) => runningSessionIds.has(session.sessionId))
  })
  appendMenuBarSessionSection({
    items,
    label: 'Unread',
    entries: menuBarUnreadSessionIds.flatMap((sessionId) => sessionById.get(sessionId) ?? [])
  })
  appendMenuBarSessionSection({
    items,
    label: 'Pinned',
    entries: sortedPinned
  })
  appendMenuBarSessionSection({
    items,
    label: 'Recent',
    entries: sortedByUpdated.filter((session) => !unreadSessionIdSet.has(session.sessionId)),
    showMore: true
  })

  items.push(
    {
      label: 'New Chat',
      click: () => dispatchAppHotkeyCommand('new-session', 'tray_menu')
    },
    { type: 'separator' },
    {
      label: `Open ${APP_DISPLAY_NAME}`,
      click: () => {
        showMainWindow()
      }
    },
    { type: 'separator' },
    { label: `Quit ${APP_DISPLAY_NAME}`, role: 'quit' }
  )

  return Menu.buildFromTemplate(items)
}

function showMenuBarTrayMenu(source: 'tray_click' | 'tray_context_menu'): void {
  if (!menuBarTray) return
  void source
  menuBarTray.popUpContextMenu(buildMenuBarTrayMenu())
}

function updateMenuBarTray(): void {
  if (process.platform !== 'darwin') return

  const { showInMenuBar } = getSettingsForRenderer()
  if (!showInMenuBar) {
    menuBarTray?.destroy()
    menuBarTray = null
    return
  }

  if (menuBarTray) return

  menuBarTray = new Tray(createMenuBarTrayImage())
  menuBarTray.setToolTip(APP_DISPLAY_NAME)
  refreshMenuBarTrayUnreadTitle()
  menuBarTray.on('click', () => showMenuBarTrayMenu('tray_click'))
  menuBarTray.on('right-click', () => showMenuBarTrayMenu('tray_context_menu'))
}

function dispatchAppHotkeyCommand(
  command: AppHotkeyCommand,
  source: 'hotkey' | 'app_menu' | 'tray_menu'
): void {
  void source

  if (command === 'hide-app') {
    if (!isAppClosing()) {
      app.hide()
    }
    return
  }

  if (command === 'open-settings') {
    navigateApp('/settings')
    return
  }

  showMainWindow()
  const webContents = mainWindow?.webContents
  if (!webContents || webContents.isLoadingMainFrame()) {
    return
  }
  webContents.send('app:hotkey', { command })
}

type AppZoomCommand = 'reset' | 'in' | 'out'

function appZoomCommandForInput(input: Electron.Input): AppZoomCommand | null {
  const modifiers = new Set(input.modifiers ?? [])
  const hasShift = input.shift === true || modifiers.has('shift')
  const hasAlt = input.alt === true || modifiers.has('alt') || modifiers.has('option')
  const hasMeta =
    input.meta === true || modifiers.has('meta') || modifiers.has('command') || modifiers.has('cmd')
  const hasControl = input.control === true || modifiers.has('control') || modifiers.has('ctrl')
  const usesZoomModifier =
    process.platform === 'darwin' ? hasMeta && !hasControl : hasControl && !hasMeta

  if (!usesZoomModifier || hasAlt) return null

  const key = input.key.toLowerCase()
  if (!hasShift && (input.code === 'Digit0' || input.code === 'Numpad0' || key === '0')) {
    return 'reset'
  }
  if (input.code === 'Equal' || input.code === 'NumpadAdd' || key === '+' || key === '=') {
    return 'in'
  }
  if (!hasShift && (input.code === 'Minus' || input.code === 'NumpadSubtract' || key === '-')) {
    return 'out'
  }
  return null
}

function dispatchAppZoomCommand(command: AppZoomCommand): void {
  const window = BrowserWindow.getFocusedWindow() ?? mainWindow
  const webContents = window?.webContents
  if (!webContents || webContents.isDestroyed()) {
    return
  }

  if (command === 'reset') {
    webContents.setZoomLevel(0)
  } else {
    const direction = command === 'in' ? 1 : -1
    const nextZoomLevel = Math.min(
      APP_ZOOM_MAX_LEVEL,
      Math.max(APP_ZOOM_MIN_LEVEL, webContents.getZoomLevel() + direction * APP_ZOOM_LEVEL_STEP)
    )
    webContents.setZoomLevel(nextZoomLevel)
  }
}

function installAppHotkeys(webContents: WebContents): void {
  if (appHotkeyWebContents.has(webContents)) return
  appHotkeyWebContents.add(webContents)

  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return

    if (BrowserWindow.getFocusedWindow() !== mainWindow) {
      return
    }

    const zoomCommand = appZoomCommandForInput(input)
    if (zoomCommand) {
      event.preventDefault()
      dispatchAppZoomCommand(zoomCommand)
      return
    }

    const command = appHotkeyCommandForInput(
      input,
      process.platform === 'darwin' ? 'darwin' : 'other'
    )
    if (!command) {
      return
    }

    event.preventDefault()
    dispatchAppHotkeyCommand(command, 'hotkey')
  })
}

function installTextContextMenu(webContents: WebContents): void {
  if (textContextMenuWebContents.has(webContents)) return
  textContextMenuWebContents.add(webContents)

  webContents.on('context-menu', (_event, params) => {
    if (params.isEditable) {
      const menu = Menu.buildFromTemplate([
        { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste }
      ])

      menu.popup({
        window: BrowserWindow.fromWebContents(webContents) ?? undefined,
        frame: params.frame ?? undefined,
        x: params.x,
        y: params.y,
        sourceType: params.menuSourceType
      })
      return
    }

    const selectedText = params.selectionText.trim()
    if (selectedText.length === 0) {
      return
    }

    const menuItems: MenuItemConstructorOptions[] = []
    if (process.platform === 'darwin') {
      menuItems.push({
        label: `Look Up "${selectionSnippetForContextMenu(selectedText)}"`,
        click: () => webContents.showDefinitionForSelection()
      })
      menuItems.push({ type: 'separator' })
    }
    menuItems.push({
      label: 'Search with Google',
      click: () => {
        void shell.openExternal(
          `https://www.google.com/search?q=${encodeURIComponent(selectedText)}`
        )
      }
    })
    menuItems.push({ type: 'separator' })
    menuItems.push({
      label: 'Copy',
      role: 'copy',
      enabled: params.editFlags.canCopy || selectedText.length > 0
    })

    Menu.buildFromTemplate(menuItems).popup({
      window: BrowserWindow.fromWebContents(webContents) ?? undefined,
      frame: params.frame ?? undefined,
      x: params.x,
      y: params.y,
      sourceType: params.menuSourceType
    })
  })
}

function selectionSnippetForContextMenu(selectionText: string): string {
  const normalizedSelection = selectionText.replace(/\s+/g, ' ').trim()
  const maxSnippetLength = 32
  const characters = Array.from(normalizedSelection)
  if (characters.length <= maxSnippetLength) {
    return normalizedSelection
  }

  return `${characters.slice(0, maxSnippetLength).join('')}...`
}

function installApplicationMenu(): void {
  const appMenu: MenuItemConstructorOptions[] =
    process.platform === 'darwin'
      ? [
          {
            label: APP_DISPLAY_NAME,
            submenu: [
              { label: `About ${APP_DISPLAY_NAME}`, role: 'about' },
              { type: 'separator' },
              {
                label: 'Settings...',
                accelerator: 'Command+,',
                click: () => dispatchAppHotkeyCommand('open-settings', 'app_menu')
              },
              { type: 'separator' },
              { label: 'Services', role: 'services', submenu: [] },
              { type: 'separator' },
              { label: `Hide ${APP_DISPLAY_NAME}`, role: 'hide' },
              { label: 'Hide Others', role: 'hideOthers' },
              { label: 'Show All', role: 'unhide' },
              { label: `Quit ${APP_DISPLAY_NAME}`, role: 'quit' }
            ]
          },
          {
            label: 'File',
            submenu: [
              {
                label: 'New Chat',
                accelerator: 'Command+N',
                click: () => dispatchAppHotkeyCommand('new-session', 'app_menu')
              },
              {
                label: 'Search Chats',
                accelerator: 'Command+G',
                click: () => dispatchAppHotkeyCommand('open-search', 'app_menu')
              },
              { type: 'separator' },
              { label: 'Close Window', role: 'close' }
            ]
          },
          {
            label: 'Edit',
            submenu: [
              { role: 'undo' },
              { role: 'redo' },
              { type: 'separator' },
              { role: 'cut' },
              { role: 'copy' },
              { role: 'paste' },
              { role: 'selectAll' }
            ]
          },
          {
            label: 'View',
            submenu: [
              {
                label: 'Toggle Sidebar',
                accelerator: 'Command+B',
                click: () => dispatchAppHotkeyCommand('toggle-sidebar', 'app_menu')
              },
              {
                label: 'Open Browser Tab',
                accelerator: 'Command+T',
                click: () => dispatchAppHotkeyCommand('open-browser-tab', 'app_menu')
              },
              {
                label: 'Open Files Tab',
                accelerator: 'Command+P',
                click: () => dispatchAppHotkeyCommand('open-files-tab', 'app_menu')
              },
              {
                label: 'Open Side Chat',
                accelerator: 'Command+Alt+S',
                click: () => dispatchAppHotkeyCommand('open-side-chat-tab', 'app_menu')
              },
              { type: 'separator' },
              {
                label: 'Previous Chat',
                accelerator: 'Command+[',
                click: () => dispatchAppHotkeyCommand('previous-session', 'app_menu')
              },
              {
                label: 'Next Chat',
                accelerator: 'Command+]',
                click: () => dispatchAppHotkeyCommand('next-session', 'app_menu')
              },
              { type: 'separator' },
              { role: 'reload' },
              { role: 'forceReload' },
              { role: 'toggleDevTools' },
              { type: 'separator' },
              {
                label: 'Actual Size',
                accelerator: 'Command+0',
                click: () => dispatchAppZoomCommand('reset')
              },
              {
                label: 'Zoom In',
                accelerator: 'Command+=',
                click: () => dispatchAppZoomCommand('in')
              },
              {
                label: 'Zoom Out',
                accelerator: 'Command+-',
                click: () => dispatchAppZoomCommand('out')
              },
              { type: 'separator' },
              { role: 'togglefullscreen' }
            ]
          },
          { label: 'Window', role: 'windowMenu' },
          { label: 'Help', role: 'help', submenu: [] }
        ]
      : [
          {
            label: 'File',
            submenu: [
              {
                label: 'Settings...',
                accelerator: 'CommandOrControl+,',
                click: () => dispatchAppHotkeyCommand('open-settings', 'app_menu')
              },
              {
                label: 'New Chat',
                accelerator: 'CommandOrControl+N',
                click: () => dispatchAppHotkeyCommand('new-session', 'app_menu')
              },
              {
                label: 'Search Chats',
                accelerator: 'CommandOrControl+G',
                click: () => dispatchAppHotkeyCommand('open-search', 'app_menu')
              },
              { type: 'separator' },
              { role: 'quit' }
            ]
          },
          { label: 'Edit', role: 'editMenu' },
          {
            label: 'View',
            submenu: [
              {
                label: 'Toggle Sidebar',
                accelerator: 'CommandOrControl+B',
                click: () => dispatchAppHotkeyCommand('toggle-sidebar', 'app_menu')
              },
              {
                label: 'Open Browser Tab',
                accelerator: 'CommandOrControl+T',
                click: () => dispatchAppHotkeyCommand('open-browser-tab', 'app_menu')
              },
              {
                label: 'Open Files Tab',
                accelerator: 'CommandOrControl+P',
                click: () => dispatchAppHotkeyCommand('open-files-tab', 'app_menu')
              },
              {
                label: 'Open Side Chat',
                accelerator: 'CommandOrControl+Alt+S',
                click: () => dispatchAppHotkeyCommand('open-side-chat-tab', 'app_menu')
              },
              { type: 'separator' },
              {
                label: 'Previous Chat',
                accelerator: 'CommandOrControl+[',
                click: () => dispatchAppHotkeyCommand('previous-session', 'app_menu')
              },
              {
                label: 'Next Chat',
                accelerator: 'CommandOrControl+]',
                click: () => dispatchAppHotkeyCommand('next-session', 'app_menu')
              },
              { type: 'separator' },
              { role: 'reload' },
              { role: 'forceReload' },
              { role: 'toggleDevTools' },
              { type: 'separator' },
              {
                label: 'Actual Size',
                accelerator: 'CommandOrControl+0',
                click: () => dispatchAppZoomCommand('reset')
              },
              {
                label: 'Zoom In',
                accelerator: 'CommandOrControl+=',
                click: () => dispatchAppZoomCommand('in')
              },
              {
                label: 'Zoom Out',
                accelerator: 'CommandOrControl+-',
                click: () => dispatchAppZoomCommand('out')
              },
              { type: 'separator' },
              { role: 'togglefullscreen' }
            ]
          },
          { label: 'Window', role: 'windowMenu' },
          { label: 'Help', role: 'help', submenu: [] }
        ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenu))
}

app.whenReady().then(async () => {
  initSettingsStore()
  loadPersistedUnreadSessionIds()
  const expiredSideSessionCount = expireSideSessionsFromIndex()
  if (expiredSideSessionCount > 0) {
    console.info('[main] expired side chat sessions:', expiredSideSessionCount)
  }
  await initializeDeviceId()
  electronApp.setAppUserModelId('us.pichuapp.pichu.app')
  registerClientProtocol()
  handleClientArgv(process.argv)
  applyAppBranding()
  installApplicationMenu()

  setSettingsUpdatedCallback(handleSettingsUpdated)
  setCronJobRunner(async (job, hooks) => {
    return runDetachedSessionPrompt(job.prompt, job.cwd, {
      agentId: `automation:${job.id}`,
      title: job.name,
      source: 'automation',
      onSessionCreated: hooks.onSessionCreated
    })
  })
  initCronScheduler()
  registerScreenshotProtocol()
  registerPluginAssetProtocol()
  installAppPermissionRequestGuards()

  app.on('web-contents-created', (_, webContents) => {
    installAppHotkeys(webContents)
    installTextContextMenu(webContents)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerPiIpc()
  registerSessionTransferIpc()
  registerSessionInspectorIpc({
    isEnabled: isDebugSurfaceEnabled,
    openWindow: createSessionInspectorWindow,
    getWindow: () => sessionInspectorWindow
  })
  registerCronIpc()
  registerAppIpc()
  registerTeamIpc()
  registerPermissionsIpc()
  if (isDebugSurfaceEnabled()) {
    registerComputerUseDebugIpc()
  }
  registerEmbeddedBrowserIpc()
  registerDiagnosticsIpc()
  registerPluginIpc()
  registerFeatureGatesIpcHandlers()
  registerBackgroundTerminalsIpcHandlers()
  registerAttachmentIpc()
  registerWorkbenchIpc()
  registerSopIpcHandlers()
  await installDefaultPluginsOnStartup().catch((error) => {
    console.error('[plugins] Failed to install default plugins:', error)
  })
  await startLocalRpc(getDataRoot(), {
    appName: APP_DISPLAY_NAME,
    getAppStatus: () => ({
      ready: appLifecycleReady,
      authenticated: true,
      rendererReady,
      hasMainWindow: Boolean(mainWindow && !mainWindow.isDestroyed()),
      hasAuthWindow: false,
      currentSessionId: getAgentStatusSnapshot().sessionId
    }),
    focusApp: focusPrimaryInstance,
    openSession: openSessionFromClientUrl,
    getAgentStatus: getAgentStatusSnapshot,
    createSessionRun: localRpcAcceptNewSessionPrompt,
    continueSessionRun: (params) =>
      localRpcAcceptSessionPrompt({
        sessionId: params.sessionId,
        prompt: params.prompt
      }),
    getSessionStatus: localRpcGetSessionStatus,
    listSessions: ({ page, pageSize }) => {
      const sessions = getSessionIndex('updated')
      const start = (page - 1) * pageSize
      return {
        page,
        pageSize,
        total: sessions.length,
        sessions: sessions.slice(start, start + pageSize)
      }
    },
    listSessionMessages: (sessionId) => getSessionMessages(sessionId),
    listPlugins: async () => ({
      available: await listAvailablePluginEntries(),
      installed: await listInstalledPluginsAsync()
    }),
    installPlugin: (params) => installPlugin(params),
    installLocalPlugin: (params) =>
      installPluginDirectoryToLocalDev({ sourcePath: params.sourcePath }),
    uninstallPlugin: (pluginName) => uninstallPlugin(pluginName),
    uploadPlugin: (params) =>
      uploadPluginVersionToLocalDev(params.pluginName, params.filePath, {
        category: params.category
      }),
    listBackgroundTerminals: (params) =>
      listBackgroundTerminalsForRenderer(params, { allowGlobalSessionScope: true }),
    terminateBackgroundTerminal: (params) =>
      terminateBackgroundTerminalForRenderer(params, { allowGlobalSessionScope: true }),
    cleanBackgroundTerminals: (params) =>
      cleanBackgroundTerminalsForRenderer(params, { allowGlobalSessionScope: true })
  })
  ipcMain.handle('agent:session-import-deeplink-status', () => sessionImportDeeplinkStatus)
  ipcMain.handle('agent:session-import-deeplink-clear', () => {
    sessionImportDeeplinkStatus = { state: 'idle' }
  })
  ipcMain.handle('app:renderer-ready', () => {
    rendererReady = true
    emitSessionImportDeeplinkStatus(sessionImportDeeplinkStatus)
    queueMicrotask(flushPendingSessionImports)
    queueMicrotask(flushPendingOpenSessions)
    const path = pendingNavigationPath
    pendingNavigationPath = null
    return path ? { path } : null
  })
  ipcMain.handle('app:set-menu-bar-unread-session-ids', (_, sessionIds: unknown) => {
    updateMenuBarUnreadSessionIds(sessionIds)
  })
  ipcMain.handle('app:get-unread-session-ids', () => getUnreadSessionIds())

  createWindow()
  initializeAutoUpdater({
    getChannel: () => getSettingsForRenderer().autoUpdateChannel,
    getWebContents: () => mainWindow?.webContents ?? null,
    beforeInstall: () => beginAppClose('update')
  })
  appLifecycleReady = true
  if (pendingSecondInstanceFocus) {
    pendingSecondInstanceFocus = false
    showMainWindow()
  }
  flushPendingClientUrls()
  updateMenuBarTray()
  refreshDockUnreadBadge()
  app.on('activate', () => {
    if (isAppClosing()) {
      return
    }

    showMainWindow()
  })
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  console.info('[client-url] Received open-url event', summarizeClientUrl(url))
  handleClientUrl(url)
})

app.on('window-all-closed', () => {
  mainWindow = null
  rendererReady = false
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  const intent = appCloseIntent === 'update' ? 'update' : 'quit'
  beginAppClose(intent)
  if (intent === 'quit' && !appCloseLifecycleStarted && !appQuitConfirmed) {
    const blockers = appQuitBlockers()
    if (hasAppQuitBlockers(blockers)) {
      event.preventDefault()
      void confirmAppQuitIfNeeded().then((confirmed) => {
        if (confirmed) {
          startConfirmedAppQuit()
        } else {
          cancelAppClose('quit')
        }
      })
      return
    }
  }

  appCloseLifecycleStarted = true
  appLifecycleReady = false
  setSettingsUpdatedCallback(null)
  menuBarTray?.destroy()
  menuBarTray = null
  if (automationKeepAwakeBlockerId !== null) {
    if (powerSaveBlocker.isStarted(automationKeepAwakeBlockerId)) {
      powerSaveBlocker.stop(automationKeepAwakeBlockerId)
    }
    automationKeepAwakeBlockerId = null
  }
  forceTerminateAllBackgroundTerminals()
  disposeAgent()
  disposeCron()
  disposeTeam()
  disposePermissions()
  disposeComputerUseDebug()
  disposeComputerUseHelper()
  disposeAutoUpdater()
  disposeEmbeddedBrowser()
  void disposePluginMcpRuntimeAsync()
  disposeBrowserManager()
  disposeCursorOverlay()
  void disposeLocalRpc()
})

app.on('second-instance', (_event, argv) => {
  const clientUrlArgs = argv.filter(isClientUrlArg)
  if (clientUrlArgs.length > 0) {
    console.info('[client-url] Received second-instance client URLs', {
      count: clientUrlArgs.length,
      urls: clientUrlArgs.map(summarizeClientUrl)
    })
  }
  handleSecondInstance(argv)
})
