import type { MessageRow } from '../../../../preload/index.d'
import { useEmbeddedBrowserStore } from '../embedded-browser-store'
import { buildLoadedSessionView, mergeLoadedAndLiveMessages } from './messages'
import { mergeSessionDirectoryEntries, normalizeSessionFileDirectory } from './session-files'
import { reconcileSessionIndex } from './session-index'
import {
  clearSessionFailed,
  clearSessionUnread,
  hydrateUnreadSessionIds,
  markSessionUnread
} from './session-status'
import type { SessionState, SessionStoreGet, SessionStoreSet } from './types'

type SessionActions = Pick<
  SessionState,
  | 'resetConversation'
  | 'toggleFilePanel'
  | 'loadSessionIndex'
  | 'loadSessionFiles'
  | 'hydrateUnreadSessionIds'
  | 'markSessionUnread'
  | 'clearSessionUnread'
  | 'toggleSessionPinned'
  | 'reorderPinnedSessions'
  | 'archiveSession'
  | 'importSessionJsonl'
  | 'loadSession'
>

const sessionFileLoadRequests = new Map<string, Promise<void>>()

function mergeAssistantDraft(snapshot: string, live: string): string {
  if (!snapshot) return live
  if (!live) return snapshot
  if (snapshot === live) return snapshot
  if (snapshot.startsWith(live)) return snapshot
  if (live.startsWith(snapshot)) return live
  return snapshot.length >= live.length ? snapshot : live
}

async function loadPersistedSessionView(
  sessionId: string
): Promise<ReturnType<typeof buildLoadedSessionView>> {
  const rows = (await window.api.messages.list(sessionId)) as MessageRow[]
  const humanInputs = await window.api.agent.listHumanInputs(sessionId)
  return buildLoadedSessionView({ rows, humanInputs })
}

export function createSessionActions({
  get,
  set
}: {
  get: SessionStoreGet
  set: SessionStoreSet
}): SessionActions {
  return {
    resetConversation: () => {
      const sid = get().sessionId
      if (sid && !get().runningSessionIds.includes(sid)) {
        void window.api.agent.dispose(sid)
      }

      useEmbeddedBrowserStore.getState().resetDraft()
      set({
        sessionId: null,
        sessionLoadingId: null,
        activeSessionModel: null,
        messages: [],
        streamingAssistant: '',
        streamingThinking: false,
        pendingReconnectStatus: null,
        pendingAssistantAttachments: [],
        pendingRawEvents: [],
        queuedPrompts: [],
        busy: false,
        waitingSessionIds: sid ? get().waitingSessionIds.filter((id) => id !== sid) : [],
        lastError: null,
        retryPrompt: null,
        widgets: new Map(),
        filePanelOpen: false,
        sessionFiles: [],
        sessionFilesLoaded: false,
        sessionFileLoadedDirectories: [],
        sessionFileLoadingDirectories: []
      })
    },

    toggleFilePanel: () => {
      set((state) => ({
        filePanelOpen: !state.filePanelOpen
      }))
    },

    loadSessionIndex: async (sortKey = 'updated') => {
      try {
        const entries = await window.api.agent.sessionIndex(sortKey)
        set((state) => {
          const sessionIndex = reconcileSessionIndex(state.sessionIndex, entries)
          if (
            state.sessionIndex === sessionIndex &&
            state.sessionIndexLoaded &&
            state.sessionIndexSortKey === sortKey
          ) {
            return state
          }

          return {
            sessionIndex,
            sessionIndexLoaded: true,
            sessionIndexSortKey: sortKey
          }
        })
      } catch (error) {
        console.error('Failed to load session index', error)
        set({ sessionIndexLoaded: true, sessionIndexSortKey: sortKey })
      }
    },

    loadSessionFiles: async (directory = '') => {
      const sessionId = get().sessionId
      const normalizedDirectory = normalizeSessionFileDirectory(directory)
      if (!sessionId) {
        set({
          sessionFiles: [],
          sessionFilesLoaded: false,
          sessionFileLoadedDirectories: [],
          sessionFileLoadingDirectories: []
        })
        return
      }

      const requestKey = `${sessionId}\0${normalizedDirectory}`
      const existingRequest = sessionFileLoadRequests.get(requestKey)
      if (existingRequest) {
        await existingRequest
        return
      }

      const request = (async () => {
        set((state) => ({
          sessionFileLoadingDirectories: state.sessionFileLoadingDirectories.includes(
            normalizedDirectory
          )
            ? state.sessionFileLoadingDirectories
            : [...state.sessionFileLoadingDirectories, normalizedDirectory]
        }))

        try {
          const sessionFiles = await window.api.agent.sessionFiles(sessionId, normalizedDirectory)
          if (get().sessionId !== sessionId) return
          set((state) => ({
            sessionFiles: mergeSessionDirectoryEntries(
              state.sessionFiles,
              normalizedDirectory,
              sessionFiles
            ),
            sessionFilesLoaded: normalizedDirectory ? state.sessionFilesLoaded : true,
            sessionFileLoadedDirectories: normalizedDirectory
              ? state.sessionFileLoadedDirectories.includes(normalizedDirectory)
                ? state.sessionFileLoadedDirectories
                : [...state.sessionFileLoadedDirectories, normalizedDirectory]
              : [''],
            sessionFileLoadingDirectories: state.sessionFileLoadingDirectories.filter(
              (item) => item !== normalizedDirectory
            )
          }))
        } catch (error) {
          console.error('Failed to load session files', error)
          if (get().sessionId !== sessionId) return
          set((state) => ({
            sessionFiles: normalizedDirectory ? state.sessionFiles : [],
            sessionFilesLoaded: normalizedDirectory ? state.sessionFilesLoaded : true,
            sessionFileLoadingDirectories: state.sessionFileLoadingDirectories.filter(
              (item) => item !== normalizedDirectory
            )
          }))
        }
      })()

      sessionFileLoadRequests.set(requestKey, request)
      try {
        await request
      } finally {
        sessionFileLoadRequests.delete(requestKey)
      }
    },

    markSessionUnread: (sessionId: string) => {
      markSessionUnread(sessionId, set)
    },

    clearSessionUnread: (sessionId: string) => {
      clearSessionUnread(sessionId, set)
    },

    hydrateUnreadSessionIds: (sessionIds: string[]) => {
      hydrateUnreadSessionIds(sessionIds, set)
    },

    toggleSessionPinned: async (sessionId: string, pinned: boolean) => {
      await window.api.agent.sessionIndexSetPinned(sessionId, pinned)
      set((state) => ({
        sessionIndex: state.sessionIndex.map((entry) =>
          entry.sessionId === sessionId ? { ...entry, pinned } : entry
        )
      }))
      await get().loadSessionIndex(get().sessionIndexSortKey)
    },

    reorderPinnedSessions: async (sessionIds: string[]) => {
      const orderedSessionIds = [...new Set(sessionIds)]
      const pinnedOrderBySessionId = new Map(
        orderedSessionIds.map((sessionId, index) => [sessionId, orderedSessionIds.length - index])
      )
      set((state) => ({
        sessionIndex: state.sessionIndex.map((entry) => {
          const pinnedOrder = pinnedOrderBySessionId.get(entry.sessionId)
          return pinnedOrder === undefined ? entry : { ...entry, pinned: true, pinnedOrder }
        })
      }))
      try {
        await window.api.agent.sessionIndexReorderPinned(orderedSessionIds)
      } finally {
        await get().loadSessionIndex(get().sessionIndexSortKey)
      }
    },

    archiveSession: async (sessionId: string) => {
      await window.api.agent.sessionIndexArchive(sessionId)
      clearSessionUnread(sessionId, set)
      clearSessionFailed(sessionId, set)
      await get().loadSessionIndex(get().sessionIndexSortKey)
      if (get().sessionLoadingId === sessionId) {
        set({ sessionLoadingId: null })
      }
      if (get().sessionId === sessionId) {
        get().resetConversation()
      }
    },

    importSessionJsonl: async (url: string) => {
      try {
        set({ lastError: null })
        const result = await window.api.agent.sessionImportJsonl(url)
        const sessionId =
          result.status === 'duplicate' ? result.existingSessionId : result.sessionId
        await get().loadSessionIndex(get().sessionIndexSortKey)
        await get().loadSession(sessionId)
        return sessionId
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        set({ lastError: message })
        return null
      }
    },

    loadSession: async (sessionId: string) => {
      try {
        set((state) => ({
          sessionLoadingId: sessionId,
          queuedPrompts: state.sessionId === sessionId ? [] : state.queuedPrompts,
          lastError: null,
          retryPrompt: null
        }))
        const resumed = await window.api.agent.resumeSession(sessionId)
        const status = await window.api.agent.status()
        const assistantDraft = await window.api.agent.assistantDraft(sessionId)
        const loaded = await loadPersistedSessionView(sessionId)
        if (get().sessionLoadingId !== sessionId) return
        const stillBusy =
          status.runningSessionIds.includes(sessionId) ||
          (status.waitingSessionIds ?? []).includes(sessionId)

        set((state) => {
          if (state.sessionLoadingId !== sessionId) return {}
          const reloadingCurrentSession = state.sessionId === sessionId
          const widgets = new Map(loaded.widgets)
          if (reloadingCurrentSession) {
            state.widgets.forEach((widget, toolCallId) => {
              widgets.set(toolCallId, widget)
            })
          }
          return {
            sessionId,
            sessionLoadingId: null,
            activeSessionModel: resumed.sessionModel,
            messages: reloadingCurrentSession
              ? mergeLoadedAndLiveMessages(loaded.messages, state.messages)
              : loaded.messages,
            streamingAssistant: stillBusy
              ? mergeAssistantDraft(
                  assistantDraft,
                  reloadingCurrentSession ? state.streamingAssistant : ''
                )
              : '',
            streamingThinking:
              stillBusy && reloadingCurrentSession ? state.streamingThinking : false,
            pendingReconnectStatus:
              stillBusy && reloadingCurrentSession ? state.pendingReconnectStatus : null,
            pendingAssistantAttachments:
              stillBusy && reloadingCurrentSession ? state.pendingAssistantAttachments : [],
            pendingRawEvents: stillBusy && reloadingCurrentSession ? state.pendingRawEvents : [],
            queuedPrompts: [],
            busy: stillBusy,
            waitingSessionIds: status.waitingSessionIds ?? [],
            runningSessionIds: status.runningSessionIds,
            activeRunIdsBySession: status.activeRunIdsBySession ?? {},
            activeRunStartedAtsBySession: status.activeRunStartedAtsBySession ?? {},
            lastError: null,
            retryPrompt: null,
            widgets,
            sessionFiles: [],
            sessionFilesLoaded: false,
            sessionFileLoadedDirectories: [],
            sessionFileLoadingDirectories: []
          }
        })
        if (stillBusy) {
          const refreshed = await loadPersistedSessionView(sessionId)
          set((state) => {
            if (state.sessionId !== sessionId || state.sessionLoadingId) return {}
            const widgets = new Map(refreshed.widgets)
            state.widgets.forEach((widget, toolCallId) => {
              widgets.set(toolCallId, widget)
            })
            return {
              messages: mergeLoadedAndLiveMessages(refreshed.messages, state.messages),
              widgets
            }
          })
        }
        clearSessionUnread(sessionId, set)
      } catch (error) {
        console.error('Failed to load session messages', error)
        set((state) => ({
          sessionLoadingId: state.sessionLoadingId === sessionId ? null : state.sessionLoadingId,
          lastError: error instanceof Error ? error.message : String(error)
        }))
      }
    }
  }
}
