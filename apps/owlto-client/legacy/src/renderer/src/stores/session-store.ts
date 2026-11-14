import { create } from 'zustand'
import { createAgentEventActions } from './session/agent-events'
import { createListenerActions } from './session/listener-actions'
import { createPromptActions } from './session/prompt-actions'
import { createSessionActions } from './session/session-actions'
import type { SessionState } from './session/types'

export type {
  ChatMessage,
  ModelReconnectStatus,
  SessionIndexEntry,
  SessionSetupStatus
} from './session/types'

export const useSessionStore = create<SessionState>((set, get) => ({
  sessionId: null,
  sessionLoadingId: null,
  activeSessionModel: null,
  messages: [],
  streamingAssistant: '',
  streamingThinking: false,
  setupStatus: null,
  pendingReconnectStatus: null,
  pendingAssistantAttachments: [],
  pendingRawEvents: [],
  queuedPrompts: [],
  busy: false,
  runningSessionIds: [],
  waitingSessionIds: [],
  activeRunIdsBySession: {},
  activeRunStartedAtsBySession: {},
  unreadSessionIds: [],
  unreadSessionIdsLoaded: false,
  failedSessionIds: [],
  lastError: null,
  retryPrompt: null,
  unsubscribeSession: null,

  widgets: new Map(),

  sessionIndex: [],
  sessionIndexLoaded: false,
  sessionIndexSortKey: 'updated',
  filePanelOpen: false,
  sessionFiles: [],
  sessionFilesLoaded: false,
  sessionFileLoadedDirectories: [],
  sessionFileLoadingDirectories: [],

  ...createListenerActions({
    get,
    set,
    shouldMarkSessionUnread: (sessionId, state) =>
      state.sessionId === sessionId ||
      state.sessionIndex.some(
        (entry) => entry.sessionId === sessionId && (entry.sessionKind ?? 'main') === 'main'
      )
  }),
  ...createAgentEventActions({ get, set }),
  ...createPromptActions({ get, set }),
  ...createSessionActions({ get, set })
}))
