import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { PichuMessageVisibility } from '../shared/agent-message-visibility.js'
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
import type { CustomMcpConnectResult, SaveCustomMcpServerInput } from '../shared/custom-mcp.js'
import type {
  ChatDiagnosticEventInput,
  DiagnosticsExportOptions,
  DiagnosticsExportResult
} from '../shared/diagnostics.js'
import type { LocalFeatureGateState } from '../shared/feature-gates.js'
import type {
  CancelHumanInputPayload,
  ContinueAfterHumanInputPayload,
  HumanInputRequestForRenderer,
  SubmitHumanInputPayload
} from '../shared/human-input.js'
import type { ImageGenerationConfigStatus } from '../shared/image-generation-config.js'
import type { MessagePart } from '../shared/message-parts.js'
import type { UserModelConfig } from '../shared/model-config.js'
import type { PichuThinkingLevel } from '../shared/model-settings.js'
import type { OpenAIOAuthStatus } from '../shared/openai-oauth.js'
import type {
  PluginAdminCancelUploadInput,
  PluginAdminLocalVersionInput,
  PluginAdminUploadVersionInput
} from '../shared/plugin-admin.js'
import type { ProjectEntry } from '../shared/projects.js'
import type { SessionImportDeeplinkStatus } from '../shared/session-import-deeplink.js'
import type { SopDetail, SopIndexEntry } from '../shared/sop.js'
import type {
  AgentTrustProfile,
  ToolApprovalAutoReviewEvent,
  ToolApprovalRequestForRenderer,
  ToolApprovalResolvedEvent,
  ToolApprovalResolveRequest
} from '../shared/tool-approval.js'
import type {
  CreateWorkbenchWorkspaceInput,
  DeleteWorkbenchCellInput,
  GetWorkbenchCellInput,
  ListWorkbenchInput,
  RunWorkbenchCellInput,
  SaveToWorkbenchInput,
  SetCurrentWorkbenchWorkspaceInput,
  UpdateWorkbenchLayoutInput
} from '../shared/workbench.js'

const computerUseDebug = {
  listTargets: () => ipcRenderer.invoke('computer-use-debug:list-targets'),
  animateOverlay: (params: { windowId: number; pointCount?: number }) =>
    ipcRenderer.invoke('computer-use-debug:animate-overlay', params),
  click: (params: {
    snapshotId?: string
    ref?: string
    windowId?: number
    position?:
      | { space: 'cg-global-points'; x: number; y: number }
      | { space: 'window-points'; x: number; y: number }
      | {
          space: 'screenshot-pixels'
          px: number
          py: number
          geometry: {
            region: 'window-frame' | 'display-full'
            coordinateSpace: 'cg-global'
            unit: 'point'
            originY: 'top'
            displayId?: number
            displayBounds?: { x: number; y: number; width: number; height: number }
            displayScaleFactor: number
            windowBounds?: { x: number; y: number; width: number; height: number }
            nativePixelSize: { width: number; height: number }
            thumbnailScale: number
          }
        }
    button?: 'left' | 'right' | 'middle'
    count?: number
    modifiers?: Array<'shift' | 'control' | 'option' | 'command' | 'function'>
    holdMs?: number
  }) => ipcRenderer.invoke('computer-use-debug:click', params),
  drag: (params: { windowId: number }) => ipcRenderer.invoke('computer-use-debug:drag', params),
  type: (params: { windowId: number; text: string; perCharDelayMs?: number }) =>
    ipcRenderer.invoke('computer-use-debug:type', params),
  pressKey: (params: {
    windowId: number
    key: string
    modifiers?: Array<'shift' | 'control' | 'option' | 'command' | 'function'>
  }) => ipcRenderer.invoke('computer-use-debug:press-key', params),
  appState: (params: { windowId: number; sourceId?: string | null }) =>
    ipcRenderer.invoke('computer-use-debug:app-state', params)
}

const api = {
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    save: (model: UserModelConfig, previousId?: string) =>
      ipcRenderer.invoke('models:save', { model, previousId }),
    delete: (modelId: string) => ipcRenderer.invoke('models:delete', modelId)
  },
  customMcp: {
    list: () => ipcRenderer.invoke('custom-mcp:list'),
    save: (server: SaveCustomMcpServerInput) => ipcRenderer.invoke('custom-mcp:save', server),
    delete: (serverId: string) => ipcRenderer.invoke('custom-mcp:delete', serverId),
    connect: (serverId: string): Promise<CustomMcpConnectResult> =>
      ipcRenderer.invoke('custom-mcp:connect', serverId),
    disconnect: (serverId: string) => ipcRenderer.invoke('custom-mcp:disconnect', serverId)
  },
  openAIOAuth: {
    get: (): Promise<OpenAIOAuthStatus> => ipcRenderer.invoke('openai-oauth:get'),
    login: (): Promise<OpenAIOAuthStatus> => ipcRenderer.invoke('openai-oauth:login'),
    logout: (): Promise<OpenAIOAuthStatus> => ipcRenderer.invoke('openai-oauth:logout'),
    setEnabledModels: (modelIds: string[]): Promise<OpenAIOAuthStatus> =>
      ipcRenderer.invoke('openai-oauth:set-enabled-models', modelIds)
  },
  imageGenerationConfig: {
    get: (): Promise<ImageGenerationConfigStatus> =>
      ipcRenderer.invoke('image-generation-config:get'),
    save: (apiKey: string): Promise<ImageGenerationConfigStatus> =>
      ipcRenderer.invoke('image-generation-config:save', apiKey),
    clear: (): Promise<ImageGenerationConfigStatus> =>
      ipcRenderer.invoke('image-generation-config:clear')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
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
    }) => ipcRenderer.invoke('settings:set', patch)
  },
  diagnostics: {
    recordChatEvent: (input: ChatDiagnosticEventInput): Promise<void> =>
      ipcRenderer.invoke('diagnostics:record-chat-event', input),
    export: (options?: DiagnosticsExportOptions): Promise<DiagnosticsExportResult> =>
      ipcRenderer.invoke('diagnostics:export', options)
  },
  featureGates: {
    list: (): Promise<LocalFeatureGateState[]> => ipcRenderer.invoke('feature-gates:list'),
    setEnabled: (
      featureKey: LocalFeatureGateState['key'],
      enabled: boolean
    ): Promise<LocalFeatureGateState> =>
      ipcRenderer.invoke('feature-gates:set-enabled', { featureKey, enabled })
  },
  agent: {
    newSession: (
      cwd?: string,
      model?: string,
      thinkingLevel?: PichuThinkingLevel,
      titleHint?: string
    ) => ipcRenderer.invoke('agent:new-session', { cwd, model, thinkingLevel, titleHint }),

    resumeSession: (sessionId: string) => ipcRenderer.invoke('agent:resume-session', sessionId),

    sideSessionEntry: (params: { sessionId: string; parentSessionId: string }) =>
      ipcRenderer.invoke('agent:side-session-entry', params),

    sideSession: (params: {
      parentSessionId: string
      cwd?: string
      model?: string
      thinkingLevel?: PichuThinkingLevel
      forceNew?: boolean
    }) => ipcRenderer.invoke('agent:side-session', params),

    prompt: (
      sessionId: string,
      text: string,
      options?: { hasImages?: boolean; parts?: MessagePart[] }
    ) =>
      ipcRenderer.invoke('agent:prompt', {
        sessionId,
        text,
        hasImages: options?.hasImages,
        parts: options?.parts
      }),

    steer: (
      sessionId: string,
      text: string,
      options?: { hasImages?: boolean; expectedRunId?: string; parts?: MessagePart[] }
    ) =>
      ipcRenderer.invoke('agent:steer', {
        sessionId,
        text,
        hasImages: options?.hasImages,
        expectedRunId: options?.expectedRunId,
        parts: options?.parts
      }),

    cancel: (sessionId?: string) => ipcRenderer.invoke('agent:cancel', sessionId),

    status: () => ipcRenderer.invoke('agent:status'),

    listHumanInputs: (sessionId?: string) =>
      ipcRenderer.invoke('agent:list-human-inputs', sessionId),

    submitHumanInput: (payload: SubmitHumanInputPayload) =>
      ipcRenderer.invoke('agent:submit-human-input', payload),

    cancelHumanInput: (payload: CancelHumanInputPayload) =>
      ipcRenderer.invoke('agent:cancel-human-input', payload),

    continueAfterHumanInput: (payload: ContinueAfterHumanInputPayload) =>
      ipcRenderer.invoke('agent:continue-after-human-input', payload),

    onHumanInputRequested: (callback: (request: HumanInputRequestForRenderer) => void) => {
      const listener = (_: unknown, request: HumanInputRequestForRenderer) => {
        callback(request)
      }
      ipcRenderer.on('agent:human-input-requested', listener)
      return () => ipcRenderer.removeListener('agent:human-input-requested', listener)
    },

    onHumanInputUpdated: (callback: (request: HumanInputRequestForRenderer) => void) => {
      const listener = (_: unknown, request: HumanInputRequestForRenderer) => {
        callback(request)
      }
      ipcRenderer.on('agent:human-input-updated', listener)
      return () => ipcRenderer.removeListener('agent:human-input-updated', listener)
    },

    dispose: (sessionId?: string) => ipcRenderer.invoke('agent:dispose', sessionId),

    setSessionModel: (payload: {
      sessionId: string
      modelId: string
      thinkingLevel: PichuThinkingLevel
    }) => ipcRenderer.invoke('agent:set-session-model', payload),

    sessionIndex: (sortKey?: 'updated' | 'created') =>
      ipcRenderer.invoke('agent:session-index', { sortKey }),

    sessionFiles: (sessionId: string, directory?: string) =>
      ipcRenderer.invoke('agent:session-files', { sessionId, directory }),

    readSessionFile: (sessionId: string, filePath: string) =>
      ipcRenderer.invoke('agent:read-session-file', { sessionId, filePath }),

    sessionFileUrl: (sessionId: string, filePath: string) =>
      ipcRenderer.invoke('agent:session-file-url', { sessionId, filePath }),

    sessionIndexUpdateTitle: (sessionId: string, title: string) =>
      ipcRenderer.invoke('agent:session-index-update-title', sessionId, title),

    sessionIndexSetPinned: (sessionId: string, pinned: boolean) =>
      ipcRenderer.invoke('agent:session-index-set-pinned', sessionId, pinned),

    sessionIndexReorderPinned: (sessionIds: string[]) =>
      ipcRenderer.invoke('agent:session-index-reorder-pinned', sessionIds),

    generateSessionTitle: (
      sessionId: string,
      fallbackText: string,
      options?: { hasImages?: boolean }
    ) =>
      ipcRenderer.invoke('agent:generate-session-title', {
        sessionId,
        fallbackText,
        hasImages: options?.hasImages
      }),

    sessionIndexRemove: (sessionId: string) =>
      ipcRenderer.invoke('agent:session-index-remove', sessionId),

    sessionIndexArchive: (sessionId: string) =>
      ipcRenderer.invoke('agent:session-index-archive', sessionId),

    archivedSessionIndex: () => ipcRenderer.invoke('agent:archived-session-index'),

    sessionIndexUnarchive: (sessionId: string) =>
      ipcRenderer.invoke('agent:session-index-unarchive', sessionId),

    archivedSessionDelete: (sessionId: string) =>
      ipcRenderer.invoke('agent:archived-session-delete', sessionId),

    archivedSessionsDeleteAll: () => ipcRenderer.invoke('agent:archived-sessions-delete-all'),

    sessionImportJsonl: (url: string, options?: { force?: boolean }) =>
      ipcRenderer.invoke('agent:session-import-jsonl', {
        url,
        force: options?.force === true
      }),

    sessionImportDeeplinkStatus: () => ipcRenderer.invoke('agent:session-import-deeplink-status'),

    clearSessionImportDeeplinkStatus: () =>
      ipcRenderer.invoke('agent:session-import-deeplink-clear'),

    listSkills: () => ipcRenderer.invoke('agent:list-skills'),

    readSkill: (filePath: string) => ipcRenderer.invoke('agent:read-skill', filePath),

    openSkill: (filePath: string) => ipcRenderer.invoke('agent:open-skill', filePath),

    deleteSkill: (skillName: string) => ipcRenderer.invoke('agent:delete-skill', skillName),

    listModels: () => ipcRenderer.invoke('agent:list-models'),

    contextUsage: (sessionId: string) => ipcRenderer.invoke('agent:context-usage', sessionId),

    usageStats: () => ipcRenderer.invoke('agent:usage-stats'),

    assistantDraft: (sessionId: string) => ipcRenderer.invoke('agent:assistant-draft', sessionId),

    onEvent: (callback: (payload: unknown) => void): (() => void) => {
      const listener = (_: unknown, data: unknown) => {
        callback(data)
      }
      ipcRenderer.on('agent:event', listener)
      return () => {
        ipcRenderer.removeListener('agent:event', listener)
      }
    },

    onRunState: (callback: (payload: unknown) => void): (() => void) => {
      const listener = (_: unknown, data: unknown) => {
        callback(data)
      }
      ipcRenderer.on('agent:run-state', listener)
      return () => {
        ipcRenderer.removeListener('agent:run-state', listener)
      }
    },

    onSessionImportDeeplinkStatus: (
      callback: (payload: SessionImportDeeplinkStatus) => void
    ): (() => void) => {
      const listener = (_: unknown, data: SessionImportDeeplinkStatus) => {
        callback(data)
      }
      ipcRenderer.on('agent:session-import-deeplink-status', listener)
      return () => {
        ipcRenderer.removeListener('agent:session-import-deeplink-status', listener)
      }
    }
  },
  toolApprovals: {
    list: () => ipcRenderer.invoke('tool-approval:list'),
    resolve: (payload: ToolApprovalResolveRequest) =>
      ipcRenderer.invoke('tool-approval:resolve', payload),
    onRequested: (callback: (request: ToolApprovalRequestForRenderer) => void) => {
      const listener = (_: unknown, request: ToolApprovalRequestForRenderer) => {
        callback(request)
      }
      ipcRenderer.on('tool-approval:requested', listener)
      return () => ipcRenderer.removeListener('tool-approval:requested', listener)
    },
    onResolved: (callback: (event: ToolApprovalResolvedEvent) => void) => {
      const listener = (_: unknown, event: ToolApprovalResolvedEvent) => {
        callback(event)
      }
      ipcRenderer.on('tool-approval:resolved', listener)
      return () => ipcRenderer.removeListener('tool-approval:resolved', listener)
    },
    onAutoReviewStarted: (callback: (event: ToolApprovalAutoReviewEvent) => void) => {
      const listener = (_: unknown, event: ToolApprovalAutoReviewEvent) => {
        callback(event)
      }
      ipcRenderer.on('tool-approval:auto-review-started', listener)
      return () => ipcRenderer.removeListener('tool-approval:auto-review-started', listener)
    },
    onAutoReviewCompleted: (callback: (event: ToolApprovalAutoReviewEvent) => void) => {
      const listener = (_: unknown, event: ToolApprovalAutoReviewEvent) => {
        callback(event)
      }
      ipcRenderer.on('tool-approval:auto-review-completed', listener)
      return () => ipcRenderer.removeListener('tool-approval:auto-review-completed', listener)
    }
  },
  messages: {
    add: (msg: {
      sessionId: string
      role: string
      content: string
      agentContent?: string | null
      visibility?: PichuMessageVisibility | null
      attachments?: unknown[]
      parts?: MessagePart[]
      persistRuntimeContext?: boolean | null
      modelId?: string | null
      modelProvider?: string | null
      modelApi?: string | null
      modelUsageJson?: string | null
    }) => ipcRenderer.invoke('messages:add', msg),

    list: (sessionId: string) => ipcRenderer.invoke('messages:list', sessionId),

    search: (query: { text: string; limit?: number }) =>
      ipcRenderer.invoke('messages:search', query),

    onUpdated: (callback: (payload: unknown) => void): (() => void) => {
      const listener = (_: unknown, data: unknown) => {
        callback(data)
      }
      ipcRenderer.on('messages:updated', listener)
      return () => {
        ipcRenderer.removeListener('messages:updated', listener)
      }
    }
  },
  attachments: {
    pick: () => ipcRenderer.invoke('attachments:pick'),
    statPaths: (items: Array<{ path: string; name?: string; mimeType?: string | null }>) =>
      ipcRenderer.invoke('attachments:stat-paths', items),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    saveClipboardImage: (input: { name?: string; mimeType: string; data: ArrayBuffer }) =>
      ipcRenderer.invoke('attachments:save-clipboard-image', input),
    saveCommentScreenshot: (input: { name?: string; mimeType: string; data: ArrayBuffer }) =>
      ipcRenderer.invoke('attachments:save-comment-screenshot', input),
    readImageDataUrl: (path: string) => ipcRenderer.invoke('attachments:read-image-data-url', path),
    readTextFile: (path: string) => ipcRenderer.invoke('attachments:read-text-file', path),
    reveal: (path: string) => ipcRenderer.invoke('attachments:reveal', path),
    open: (path: string) => ipcRenderer.invoke('attachments:open', path),
    openFolder: (path: string) => ipcRenderer.invoke('attachments:open-folder', path),
    saveCopy: (path: string) => ipcRenderer.invoke('attachments:save-copy', path)
  },
  artifacts: {
    list: () => ipcRenderer.invoke('artifacts:list'),
    save: (request: unknown) => ipcRenderer.invoke('artifacts:save', request),
    delete: (id: string) => ipcRenderer.invoke('artifacts:delete', id)
  },
  workbench: {
    createWorkspace: (input: CreateWorkbenchWorkspaceInput) =>
      ipcRenderer.invoke('workbench:create-workspace', input),
    listWorkspaces: () => ipcRenderer.invoke('workbench:list-workspaces'),
    setCurrentWorkspace: (input: SetCurrentWorkbenchWorkspaceInput) =>
      ipcRenderer.invoke('workbench:set-current-workspace', input),
    save: (input: SaveToWorkbenchInput) => ipcRenderer.invoke('workbench:save', input),
    list: (input?: ListWorkbenchInput) => ipcRenderer.invoke('workbench:list', input),
    getCell: (input: GetWorkbenchCellInput) => ipcRenderer.invoke('workbench:get-cell', input),
    deleteCell: (input: DeleteWorkbenchCellInput) =>
      ipcRenderer.invoke('workbench:delete-cell', input),
    updateLayout: (input: UpdateWorkbenchLayoutInput) =>
      ipcRenderer.invoke('workbench:update-layout', input),
    runCell: (input: RunWorkbenchCellInput) => ipcRenderer.invoke('workbench:run-cell', input)
  },
  plugins: {
    listMarketplaces: () => ipcRenderer.invoke('plugins:list-marketplaces'),
    listAvailable: () => ipcRenderer.invoke('plugins:list-available'),
    listInstalled: () => ipcRenderer.invoke('plugins:list-installed'),
    refreshMarketplaces: (options?: {
      source?: 'startup' | 'page_load' | 'manual' | 'post_action'
    }) => ipcRenderer.invoke('plugins:refresh-marketplaces', options),
    install: (params: { marketplaceName: string; pluginName: string }) =>
      ipcRenderer.invoke('plugins:install', params),
    enable: (id: string) => ipcRenderer.invoke('plugins:enable', id),
    disable: (id: string) => ipcRenderer.invoke('plugins:disable', id),
    uninstall: (id: string) => ipcRenderer.invoke('plugins:uninstall', id),
    upgrade: (id: string) => ipcRenderer.invoke('plugins:upgrade', id),
    reinstall: (id: string) => ipcRenderer.invoke('plugins:reinstall', id),
    clearInstalled: () => ipcRenderer.invoke('plugins:clear-installed'),
    validate: () => ipcRenderer.invoke('plugins:validate'),
    listAuditLog: (limit?: number) => ipcRenderer.invoke('plugins:list-audit-log', limit),
    adminList: () => ipcRenderer.invoke('plugins:admin-list'),
    adminUpload: (input: PluginAdminUploadVersionInput) =>
      ipcRenderer.invoke('plugins:admin-upload', input),
    adminCancelUpload: (input: PluginAdminCancelUploadInput) =>
      ipcRenderer.invoke('plugins:admin-cancel-upload', input),
    adminInstallLocalVersion: (input: PluginAdminLocalVersionInput) =>
      ipcRenderer.invoke('plugins:admin-install-local-version', input),
    adminUninstallLocalVersion: (input: PluginAdminLocalVersionInput) =>
      ipcRenderer.invoke('plugins:admin-uninstall-local-version', input),
    onEvent: (callback: (payload: unknown) => void): (() => void) => {
      const listener = (_: unknown, data: unknown) => {
        callback(data)
      }
      ipcRenderer.on('plugins:event', listener)
      return () => {
        ipcRenderer.removeListener('plugins:event', listener)
      }
    }
  },
  embeddedBrowser: {
    setActiveSession: (sessionKey: string) =>
      ipcRenderer.invoke('embedded-browser:set-active-session', sessionKey),
    attachWebview: (params: { sessionKey: string; webContentsId: number }) =>
      ipcRenderer.invoke('embedded-browser:attach-webview', params),
    detachWebview: (params: { sessionKey: string; webContentsId: number }) =>
      ipcRenderer.invoke('embedded-browser:detach-webview', params),
    setViewBounds: (params: {
      sessionKey: string
      x: number
      y: number
      width: number
      height: number
      visible: boolean
    }) => ipcRenderer.invoke('embedded-browser:set-view-bounds', params),
    updateSessionUrl: (params: { sessionKey: string; url: string }) =>
      ipcRenderer.invoke('embedded-browser:update-session-url', params),
    completeCursorCommand: (params: { commandId: string; ok: boolean; error?: string }) =>
      ipcRenderer.invoke('embedded-browser:cursor-command-complete', params),
    setAnnotationMode: (params: {
      sessionKey?: string | null
      mode: 'browse' | 'comment'
      labels: {
        placeholder: string
        add: string
        cancel: string
        hint: string
      }
    }) => ipcRenderer.invoke('embedded-browser:set-annotation-mode', params),
    syncAnnotations: (params: { sessionKey?: string | null; comments: unknown[] }) =>
      ipcRenderer.invoke('embedded-browser:sync-annotations', params),
    selectAnnotation: (params: { sessionKey?: string | null; annotationId: string }) =>
      ipcRenderer.invoke('embedded-browser:select-annotation', params),
    submitAnnotationDraft: (params: {
      sessionKey?: string | null
      annotationId: string
      comment: string
    }) => ipcRenderer.invoke('embedded-browser:submit-annotation-draft', params),
    cancelAnnotationDraft: (params: { sessionKey?: string | null; annotationId?: string | null }) =>
      ipcRenderer.invoke('embedded-browser:cancel-annotation-draft', params),
    discardAnnotations: (sessionKey?: string | null) =>
      ipcRenderer.invoke('embedded-browser:discard-annotations', sessionKey),
    status: () => ipcRenderer.invoke('embedded-browser:status'),
    open: (input: string | { sessionKey?: string; url: string }) =>
      ipcRenderer.invoke('embedded-browser:open', input),
    goBack: (sessionKey: string) => ipcRenderer.invoke('embedded-browser:go-back', sessionKey),
    goForward: (sessionKey: string) =>
      ipcRenderer.invoke('embedded-browser:go-forward', sessionKey),
    reload: (sessionKey: string) => ipcRenderer.invoke('embedded-browser:reload', sessionKey),
    stop: (sessionKey: string) => ipcRenderer.invoke('embedded-browser:stop', sessionKey),
    openDevTools: (sessionKey: string) =>
      ipcRenderer.invoke('embedded-browser:open-devtools', sessionKey),
    onEvent: (callback: (payload: unknown) => void): (() => void) => {
      const listener = (_: unknown, data: unknown) => {
        callback(data)
      }
      ipcRenderer.on('embedded-browser:event', listener)
      return () => {
        ipcRenderer.removeListener('embedded-browser:event', listener)
      }
    }
  },
  team: {
    status: () => ipcRenderer.invoke('team:status'),
    listAgents: () => ipcRenderer.invoke('team:list-agents'),
    create: (teamName: string, cwd?: string) => ipcRenderer.invoke('team:create', teamName, cwd),
    destroy: () => ipcRenderer.invoke('team:destroy'),
    spawn: (params: { name: string; definitionId: string; prompt: string }) =>
      ipcRenderer.invoke('team:spawn', params),
    assignTask: (params: { teammateName: string; subject: string; description: string }) =>
      ipcRenderer.invoke('team:assign-task', params),
    sendMessage: (params: { to: string; text: string; from?: string }) =>
      ipcRenderer.invoke('team:send-message', params),
    onEvent: (callback: (payload: unknown) => void): (() => void) => {
      const listener = (_: unknown, data: unknown) => {
        callback(data)
      }
      ipcRenderer.on('team:event', listener)
      return () => {
        ipcRenderer.removeListener('team:event', listener)
      }
    }
  },
  cron: {
    list: () => ipcRenderer.invoke('cron:list'),
    runs: (jobId: string) => ipcRenderer.invoke('cron:runs', jobId),
    onEvent: (callback: (payload: unknown) => void): (() => void) => {
      const listener = (_: unknown, data: unknown) => {
        callback(data)
      }
      ipcRenderer.on('cron:event', listener)
      return () => {
        ipcRenderer.removeListener('cron:event', listener)
      }
    },
    create: (params: {
      name: string
      schedule: string
      prompt: string
      cwd?: string
      active?: boolean
    }) => ipcRenderer.invoke('cron:create', params),
    update: (
      jobId: string,
      patch: Partial<{
        name: string
        schedule: string
        prompt: string
        cwd: string
      }>
    ) => ipcRenderer.invoke('cron:update', jobId, patch),
    delete: (jobId: string) => ipcRenderer.invoke('cron:delete', jobId),
    runNow: (jobId: string) => ipcRenderer.invoke('cron:run-now', jobId),
    toggle: (jobId: string, active: boolean) => ipcRenderer.invoke('cron:toggle', jobId, active)
  },
  sop: {
    list: (): Promise<SopIndexEntry[]> => ipcRenderer.invoke('sop:list'),
    get: (sopId: string): Promise<SopDetail | null> => ipcRenderer.invoke('sop:get', sopId)
  },
  projects: {
    list: (): Promise<ProjectEntry[]> => ipcRenderer.invoke('projects:list'),
    createFromScratch: (): Promise<ProjectEntry | null> =>
      ipcRenderer.invoke('projects:create-from-scratch'),
    addExistingFolder: (): Promise<ProjectEntry | null> =>
      ipcRenderer.invoke('projects:add-existing-folder'),
    touch: (path: string): Promise<ProjectEntry | null> =>
      ipcRenderer.invoke('projects:touch', path),
    setPinned: (path: string, pinned: boolean): Promise<ProjectEntry> =>
      ipcRenderer.invoke('projects:set-pinned', path, pinned),
    rename: (path: string, name: string): Promise<ProjectEntry> =>
      ipcRenderer.invoke('projects:rename', path, name),
    remove: (path: string): Promise<{ removed: boolean }> =>
      ipcRenderer.invoke('projects:remove', path)
  },
  backgroundTerminals: {
    list: (input?: ListBackgroundTerminalsRequest): Promise<ListBackgroundTerminalsResult> =>
      ipcRenderer.invoke('background-terminals:list', input),
    terminate: (
      input: TerminateBackgroundTerminalRequest
    ): Promise<TerminateBackgroundTerminalResult> =>
      ipcRenderer.invoke('background-terminals:terminate', input),
    clean: (input?: CleanBackgroundTerminalsRequest): Promise<CleanBackgroundTerminalsResult> =>
      ipcRenderer.invoke('background-terminals:clean', input)
  },
  autoUpdate: {
    getState: (): Promise<AutoUpdateState> => ipcRenderer.invoke('auto-update:get-state'),
    check: (): Promise<AutoUpdateState> => ipcRenderer.invoke('auto-update:check'),
    install: (): Promise<AutoUpdateState> => ipcRenderer.invoke('auto-update:install'),
    onStateChange: (callback: (state: AutoUpdateState) => void): (() => void) => {
      const listener = (_: unknown, nextState: AutoUpdateState) => callback(nextState)
      ipcRenderer.on('auto-update:state', listener)
      return () => ipcRenderer.removeListener('auto-update:state', listener)
    }
  },
  app: {
    buildInfo: () => ipcRenderer.invoke('app:build-info'),
    deviceId: () => ipcRenderer.invoke('app:device-id'),
    restart: () => ipcRenderer.invoke('app:restart'),
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
    isFullScreen: () => ipcRenderer.invoke('app:is-full-screen'),
    resolveLinkIcon: (url: string) => ipcRenderer.invoke('app:resolve-link-icon', url),
    showContextMenu: (request: unknown) => ipcRenderer.invoke('app:show-context-menu', request),
    selectFolder: (options?: { defaultPath?: string }) =>
      ipcRenderer.invoke('app:select-folder', options),
    getUnreadSessionIds: () => ipcRenderer.invoke('app:get-unread-session-ids'),
    setMenuBarUnreadSessionIds: (sessionIds: string[]) =>
      ipcRenderer.invoke('app:set-menu-bar-unread-session-ids', sessionIds),
    rendererReady: () => ipcRenderer.invoke('app:renderer-ready'),
    onOpenSession: (
      callback: (payload: {
        sessionId: string
        sessionKind?: 'main' | 'side'
        parentSessionId?: string | null
        cwd?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _: unknown,
        data: {
          sessionId: string
          sessionKind?: 'main' | 'side'
          parentSessionId?: string | null
          cwd?: string
        }
      ) => {
        callback(data)
      }
      ipcRenderer.on('app:open-session', listener)
      return () => {
        ipcRenderer.removeListener('app:open-session', listener)
      }
    },
    onNavigate: (callback: (payload: { path: string }) => void): (() => void) => {
      const listener = (_: unknown, data: { path: string }) => {
        callback(data)
      }
      ipcRenderer.on('app:navigate', listener)
      return () => {
        ipcRenderer.removeListener('app:navigate', listener)
      }
    },
    onHotkey: (callback: (payload: AppHotkeyPayload) => void): (() => void) => {
      const listener = (_: unknown, data: AppHotkeyPayload) => {
        callback(data)
      }
      ipcRenderer.on('app:hotkey', listener)
      return () => {
        ipcRenderer.removeListener('app:hotkey', listener)
      }
    },
    onFullScreenChange: (callback: (payload: { isFullScreen: boolean }) => void): (() => void) => {
      const listener = (_: unknown, data: { isFullScreen: boolean }) => {
        callback(data)
      }
      ipcRenderer.on('app:full-screen-change', listener)
      return () => {
        ipcRenderer.removeListener('app:full-screen-change', listener)
      }
    }
  },
  sessionInspector: {
    openWindow: () => ipcRenderer.invoke('session-inspector:open-window'),
    listSessions: (input?: { includeOptional?: boolean; limit?: number }) =>
      ipcRenderer.invoke('session-inspector:list-sessions', input),
    readSessionText: (path: string) =>
      ipcRenderer.invoke('session-inspector:read-session-text', path)
  },
  notifications: {
    send: (options: { title: string; body?: string; subtitle?: string; silent?: boolean }) =>
      ipcRenderer.invoke('notifications:send', options)
  },
  cursorOverlay: {
    /**
     * Tell the main process where the chat input is on screen so the
     * virtual cursor first materialises right under it. Pass `null` to
     * clear (e.g. when the input unmounts). Coordinates must be in CG
     * global points — `window.screenX/Y + getBoundingClientRect()` works
     * on macOS without further conversion.
     */
    setOrigin: (point: { x: number; y: number } | null) =>
      ipcRenderer.invoke('cursor-overlay:set-origin', point)
  },
  computerUseDebug: computerUseDebug
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error (define in dts)
  window.electron = electronAPI
  // @ts-expect-error (define in dts)
  window.api = api
}
