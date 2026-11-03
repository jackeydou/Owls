import type {
  CleanBackgroundTerminalsRequest,
  CleanBackgroundTerminalsResult,
  ListBackgroundTerminalsRequest,
  ListBackgroundTerminalsResult,
  TerminateBackgroundTerminalRequest,
  TerminateBackgroundTerminalResult
} from '../../shared/background-terminals.js'
import type { PichuThinkingLevel } from '../../shared/model-settings.js'
import type {
  PluginAdminUploadResult,
  PluginAdminUploadVersionInput
} from '../../shared/plugin-admin.js'
import type { AgentStatusSnapshot } from '../agent/index.js'
import type { SessionStatusView } from '../agent/session-commands.js'
import type { InstalledPlugin, PluginMarketplaceEntry } from '../plugins/plugin-types.js'
import type { MessageRow, SessionIndexEntry } from '../stores/settings-store.js'

export type LocalRpcAppStatus = {
  ready: boolean
  authenticated: boolean
  rendererReady: boolean
  hasMainWindow: boolean
  hasAuthWindow: boolean
  currentSessionId: string | null
}

export type LocalRpcDiagnostics = {
  enabled: boolean
  endpoint: string | null
  clientCount: number
  pendingRequests: number
  startedAt: string | null
  lastError?: string
}

export type LocalRpcContext = {
  appName: string
  getAppStatus: () => LocalRpcAppStatus
  focusApp: () => void
  openSession: (sessionId: string) => void
  getAgentStatus: () => AgentStatusSnapshot
  createSessionRun: (params: {
    prompt: string
    cwd?: string
    model?: string
    thinkingLevel?: PichuThinkingLevel
  }) => Promise<{ accepted: true; sessionId: string }>
  continueSessionRun: (params: { sessionId: string; prompt: string }) => {
    accepted: true
    sessionId: string
  }
  getSessionStatus: (sessionId?: string) => SessionStatusView
  listSessions: (params: { page: number; pageSize: number }) => {
    page: number
    pageSize: number
    total: number
    sessions: SessionIndexEntry[]
  }
  listSessionMessages: (sessionId: string) => MessageRow[]
  listPlugins: () => Promise<{
    available: PluginMarketplaceEntry[]
    installed: InstalledPlugin[]
  }>
  installPlugin: (params: {
    marketplaceName: string
    pluginName: string
  }) => Promise<InstalledPlugin>
  installLocalPlugin: (params: { sourcePath: string }) => Promise<InstalledPlugin>
  uninstallPlugin: (pluginName: string) => Promise<{ uninstalled: boolean }>
  uploadPlugin: (params: PluginAdminUploadVersionInput) => Promise<PluginAdminUploadResult>
  listBackgroundTerminals: (params: ListBackgroundTerminalsRequest) => ListBackgroundTerminalsResult
  terminateBackgroundTerminal: (
    params: TerminateBackgroundTerminalRequest
  ) => TerminateBackgroundTerminalResult
  cleanBackgroundTerminals: (
    params: CleanBackgroundTerminalsRequest
  ) => CleanBackgroundTerminalsResult
  getDiagnostics: () => LocalRpcDiagnostics
}
