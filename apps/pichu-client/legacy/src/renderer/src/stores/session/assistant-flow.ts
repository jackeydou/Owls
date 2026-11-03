import type { AgentEvent } from '@earendil-works/pi-agent-core'
import type { MessageAttachment } from '../../../../preload/index.d'
import {
  shouldStripLeadingThinkClosePrefix,
  stripThinkingTags,
  ThinkingTagFilter,
  type ThinkingTagFilterOptions
} from '../../../../shared/thinking-tags'
import { useSettingsStore } from '../settings-store'
import { activeToolWidgetCount } from './tool-widgets'
import type { ChatMessage, SessionState, SessionStoreGet, SessionStoreSet } from './types'

const MODEL_RECONNECT_STATUS_MARKER = '[[pichu:model-reconnect]]'

export const assistantModelIdsBySession = new Map<string, string>()
export const runStartTimesBySession = new Map<string, number>()
export const runToolCountsBySession = new Map<string, number>()
export const toolStartTimesByCallId = new Map<string, number>()

type SuppressedAssistantCompletion = {
  messageId: string
}

const suppressedAssistantCompletionBySession = new Map<string, SuppressedAssistantCompletion>()
const assistantTextFiltersBySession = new Map<string, ThinkingTagFilter>()

export function activeRunIdForSession(
  state: SessionState,
  sessionId: string | null | undefined
): string | null {
  if (!sessionId) return null
  return state.activeRunIdsBySession[sessionId] ?? null
}

export function appendPendingAssistantAttachments(
  attachments: MessageAttachment[],
  set: SessionStoreSet
): void {
  if (attachments.length === 0) return
  set((state) => {
    const seen = new Set(state.pendingAssistantAttachments.map((attachment) => attachment.path))
    const next = [...state.pendingAssistantAttachments]
    for (const attachment of attachments) {
      if (seen.has(attachment.path)) continue
      seen.add(attachment.path)
      next.push(attachment)
    }
    return { pendingAssistantAttachments: next }
  })
}

export function shouldLogAssistantDebug(): boolean {
  return useSettingsStore.getState().debugMode
}

export function logAssistantFlowDebug(
  reason: string,
  state: SessionState,
  extra?: Record<string, unknown>
): void {
  if (!shouldLogAssistantDebug()) return
  console.info('[session-store] assistant flow %s', reason, {
    sessionId: state.sessionId,
    busy: state.busy,
    streamingThinking: state.streamingThinking,
    streamingChars: state.streamingAssistant.length,
    reconnectLines: state.pendingReconnectStatus?.lines.length ?? 0,
    hasReconnectError: Boolean(state.pendingReconnectStatus?.error),
    pendingRawEvents: state.pendingRawEvents.length,
    pendingAttachments: state.pendingAssistantAttachments.length,
    activeToolWidgets: activeToolWidgetCount(state.widgets),
    ...extra
  })
}

export function updateStreamingThinking(
  get: SessionStoreGet,
  set: SessionStoreSet,
  next: boolean,
  reason: string,
  extra?: Record<string, unknown>
): void {
  if (get().streamingThinking === next) return
  set({ streamingThinking: next })
  logAssistantFlowDebug(reason, get(), { nextStreamingThinking: next, ...extra })
}

export function extractFromEvent(event: AgentEvent): string | null {
  if (event.type === 'message_update') {
    const ame = event.assistantMessageEvent as
      | { type: string; delta?: string; text?: string }
      | undefined
    if (!ame || typeof ame.delta !== 'string') return null

    if (ame.type === 'text_delta') return ame.delta
    if (ame.type === 'thinking_delta') {
      if (ame.delta.startsWith(MODEL_RECONNECT_STATUS_MARKER)) return null
      return null
    }
    return null
  }

  if (event.type === 'tool_execution_start') {
    return null
  }

  if (event.type === 'tool_execution_end') {
    return null
  }

  return null
}

export function extractReconnectStatusLine(event: AgentEvent): string | null {
  if (event.type !== 'message_update') return null

  const ame = event.assistantMessageEvent as { type?: string; delta?: string } | undefined
  if (ame?.type !== 'thinking_delta' || typeof ame.delta !== 'string') return null
  if (!ame.delta.startsWith(MODEL_RECONNECT_STATUS_MARKER)) return null

  return ame.delta.slice(MODEL_RECONNECT_STATUS_MARKER.length).trim()
}

export function isHiddenThinkingDeltaEvent(event: AgentEvent): boolean {
  if (event.type !== 'message_update') return false

  const ame = event.assistantMessageEvent as { type?: string; delta?: string } | undefined
  return (
    ame?.type === 'thinking_delta' &&
    typeof ame.delta === 'string' &&
    !ame.delta.startsWith(MODEL_RECONNECT_STATUS_MARKER)
  )
}

export function appendReconnectStatusLine(line: string, set: SessionStoreSet): void {
  if (!line) return
  set((state) => {
    const current = state.pendingReconnectStatus ?? { lines: [] }
    return {
      pendingReconnectStatus: {
        ...current,
        lines: [...current.lines, line]
      }
    }
  })
}

function extractAssistantText(message: unknown): string {
  const msg = message as { content?: unknown } | undefined
  if (!Array.isArray(msg?.content)) return ''
  return msg.content
    .flatMap((block) => {
      if (
        typeof block !== 'object' ||
        block === null ||
        Array.isArray(block) ||
        block.type !== 'text' ||
        typeof block.text !== 'string'
      ) {
        return []
      }
      return [block.text]
    })
    .join('')
    .trim()
}

function assistantModelIdFromMessage(message: unknown): string | null {
  if (
    typeof message !== 'object' ||
    message === null ||
    Array.isArray(message) ||
    !('role' in message) ||
    message.role !== 'assistant'
  ) {
    return null
  }
  return 'model' in message && typeof message.model === 'string' && message.model.trim()
    ? message.model.trim()
    : null
}

export function assistantModelIdFromEvent(event: AgentEvent): string | null {
  const e = event as Record<string, unknown>
  if (e.type === 'message_end') return assistantModelIdFromMessage(e.message)
  if (e.type !== 'message_update') return null
  const assistantMessageEvent = e.assistantMessageEvent
  if (
    typeof assistantMessageEvent === 'object' &&
    assistantMessageEvent !== null &&
    !Array.isArray(assistantMessageEvent) &&
    'partial' in assistantMessageEvent
  ) {
    return assistantModelIdFromMessage(assistantMessageEvent.partial)
  }
  return assistantModelIdFromMessage(e.partial ?? e.message)
}

export function assistantPartialTextFromEvent(event: AgentEvent): string | null {
  const e = event as Record<string, unknown>
  if (e.type !== 'message_update') return null

  const assistantMessageEvent = e.assistantMessageEvent
  const partial =
    typeof assistantMessageEvent === 'object' &&
    assistantMessageEvent !== null &&
    !Array.isArray(assistantMessageEvent) &&
    'partial' in assistantMessageEvent
      ? assistantMessageEvent.partial
      : (e.partial ?? e.message)
  const text = extractAssistantText(partial)
  return text ? text : null
}

function assistantMessageHasToolCalls(message: unknown): boolean {
  const msg = message as { content?: unknown } | undefined
  if (!Array.isArray(msg?.content)) return false
  return msg.content.some((block) => {
    return (
      typeof block === 'object' &&
      block !== null &&
      !Array.isArray(block) &&
      block.type === 'toolCall'
    )
  })
}

export function assistantCompletionFromEvent(event: AgentEvent): {
  content: string
} | null {
  const e = event as Record<string, unknown>
  if (e.type !== 'message_end') return null

  const message = e.message as
    | {
        role?: string
        stopReason?: string
      }
    | undefined
  if (message?.role !== 'assistant') return null
  if (message.stopReason === 'error') return null
  if (assistantMessageHasToolCalls(message)) return null

  return {
    content: extractAssistantText(message)
  }
}

export type AssistantFailure = {
  content: string
  errorMessage: string
}

export function assistantFailureFromEvent(event: AgentEvent): AssistantFailure | null {
  const e = event as Record<string, unknown>
  if (e.type !== 'message_end') return null

  const message = e.message as
    | {
        role?: string
        stopReason?: string
        errorMessage?: string
      }
    | undefined
  if (message?.role !== 'assistant') return null
  if (message.stopReason !== 'error') return null

  const errorMessage =
    typeof message.errorMessage === 'string' && message.errorMessage.trim()
      ? message.errorMessage.trim()
      : 'Model request failed.'
  const text = extractAssistantText(message)
  return {
    content: text || errorMessage,
    errorMessage
  }
}

export function commitStreamingAssistant(
  get: SessionStoreGet,
  set: SessionStoreSet,
  source: 'optimistic' | 'completion' | 'steer' = 'completion',
  debug?: { hadSuppression?: boolean; suppressed?: boolean },
  runIdOverride?: string | null
): boolean {
  const text = get().streamingAssistant
  const attachments = get().pendingAssistantAttachments
  const reconnectStatus = get().pendingReconnectStatus
  if (!text && attachments.length === 0 && !reconnectStatus) return false

  const rawEvents = get().pendingRawEvents.length > 0 ? [...get().pendingRawEvents] : undefined
  const runId = runIdOverride ?? activeRunIdForSession(get(), get().sessionId)
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: text,
    createdAt: new Date().toISOString(),
    runId,
    rawEvents,
    reconnectStatus: reconnectStatus ?? undefined,
    attachments: attachments.length > 0 ? attachments : undefined
  }
  logAssistantCommitDebug({
    source,
    sessionId: get().sessionId,
    messageId: message.id,
    content: text,
    hadSuppression: debug?.hadSuppression,
    suppressed: debug?.suppressed
  })
  set((state) => ({
    messages: [...state.messages, message],
    streamingAssistant: '',
    streamingThinking: false,
    pendingReconnectStatus: null,
    pendingAssistantAttachments: [],
    pendingRawEvents: []
  }))

  return true
}

export function discardStreamingAssistantDraft(
  get: SessionStoreGet,
  set: SessionStoreSet,
  reason: string
): void {
  if (!get().streamingAssistant && !get().streamingThinking && !get().pendingReconnectStatus) {
    return
  }
  set({
    streamingAssistant: '',
    streamingThinking: false,
    pendingReconnectStatus: null
  })
  logAssistantFlowDebug(reason, get())
}

export function consumeAssistantTextDelta(
  sessionId: string | null | undefined,
  delta: string
): string {
  if (!sessionId) return stripThinkingTags(delta)
  let filter = assistantTextFiltersBySession.get(sessionId)
  if (!filter) {
    filter = new ThinkingTagFilter(streamingThinkingTagFilterOptionsForSession(sessionId))
    assistantTextFiltersBySession.set(sessionId, filter)
  }
  return filter.consume(delta)
}

export function resetAssistantTextFilter(sessionId: string | null | undefined): void {
  if (sessionId) assistantTextFiltersBySession.delete(sessionId)
}

export function thinkingTagFilterOptionsForSession(
  sessionId: string | null | undefined
): ThinkingTagFilterOptions {
  return {
    stripLeadingCloseTagPrefix: shouldStripLeadingThinkClosePrefix(
      sessionId ? assistantModelIdsBySession.get(sessionId) : null
    )
  }
}

export function streamingThinkingTagFilterOptionsForSession(
  sessionId: string | null | undefined
): ThinkingTagFilterOptions {
  const options = thinkingTagFilterOptionsForSession(sessionId)
  if (!options.stripLeadingCloseTagPrefix || !sessionId) return options
  return {
    ...options,
    stripLeadingCloseTagPrefix: (runToolCountsBySession.get(sessionId) ?? 0) === 0
  }
}

export function rememberAssistantModelId(
  sessionId: string | null | undefined,
  modelId: string | null | undefined
): void {
  const normalized = modelId?.trim()
  if (sessionId && normalized) {
    assistantModelIdsBySession.set(sessionId, normalized)
  }
}

export function normalizedAssistantContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim()
}

export function logAssistantCommitDebug(params: {
  source: 'optimistic' | 'completion' | 'steer'
  sessionId: string | null | undefined
  messageId?: string
  content: string
  suppressed?: boolean
  hadSuppression?: boolean
}): void {
  if (!shouldLogAssistantDebug()) return
  console.info(
    '[session-store] assistant commit source=%s session=%s message=%s chars=%d normalizedChars=%d hadSuppression=%s suppressed=%s',
    params.source,
    params.sessionId ?? 'none',
    params.messageId ?? 'none',
    params.content.length,
    normalizedAssistantContent(params.content).length,
    params.hadSuppression ?? false,
    params.suppressed ?? false
  )
}

export function suppressAssistantCompletion(sessionId: string, messageId: string): void {
  suppressedAssistantCompletionBySession.set(sessionId, { messageId })
}

export function consumeSuppressedAssistantCompletion(
  sessionId: string | null | undefined
): SuppressedAssistantCompletion | undefined {
  if (!sessionId) return undefined
  const suppressed = suppressedAssistantCompletionBySession.get(sessionId)
  if (suppressed) suppressedAssistantCompletionBySession.delete(sessionId)
  return suppressed
}
