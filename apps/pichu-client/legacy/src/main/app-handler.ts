import { mkdirSync } from 'node:fs'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  shell
} from 'electron'
import { buildMode, isDebugPackage } from '../shared/build-mode.js'
import type {
  NativeContextMenuItem,
  NativeContextMenuRequest
} from '../shared/native-context-menu.js'
import { getDevAppInstanceInfo } from './dev-app-instance.js'
import { normalizeLinkIconUrl, resolveLinkIconDataUrl } from './link-icon-resolver.js'
import { defaultWorkspaceRoot } from './pichu-paths.js'
import {
  createScratchProject,
  defaultScratchProjectPath,
  listProjects,
  removeProject,
  renameProject,
  setProjectPinned,
  touchProject,
  upsertProject
} from './stores/project-store.js'
import { getDeviceId } from './utils/device-id.js'

let appWindowGetter: () => BrowserWindow | null = () => null
const MAX_LINK_ICON_CACHE_SIZE = 200
const linkIconCache = new Map<string, Promise<string | null>>()

function restartApp(): void {
  app.relaunch()
  app.quit()
}

function normalizeExternalUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https links can be opened externally.')
  }
  return url.toString()
}

function cacheLinkIcon(key: string, loader: () => Promise<string | null>): Promise<string | null> {
  const existing = linkIconCache.get(key)
  if (existing) return existing

  if (linkIconCache.size >= MAX_LINK_ICON_CACHE_SIZE) {
    const oldestKey = linkIconCache.keys().next().value
    if (oldestKey) linkIconCache.delete(oldestKey)
  }

  const promise = loader().catch((error: unknown) => {
    linkIconCache.delete(key)
    throw error
  })
  linkIconCache.set(key, promise)
  return promise
}

function normalizeContextMenuItem(value: unknown): NativeContextMenuItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>

  if (item.type === 'separator') return { type: 'separator' }

  const id = typeof item.id === 'string' ? item.id.trim() : ''
  const label = typeof item.label === 'string' ? item.label.trim() : ''
  if (!id || !label) return null

  return {
    type: 'normal',
    id,
    label,
    enabled: typeof item.enabled === 'boolean' ? item.enabled : true
  }
}

function normalizeContextMenuRequest(value: unknown): NativeContextMenuRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid context menu request.')
  }

  const request = value as Record<string, unknown>
  const items = Array.isArray(request.items)
    ? request.items
        .map(normalizeContextMenuItem)
        .filter((item): item is NativeContextMenuItem => Boolean(item))
    : []
  if (items.length === 0 || items.every((item) => item.type === 'separator')) {
    throw new Error('Context menu requires at least one item.')
  }

  return {
    x:
      typeof request.x === 'number' && Number.isFinite(request.x)
        ? Math.round(request.x)
        : undefined,
    y:
      typeof request.y === 'number' && Number.isFinite(request.y)
        ? Math.round(request.y)
        : undefined,
    items
  }
}

function showNativeContextMenu(
  window: BrowserWindow | null,
  request: NativeContextMenuRequest
): Promise<string | null> {
  return new Promise((resolve) => {
    let selected = false
    const resolveOnce = (value: string | null) => {
      if (selected) return
      selected = true
      resolve(value)
    }
    const template: MenuItemConstructorOptions[] = request.items.map((item) => {
      if (item.type === 'separator') return { type: 'separator' }
      return {
        label: item.label,
        enabled: item.enabled ?? true,
        click: () => resolveOnce(item.id)
      }
    })

    Menu.buildFromTemplate(template).popup({
      window: window ?? undefined,
      x: request.x,
      y: request.y,
      callback: () => resolveOnce(null)
    })
  })
}

export function setAppWindowGetter(getter: () => BrowserWindow | null): void {
  appWindowGetter = getter
}

export function registerAppIpc(): void {
  ipcMain.handle('app:build-info', () => ({
    buildMode,
    isDebugPackage,
    isBetaPackage: app.getVersion().includes('-beta'),
    appVersion: app.getVersion(),
    devInstance: getDevAppInstanceInfo()
  }))
  ipcMain.handle('app:device-id', () => getDeviceId())
  ipcMain.handle('app:is-full-screen', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? appWindowGetter()
    return window?.isFullScreen() ?? false
  })
  ipcMain.handle('app:restart', () => restartApp())
  ipcMain.handle('app:open-external', async (_, url: string) => {
    await shell.openExternal(normalizeExternalUrl(url))
  })
  ipcMain.handle('app:resolve-link-icon', (_, url: string) => {
    const normalizedUrl = normalizeLinkIconUrl(url)
    return cacheLinkIcon(normalizedUrl.toString(), () =>
      resolveLinkIconDataUrl(normalizedUrl.toString())
    )
  })
  ipcMain.handle('app:show-context-menu', (event, payload: unknown) => {
    const request = normalizeContextMenuRequest(payload)
    const window = BrowserWindow.fromWebContents(event.sender) ?? appWindowGetter()
    return showNativeContextMenu(window, request)
  })
  ipcMain.handle('app:select-folder', async (_, options?: { defaultPath?: string }) => {
    const window = appWindowGetter()
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: ['openDirectory'],
          defaultPath: options?.defaultPath
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory'],
          defaultPath: options?.defaultPath
        })

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:create-from-scratch', async () => {
    const defaultPath = defaultScratchProjectPath()
    const window = appWindowGetter()
    const result = window
      ? await dialog.showSaveDialog(window, {
          title: 'Create Project',
          buttonLabel: 'Create Project',
          defaultPath
        })
      : await dialog.showSaveDialog({
          title: 'Create Project',
          buttonLabel: 'Create Project',
          defaultPath
        })

    if (result.canceled || !result.filePath) return null
    return createScratchProject(result.filePath)
  })
  ipcMain.handle('projects:add-existing-folder', async () => {
    const defaultPath = defaultWorkspaceRoot()
    mkdirSync(defaultPath, { recursive: true })
    const window = appWindowGetter()
    const result = window
      ? await dialog.showOpenDialog(window, {
          title: 'Use Existing Folder',
          buttonLabel: 'Use Folder',
          properties: ['openDirectory'],
          defaultPath
        })
      : await dialog.showOpenDialog({
          title: 'Use Existing Folder',
          buttonLabel: 'Use Folder',
          properties: ['openDirectory'],
          defaultPath
        })

    if (result.canceled) return null
    const path = result.filePaths[0]
    return path ? upsertProject(path) : null
  })
  ipcMain.handle('projects:touch', (_, path: string) => touchProject(path))
  ipcMain.handle('projects:set-pinned', (_, path: string, pinned: boolean) =>
    setProjectPinned(path, pinned)
  )
  ipcMain.handle('projects:rename', (_, path: string, name: string) => renameProject(path, name))
  ipcMain.handle('projects:remove', (_, path: string) => removeProject(path))
}
