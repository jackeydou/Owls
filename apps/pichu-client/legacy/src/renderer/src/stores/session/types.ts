import type {
  AgentEventPayload,
  FileTreeEntry,
  MessageAttachment,
  SessionIndexSortKey
} from '../../../../preload/index.d'
import type {
  PichuMessageKind,
  PichuMessageVisibility
} from '../../../../shared/agent-message-visibility'
import type { MessagePart } from '../../../../shared/message-parts'
import type { PichuThinkingLevel, SessionModelPreference } from '../../../../shared/model-settings'
import type { ToolWidgetState } from '../../components/tool-widgets/types'

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

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  kind?: PichuMessageKind
  content: string
  runId?: string | null
  runStatus?: 'running' | 'completed' | 'failed' | 'cancelled' | null
  runStartedAt?: string | null
  runCompletedAt?: string | null
  runDurationMs?: number | null
  runError?: string | null
  parts?: MessagePart[]
  visibility?: PichuMessageVisibility
  createdAt?: string
  attachments?: MessageAttachment[]
  reconnectStatus?: ModelReconnectStatus
  toolCallId?: string
  rawEvents?: unknown[]
  errorMessage?: string
  stopReason?: string
}

export type ModelReconnectStatus = {
  lines: string[]
  error?: string
}

export type QueuedPrompt = {
  id: string
  text: string
  agentText?: string
  parts?: MessagePart[]
  cwd: string
  attachments?: MessageAttachment[]
  createdAt: string
}

export type RetryPrompt = {
  text: string
  agentText?: string
  parts?: MessagePart[]
  cwd: string
  attachments?: MessageAttachment[]
}

export type PromptRunOptions = {
  agentText?: string
  parts?: MessagePart[]
}

export type SessionSetupStatus = 'setting-up-workspace'

export type SessionState = {
  sessionId: string | null
  sessionLoadingId: string | null
  activeSessionModel: SessionModelPreference | null
  messages: ChatMessage[]
  streamingAssistant: string
  streamingThinking: boolean
  setupStatus: SessionSetupStatus | null
  pendingReconnectStatus: ModelReconnectStatus | null
  pendingAssistantAttachments: MessageAttachment[]
  pendingRawEvents: unknown[]
  queuedPrompts: QueuedPrompt[]
  busy: boolean
  runningSessionIds: string[]
  waitingSessionIds: string[]
  activeRunIdsBySession: Record<string, string>
  activeRunStartedAtsBySession: Record<string, string>
  unreadSessionIds: string[]
  unreadSessionIdsLoaded: boolean
  failedSessionIds: string[]
  lastError: string | null
  retryPrompt: RetryPrompt | null
  unsubscribeSession: (() => void) | null

  widgets: Map<string, ToolWidgetState>

  sessionIndex: SessionIndexEntry[]
  sessionIndexLoaded: boolean
  sessionIndexSortKey: SessionIndexSortKey
  filePanelOpen: boolean
  sessionFiles: FileTreeEntry[]
  sessionFilesLoaded: boolean
  sessionFileLoadedDirectories: string[]
  sessionFileLoadingDirectories: string[]

  appendAgentEvent: (payload: AgentEventPayload) => void
  sendPrompt: (
    text: string,
    cwd: string,
    attachments?: MessageAttachment[],
    options?: PromptRunOptions
  ) => Promise<void>
  retryLastFailedPrompt: () => Promise<void>
  steerPrompt: (
    text: string,
    cwd: string,
    attachments?: MessageAttachment[],
    queuedPromptId?: string,
    options?: PromptRunOptions
  ) => Promise<boolean>
  steerQueuedPrompt: (queuedPromptId: string) => Promise<void>
  steerQueuedPrompts: (queuedPromptIds: string[]) => Promise<void>
  removeQueuedPrompt: (queuedPromptId: string) => void
  reorderQueuedPrompts: (queuedPromptIds: string[]) => void
  cancel: () => Promise<void>
  bindSessionListener: () => void
  resetConversation: () => void
  toggleFilePanel: () => void

  loadSessionIndex: (sortKey?: SessionIndexSortKey) => Promise<void>
  loadSessionFiles: (directory?: string) => Promise<void>
  hydrateUnreadSessionIds: (sessionIds: string[]) => void
  markSessionUnread: (sessionId: string) => void
  clearSessionUnread: (sessionId: string) => void
  toggleSessionPinned: (sessionId: string, pinned: boolean) => Promise<void>
  reorderPinnedSessions: (sessionIds: string[]) => Promise<void>
  archiveSession: (sessionId: string) => Promise<void>
  importSessionJsonl: (url: string) => Promise<string | null>
  loadSession: (sessionId: string) => Promise<void>
}

export type SessionStoreSet = (
  partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)
) => void

export type SessionStoreGet = () => SessionState
