import type { WebContents } from 'electron'
import { ipcMain } from 'electron'
import type {
  PluginAdminCancelUploadInput,
  PluginAdminCancelUploadResult,
  PluginAdminLocalVersionInput,
  PluginAdminUploadResult,
  PluginAdminUploadVersionInput
} from '../../shared/plugin-admin.js'
import {
  assertPluginAdminUploadFilePath,
  normalizePluginAdminName,
  normalizePluginAdminVersion
} from '../../shared/plugin-admin.js'
import { listAvailablePluginEntries, listPluginMarketplaces } from './marketplace-loader.js'
import {
  installPluginVersionFromLocalDev,
  listLocalPluginUploads,
  uninstallPluginVersionFromLocalDev,
  uploadPluginVersionToLocalDev
} from './plugin-admin-local-dev.js'
import {
  clearInstalledPlugins,
  installPlugin,
  listInstalledPluginsAsync,
  listPluginAuditLogAsync,
  refreshPluginMarketplaces,
  reinstallPlugin,
  setPluginEnabled,
  uninstallPlugin,
  upgradePlugin,
  validateInstalledPlugins
} from './plugin-registry.js'

const PLUGIN_EVENT_CHANNEL = 'plugins:event'

type PluginEventPayload =
  | {
      type: 'changed'
      action:
        | 'install'
        | 'enable'
        | 'disable'
        | 'uninstall'
        | 'upgrade'
        | 'reinstall'
        | 'clear-installed'
        | 'validate'
        | 'refresh-marketplaces'
        | 'admin-list'
        | 'admin-upload'
        | 'admin-install-local-version'
        | 'admin-uninstall-local-version'
    }
  | {
      type: 'admin-auth-login-started'
      action: 'admin-upload'
      pluginName: string
    }
type PluginChangedAction = Extract<PluginEventPayload, { type: 'changed' }>['action']
const activeAdminUploadControllers = new Map<string, AbortController>()

function adminUploadOperationKey(webContents: WebContents, pluginName: string): string {
  return `${webContents.id}:${pluginName}`
}

function sendPluginEvent(webContents: WebContents, action: PluginChangedAction): void {
  console.log('[plugin-handler] sending plugin event', { action })
  if (!webContents.isDestroyed()) {
    webContents.send(PLUGIN_EVENT_CHANNEL, { type: 'changed', action } satisfies PluginEventPayload)
  } else {
    console.log('[plugin-handler] skipped plugin event because renderer is destroyed', { action })
  }
}

function sendPluginAuthLoginStartedEvent(webContents: WebContents, pluginName: string): void {
  console.log('[plugin-handler] sending plugin auth login started event', { pluginName })
  if (!webContents.isDestroyed()) {
    webContents.send(PLUGIN_EVENT_CHANNEL, {
      type: 'admin-auth-login-started',
      action: 'admin-upload',
      pluginName
    } satisfies PluginEventPayload)
  } else {
    console.log('[plugin-handler] skipped plugin auth login event because renderer is destroyed', {
      pluginName
    })
  }
}

export function registerPluginIpc(): void {
  ipcMain.handle('plugins:list-marketplaces', () => listPluginMarketplaces())
  ipcMain.handle('plugins:list-available', () => listAvailablePluginEntries())
  ipcMain.handle('plugins:list-installed', () => listInstalledPluginsAsync())
  ipcMain.handle('plugins:refresh-marketplaces', async (event) => {
    const result = await refreshPluginMarketplaces()
    sendPluginEvent(event.sender, 'refresh-marketplaces')
    return result
  })
  ipcMain.handle(
    'plugins:install',
    async (event, params: { marketplaceName: string; pluginName: string }) => {
      console.log('[plugin-handler] install requested', params)
      const result = await installPlugin(params)
      console.log('[plugin-handler] install completed', {
        id: result.id,
        name: result.name,
        enabled: result.enabled
      })
      sendPluginEvent(event.sender, 'install')
      return result
    }
  )
  ipcMain.handle('plugins:enable', async (event, id: string) => {
    const result = await setPluginEnabled(id, true)
    sendPluginEvent(event.sender, 'enable')
    return result
  })
  ipcMain.handle('plugins:disable', async (event, id: string) => {
    const result = await setPluginEnabled(id, false)
    sendPluginEvent(event.sender, 'disable')
    return result
  })
  ipcMain.handle('plugins:uninstall', async (event, id: string) => {
    console.log('[plugin-handler] uninstall requested', { id })
    const result = await uninstallPlugin(id)
    console.log('[plugin-handler] uninstall completed', { id, uninstalled: result.uninstalled })
    sendPluginEvent(event.sender, 'uninstall')
    return result
  })
  ipcMain.handle('plugins:upgrade', async (event, id: string) => {
    const result = await upgradePlugin(id)
    sendPluginEvent(event.sender, 'upgrade')
    return result
  })
  ipcMain.handle('plugins:reinstall', async (event, id: string) => {
    const result = await reinstallPlugin(id)
    sendPluginEvent(event.sender, 'reinstall')
    return result
  })
  ipcMain.handle('plugins:clear-installed', async (event) => {
    const result = await clearInstalledPlugins()
    sendPluginEvent(event.sender, 'clear-installed')
    return result
  })
  ipcMain.handle('plugins:validate', async (event) => {
    const result = await validateInstalledPlugins()
    sendPluginEvent(event.sender, 'validate')
    return result
  })
  ipcMain.handle('plugins:list-audit-log', (_, limit?: number) => listPluginAuditLogAsync(limit))
  ipcMain.handle('plugins:admin-list', () => listLocalPluginUploads())
  ipcMain.handle('plugins:admin-upload', async (event, input: PluginAdminUploadVersionInput) => {
    const pluginName = normalizePluginAdminName(input.pluginName)
    const filePath = assertPluginAdminUploadFilePath(input.filePath)
    const operationKey = adminUploadOperationKey(event.sender, pluginName)
    activeAdminUploadControllers.get(operationKey)?.abort()
    const controller = new AbortController()
    activeAdminUploadControllers.set(operationKey, controller)
    try {
      const result: PluginAdminUploadResult = await uploadPluginVersionToLocalDev(
        pluginName,
        filePath,
        {
          category: input.category?.trim() || undefined,
          signal: controller.signal,
          onAuthLoginStart: (authPluginName) =>
            sendPluginAuthLoginStartedEvent(event.sender, authPluginName)
        }
      )
      sendPluginEvent(event.sender, 'admin-upload')
      return result
    } finally {
      if (activeAdminUploadControllers.get(operationKey) === controller) {
        activeAdminUploadControllers.delete(operationKey)
      }
    }
  })
  ipcMain.handle(
    'plugins:admin-cancel-upload',
    async (event, input: PluginAdminCancelUploadInput): Promise<PluginAdminCancelUploadResult> => {
      const pluginName = normalizePluginAdminName(input.pluginName)
      const operationKey = adminUploadOperationKey(event.sender, pluginName)
      const controller = activeAdminUploadControllers.get(operationKey)
      controller?.abort()
      return { cancelled: Boolean(controller) }
    }
  )
  ipcMain.handle(
    'plugins:admin-install-local-version',
    async (event, input: PluginAdminLocalVersionInput) => {
      const pluginName = normalizePluginAdminName(input.pluginName)
      const version = normalizePluginAdminVersion(input.version)
      const result = await installPluginVersionFromLocalDev({ pluginName, version })
      sendPluginEvent(event.sender, 'admin-install-local-version')
      return result
    }
  )
  ipcMain.handle(
    'plugins:admin-uninstall-local-version',
    async (event, input: PluginAdminLocalVersionInput) => {
      const pluginName = normalizePluginAdminName(input.pluginName)
      const version = normalizePluginAdminVersion(input.version)
      const result = await uninstallPluginVersionFromLocalDev({ pluginName, version })
      sendPluginEvent(event.sender, 'admin-uninstall-local-version')
      return result
    }
  )
}
