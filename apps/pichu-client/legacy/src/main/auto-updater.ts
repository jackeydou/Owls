import { app, ipcMain, type WebContents } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import type { AutoUpdateChannel, AutoUpdateState } from '../shared/auto-update.js'
import { isDebugPackage } from '../shared/build-mode.js'
import { writeAutoUpdateDiagnosticEvent } from './diagnostics.js'

const INITIAL_CHECK_DELAY_MS = 15_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

type AutoUpdaterOptions = {
  getChannel: () => AutoUpdateChannel
  getWebContents: () => WebContents | null
  beforeInstall: () => void
}

let state: AutoUpdateState = {
  status: 'unavailable',
  currentVersion: app.getVersion(),
  availableVersion: null,
  releaseNotes: null,
  downloadPercent: null,
  error: null
}
let options: AutoUpdaterOptions | null = null
let initialCheckTimer: NodeJS.Timeout | null = null
let periodicCheckTimer: NodeJS.Timeout | null = null
let initialized = false

function isAutoUpdateAvailable(): boolean {
  return app.isPackaged && process.platform === 'darwin' && !isDebugPackage
}

function releaseNotesText(releaseNotes: UpdateInfo['releaseNotes']): string | null {
  if (typeof releaseNotes === 'string') return releaseNotes.trim() || null
  if (!Array.isArray(releaseNotes)) return null
  const notes = releaseNotes
    .map((item) => item.note?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
  return notes || null
}

function emitState(nextState: AutoUpdateState): void {
  state = nextState
  const webContents = options?.getWebContents()
  if (webContents && !webContents.isDestroyed()) {
    webContents.send('auto-update:state', state)
  }
}

function updateState(patch: Partial<AutoUpdateState>): void {
  emitState({ ...state, ...patch })
}

function recordEvent(
  event: string,
  details: Record<string, string | number | boolean | null> = {}
) {
  writeAutoUpdateDiagnosticEvent(event, {
    currentVersion: state.currentVersion,
    channel: options?.getChannel() ?? null,
    ...details
  })
}

function configureChannel(): void {
  const channel = options?.getChannel() ?? 'stable'
  autoUpdater.channel = channel === 'beta' ? 'beta' : 'latest'
  autoUpdater.allowPrerelease = channel === 'beta'
  autoUpdater.allowDowngrade = channel === 'stable' && app.getVersion().includes('-beta')
}

async function checkForUpdates(): Promise<AutoUpdateState> {
  if (!initialized || !isAutoUpdateAvailable()) {
    return state
  }
  if (state.status === 'checking' || state.status === 'downloading') {
    return state
  }

  configureChannel()
  updateState({ status: 'checking', downloadPercent: null, error: null })
  recordEvent('check_started')
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateState({ status: 'error', error: message })
    recordEvent('check_failed', { error: message.slice(0, 500) })
  }
  return state
}

function installDownloadedUpdate(): AutoUpdateState {
  if (state.status !== 'downloaded') return state
  recordEvent('install_requested', { version: state.availableVersion })
  options?.beforeInstall()
  autoUpdater.quitAndInstall(false, true)
  return state
}

function onCheckingForUpdate(): void {
  updateState({ status: 'checking', downloadPercent: null, error: null })
}

function onUpdateNotAvailable(info: UpdateInfo): void {
  updateState({
    status: 'not-available',
    availableVersion: null,
    releaseNotes: null,
    downloadPercent: null,
    error: null
  })
  recordEvent('update_not_available', { version: info.version })
}

function onUpdateAvailable(info: UpdateInfo): void {
  updateState({
    status: 'downloading',
    availableVersion: info.version,
    releaseNotes: releaseNotesText(info.releaseNotes),
    downloadPercent: 0,
    error: null
  })
  recordEvent('update_available', { version: info.version })
}

function onDownloadProgress(progress: { percent: number }): void {
  updateState({
    status: 'downloading',
    downloadPercent: Math.max(0, Math.min(100, Math.round(progress.percent * 10) / 10))
  })
}

function onUpdateDownloaded(info: UpdateInfo): void {
  updateState({
    status: 'downloaded',
    availableVersion: info.version,
    releaseNotes: releaseNotesText(info.releaseNotes),
    downloadPercent: 100,
    error: null
  })
  recordEvent('update_downloaded', { version: info.version })
}

function onError(error: Error): void {
  updateState({ status: 'error', error: error.message })
  recordEvent('updater_error', { error: error.message.slice(0, 500) })
}

export function initializeAutoUpdater(nextOptions: AutoUpdaterOptions): void {
  if (initialized) return
  initialized = true
  options = nextOptions

  ipcMain.handle('auto-update:get-state', () => state)
  ipcMain.handle('auto-update:check', () => checkForUpdates())
  ipcMain.handle('auto-update:install', () => installDownloadedUpdate())

  if (!isAutoUpdateAvailable()) {
    emitState({ ...state, status: 'unavailable' })
    return
  }

  state = { ...state, status: 'idle' }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('checking-for-update', onCheckingForUpdate)
  autoUpdater.on('update-not-available', onUpdateNotAvailable)
  autoUpdater.on('update-available', onUpdateAvailable)
  autoUpdater.on('download-progress', onDownloadProgress)
  autoUpdater.on('update-downloaded', onUpdateDownloaded)
  autoUpdater.on('error', onError)

  initialCheckTimer = setTimeout(() => void checkForUpdates(), INITIAL_CHECK_DELAY_MS)
  initialCheckTimer.unref()
  periodicCheckTimer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
  periodicCheckTimer.unref()
}

export function refreshAutoUpdaterChannel(): void {
  if (initialized && isAutoUpdateAvailable()) {
    configureChannel()
  }
}

export function disposeAutoUpdater(): void {
  if (initialCheckTimer) clearTimeout(initialCheckTimer)
  if (periodicCheckTimer) clearInterval(periodicCheckTimer)
  initialCheckTimer = null
  periodicCheckTimer = null
  autoUpdater.removeListener('checking-for-update', onCheckingForUpdate)
  autoUpdater.removeListener('update-not-available', onUpdateNotAvailable)
  autoUpdater.removeListener('update-available', onUpdateAvailable)
  autoUpdater.removeListener('download-progress', onDownloadProgress)
  autoUpdater.removeListener('update-downloaded', onUpdateDownloaded)
  autoUpdater.removeListener('error', onError)
  options = null
}
