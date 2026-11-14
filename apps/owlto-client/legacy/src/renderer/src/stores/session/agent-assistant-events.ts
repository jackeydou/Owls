import type { AgentEvent } from '@earendil-works/pi-agent-core'
import { stripStreamingThinkingTags, stripThinkingTags } from '../../../../shared/thinking-tags'
import {
  type AssistantFailure,
  appendReconnectStatusLine,
  assistantCompletionFromEvent,
  assistantPartialTextFromEvent,
  commitStreamingAssistant,
  consumeAssistantTextDelta,
  consumeSuppressedAssistantCompletion,
  extractFromEvent,
  extractReconnectStatusLine,
  isHiddenThinkingDeltaEvent,
  logAssistantCommitDebug,
  logAssistantFlowDebug,
  normalizedAssistantContent,
  resetAssistantTextFilter,
  streamingThinkingTagFilterOptionsForSession,
  thinkingTagFilterOptionsForSession,
  updateStreamingThinking
} from './assistant-flow'
import { markSessionFailed } from './session-status'
import { activeToolWidgetCount } from './tool-widgets'
import type { SessionStoreGet, SessionStoreSet } from './types'

export function handleReconnectStatusEvent({
  event,
  get,
  set
}: {
  event: AgentEvent
  get: SessionStoreGet
  set: SessionStoreSet
}): boolean {
  const reconnectStatusLine = extractReconnectStatusLine(event)
  if (!reconnectStatusLine) return false
  updateStreamingThinking(get, set, false, 'reconnect-status')
  appendReconnectStatusLine(reconnectStatusLine, set)
  return true
}

export function handleHiddenThinkingDeltaEvent({
  event,
  get,
  set
}: {
  event: AgentEvent
  get: SessionStoreGet
  set: SessionStoreSet
}): boolean {
  if (!isHiddenThinkingDeltaEvent(event)) return false
  updateStreamingThinking(get, set, true, 'hidden-thinking-delta')
  return true
}

export function handleAssistantFailureEvent({
  assistantFailure,
  sessionId,
  get,
  set
}: {
  assistantFailure: AssistantFailure | null
  sessionId: string | null | undefined
  get: SessionStoreGet
  set: SessionStoreSet
}): boolean {
  if (!assistantFailure) return false
  if (sessionId) {
    markSessionFailed(sessionId, set)
  }
  resetAssistantTextFilter(sessionId)
  updateStreamingThinking(get, set, false, 'assistant-failure')
  set((state) => ({
    pendingReconnectStatus: state.pendingReconnectStatus
      ? { ...state.pendingReconnectStatus, error: assistantFailure.errorMessage }
      : { lines: [], error: assistantFailure.errorMessage },
    lastError: assistantFailure.errorMessage
  }))
  commitStreamingAssistant(get, set)
  return true
}

export function handleAssistantCompletionEvent({
  event,
  sessionId,
  get,
  set
}: {
  event: AgentEvent
  sessionId: string | null | undefined
  get: SessionStoreGet
  set: SessionStoreSet
}): boolean {
  const assistantCompletion = assistantCompletionFromEvent(event)
  if (!assistantCompletion) return false

  const visibleCompletion = stripThinkingTags(
    assistantCompletion.content,
    thinkingTagFilterOptionsForSession(sessionId)
  )
  const suppressedCompletion = consumeSuppressedAssistantCompletion(sessionId)
  if (sessionId && suppressedCompletion) {
    const lastMessage = get().messages.at(-1)
    if (lastMessage?.id === suppressedCompletion.messageId) {
      const nextContent = normalizedAssistantContent(visibleCompletion)
        ? visibleCompletion
        : lastMessage.content
      logAssistantCommitDebug({
        source: 'completion',
        sessionId,
        messageId: lastMessage.id,
        content: visibleCompletion,
        hadSuppression: true,
        suppressed: true
      })
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === lastMessage.id
            ? {
                ...message,
                content: nextContent,
                rawEvents:
                  state.pendingRawEvents.length > 0
                    ? [...state.pendingRawEvents]
                    : message.rawEvents
              }
            : message
        ),
        streamingAssistant: '',
        streamingThinking: false,
        pendingReconnectStatus: null,
        pendingRawEvents: []
      }))
      logAssistantFlowDebug('assistant-completion-suppressed', get())
      resetAssistantTextFilter(sessionId)
      return true
    }
  }

  if (visibleCompletion.trim() || !get().streamingAssistant) {
    set({
      streamingAssistant: visibleCompletion,
      streamingThinking: false,
      pendingReconnectStatus: null
    })
    logAssistantFlowDebug('assistant-completion-visible', get(), {
      completionChars: visibleCompletion.length
    })
  }
  if (get().pendingReconnectStatus) {
    set({ pendingReconnectStatus: null })
  }
  commitStreamingAssistant(get, set, 'completion', {
    hadSuppression: Boolean(suppressedCompletion),
    suppressed: false
  })
  resetAssistantTextFilter(sessionId)
  return true
}

export function handleTurnEndEvent({
  event,
  sessionId,
  get,
  set
}: {
  event: AgentEvent
  sessionId: string | null | undefined
  get: SessionStoreGet
  set: SessionStoreSet
}): boolean {
  if (event.type !== 'agent_end' && event.type !== 'turn_end') return false
  updateStreamingThinking(get, set, false, event.type)
  if (get().pendingReconnectStatus) {
    set({ pendingReconnectStatus: null })
  }
  const committed = commitStreamingAssistant(get, set)
  if (!committed) {
    set({ pendingRawEvents: [], streamingThinking: false })
  }
  resetAssistantTextFilter(sessionId)
  return true
}

export function handleAssistantTextDeltaEvent({
  event,
  sessionId,
  get,
  set
}: {
  event: AgentEvent
  sessionId: string | null | undefined
  get: SessionStoreGet
  set: SessionStoreSet
}): boolean {
  const chunk = extractFromEvent(event)
  if (!chunk) return false

  const partialText = assistantPartialTextFromEvent(event)
  if (partialText) {
    const visiblePartial = stripStreamingThinkingTags(
      partialText,
      streamingThinkingTagFilterOptionsForSession(sessionId)
    )
    const normalizedVisiblePartial = normalizedAssistantContent(visiblePartial)
    if (normalizedVisiblePartial) {
      const wasThinking = get().streamingThinking
      const hadStreamingText = get().streamingAssistant.length > 0
      set({
        streamingAssistant: visiblePartial,
        streamingThinking: false,
        pendingReconnectStatus: null
      })
      if (wasThinking || !hadStreamingText) {
        logAssistantFlowDebug('text-partial-visible', get(), {
          partialChars: visiblePartial.length
        })
      }
      return true
    }
  }

  const visibleChunk = consumeAssistantTextDelta(sessionId, chunk)
  const normalizedVisibleChunk = normalizedAssistantContent(visibleChunk)
  if (normalizedVisibleChunk) {
    const wasThinking = get().streamingThinking
    const hadStreamingText = get().streamingAssistant.length > 0
    set((state) => ({
      streamingAssistant: state.streamingAssistant + visibleChunk,
      streamingThinking: false,
      pendingReconnectStatus: null
    }))
    if (wasThinking || !hadStreamingText) {
      logAssistantFlowDebug('text-delta-visible', get(), {
        chunkChars: visibleChunk.length
      })
    }
  } else if (
    (chunk.trim() || visibleChunk) &&
    !get().streamingAssistant &&
    !get().pendingReconnectStatus &&
    activeToolWidgetCount(get().widgets) === 0
  ) {
    updateStreamingThinking(get, set, true, 'suppressed-text-delta', {
      chunkChars: chunk.length
    })
  }
  return true
}
