import { ipcMain, shell } from 'electron'
import type { CustomMcpConnectResult } from '../../shared/custom-mcp.js'
import type { OpenAIOAuthStatus } from '../../shared/openai-oauth.js'
import {
  connectCustomMcpRemoteServer,
  disconnectCustomMcpRemoteServer,
  isCustomMcpOAuthDiscoveryHtmlError
} from '../custom-mcp-oauth.js'
import { hasOpenAIOAuthCredential, loginOpenAIOAuth, logoutOpenAIOAuth } from '../openai-oauth.js'
import { stopCustomMcpServerAsync } from '../plugins/mcp-runtime.js'
import {
  deleteCustomMcpServer,
  listCustomMcpServers,
  saveCustomMcpServer
} from '../stores/custom-mcp-store.js'
import {
  clearImageGenerationApiKey,
  getImageGenerationConfigStatus,
  saveImageGenerationApiKey
} from '../stores/image-generation-config-store.js'
import {
  deleteUserModelConfig,
  listOpenAIOAuthModels,
  listUserModelSummaries,
  saveUserModelConfig,
  setOpenAIOAuthEnabledModels
} from '../stores/model-config-store.js'
import {
  applySettingsPatch,
  getSettingsForRenderer,
  type SettingsPatch
} from '../stores/settings-store.js'
import { setCursorOriginHint } from '../tools/computer-use/cursor-overlay.js'

export function registerSettingsIpcHandlers(): void {
  const openAIOAuthStatus = (): OpenAIOAuthStatus => ({
    signedIn: hasOpenAIOAuthCredential(),
    models: listOpenAIOAuthModels()
  })

  ipcMain.handle('settings:get', () => getSettingsForRenderer())

  // Cursor-overlay origin hint: the renderer reports the chat input's
  // on-screen position so the ghost cursor first materialises right at
  // the input, then animates outward to the click target. Receives `null`
  // when no input is mounted (the overlay falls back to the main-window
  // bottom-centre).
  ipcMain.handle('cursor-overlay:set-origin', (_, point: { x: number; y: number } | null) => {
    setCursorOriginHint(point)
  })

  ipcMain.handle('settings:set', (_, patch: SettingsPatch) => applySettingsPatch(patch))
  ipcMain.handle('models:list', () => listUserModelSummaries())
  ipcMain.handle('models:save', (_, input: { model?: unknown; previousId?: unknown }) =>
    saveUserModelConfig(input?.model, input?.previousId)
  )
  ipcMain.handle('models:delete', (_, modelId: unknown) => deleteUserModelConfig(modelId))
  ipcMain.handle('custom-mcp:list', () => listCustomMcpServers())
  ipcMain.handle('custom-mcp:save', async (_, input: unknown) => {
    const serverId =
      input && typeof input === 'object' && 'id' in input && typeof input.id === 'string'
        ? input.id
        : undefined
    if (serverId) await stopCustomMcpServerAsync(serverId)
    return saveCustomMcpServer(input)
  })
  ipcMain.handle('custom-mcp:delete', async (_, serverId: unknown) => {
    if (typeof serverId === 'string') await stopCustomMcpServerAsync(serverId)
    return deleteCustomMcpServer(serverId)
  })
  ipcMain.handle(
    'custom-mcp:connect',
    async (_, serverId: unknown): Promise<CustomMcpConnectResult> => {
      try {
        await connectCustomMcpRemoteServer(serverId)
        return { ok: true, servers: listCustomMcpServers() }
      } catch (error) {
        if (isCustomMcpOAuthDiscoveryHtmlError(error)) {
          return { ok: false, error: 'oauth_discovery_invalid' }
        }
        throw error
      }
    }
  )
  ipcMain.handle('custom-mcp:disconnect', async (_, serverId: unknown) => {
    if (typeof serverId === 'string') await stopCustomMcpServerAsync(serverId)
    disconnectCustomMcpRemoteServer(serverId)
    return listCustomMcpServers()
  })
  ipcMain.handle('openai-oauth:get', openAIOAuthStatus)
  ipcMain.handle('openai-oauth:login', async () => {
    await loginOpenAIOAuth((url) => shell.openExternal(url))
    return openAIOAuthStatus()
  })
  ipcMain.handle('openai-oauth:logout', async () => {
    setOpenAIOAuthEnabledModels([])
    await logoutOpenAIOAuth()
    return openAIOAuthStatus()
  })
  ipcMain.handle('openai-oauth:set-enabled-models', (_, modelIds: unknown) => {
    setOpenAIOAuthEnabledModels(modelIds)
    return openAIOAuthStatus()
  })
  ipcMain.handle('image-generation-config:get', () => getImageGenerationConfigStatus())
  ipcMain.handle('image-generation-config:save', (_, apiKey: unknown) =>
    saveImageGenerationApiKey(apiKey)
  )
  ipcMain.handle('image-generation-config:clear', () => clearImageGenerationApiKey())
}
