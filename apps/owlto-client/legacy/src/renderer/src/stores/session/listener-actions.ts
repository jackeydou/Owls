import type {
  AgentEventPayload,
  AgentRunStatePayload,
  MessageRow
} from '../../../../preload/index.d'
import type { HumanInputRequestForRenderer } from '../../../../shared/human-input'
import { activeRunIdForSession } from './assistant-flow'
import {
  applyCompletedRunToMessages,
  applyUpdatedMessageRow,
  buildLoadedSessionView,
  mergeLoadedAndLiveMessages
} from './messages'
import { markSessionUnread } from './session-status'
import {
  applyActiveRunIdToOptimisticToolMessages,
  ensureToolMessage,
  mergeHumanInputWidget
} from './tool-widgets'
import type { SessionState, SessionStoreGet, SessionStoreSet } from './types'

type ListenerActions = Pick<SessionState, 'bindSessionListener'>

let nextPersistedSessionRefreshToken = 0
const latestPersistedSessionRefreshTokenBySession = new Map<string, number>()
const refreshedCompletedRunIdBySession = new Map<string, string>()

function isRendererWindowActive(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

async function loadPersistedSessionView(
  sessionId: string
): Promise<ReturnType<typeof buildLoadedSessionView>> {
  const rows = (await window.api.messages.list(sessionId)) as MessageRow[]
  const humanInputs = await window.api.agent.listHumanInputs(sessionId)
  return buildLoadedSessionView({ rows, humanInputs })
}

async function refreshPersistedSessionView(
  sessionId: string,
  token: number,
  set: SessionStoreSet
): Promise<void> {
  const loaded = await loadPersistedSessionView(sessionId)
  set((state) => {
    if (state.sessionId !== sessionId) return {}
    if (latestPersistedSessionRefreshTokenBySession.get(sessionId) !== token) return {}
    return {
      messages: mergeLoadedAndLiveMessages(loaded.messages, state.messages),
      widgets: new Map([...state.widgets, ...loaded.widgets])
    }
  })
}

function schedulePersistedSessionRefresh(
  sessionId: string,
  completedRunId: string,
  set: SessionStoreSet
): void {
  if (refreshedCompletedRunIdBySession.get(sessionId) === completedRunId) return
  refreshedCompletedRunIdBySession.set(sessionId, completedRunId)

  const token = nextPersistedSessionRefreshToken + 1
  nextPersistedSessionRefreshToken = token
  latestPersistedSessionRefreshTokenBySession.set(sessionId, token)

  void refreshPersistedSessionView(sessionId, token, set).catch(console.error)
}

export function createListenerActions({
  get,
  set,
  shouldMarkSessionUnread = () => true
}: {
  get: SessionStoreGet
  set: SessionStoreSet
  shouldMarkSessionUnread?: (sessionId: string, state: ReturnType<SessionStoreGet>) => boolean
}): ListenerActions {
  return {
    bindSessionListener: () => {
      const prev = get().unsubscribeSession
      prev?.()
      const offEvent = window.api.agent.onEvent((raw) => {
        get().appendAgentEvent(raw as AgentEventPayload)
      })
      const offRunState = window.api.agent.onRunState((raw) => {
        const payload = raw as AgentRunStatePayload
        const waitingSessionIds = payload.waitingSessionIds ?? []
        const shouldMarkUnread = Boolean(
          payload.completedRun &&
            payload.completedRun.status !== 'cancelled' &&
            payload.sessionId &&
            (payload.sessionId !== get().sessionId || !isRendererWindowActive())
        )
        set((state) => {
          let messages = state.messages
          if (state.sessionId === payload.sessionId) {
            messages = applyActiveRunIdToOptimisticToolMessages(
              messages,
              payload.activeRunId ?? payload.completedRun?.id
            )
            if (payload.completedRun) {
              messages = applyCompletedRunToMessages(messages, payload.completedRun)
            }
          }
          const isRunActive = payload.running || payload.status === 'waiting_for_approval'

          return {
            messages,
            runningSessionIds: payload.runningSessionIds,
            waitingSessionIds,
            activeRunIdsBySession:
              isRunActive && payload.activeRunId
                ? { ...state.activeRunIdsBySession, [payload.sessionId]: payload.activeRunId }
                : Object.fromEntries(
                    Object.entries(state.activeRunIdsBySession).filter(
                      ([id]) => id !== payload.sessionId
                    )
                  ),
            activeRunStartedAtsBySession:
              isRunActive && payload.activeRunStartedAt
                ? {
                    ...state.activeRunStartedAtsBySession,
                    [payload.sessionId]: payload.activeRunStartedAt
                  }
                : Object.fromEntries(
                    Object.entries(state.activeRunStartedAtsBySession).filter(
                      ([id]) => id !== payload.sessionId
                    )
                  ),
            busy:
              state.sessionId === payload.sessionId
                ? payload.running || waitingSessionIds.includes(payload.sessionId)
                : state.busy,
            streamingThinking:
              state.sessionId === payload.sessionId && !payload.running
                ? false
                : state.streamingThinking
          }
        })
        if (payload.completedRun && payload.sessionId === get().sessionId) {
          schedulePersistedSessionRefresh(payload.sessionId, payload.completedRun.id, set)
        }
        if (shouldMarkUnread) {
          const currentState = get()
          if (shouldMarkSessionUnread(payload.sessionId, currentState)) {
            markSessionUnread(payload.sessionId, set)
          }
        }
      })
      const applyHumanInput = (request: HumanInputRequestForRenderer) => {
        set((state) => {
          const widgets = new Map(state.widgets)
          mergeHumanInputWidget(widgets, request)
          return {
            widgets,
            messages:
              state.sessionId === request.sessionId
                ? ensureToolMessage(
                    state.messages,
                    request.toolCallId,
                    activeRunIdForSession(state, request.sessionId)
                  )
                : state.messages
          }
        })
      }
      const offHumanInputRequested = window.api.agent.onHumanInputRequested(applyHumanInput)
      const offHumanInputUpdated = window.api.agent.onHumanInputUpdated(applyHumanInput)
      const offMessageUpdated = window.api.messages.onUpdated((row) => {
        applyUpdatedMessageRow(row, set)
      })
      set({
        unsubscribeSession: () => {
          offEvent()
          offRunState()
          offHumanInputRequested()
          offHumanInputUpdated()
          offMessageUpdated()
        }
      })
      void window.api.agent
        .status()
        .then(async (status) => {
          const activeSessionId = get().sessionId
          const waitingSessionIds = status.waitingSessionIds ?? []
          set((state) => {
            const stateSessionId = state.sessionId
            const isActiveRunning = stateSessionId
              ? status.runningSessionIds.includes(stateSessionId)
              : false
            const isActiveBusy = stateSessionId
              ? isActiveRunning || waitingSessionIds.includes(stateSessionId)
              : false
            return {
              runningSessionIds: status.runningSessionIds,
              waitingSessionIds,
              activeRunIdsBySession: status.activeRunIdsBySession ?? {},
              activeRunStartedAtsBySession: status.activeRunStartedAtsBySession ?? {},
              busy: isActiveBusy,
              streamingAssistant: isActiveBusy ? state.streamingAssistant : '',
              streamingThinking: isActiveRunning ? state.streamingThinking : false
            }
          })

          if (!activeSessionId) return

          const [assistantDraftResult, loadedResult] = await Promise.allSettled([
            window.api.agent.assistantDraft(activeSessionId),
            loadPersistedSessionView(activeSessionId)
          ])
          if (assistantDraftResult.status === 'rejected') {
            console.error(assistantDraftResult.reason)
          }
          if (loadedResult.status === 'rejected') {
            console.error(loadedResult.reason)
          }

          const assistantDraft =
            assistantDraftResult.status === 'fulfilled' ? assistantDraftResult.value : ''
          const loaded = loadedResult.status === 'fulfilled' ? loadedResult.value : null

          set((state) => {
            if (state.sessionId !== activeSessionId) return {}
            const stillRunning = state.runningSessionIds.includes(activeSessionId)
            const stillBusy = stillRunning || state.waitingSessionIds.includes(activeSessionId)
            return {
              ...(loaded
                ? {
                    messages: mergeLoadedAndLiveMessages(loaded.messages, state.messages),
                    widgets: new Map([...loaded.widgets, ...state.widgets])
                  }
                : {}),
              streamingAssistant: stillBusy ? assistantDraft || state.streamingAssistant : '',
              streamingThinking: stillRunning ? state.streamingThinking : false
            }
          })
        })
        .catch(console.error)
    }
  }
}
