import type { AgentEvent } from '@earendil-works/pi-agent-core'
import { writeChatDiagnosticEvent } from '../diagnostics.js'

type AgentRunDebugStats = {
  modelId: string
  startedAt: number
  promptChars: number
  imageCount: number
  eventCount: number
  messageUpdateCount: number
  messageEndCount: number
  textDeltaChunks: number
  textDeltaChars: number
  visibleDeltaChars: number
  thinkingDeltaChunks: number
  thinkingDeltaChars: number
  completionChars: number
  visibleCompletionChars: number
  assistantPersistCount: number
  assistantPersistChars: number
  toolStartCount: number
  toolEndCount: number
  failureCount: number
}

const agentRunDebugBySession = new Map<string, AgentRunDebugStats>()

export function startAgentRunDebug(
  sessionId: string,
  modelId: string,
  promptChars: number,
  imageCount: number
): void {
  agentRunDebugBySession.set(sessionId, {
    modelId,
    startedAt: Date.now(),
    promptChars,
    imageCount,
    eventCount: 0,
    messageUpdateCount: 0,
    messageEndCount: 0,
    textDeltaChunks: 0,
    textDeltaChars: 0,
    visibleDeltaChars: 0,
    thinkingDeltaChunks: 0,
    thinkingDeltaChars: 0,
    completionChars: 0,
    visibleCompletionChars: 0,
    assistantPersistCount: 0,
    assistantPersistChars: 0,
    toolStartCount: 0,
    toolEndCount: 0,
    failureCount: 0
  })
  console.info(
    '[pi-handler] agent prompt start session=%s model=%s promptChars=%d images=%d',
    sessionId,
    modelId,
    promptChars,
    imageCount
  )
  writeChatDiagnosticEvent({
    event: 'agent_run_debug_started',
    sessionId,
    details: {
      modelId,
      promptChars,
      imageCount
    }
  })
}

export function recordAgentRunEvent(sessionId: string, event: AgentEvent): void {
  const stats = agentRunDebugBySession.get(sessionId)
  if (!stats) return

  stats.eventCount += 1
  if (event.type === 'message_update') {
    stats.messageUpdateCount += 1
    const assistantEvent = event.assistantMessageEvent
    if (assistantEvent.type === 'text_delta') {
      stats.textDeltaChunks += 1
      stats.textDeltaChars += assistantEvent.delta.length
    } else if (assistantEvent.type === 'thinking_delta') {
      stats.thinkingDeltaChunks += 1
      stats.thinkingDeltaChars += assistantEvent.delta.length
    }
  } else if (event.type === 'message_end') {
    stats.messageEndCount += 1
  } else if (event.type === 'tool_execution_start') {
    stats.toolStartCount += 1
  } else if (event.type === 'tool_execution_end') {
    stats.toolEndCount += 1
  }
}

export function recordVisibleAssistantDelta(sessionId: string, visibleDelta: string): void {
  const stats = agentRunDebugBySession.get(sessionId)
  if (!stats) return
  stats.visibleDeltaChars += visibleDelta.length
}

export function recordAssistantCompletion(
  sessionId: string,
  completionText: string,
  visibleCompletionText: string
): void {
  const stats = agentRunDebugBySession.get(sessionId)
  if (!stats) return
  stats.completionChars += completionText.length
  stats.visibleCompletionChars += visibleCompletionText.length
}

export function recordAssistantPersist(sessionId: string, content: string): void {
  const stats = agentRunDebugBySession.get(sessionId)
  if (!stats) return
  stats.assistantPersistCount += 1
  stats.assistantPersistChars += content.length
}

export function recordAssistantFailure(sessionId: string): void {
  const stats = agentRunDebugBySession.get(sessionId)
  if (!stats) return
  stats.failureCount += 1
}

export function finishAgentRunDebug(
  sessionId: string,
  result: 'success' | 'error',
  error?: unknown
): void {
  const stats = agentRunDebugBySession.get(sessionId)
  if (!stats) return

  agentRunDebugBySession.delete(sessionId)
  const errorText = error instanceof Error ? error.message : error ? String(error) : ''
  console.info(
    '[pi-handler] agent prompt end session=%s model=%s result=%s durationMs=%d events=%d messageUpdates=%d messageEnds=%d textChunks=%d textChars=%d visibleDeltaChars=%d thinkingChunks=%d thinkingChars=%d completionChars=%d visibleCompletionChars=%d assistantPersists=%d assistantPersistChars=%d toolStarts=%d toolEnds=%d failures=%d error=%s',
    sessionId,
    stats.modelId,
    result,
    Date.now() - stats.startedAt,
    stats.eventCount,
    stats.messageUpdateCount,
    stats.messageEndCount,
    stats.textDeltaChunks,
    stats.textDeltaChars,
    stats.visibleDeltaChars,
    stats.thinkingDeltaChunks,
    stats.thinkingDeltaChars,
    stats.completionChars,
    stats.visibleCompletionChars,
    stats.assistantPersistCount,
    stats.assistantPersistChars,
    stats.toolStartCount,
    stats.toolEndCount,
    stats.failureCount,
    errorText || 'none'
  )
  writeChatDiagnosticEvent({
    event: 'agent_run_debug_finished',
    sessionId,
    details: {
      modelId: stats.modelId,
      result,
      durationMs: Date.now() - stats.startedAt,
      eventCount: stats.eventCount,
      messageUpdateCount: stats.messageUpdateCount,
      messageEndCount: stats.messageEndCount,
      textDeltaChunks: stats.textDeltaChunks,
      textDeltaChars: stats.textDeltaChars,
      visibleDeltaChars: stats.visibleDeltaChars,
      thinkingDeltaChunks: stats.thinkingDeltaChunks,
      thinkingDeltaChars: stats.thinkingDeltaChars,
      completionChars: stats.completionChars,
      visibleCompletionChars: stats.visibleCompletionChars,
      assistantPersistCount: stats.assistantPersistCount,
      assistantPersistChars: stats.assistantPersistChars,
      toolStartCount: stats.toolStartCount,
      toolEndCount: stats.toolEndCount,
      failureCount: stats.failureCount,
      errorMessage: errorText || null
    }
  })
}
