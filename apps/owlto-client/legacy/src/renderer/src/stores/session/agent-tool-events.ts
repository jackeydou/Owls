import type { AgentEvent } from '@earendil-works/pi-agent-core'
import {
  activeRunIdForSession,
  appendPendingAssistantAttachments,
  discardStreamingAssistantDraft,
  logAssistantFlowDebug,
  resetAssistantTextFilter,
  runToolCountsBySession,
  toolStartTimesByCallId,
  updateStreamingThinking
} from './assistant-flow'
import { collectMediaPathsFromToolResult, optimisticAttachmentFromPath } from './attachments'
import {
  activeToolWidgetCount,
  ensureToolMessage,
  extractToolCallsFromMessageUpdate,
  isImageGenerationToolName,
  toolName,
  upsertToolWidget
} from './tool-widgets'
import type { SessionStoreGet, SessionStoreSet } from './types'
import { isRecord } from './utils'

export function handleToolCallMessageEvent({
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
  const toolCalls = extractToolCallsFromMessageUpdate(event)
  if (toolCalls.length === 0) return false

  updateStreamingThinking(get, set, false, 'tool-call-start', {
    toolCalls: toolCalls.length
  })
  discardStreamingAssistantDraft(get, set, 'tool-call-start-discard-assistant-draft')
  resetAssistantTextFilter(sessionId)

  set((state) => {
    const widgets = new Map(state.widgets)
    let messages = state.messages

    for (const toolCall of toolCalls) {
      upsertToolWidget(widgets, {
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        args: toolCall.args,
        status: 'streaming'
      })
      messages = ensureToolMessage(
        messages,
        toolCall.toolCallId,
        activeRunIdForSession(state, sessionId)
      )
    }

    return {
      widgets,
      messages
    }
  })
  logAssistantFlowDebug('tool-call-start', get(), { toolCalls: toolCalls.length })
  return true
}

export function handleToolExecutionStartEvent({
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
  if (event.type !== 'tool_execution_start') return false

  updateStreamingThinking(get, set, false, 'tool-execution-start', {
    toolName: toolName(event)
  })
  discardStreamingAssistantDraft(get, set, 'tool-execution-start-discard-assistant-draft')
  resetAssistantTextFilter(sessionId)
  const toolCallId = (event as Record<string, unknown>).toolCallId as string | undefined
  if (toolCallId) {
    toolStartTimesByCallId.set(toolCallId, performance.now())
    if (sessionId) {
      runToolCountsBySession.set(sessionId, (runToolCountsBySession.get(sessionId) ?? 0) + 1)
    }
    set((state) => {
      const widgets = new Map(state.widgets)
      upsertToolWidget(widgets, {
        toolCallId,
        toolName: toolName(event),
        args: isRecord((event as Record<string, unknown>).args)
          ? ((event as Record<string, unknown>).args as Record<string, unknown>)
          : undefined,
        status: 'running'
      })

      return {
        widgets,
        messages: ensureToolMessage(
          state.messages,
          toolCallId,
          activeRunIdForSession(state, sessionId)
        )
      }
    })
    logAssistantFlowDebug('tool-execution-start', get(), { toolName: toolName(event) })
  }
  return true
}

export function handleToolExecutionUpdateEvent({
  event,
  sessionId,
  set
}: {
  event: AgentEvent
  sessionId: string | null | undefined
  set: SessionStoreSet
}): boolean {
  if (event.type !== 'tool_execution_update') return false

  const toolCallId = (event as Record<string, unknown>).toolCallId as string | undefined
  if (toolCallId) {
    set((state) => {
      const widgets = new Map(state.widgets)
      upsertToolWidget(widgets, {
        toolCallId,
        toolName: toolName(event),
        args: isRecord((event as Record<string, unknown>).args)
          ? ((event as Record<string, unknown>).args as Record<string, unknown>)
          : undefined,
        result: (event as Record<string, unknown>).partialResult,
        status: 'running'
      })

      return {
        widgets,
        messages: ensureToolMessage(
          state.messages,
          toolCallId,
          activeRunIdForSession(state, sessionId)
        )
      }
    })
  }
  return true
}

export function handleToolExecutionEndEvent({
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
  if (event.type !== 'tool_execution_end') return false

  const toolCallId = (event as Record<string, unknown>).toolCallId as string | undefined
  const result = (event as Record<string, unknown>).result
  const nextToolName = toolName(event)
  const mediaAttachments = isImageGenerationToolName(nextToolName)
    ? []
    : collectMediaPathsFromToolResult(result).map(optimisticAttachmentFromPath)
  appendPendingAssistantAttachments(mediaAttachments, set)
  const isError = Boolean((event as Record<string, unknown>).isError)
  if (toolCallId) {
    toolStartTimesByCallId.delete(toolCallId)
  }
  if (toolCallId) {
    set((state) => {
      const widgets = new Map(state.widgets)
      upsertToolWidget(widgets, {
        toolCallId,
        toolName: nextToolName,
        result,
        status: isError ? 'error' : 'complete',
        isError
      })

      return {
        widgets,
        messages: ensureToolMessage(
          state.messages,
          toolCallId,
          activeRunIdForSession(state, sessionId)
        )
      }
    })
    if (get().filePanelOpen) {
      void get().loadSessionFiles()
    }
    logAssistantFlowDebug('tool-execution-end', get(), {
      toolName: nextToolName,
      isError
    })
    if (
      get().busy &&
      !get().streamingAssistant &&
      !get().pendingReconnectStatus &&
      activeToolWidgetCount(get().widgets) === 0
    ) {
      updateStreamingThinking(get, set, true, 'tool-execution-end-awaiting-model', {
        toolName: nextToolName
      })
    }
  }
  return true
}
