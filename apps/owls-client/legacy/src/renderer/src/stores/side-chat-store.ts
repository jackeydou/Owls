import { create } from 'zustand'
import { createAgentEventActions } from './session/agent-events'
import { createListenerActions } from './session/listener-actions'
import { createPromptActions } from './session/prompt-actions'
import { createSessionActions } from './session/session-actions'
import type { SessionState, SessionStoreGet, SessionStoreSet } from './session/types'

type PendingComposerText = {
  id: string
  parentSessionId: string
  sideSessionId: string
  text: string
  sourceMessageId?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isExpiredSideSessionError(message: string): boolean {
  return (
    message.startsWith('Unknown side chat session:') ||
    message.startsWith('Unknown session:') ||
    message.includes('does not belong to parent session')
  )
}

type SideChatState = SessionState & {
  parentSessionId: string | null
  parentCwd: string
  expiredSideSessionId: string | null
  sideChatTitlesBySession: Record<string, string>
  pendingComposerTexts: PendingComposerText[]
  loadSideChatSession: (params: {
    sessionId: string
    parentSessionId: string
    cwd: string
  }) => Promise<void>
  openForParent: (params: {
    parentSessionId: string
    cwd?: string
    initialText?: string
    forceNew?: boolean
  }) => Promise<{ sessionId: string; cwd: string; reused: boolean }>
  closeSideChatSession: (sessionId: string) => Promise<void>
  queueComposerText: (
    parentSessionId: string,
    sideSessionId: string,
    text: string,
    sourceMessageId?: string
  ) => void
  removePendingComposerText: (id: string) => void
  resetSideChat: () => Promise<void>
}

type SideChatSessionSnapshot = Pick<
  SessionState,
  | 'sessionId'
  | 'sessionLoadingId'
  | 'activeSessionModel'
  | 'messages'
  | 'streamingAssistant'
  | 'streamingThinking'
  | 'setupStatus'
  | 'pendingReconnectStatus'
  | 'pendingAssistantAttachments'
  | 'pendingRawEvents'
  | 'queuedPrompts'
  | 'busy'
  | 'lastError'
  | 'retryPrompt'
  | 'widgets'
  | 'sessionFiles'
  | 'sessionFilesLoaded'
  | 'sessionFileLoadedDirectories'
  | 'sessionFileLoadingDirectories'
>

function emptySessionSlice(): Pick<
  SessionState,
  | 'sessionId'
  | 'sessionLoadingId'
  | 'activeSessionModel'
  | 'messages'
  | 'streamingAssistant'
  | 'streamingThinking'
  | 'setupStatus'
  | 'pendingReconnectStatus'
  | 'pendingAssistantAttachments'
  | 'pendingRawEvents'
  | 'queuedPrompts'
  | 'busy'
  | 'lastError'
  | 'retryPrompt'
  | 'widgets'
  | 'sessionFiles'
  | 'sessionFilesLoaded'
  | 'sessionFileLoadedDirectories'
  | 'sessionFileLoadingDirectories'
> {
  return {
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
    lastError: null,
    retryPrompt: null,
    widgets: new Map(),
    sessionFiles: [],
    sessionFilesLoaded: false,
    sessionFileLoadedDirectories: [],
    sessionFileLoadingDirectories: []
  }
}

function snapshotSideSession(state: SideChatState): SideChatSessionSnapshot | null {
  if (!state.sessionId) return null
  return {
    sessionId: state.sessionId,
    sessionLoadingId: state.sessionLoadingId,
    activeSessionModel: state.activeSessionModel,
    messages: state.messages,
    streamingAssistant: state.streamingAssistant,
    streamingThinking: state.streamingThinking,
    setupStatus: state.setupStatus,
    pendingReconnectStatus: state.pendingReconnectStatus,
    pendingAssistantAttachments: state.pendingAssistantAttachments,
    pendingRawEvents: state.pendingRawEvents,
    queuedPrompts: state.queuedPrompts,
    busy: state.busy,
    lastError: state.lastError,
    retryPrompt: state.retryPrompt,
    widgets: new Map(state.widgets),
    sessionFiles: state.sessionFiles,
    sessionFilesLoaded: state.sessionFilesLoaded,
    sessionFileLoadedDirectories: state.sessionFileLoadedDirectories,
    sessionFileLoadingDirectories: state.sessionFileLoadingDirectories
  }
}

export const useSideChatStore = create<SideChatState>((set, get) => {
  const sessionGet: SessionStoreGet = () => get()
  const sessionSet: SessionStoreSet = (partial) => {
    if (typeof partial === 'function') {
      set((state) => partial(state))
      return
    }
    set(partial)
  }

  const listenerActions = createListenerActions({ get: sessionGet, set: sessionSet })
  const agentEventActions = createAgentEventActions({ get: sessionGet, set: sessionSet })
  const promptActions = createPromptActions({
    get: sessionGet,
    set: sessionSet,
    onSessionTitleUpdated: (sessionId, title) => {
      set((state) => ({
        sideChatTitlesBySession: {
          ...state.sideChatTitlesBySession,
          [sessionId]: title
        }
      }))
    }
  })
  const sessionActions = createSessionActions({ get: sessionGet, set: sessionSet })
  let openingSideChatPromise: Promise<{ sessionId: string; cwd: string; reused: boolean }> | null =
    null
  let openingSideChatRequestId = 0
  const sessionSnapshots = new Map<string, SideChatSessionSnapshot>()

  const removeSessionKey = <T>(record: Record<string, T>, sessionId: string): Record<string, T> => {
    const { [sessionId]: _removed, ...rest } = record
    return rest
  }

  const sideSessionCleanup = (
    state: SideChatState,
    sessionId: string
  ): Pick<
    SideChatState,
    | 'runningSessionIds'
    | 'waitingSessionIds'
    | 'unreadSessionIds'
    | 'failedSessionIds'
    | 'activeRunIdsBySession'
    | 'activeRunStartedAtsBySession'
    | 'sideChatTitlesBySession'
    | 'pendingComposerTexts'
  > => ({
    runningSessionIds: state.runningSessionIds.filter((id) => id !== sessionId),
    waitingSessionIds: state.waitingSessionIds.filter((id) => id !== sessionId),
    unreadSessionIds: state.unreadSessionIds.filter((id) => id !== sessionId),
    failedSessionIds: state.failedSessionIds.filter((id) => id !== sessionId),
    activeRunIdsBySession: removeSessionKey(state.activeRunIdsBySession, sessionId),
    activeRunStartedAtsBySession: removeSessionKey(state.activeRunStartedAtsBySession, sessionId),
    sideChatTitlesBySession: removeSessionKey(state.sideChatTitlesBySession, sessionId),
    pendingComposerTexts: state.pendingComposerTexts.filter(
      (item) => item.sideSessionId !== sessionId
    )
  })

  const snapshotActiveSession = (): void => {
    const snapshot = snapshotSideSession(get())
    if (!snapshot?.sessionId) return
    sessionSnapshots.set(snapshot.sessionId, snapshot)
  }

  const resetSideChat = async (): Promise<void> => {
    openingSideChatRequestId += 1
    openingSideChatPromise = null
    const state = get()
    const sid = state.sessionId
    if (sid) {
      sessionSnapshots.delete(sid)
    }

    set({
      ...emptySessionSlice(),
      parentSessionId: null,
      parentCwd: '',
      expiredSideSessionId: null,
      ...(sid
        ? sideSessionCleanup(state, sid)
        : {
            pendingComposerTexts: [],
            runningSessionIds: state.runningSessionIds,
            waitingSessionIds: state.waitingSessionIds,
            unreadSessionIds: state.unreadSessionIds,
            failedSessionIds: state.failedSessionIds,
            activeRunIdsBySession: state.activeRunIdsBySession,
            activeRunStartedAtsBySession: state.activeRunStartedAtsBySession,
            sideChatTitlesBySession: state.sideChatTitlesBySession
          })
    })

    if (sid) {
      await window.api.agent.sessionIndexRemove(sid).catch((error) => {
        const message = errorMessage(error)
        if (!message.startsWith('Unknown session:')) {
          throw error
        }
      })
    }
  }

  const ensureSideChatSession = async (
    parentSessionId: string,
    cwd: string | undefined,
    forceNew = false
  ): Promise<{ sessionId: string; cwd: string; reused: boolean }> => {
    const current = get()
    if (!forceNew && current.sessionId && current.parentSessionId === parentSessionId) {
      return { sessionId: current.sessionId, cwd: current.parentCwd || cwd || '', reused: true }
    }

    snapshotActiveSession()
    set({
      parentSessionId,
      parentCwd: cwd ?? '',
      expiredSideSessionId: null,
      lastError: null
    })

    if (openingSideChatPromise && !forceNew) {
      await openingSideChatPromise.catch(() => null)
      const sid = get().sessionId
      if (sid && get().parentSessionId === parentSessionId) {
        return { sessionId: sid, cwd: get().parentCwd || cwd || '', reused: true }
      }
    }

    openingSideChatRequestId += 1
    const requestId = openingSideChatRequestId
    const openPromise = (async (): Promise<{ sessionId: string; cwd: string; reused: boolean }> => {
      try {
        set({ lastError: null })
        const result = await window.api.agent.sideSession({
          parentSessionId,
          forceNew
        })
        if (requestId !== openingSideChatRequestId || get().parentSessionId !== parentSessionId) {
          if (!result.reused) {
            void window.api.agent.sessionIndexRemove(result.sessionId).catch(console.error)
          }
          throw new Error('Side chat request was superseded.')
        }
        set({ parentCwd: result.cwd })
        await sessionActions.loadSession(result.sessionId)
        if (
          requestId !== openingSideChatRequestId ||
          get().parentSessionId !== parentSessionId ||
          get().sessionId !== result.sessionId
        ) {
          if (!result.reused) {
            void window.api.agent.sessionIndexRemove(result.sessionId).catch(console.error)
          }
          throw new Error('Side chat request was superseded.')
        }
        set({ lastError: null })
        return { sessionId: result.sessionId, cwd: result.cwd, reused: result.reused }
      } catch (error) {
        if (requestId === openingSideChatRequestId && get().parentSessionId === parentSessionId) {
          set({ lastError: error instanceof Error ? error.message : String(error) })
        }
        throw error
      }
    })()

    openingSideChatPromise = openPromise
    try {
      return await openPromise
    } finally {
      if (openingSideChatPromise === openPromise) {
        openingSideChatPromise = null
      }
    }
  }

  return {
    ...emptySessionSlice(),
    parentSessionId: null,
    parentCwd: '',
    expiredSideSessionId: null,
    sideChatTitlesBySession: {},
    pendingComposerTexts: [],
    runningSessionIds: [],
    waitingSessionIds: [],
    activeRunIdsBySession: {},
    activeRunStartedAtsBySession: {},
    unreadSessionIds: [],
    unreadSessionIdsLoaded: false,
    failedSessionIds: [],
    unsubscribeSession: null,
    sessionIndex: [],
    sessionIndexLoaded: false,
    sessionIndexSortKey: 'updated',
    filePanelOpen: false,

    ...listenerActions,
    ...agentEventActions,
    ...promptActions,
    ...sessionActions,

    resetSideChat,

    loadSideChatSession: async ({ sessionId, parentSessionId, cwd }) => {
      snapshotActiveSession()
      const entry = await window.api.agent
        .sideSessionEntry({ sessionId, parentSessionId })
        .catch((error) => {
          const message = errorMessage(error)
          if (isExpiredSideSessionError(message)) {
            openingSideChatRequestId += 1
            openingSideChatPromise = null
            sessionSnapshots.delete(sessionId)
            set({
              ...emptySessionSlice(),
              parentSessionId,
              parentCwd: cwd,
              expiredSideSessionId: sessionId,
              lastError: null
            })
            return null
          }
          set({ lastError: message })
          throw error
        })
      if (!entry) return
      openingSideChatRequestId += 1
      openingSideChatPromise = null
      const snapshot = sessionSnapshots.get(sessionId)
      set({
        ...(snapshot ?? emptySessionSlice()),
        parentSessionId,
        parentCwd: entry.cwd || cwd,
        expiredSideSessionId: null,
        sideChatTitlesBySession: {
          ...get().sideChatTitlesBySession,
          [sessionId]: entry.title
        },
        lastError: null
      })
      await sessionActions.loadSession(sessionId).catch((error) => {
        const message = errorMessage(error)
        if (isExpiredSideSessionError(message)) {
          sessionSnapshots.delete(sessionId)
          set({
            ...emptySessionSlice(),
            parentSessionId,
            parentCwd: entry.cwd || cwd,
            expiredSideSessionId: sessionId,
            lastError: null
          })
          return
        }
        set({ lastError: message })
        throw error
      })
    },

    closeSideChatSession: async (sessionId) => {
      const normalizedSessionId = sessionId.trim()
      if (!normalizedSessionId) return
      sessionSnapshots.delete(normalizedSessionId)
      let removeError: unknown = null
      await window.api.agent.sessionIndexRemove(normalizedSessionId).catch((error) => {
        const message = errorMessage(error)
        if (!message.startsWith('Unknown session:')) {
          removeError = error
        }
      })
      if (get().sessionId === normalizedSessionId) {
        openingSideChatRequestId += 1
        openingSideChatPromise = null
        set((state) => ({
          ...emptySessionSlice(),
          parentSessionId: null,
          parentCwd: '',
          expiredSideSessionId: null,
          ...sideSessionCleanup(state, normalizedSessionId)
        }))
      } else {
        set((state) => sideSessionCleanup(state, normalizedSessionId))
      }
      if (removeError) {
        throw removeError
      }
    },

    sendPrompt: async (text, cwd, attachments, options) => {
      const parentSessionId = get().parentSessionId
      if (!parentSessionId) {
        throw new Error('Parent session id is required')
      }
      const sideCwd = cwd || get().parentCwd
      const result = await ensureSideChatSession(parentSessionId, sideCwd)
      const resolvedCwd = result.cwd || sideCwd
      if (!get().sessionId) {
        throw new Error('Side chat session is not ready')
      }
      await promptActions.sendPrompt(text, resolvedCwd, attachments, options)
    },

    steerPrompt: async (text, cwd, attachments, queuedPromptId, options) => {
      const parentSessionId = get().parentSessionId
      if (!parentSessionId) {
        throw new Error('Parent session id is required')
      }
      const sideCwd = cwd || get().parentCwd
      const result = await ensureSideChatSession(parentSessionId, sideCwd)
      const resolvedCwd = result.cwd || sideCwd
      if (!get().sessionId) {
        throw new Error('Side chat session is not ready')
      }
      return promptActions.steerPrompt(text, resolvedCwd, attachments, queuedPromptId, options)
    },

    queueComposerText: (parentSessionId, sideSessionId, text, sourceMessageId) => {
      const normalizedParentSessionId = parentSessionId.trim()
      const normalizedSideSessionId = sideSessionId.trim()
      const trimmed = text.trim()
      if (!normalizedParentSessionId || !normalizedSideSessionId || !trimmed) return
      set((state) => ({
        pendingComposerTexts: [
          ...state.pendingComposerTexts,
          {
            id: crypto.randomUUID(),
            parentSessionId: normalizedParentSessionId,
            sideSessionId: normalizedSideSessionId,
            text: trimmed,
            sourceMessageId
          }
        ]
      }))
    },

    removePendingComposerText: (id) => {
      set((state) => ({
        pendingComposerTexts: state.pendingComposerTexts.filter((item) => item.id !== id)
      }))
    },

    openForParent: async ({ parentSessionId, cwd, initialText, forceNew = false }) => {
      try {
        const result = await ensureSideChatSession(parentSessionId, cwd, forceNew)

        const prompt = initialText?.trim()
        if (prompt) {
          await promptActions.sendPrompt(prompt, result.cwd || cwd || '')
        }
        return result
      } catch (error) {
        set({ lastError: errorMessage(error) })
        throw error
      }
    }
  }
})
