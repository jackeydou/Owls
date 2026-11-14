import type { AgentEventPayload } from '../../../../preload/index.d'
import { serializeContextCompactionMarker } from '../../../../shared/context-compaction'
import {
  handleAssistantCompletionEvent,
  handleAssistantFailureEvent,
  handleAssistantTextDeltaEvent,
  handleHiddenThinkingDeltaEvent,
  handleReconnectStatusEvent,
  handleTurnEndEvent
} from './agent-assistant-events'
import {
  handleToolCallMessageEvent,
  handleToolExecutionEndEvent,
  handleToolExecutionStartEvent,
  handleToolExecutionUpdateEvent
} from './agent-tool-events'
import {
  assistantFailureFromEvent,
  assistantModelIdFromEvent,
  rememberAssistantModelId
} from './assistant-flow'
import { isContextCompactionEvent } from './event-classifiers'
import { markSessionFailed } from './session-status'
import type { SessionState, SessionStoreGet, SessionStoreSet } from './types'

type AgentEventActions = Pick<SessionState, 'appendAgentEvent'>

export function createAgentEventActions({
  get,
  set
}: {
  get: SessionStoreGet
  set: SessionStoreSet
}): AgentEventActions {
  return {
    appendAgentEvent: (payload: AgentEventPayload) => {
      const { sessionId } = get()
      const { event } = payload

      if (isContextCompactionEvent(event)) {
        if (payload.sessionId !== sessionId) {
          return
        }

        const content = serializeContextCompactionMarker(event.marker)
        set((state) => ({
          messages: [
            ...state.messages,
            {
              id: `context-compaction-${event.marker.id}`,
              role: 'system',
              content,
              visibility: 'model-only',
              createdAt: event.marker.createdAt,
              rawEvents: [event]
            }
          ],
          pendingRawEvents: []
        }))
        return
      }

      rememberAssistantModelId(
        payload.sessionId,
        payload.modelId ?? assistantModelIdFromEvent(event)
      )

      const assistantFailure = assistantFailureFromEvent(event)

      if (payload.sessionId !== sessionId) {
        if (payload.sessionId) {
          if (assistantFailure) {
            markSessionFailed(payload.sessionId, set)
          }
        }
        return
      }

      set((state) => ({ pendingRawEvents: [...state.pendingRawEvents, event] }))

      if (handleReconnectStatusEvent({ event, get, set })) return
      if (handleHiddenThinkingDeltaEvent({ event, get, set })) return
      if (
        handleAssistantFailureEvent({
          assistantFailure,
          sessionId: payload.sessionId,
          get,
          set
        })
      ) {
        return
      }
      if (handleAssistantCompletionEvent({ event, sessionId: payload.sessionId, get, set })) return
      if (handleTurnEndEvent({ event, sessionId: payload.sessionId, get, set })) return
      if (handleToolCallMessageEvent({ event, sessionId: payload.sessionId, get, set })) return
      if (handleToolExecutionStartEvent({ event, sessionId: payload.sessionId, get, set })) return
      if (handleToolExecutionUpdateEvent({ event, sessionId: payload.sessionId, set })) return
      if (handleToolExecutionEndEvent({ event, sessionId: payload.sessionId, get, set })) return
      handleAssistantTextDeltaEvent({ event, sessionId: payload.sessionId, get, set })
    }
  }
}
