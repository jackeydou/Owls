import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AgentEvent } from '@earendil-works/pi-agent-core'
import type { SessionListResult, SessionText } from '@pichu/session-inspector'
import type {
  PichuMessageKind,
  PichuMessageVisibility
} from '../shared/agent-message-visibility.js'
import type { ArtifactRecord, SaveArtifactRequest } from '../shared/artifacts.js'
import type { AttachmentInput, MessageAttachment } from '../shared/attachments.js'
import type { AppHotkeyPayload } from '../shared/app-hotkeys.js'
import type { AutoUpdateChannel, AutoUpdateState } from '../shared/auto-update.js'
import type {
  CleanBackgroundTerminalsRequest,
  CleanBackgroundTerminalsResult,
  ListBackgroundTerminalsRequest,
  ListBackgroundTerminalsResult,
  TerminateBackgroundTerminalRequest,
  TerminateBackgroundTerminalResult
} from '../shared/background-terminals.js'
import type { MessagePart } from '../shared/message-parts.js'
import type { BuildMode } from '../shared/build-mode.js'
import type {
  ComputerUseAppStateResult,
  ComputerUseClickToolParams,
  ComputerUseClickToolResult,
  ComputerUseDebugInventory,
  ComputerUseDragTestResult,
  ComputerUseModifier,
  ComputerUseOverlayAnimationResult
} from '../shared/computer-use.js'
import type { ContextCompactionEvent } from '../shared/context-compaction.js'
import type { DevAppInstanceInfo } from '../shared/dev-app-instance.js'
import type {
  ChatDiagnosticEventInput,
  DiagnosticsExportOptions,
  DiagnosticsExportResult
} from '../shared/diagnostics.js'
import type { LocalFeatureGateKey, LocalFeatureGateState } from '../shared/feature-gates.js'
import type { ImageGenerationConfigStatus } from '../shared/image-generation-config.js'
import type {
  CustomMcpConnectResult,
  CustomMcpServerSummary,
  SaveCustomMcpServerInput
} from '../shared/custom-mcp.js'
import type {
  PichuReasoningMenuLevel,
  PichuThinkingLevel,
  RunModelUsage,
  SessionModelPreference
} from '../shared/model-settings.js'
import type { UserModelConfig, UserModelSummary } from '../shared/model-config.js'
import type { OpenAIOAuthStatus } from '../shared/openai-oauth.js'
import type {
  CancelHumanInputPayload,
  ContinueAfterHumanInputPayload,
  HumanInputRequestForRenderer,
  SubmitHumanInputPayload
} from '../shared/human-input.js'
import type { NativeContextMenuRequest } from '../shared/native-context-menu.js'
import type { UsageStats } from '../shared/usage-stats.js'
import type { SopDetail, SopIndexEntry } from '../shared/sop.js'
import type {
  PluginAdminCancelUploadInput,
  PluginAdminCancelUploadResult,
  PluginAdminCatalogItem,
  PluginAdminLocalVersionInput,
  PluginAdminLocalVersionRemoveResult,
  PluginAdminUploadResult,
  PluginAdminUploadVersionInput
} from '../shared/plugin-admin.js'
import type { ProjectEntry } from '../shared/projects.js'
import type { SessionImportDeeplinkStatus } from '../shared/session-import-deeplink.js'
import type {
  AgentTrustProfile,
  ToolApprovalRequestForRenderer,
  ToolApprovalResolveRequest,
  ToolApprovalResolvedEvent
} from '../shared/tool-approval.js'
import type {
  CreateWorkbenchWorkspaceInput,
  CreateWorkbenchWorkspaceResult,
  DeleteWorkbenchCellInput,
  DeleteWorkbenchCellResult,
  GetWorkbenchCellInput,
  GetWorkbenchCellResult,
  ListWorkbenchInput,
  ListWorkbenchResult,
  ListWorkbenchWorkspacesResult,
  RunWorkbenchCellInput,
  RunWorkbenchCellResult,
  SaveToWorkbenchInput,
  SaveToWorkbenchResult,
  SetCurrentWorkbenchWorkspaceInput,
  UpdateWorkbenchLayoutInput
} from '../shared/workbench.js'

export type { AttachmentInput, MessageAttachment } from '../shared/attachments.js'
export type { SessionImportDeeplinkStatus } from '../shared/session-import-deeplink.js'
export type { LocalFeatureGateKey, LocalFeatureGateState } from '../shared/feature-gates.js'
export type { ProjectEntry } from '../shared/projects.js'
export type {
  PluginAdminCancelUploadInput,
  PluginAdminCancelUploadResult,
  PluginAdminCatalogItem,
  PluginAdminLocalVersionInput,
  PluginAdminLocalVersionRemoveResult,
  PluginAdminLocalUploadResult,
  PluginAdminUploadResult,
  PluginAdminUploadVersionInput,
  PluginAdminVersion
} from '../shared/plugin-admin.js'
export type {
  AgentTrustProfile,
  ToolApprovalAutoReviewEvent,
  ToolApprovalMode,
  ToolApprovalRequestForRenderer,
  ToolApprovalResolveBehavior,
  ToolApprovalResolveRequest,
  ToolApprovalResolvedEvent
} from '../shared/tool-approval.js'
export type {
  ComputerUseAppStateResult,
  ComputerUseAppTarget,
  ComputerUseCapturedWindow,
  ComputerUseClickToolParams,
  ComputerUseClickToolResult,
  ComputerUseDebugInventory,
  ComputerUseDragTestResult,
  ComputerUseModifier,
  ComputerUseOverlayAnimationResult,
  ComputerUseWindowTarget
} from '../shared/computer-use.js'

export type AgentEventPayload = {
  sessionId: string | null
  modelId?: string | null
  event: AgentEvent | ContextCompactionEvent
}

export type AgentStatus = {
  hasSession: boolean
  sessionId: string | null
  runningSessionIds: string[]
  waitingSessionIds: string[]
  activeRunIdsBySession: Record<string, string>
  activeRunStartedAtsBySession: Record<string, string>
  runStatusBySession: Record<
    string,
    'idle' | 'running' | 'waiting_for_user' | 'waiting_for_approval'
  >
  waitingInputIdBySession: Record<string, string>
  waitingApprovalIdBySession?: Record<string, string>
  modelId: string | null
}

export type AgentPromptResult = {
  effectiveModelId: string
  effectiveThinkingLevel: PichuThinkingLevel
  effectiveReason?: RunModelUsage['effectiveReason']
}

export type AgentPromptOptions = {
  hasImages?: boolean
  parts?: MessagePart[]
}

export type AgentSteerOptions = AgentPromptOptions & {
  expectedRunId?: string
}

export type AgentGenerateTitleOptions = {
  hasImages?: boolean
}

export type AgentNewSessionResult = {
  sessionId: string
  sessionModel: SessionModelPreference
}

export type AgentResumeSessionResult = {
  sessionModel: SessionModelPreference
}

export type AgentSetSessionModelResult = {
  sessionModel: SessionModelPreference
}

export type AgentRunStatePayload = {
  sessionId: string
  running: boolean
  status?: 'idle' | 'running' | 'waiting_for_user' | 'waiting_for_approval'
  activeRunId: string | null
  activeRunStartedAt: string | null
  completedRun?: {
    id: string
    sessionId: string
    status: 'completed' | 'failed' | 'cancelled'
    startedAt: string
    completedAt?: string | null
    durationMs?: number | null
    error?: string | null
  } | null
  runningSessionIds: string[]
  waitingSessionIds?: string[]
  runStatusBySession?: Record<
    string,
    'idle' | 'running' | 'waiting_for_user' | 'waiting_for_approval'
  >
  waitingInputIdBySession?: Record<string, string>
  waitingApprovalIdBySession?: Record<string, string>
}

export type SettingsPayload = {
  model: string
  thinkingLevel: PichuThinkingLevel
  dataRoot: string
  workingDirectory: string
  enableAgentsSkills: boolean
  enableClaudeSkills: boolean
  computerUseEnabled: boolean
  debugMode: boolean
  language: 'auto' | 'zh-CN' | 'en'
  autoUpdateChannel: AutoUpdateChannel
  showInMenuBar: boolean
  showModelSwitcher: boolean
  followUpBehavior: 'queue' | 'steer'
  completionNotifications: 'never' | 'unfocused' | 'always'
  approvalNotifications: boolean
  questionNotifications: boolean
  themeMode: 'system' | 'light' | 'dark'
  modelTrajectoryLoggingEnabled: boolean
  modelTrajectoryLogDirectory: string
  automationKeepAwake: boolean
  projectSortKey: 'updated' | 'created' | 'name'
  agentTrustProfile: AgentTrustProfile
  devInstance: DevAppInstanceInfo | null
  devInstanceBadgeVisible: boolean
}

export type SettingsSetResult = SettingsPayload | { restarting: true }

export type BuildInfo = {
  buildMode: BuildMode
  isDebugPackage: boolean
  isBetaPackage: boolean
  appVersion: string
  devInstance: DevAppInstanceInfo | null
}

export type SessionIndexEntry = {
  sessionId: string
  agentId: string
  cwd: string
  title: string
  sessionKind?: 'main' | 'side'
  parentSessionId?: string | null
  createdAt: string
  updatedAt: string
  archivedAt?: string | null
  pinned?: boolean
  pinnedOrder?: number
  sessionModelId?: string | null
  sessionThinkingLevel?: PichuThinkingLevel | null
  sessionModelUpdatedAt?: string | null
  sessionModelUpdatedBy?: SessionModelPreference['updatedBy'] | null
}

export type SessionIndexSortKey = 'updated' | 'created'

export type FileTreeEntry = {
  path: string
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: string
}

export type SessionImportResult = {
  status: 'imported'
  sessionId: string
  title: string
  messageCount: number
}

export type DuplicateSessionImportResult = {
  status: 'duplicate'
  sourceSessionId: string
  existingSessionId: string
  title: string
  messageCount: number
}

export type SessionImportResponse = SessionImportResult | DuplicateSessionImportResult

export type SessionImportOptions = {
  force?: boolean
}

export type AgentContextUsage = {
  modelId: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  contextWindow: number
  messageId?: string
}

export type MessageRow = {
  id: string
  sessionId: string
  runId?: string | null
  role: 'user' | 'assistant' | 'system' | 'tool'
  kind?: PichuMessageKind | null
  content: string
  agentContent: string
  visibility: PichuMessageVisibility
  sortOrder: number
  createdAt: string
  runStatus?: 'running' | 'completed' | 'failed' | 'cancelled' | null
  runStartedAt?: string | null
  runCompletedAt?: string | null
  runDurationMs?: number | null
  runError?: string | null
  toolCallId?: string | null
  toolName?: string | null
  toolCallResult?: string | null
  attachmentsJson?: string | null
  modelId?: string | null
  modelProvider?: string | null
  modelApi?: string | null
  modelUsageJson?: string | null
  runStatus?: 'running' | 'completed' | 'failed' | 'cancelled' | null
  runStartedAt?: string | null
  runCompletedAt?: string | null
  runDurationMs?: number | null
  runError?: string | null
  parts?: MessagePart[]
}

export type SessionSearchHighlight = {
  start: number
  end: number
}

export type SessionSearchResult = {
  sessionId: string
  title: string
  cwd: string
  sessionCreatedAt: string
  sessionUpdatedAt: string
  messageId: string | null
  role: 'user' | 'assistant' | 'system' | 'tool' | 'session'
  content: string
  snippet: string
  highlights: SessionSearchHighlight[]
  sortOrder: number | null
  messageCreatedAt: string | null
  toolName?: string | null
}

export type EmbeddedBrowserStatus = {
  open: boolean
  attached: boolean
  webContentsId: number | null
  url: string | null
  title: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  annotationMode: 'browse' | 'comment'
  annotationCount: number
}

export type EmbeddedBrowserEvent =
  | { type: 'open-url'; url: string; sessionKey?: string; visible?: boolean }
  | { type: 'open-blank'; sessionKey?: string }
  | { type: 'close'; sessionKey?: string }
  | { type: 'state'; sessionKey: string; status: EmbeddedBrowserStatus }
  | {
      type: 'annotation-draft-created'
      sessionKey: string
      annotation: {
        annotationId: string
        anchor: {
          kind: 'element' | 'region'
          pageUrl: string
          title?: string
          framePath?: string[]
          frameUrl?: string
          selector?: string
          targetPath?: string
          targetRole?: string
          targetName?: string
          targetDescription?: string
          targetImmediateText?: string
          nearbyText?: string
          documentContext?: string
          isFixed?: boolean
          scrollContainers?: Array<{
            selector: string
            scrollLeft: number
            scrollTop: number
          }>
          viewportPoint: { x: number; y: number }
          viewportRect?: { x: number; y: number; width: number; height: number }
          viewportSize: { width: number; height: number }
        }
      }
    }
  | {
      type: 'annotation-draft-cleared'
      sessionKey: string
      annotationId?: string
    }
  | {
      type: 'annotation-submitted'
      sessionKey: string
      annotation: {
        annotationId: string
        label: number
        comment: string
        anchor: {
          kind: 'element' | 'region'
          pageUrl: string
          title?: string
          framePath?: string[]
          frameUrl?: string
          selector?: string
          targetPath?: string
          targetRole?: string
          targetName?: string
          targetDescription?: string
          targetImmediateText?: string
          nearbyText?: string
          documentContext?: string
          isFixed?: boolean
          scrollContainers?: Array<{
            selector: string
            scrollLeft: number
            scrollTop: number
          }>
          viewportPoint: { x: number; y: number }
          viewportRect?: { x: number; y: number; width: number; height: number }
          viewportSize: { width: number; height: number }
        }
        screenshot?: {
          data: ArrayBuffer
          width: number
          height: number
          annotationViewportRect?: { x: number; y: number; width: number; height: number }
          cropViewportRect?: { x: number; y: number; width: number; height: number }
          cropPaddingPx?: number
          markerViewportPoint?: { x: number; y: number }
        }
        pastedImages?: Array<{
          name?: string
          mimeType: string
          data: ArrayBuffer
        }>
      }
    }
  | {
      type: 'cursor-command'
      commandId: string
      sessionKey: string
      action: 'move' | 'move-click' | 'hide'
      point?: { x: number; y: number }
    }

export type SkillSummary = {
  name: string
  qualifiedName?: string
  description: string
  filePath: string
  baseDir: string
  sourceKind: 'repo' | 'agents' | 'claude' | 'pichu' | 'builtin' | 'plugin'
  sourceLabel: string
  sourceRoot: string
  pluginId?: string
  pluginName?: string
  pluginVersion?: string
  pluginRoot?: string
  pluginScripts?: PluginCommand[]
  pluginCommands?: PluginCommand[]
}

export type SkillDiagnostic = {
  type: 'warning' | 'collision'
  message: string
  path: string
  collision?: {
    name: string
    winnerPath: string
    loserPath: string
  }
}

export type SkillListResult = {
  skills: SkillSummary[]
  diagnostics: SkillDiagnostic[]
}

export type PluginDiagnostic = {
  level: 'warning' | 'error'
  message: string
  path?: string
}

export type PluginValidationStatus = {
  ok: boolean
  checkedAt: string
  errorCount: number
  warningCount: number
}

export type PluginMarketplaceSource = {
  type: 'local'
  path: string
}

export type PluginComponentPaths = {
  skills?: string
  mcpServers?: string
  apps?: string
  hooks?: string
  agents?: string
  bin?: string
}

export type PluginLegacyRuntimeRequirements = {
  node?: string
}

export type PluginRuntimeComponentRequirement = {
  version: string
  reason?: string
}

export type PluginRuntimePackageRequirement = {
  name: string
  version: string
  reason?: string
}

export type PluginNativePackageRequirement = PluginRuntimePackageRequirement & {
  commands?: string[]
}

export type PluginRuntimeRequirements = {
  node?: PluginRuntimeComponentRequirement
  python?: PluginRuntimeComponentRequirement
  nodePackages?: PluginRuntimePackageRequirement[]
  pythonPackages?: PluginRuntimePackageRequirement[]
  nativePackages?: PluginNativePackageRequirement[]
  capabilities?: string[]
}

export type PluginPermissions = {
  filesystem?: Array<'read' | 'write'>
  shell?: 'allow' | 'prompt' | 'deny'
  network?: 'allow' | 'prompt' | 'deny'
}

export type PluginCommand = {
  name: string
  entry: string
  description?: string
}

export type PluginMarketplaceSkillSummary = {
  name: string
  qualifiedName?: string
  description: string
  filePath: string
  baseDir: string
  sourceKind: 'plugin'
  sourceLabel: string
  sourceRoot: string
  pluginId?: string
  pluginName: string
  pluginVersion?: string
  pluginRoot: string
  pluginScripts?: PluginCommand[]
  pluginCommands?: PluginCommand[]
}

export type PluginAuthCommand = {
  command: string
  args: string[]
  description?: string
}

export type PluginAuth = {
  login: PluginAuthCommand
  status: PluginAuthCommand
}

export type PluginInterfaceMetadata = {
  displayName?: string
  shortDescription?: string
  longDescription?: string
  developerName?: string
  category?: string
  capabilities?: string[]
  defaultPrompt?: string[]
  brandColor?: string
  icon?: string
  composerIcon?: string
  logo?: string
  screenshots?: string[]
  websiteURL?: string
  privacyPolicyURL?: string
  termsOfServiceURL?: string
}

export type AgentHookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PermissionRequest'
  | 'PostToolUse'
  | 'Stop'

export type AgentCommandHook = {
  type: 'command'
  command: string
  timeout?: number
  statusMessage?: string
}

export type AgentHookMatcherGroup = {
  matcher?: string
  hooks: AgentCommandHook[]
}

export type AgentHookConfig = {
  hooks?: Partial<Record<AgentHookEventName, AgentHookMatcherGroup[]>>
}

export type PluginHookSource =
  | {
      type: 'path' | 'default-path'
      path: string
      index: number
    }
  | {
      type: 'inline'
      index: number
    }

export type PluginHookEventSummary = {
  event: AgentHookEventName
  matcherGroupCount: number
  commandCount: number
}

export type PluginHookDeclaration = {
  source: PluginHookSource
  config: AgentHookConfig
  events: PluginHookEventSummary[]
  matcherGroupCount: number
  commandCount: number
}

export type NormalizedPluginManifest = {
  schemaVersion?: string
  name: string
  version: string
  description: string
  author?: {
    name?: string
    email?: string
    url?: string
  }
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
  skills?: string
  mcpServers?: string
  apps?: string
  hooks?: string
  agents?: string
  bin?: string
  runtime?: PluginLegacyRuntimeRequirements
  runtimeRequirements?: PluginRuntimeRequirements
  permissions?: PluginPermissions
  auth?: PluginAuth
  scripts: PluginCommand[]
  commands: PluginCommand[]
  hookDeclarations: PluginHookDeclaration[]
  interface?: PluginInterfaceMetadata
  raw: Record<string, unknown>
}

export type PluginMarketplaceEntry = {
  name: string
  source: PluginMarketplaceSource
  scope: PluginMarketplaceScope
  interface?: PluginInterfaceMetadata
  iconUrl?: string
  description?: string
  keywords?: string[]
  version?: string
  auth?: PluginAuth
  skills?: PluginMarketplaceSkillSummary[]
  resolvedSourcePath?: string
  policy?: {
    installation?: 'AVAILABLE' | 'INSTALLED_BY_DEFAULT' | 'NOT_AVAILABLE'
    authentication?: 'ON_INSTALL' | 'ON_FIRST_USE'
  }
  category?: string
  marketplaceName: string
  marketplacePath: string
  marketplaceRoot: string
}

export type PluginMarketplaceScope = 'public' | 'internal'

export type PluginMarketplace = {
  name: string
  displayName: string
  scope: PluginMarketplaceScope
  path: string
  root: string
  plugins: PluginMarketplaceEntry[]
  diagnostics: PluginDiagnostic[]
}

export type PluginMarketplaceStatus = {
  available: boolean
  checkedAt: string
  availableVersion?: string
  message?: string
}

export type InstalledPlugin = {
  id: string
  name: string
  version: string
  installedVersion: string
  enabled: boolean
  installedAt: string
  updatedAt: string
  marketplaceName: string
  source: PluginMarketplaceSource
  sourceMetadata: {
    installedFrom: 'marketplace' | 'developer-upload'
    marketplaceName?: string
    marketplacePath?: string
    marketplaceRoot?: string
    source?: PluginMarketplaceSource
    resolvedSourcePath?: string
    resolvedZipSha256?: string
    resolvedAt?: string
  }
  cachePath: string
  manifestPath: string
  manifest: NormalizedPluginManifest
  diagnostics: PluginDiagnostic[]
  validationStatus: PluginValidationStatus
  marketplaceStatus?: PluginMarketplaceStatus
}

export type PluginMarketplaceRefreshResult = {
  refreshedAt: string
  marketplaces: PluginMarketplace[]
  available: PluginMarketplaceEntry[]
  installed: InstalledPlugin[]
}

export type PluginMarketplaceRefreshSource = 'startup' | 'page_load' | 'manual' | 'post_action'

export type PluginEventPayload =
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

export type PluginAuditEvent = {
  id: string
  timestamp: string
  action:
    | 'install'
    | 'auto-upgrade'
    | 'enable'
    | 'disable'
    | 'uninstall'
    | 'upgrade'
    | 'reinstall'
    | 'clear-installed'
    | 'marketplace-refresh'
    | 'validate'
    | 'validation-error'
    | 'command'
    | 'auth'
  pluginId?: string
  pluginName?: string
  marketplaceName?: string
  level: 'info' | 'warning' | 'error'
  message: string
  details?: Record<string, unknown>
}

export type CronJob = {
  id: string
  name: string
  schedule: string
  prompt: string
  cwd: string
  active: boolean
  createdAt: string
  updatedAt: string
  lastRunAt: string | null
  lastRunStatus: 'running' | 'success' | 'error' | null
}

export type CronJobRunSession = SessionIndexEntry

export type CronEventPayload =
  | {
      type: 'run-session-created'
      jobId: string
      sessionId: string
    }
  | {
      type: 'run-complete'
      jobId: string
      sessionId: string | null
    }

export type CreateCronJobParams = {
  name: string
  schedule: string
  prompt: string
  cwd?: string
  active?: boolean
}

export type UpdateCronJobPatch = Partial<{
  name: string
  schedule: string
  prompt: string
  cwd: string
}>

export type SystemNotificationOptions = {
  title: string
  body?: string
  subtitle?: string
  silent?: boolean
}

export type SystemNotificationResult = {
  supported: boolean
  shown: boolean
}

export type TeamAgentDefinition = {
  id: string
  name: string
  description: string
  systemPrompt: string
  model?: string
  readonly?: boolean
  maxTurns?: number
  timeoutMs?: number
  source: 'builtin' | 'project' | 'user'
  filePath?: string
  color?: string
}

export type TeamTask = {
  id: string
  subject: string
  description: string
  owner: string | null
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  blocks: string[]
  blockedBy: string[]
  createdAt: string
  updatedAt: string
}

export type TeamStatus = {
  teamName: string
  cwd: string
  lead: {
    name: string
    agentId: string
  }
  teammates: Array<{
    name: string
    agentId: string
    definitionId: string
    description: string
    status: 'working' | 'idle' | 'shutdown'
    currentTaskId: string | null
    lastActiveAt: string
  }>
  tasks: TeamTask[]
}

export type TeamEvent =
  | {
      type: 'team-created'
      teamName: string
      cwd: string
      timestamp: string
    }
  | {
      type: 'team-destroyed'
      teamName: string
      timestamp: string
    }
  | {
      type: 'teammate-spawned'
      teamName: string
      teammateName: string
      definitionId: string
      timestamp: string
    }
  | {
      type: 'teammate-working' | 'teammate-idle' | 'teammate-shutdown'
      teamName: string
      teammateName: string
      timestamp: string
      taskId?: string | null
      detail?: string
    }
  | {
      type: 'task-created' | 'task-claimed' | 'task-updated' | 'task-completed'
      teamName: string
      task: TeamTask
      timestamp: string
    }
  | {
      type: 'message-sent'
      teamName: string
      message: {
        id: string
        from: string
        to: string
        type: 'task_assignment' | 'message' | 'broadcast' | 'shutdown_request' | 'idle_notification'
        text: string
        timestamp: string
        read: boolean
        taskId?: string
      }
      timestamp: string
    }
  | {
      type: 'delegate-update'
      teamName: string
      agentId: string
      toolCallId: string
      status: 'running' | 'complete' | 'error'
      detail: string
      result?: unknown
      timestamp: string
    }
  | {
      type: 'error'
      teamName: string | null
      detail: string
      timestamp: string
    }

export type PichuApi = {
  models: {
    list: () => Promise<UserModelSummary[]>
    save: (model: UserModelConfig, previousId?: string) => Promise<UserModelSummary[]>
    delete: (modelId: string) => Promise<UserModelSummary[]>
  }
  customMcp: {
    list: () => Promise<CustomMcpServerSummary[]>
    save: (server: SaveCustomMcpServerInput) => Promise<CustomMcpServerSummary[]>
    delete: (serverId: string) => Promise<CustomMcpServerSummary[]>
    connect: (serverId: string) => Promise<CustomMcpConnectResult>
    disconnect: (serverId: string) => Promise<CustomMcpServerSummary[]>
  }
  openAIOAuth: {
    get: () => Promise<OpenAIOAuthStatus>
    login: () => Promise<OpenAIOAuthStatus>
    logout: () => Promise<OpenAIOAuthStatus>
    setEnabledModels: (modelIds: string[]) => Promise<OpenAIOAuthStatus>
  }
  imageGenerationConfig: {
    get: () => Promise<ImageGenerationConfigStatus>
    save: (apiKey: string) => Promise<ImageGenerationConfigStatus>
    clear: () => Promise<ImageGenerationConfigStatus>
  }
  settings: {
    get: () => Promise<SettingsPayload>
    set: (patch: {
      model?: string
      thinkingLevel?: PichuThinkingLevel
      dataRoot?: string
      workingDirectory?: string
      enableAgentsSkills?: boolean
      enableClaudeSkills?: boolean
      debugMode?: boolean
      language?: 'auto' | 'zh-CN' | 'en'
      autoUpdateChannel?: AutoUpdateChannel
      showInMenuBar?: boolean
      showModelSwitcher?: boolean
      followUpBehavior?: 'queue' | 'steer'
      completionNotifications?: 'never' | 'unfocused' | 'always'
      approvalNotifications?: boolean
      questionNotifications?: boolean
      themeMode?: 'system' | 'light' | 'dark'
      modelTrajectoryLoggingEnabled?: boolean
      automationKeepAwake?: boolean
      projectSortKey?: 'updated' | 'created' | 'name'
      agentTrustProfile?: AgentTrustProfile
      devInstanceBadgeVisible?: boolean
    }) => Promise<SettingsSetResult>
  }
  diagnostics: {
    recordChatEvent: (input: ChatDiagnosticEventInput) => Promise<void>
    export: (options?: DiagnosticsExportOptions) => Promise<DiagnosticsExportResult>
  }
  agent: {
    newSession: (
      cwd?: string,
      model?: string,
      thinkingLevel?: PichuThinkingLevel,
      titleHint?: string
    ) => Promise<AgentNewSessionResult>
    resumeSession: (sessionId: string) => Promise<AgentResumeSessionResult>
    sideSessionEntry: (params: {
      sessionId: string
      parentSessionId: string
    }) => Promise<SessionIndexEntry>
    sideSession: (params: {
      parentSessionId: string
      cwd?: string
      model?: string
      thinkingLevel?: PichuThinkingLevel
      forceNew?: boolean
    }) => Promise<AgentNewSessionResult & { cwd: string; reused: boolean }>
    prompt: (
      sessionId: string,
      text: string,
      options?: AgentPromptOptions
    ) => Promise<AgentPromptResult>
    steer: (
      sessionId: string,
      text: string,
      options?: AgentSteerOptions
    ) => Promise<AgentPromptResult>
    cancel: (sessionId?: string) => Promise<void>
    status: () => Promise<AgentStatus>
    listHumanInputs: (sessionId?: string) => Promise<HumanInputRequestForRenderer[]>
    submitHumanInput: (payload: SubmitHumanInputPayload) => Promise<HumanInputRequestForRenderer>
    cancelHumanInput: (payload: CancelHumanInputPayload) => Promise<HumanInputRequestForRenderer>
    continueAfterHumanInput: (payload: ContinueAfterHumanInputPayload) => Promise<void>
    onHumanInputRequested: (callback: (request: HumanInputRequestForRenderer) => void) => () => void
    onHumanInputUpdated: (callback: (request: HumanInputRequestForRenderer) => void) => () => void
    dispose: (sessionId?: string) => Promise<void>
    setSessionModel: (payload: {
      sessionId: string
      modelId: string
      thinkingLevel: PichuThinkingLevel
    }) => Promise<AgentSetSessionModelResult>
    sessionIndex: (sortKey?: SessionIndexSortKey) => Promise<SessionIndexEntry[]>
    sessionFiles: (sessionId: string, directory?: string) => Promise<FileTreeEntry[]>
    readSessionFile: (sessionId: string, filePath: string) => Promise<string>
    sessionFileUrl: (sessionId: string, filePath: string) => Promise<string>
    sessionIndexUpdateTitle: (sessionId: string, title: string) => Promise<void>
    sessionIndexSetPinned: (sessionId: string, pinned: boolean) => Promise<void>
    sessionIndexReorderPinned: (sessionIds: string[]) => Promise<void>
    generateSessionTitle: (
      sessionId: string,
      fallbackText: string,
      options?: AgentGenerateTitleOptions
    ) => Promise<string>
    sessionIndexRemove: (sessionId: string) => Promise<void>
    sessionIndexArchive: (sessionId: string) => Promise<void>
    archivedSessionIndex: () => Promise<SessionIndexEntry[]>
    sessionIndexUnarchive: (sessionId: string) => Promise<void>
    archivedSessionDelete: (sessionId: string) => Promise<void>
    archivedSessionsDeleteAll: () => Promise<number>
    sessionImportJsonl: (
      url: string,
      options?: SessionImportOptions
    ) => Promise<SessionImportResponse>
    sessionImportDeeplinkStatus: () => Promise<SessionImportDeeplinkStatus>
    clearSessionImportDeeplinkStatus: () => Promise<void>
    listSkills: () => Promise<SkillListResult>
    readSkill: (filePath: string) => Promise<{ content: string }>
    openSkill: (filePath: string) => Promise<{ opened: boolean }>
    deleteSkill: (skillName: string) => Promise<{ deleted: boolean }>
    listModels: () => Promise<
      Array<{
        id: string
        name: string
        contextWindow: number
        reasoning?: boolean
        supportedThinkingLevels?: PichuReasoningMenuLevel[]
        defaultThinkingLevel?: PichuThinkingLevel
        hiddenFromModelSwitcher?: boolean
      }>
    >
    contextUsage: (sessionId: string) => Promise<AgentContextUsage | null>
    usageStats: () => Promise<UsageStats>
    assistantDraft: (sessionId: string) => Promise<string>
    onEvent: (callback: (payload: AgentEventPayload) => void) => () => void
    onRunState: (callback: (payload: AgentRunStatePayload) => void) => () => void
    onSessionImportDeeplinkStatus: (
      callback: (payload: SessionImportDeeplinkStatus) => void
    ) => () => void
  }
  toolApprovals: {
    list: () => Promise<ToolApprovalRequestForRenderer[]>
    resolve: (payload: ToolApprovalResolveRequest) => Promise<ToolApprovalRequestForRenderer | null>
    onRequested: (callback: (request: ToolApprovalRequestForRenderer) => void) => () => void
    onResolved: (callback: (event: ToolApprovalResolvedEvent) => void) => () => void
    onAutoReviewStarted: (callback: (event: ToolApprovalAutoReviewEvent) => void) => () => void
    onAutoReviewCompleted: (callback: (event: ToolApprovalAutoReviewEvent) => void) => () => void
  }
  messages: {
    add: (msg: {
      sessionId: string
      role: 'user' | 'assistant' | 'system'
      content: string
      runId?: string | null
      kind?: PichuMessageKind | null
      agentContent?: string | null
      visibility?: PichuMessageVisibility | null
      attachments?: MessageAttachment[]
      parts?: MessagePart[]
      persistRuntimeContext?: boolean | null
      modelId?: string | null
      modelProvider?: string | null
      modelApi?: string | null
      modelUsageJson?: string | null
    }) => Promise<MessageRow>
    list: (sessionId: string) => Promise<MessageRow[]>
    search: (query: { text: string; limit?: number }) => Promise<SessionSearchResult[]>
    onUpdated: (callback: (payload: MessageRow) => void) => () => void
  }
  attachments: {
    pick: () => Promise<MessageAttachment[]>
    statPaths: (items: AttachmentInput[]) => Promise<MessageAttachment[]>
    getPathForFile: (file: File) => string
    saveClipboardImage: (input: {
      name?: string
      mimeType: string
      data: ArrayBuffer
    }) => Promise<MessageAttachment | null>
    saveCommentScreenshot: (input: {
      name?: string
      mimeType: string
      data: ArrayBuffer
    }) => Promise<MessageAttachment | null>
    readImageDataUrl: (path: string) => Promise<string | null>
    readTextFile: (path: string) => Promise<string>
    reveal: (path: string) => Promise<void>
    open: (path: string) => Promise<void>
    openFolder: (path: string) => Promise<void>
    saveCopy: (path: string) => Promise<string | null>
  }
  artifacts: {
    list: () => Promise<ArtifactRecord[]>
    save: (request: SaveArtifactRequest) => Promise<ArtifactRecord>
    delete: (id: string) => Promise<{ deleted: boolean }>
  }
  workbench: {
    createWorkspace: (
      input: CreateWorkbenchWorkspaceInput
    ) => Promise<CreateWorkbenchWorkspaceResult>
    listWorkspaces: () => Promise<ListWorkbenchWorkspacesResult>
    setCurrentWorkspace: (input: SetCurrentWorkbenchWorkspaceInput) => Promise<void>
    save: (input: SaveToWorkbenchInput) => Promise<SaveToWorkbenchResult>
    list: (input?: ListWorkbenchInput) => Promise<ListWorkbenchResult>
    getCell: (input: GetWorkbenchCellInput) => Promise<GetWorkbenchCellResult>
    deleteCell: (input: DeleteWorkbenchCellInput) => Promise<DeleteWorkbenchCellResult>
    updateLayout: (input: UpdateWorkbenchLayoutInput) => Promise<void>
    runCell: (input: RunWorkbenchCellInput) => Promise<RunWorkbenchCellResult>
  }
  plugins: {
    listMarketplaces: () => Promise<PluginMarketplace[]>
    listAvailable: () => Promise<PluginMarketplaceEntry[]>
    listInstalled: () => Promise<InstalledPlugin[]>
    refreshMarketplaces: (options?: {
      source?: PluginMarketplaceRefreshSource
    }) => Promise<PluginMarketplaceRefreshResult>
    install: (params: { marketplaceName: string; pluginName: string }) => Promise<InstalledPlugin>
    enable: (id: string) => Promise<InstalledPlugin>
    disable: (id: string) => Promise<InstalledPlugin>
    uninstall: (id: string) => Promise<{ uninstalled: boolean }>
    upgrade: (id: string) => Promise<InstalledPlugin>
    reinstall: (id: string) => Promise<InstalledPlugin>
    clearInstalled: () => Promise<{ cleared: boolean; removedCount: number }>
    validate: () => Promise<InstalledPlugin[]>
    listAuditLog: (limit?: number) => Promise<PluginAuditEvent[]>
    adminList: () => Promise<PluginAdminCatalogItem[]>
    adminUpload: (input: PluginAdminUploadVersionInput) => Promise<PluginAdminUploadResult>
    adminCancelUpload: (
      input: PluginAdminCancelUploadInput
    ) => Promise<PluginAdminCancelUploadResult>
    adminInstallLocalVersion: (
      input: PluginAdminLocalVersionInput
    ) => Promise<PluginAdminUploadResult>
    adminUninstallLocalVersion: (
      input: PluginAdminLocalVersionInput
    ) => Promise<PluginAdminLocalVersionRemoveResult>
    onEvent: (callback: (payload: PluginEventPayload) => void) => () => void
  }
  embeddedBrowser: {
    setActiveSession: (sessionKey: string) => Promise<EmbeddedBrowserStatus>
    attachWebview: (params: {
      sessionKey: string
      webContentsId: number
    }) => Promise<EmbeddedBrowserStatus>
    detachWebview: (params: {
      sessionKey: string
      webContentsId: number
    }) => Promise<EmbeddedBrowserStatus>
    setViewBounds: (params: {
      sessionKey: string
      x: number
      y: number
      width: number
      height: number
      visible: boolean
    }) => Promise<EmbeddedBrowserStatus>
    updateSessionUrl: (params: {
      sessionKey: string
      url: string
    }) => Promise<EmbeddedBrowserStatus>
    completeCursorCommand: (params: {
      commandId: string
      ok: boolean
      error?: string
    }) => Promise<unknown>
    setAnnotationMode: (params: {
      sessionKey?: string | null
      mode: 'browse' | 'comment'
      labels: {
        placeholder: string
        add: string
        cancel: string
        hint: string
      }
    }) => Promise<EmbeddedBrowserStatus>
    syncAnnotations: (params: {
      sessionKey?: string | null
      comments: Array<{
        annotationId: string
        label: number
        comment: string
        anchor: {
          kind: 'element' | 'region'
          pageUrl: string
          title?: string
          framePath?: string[]
          frameUrl?: string
          selector?: string
          targetPath?: string
          targetRole?: string
          targetName?: string
          targetDescription?: string
          targetImmediateText?: string
          nearbyText?: string
          documentContext?: string
          isFixed?: boolean
          scrollContainers?: Array<{
            selector: string
            scrollLeft: number
            scrollTop: number
          }>
          viewportPoint: { x: number; y: number }
          viewportRect?: { x: number; y: number; width: number; height: number }
          viewportSize: { width: number; height: number }
        }
      }>
    }) => Promise<EmbeddedBrowserStatus>
    selectAnnotation: (params: {
      sessionKey?: string | null
      annotationId: string
    }) => Promise<EmbeddedBrowserStatus>
    submitAnnotationDraft: (params: {
      sessionKey?: string | null
      annotationId: string
      comment: string
    }) => Promise<EmbeddedBrowserStatus>
    cancelAnnotationDraft: (params: {
      sessionKey?: string | null
      annotationId?: string | null
    }) => Promise<EmbeddedBrowserStatus>
    discardAnnotations: (sessionKey?: string | null) => Promise<EmbeddedBrowserStatus>
    status: () => Promise<EmbeddedBrowserStatus>
    open: (input: string | { sessionKey?: string; url: string }) => Promise<EmbeddedBrowserStatus>
    goBack: (sessionKey: string) => Promise<EmbeddedBrowserStatus>
    goForward: (sessionKey: string) => Promise<EmbeddedBrowserStatus>
    reload: (sessionKey: string) => Promise<EmbeddedBrowserStatus>
    stop: (sessionKey: string) => Promise<EmbeddedBrowserStatus>
    openDevTools: (sessionKey: string) => Promise<EmbeddedBrowserStatus>
    onEvent: (callback: (payload: EmbeddedBrowserEvent) => void) => () => void
  }
  team: {
    status: () => Promise<TeamStatus | null>
    listAgents: () => Promise<TeamAgentDefinition[]>
    create: (teamName: string, cwd?: string) => Promise<TeamStatus>
    destroy: () => Promise<null>
    spawn: (params: {
      name: string
      definitionId: string
      prompt: string
    }) => Promise<{ name: string; definitionId: string; status: 'working' | 'idle' | 'shutdown' }>
    assignTask: (params: {
      teammateName: string
      subject: string
      description: string
    }) => Promise<TeamTask>
    sendMessage: (params: { to: string; text: string; from?: string }) => Promise<{
      id: string
      from: string
      to: string
      type: 'task_assignment' | 'message' | 'broadcast' | 'shutdown_request' | 'idle_notification'
      text: string
      timestamp: string
      read: boolean
      taskId?: string
    }>
    onEvent: (callback: (payload: TeamEvent) => void) => () => void
  }
  featureGates: {
    list: () => Promise<LocalFeatureGateState[]>
    setEnabled: (
      featureKey: LocalFeatureGateKey,
      enabled: boolean
    ) => Promise<LocalFeatureGateState>
  }
  cron: {
    list: () => Promise<CronJob[]>
    runs: (jobId: string) => Promise<CronJobRunSession[]>
    onEvent: (callback: (payload: CronEventPayload) => void) => () => void
    create: (params: CreateCronJobParams) => Promise<CronJob>
    update: (jobId: string, patch: UpdateCronJobPatch) => Promise<CronJob>
    delete: (jobId: string) => Promise<{ deleted: boolean }>
    runNow: (jobId: string) => Promise<CronJob>
    toggle: (jobId: string, active: boolean) => Promise<CronJob>
  }
  sop: {
    list: () => Promise<SopIndexEntry[]>
    get: (sopId: string) => Promise<SopDetail | null>
  }
  projects: {
    list: () => Promise<ProjectEntry[]>
    createFromScratch: () => Promise<ProjectEntry | null>
    addExistingFolder: () => Promise<ProjectEntry | null>
    touch: (path: string) => Promise<ProjectEntry | null>
    setPinned: (path: string, pinned: boolean) => Promise<ProjectEntry>
    rename: (path: string, name: string) => Promise<ProjectEntry>
    remove: (path: string) => Promise<{ removed: boolean }>
  }
  backgroundTerminals: {
    list: (input?: ListBackgroundTerminalsRequest) => Promise<ListBackgroundTerminalsResult>
    terminate: (
      input: TerminateBackgroundTerminalRequest
    ) => Promise<TerminateBackgroundTerminalResult>
    clean: (input?: CleanBackgroundTerminalsRequest) => Promise<CleanBackgroundTerminalsResult>
  }
  autoUpdate: {
    getState: () => Promise<AutoUpdateState>
    check: () => Promise<AutoUpdateState>
    install: () => Promise<AutoUpdateState>
    onStateChange: (callback: (state: AutoUpdateState) => void) => () => void
  }
  app: {
    buildInfo: () => Promise<BuildInfo>
    deviceId: () => Promise<string>
    restart: () => Promise<void>
    openExternal: (url: string) => Promise<void>
    isFullScreen: () => Promise<boolean>
    resolveLinkIcon: (url: string) => Promise<string | null>
    showContextMenu: (request: NativeContextMenuRequest) => Promise<string | null>
    selectFolder: (options?: { defaultPath?: string }) => Promise<string | null>
    getUnreadSessionIds: () => Promise<string[]>
    setMenuBarUnreadSessionIds: (sessionIds: string[]) => Promise<void>
    rendererReady: () => Promise<{ path: string } | null>
    onOpenSession: (
      callback: (payload: {
        sessionId: string
        sessionKind?: 'main' | 'side'
        parentSessionId?: string | null
        cwd?: string
      }) => void
    ) => () => void
    onNavigate: (callback: (payload: { path: string }) => void) => () => void
    onHotkey: (callback: (payload: AppHotkeyPayload) => void) => () => void
    onFullScreenChange: (callback: (payload: { isFullScreen: boolean }) => void) => () => void
  }
  sessionInspector: {
    openWindow: () => Promise<void>
    listSessions: (input?: {
      includeOptional?: boolean
      limit?: number
    }) => Promise<SessionListResult>
    readSessionText: (path: string) => Promise<SessionText>
  }
  notifications: {
    send: (options: SystemNotificationOptions) => Promise<SystemNotificationResult>
  }
  cursorOverlay: {
    setOrigin: (point: { x: number; y: number } | null) => Promise<void>
  }
  computerUseDebug: {
    listTargets: () => Promise<ComputerUseDebugInventory>
    animateOverlay: (params: {
      windowId: number
      pointCount?: number
    }) => Promise<ComputerUseOverlayAnimationResult>
    click: (params: ComputerUseClickToolParams) => Promise<ComputerUseClickToolResult>
    drag: (params: { windowId: number }) => Promise<ComputerUseDragTestResult>
    type: (params: {
      windowId: number
      text: string
      perCharDelayMs?: number
    }) => Promise<Record<string, unknown>>
    pressKey: (params: {
      windowId: number
      key: string
      modifiers?: ComputerUseModifier[]
    }) => Promise<Record<string, unknown>>
    appState: (params: {
      windowId: number
      sourceId?: string | null
    }) => Promise<ComputerUseAppStateResult>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: PichuApi
  }
}
