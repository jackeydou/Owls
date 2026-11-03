import type { AgentEvent } from '@earendil-works/pi-agent-core'
import {
  normalizeMessageVisibility,
  type PichuMessageVisibility
} from '../../shared/agent-message-visibility.js'
import type { MessageAttachment } from '../../shared/attachments.js'
import { getHumanInputSuspensionMarkerFromResult } from '../human-input-runtime.js'
import { completeHumanInputToolResult } from '../stores/human-input-store.js'
import {
  addMessage,
  getNextSortOrder,
  stringifyMessageAttachments,
  updateMessageToolCallResult,
  upsertToolCallMessage
} from '../stores/settings-store.js'
import {
  collectAttachmentsFromToolResult,
  extractAssistantCompletionText,
  extractAssistantFailureText,
  extractAssistantTextDelta,
  extractEventAssistantModelMetadata,
  extractToolCallsFromAssistantMessage,
  extractToolCallsFromMessageUpdate,
  isToolBoundaryEvent,
  type MessageModelMetadata,
  serializeToolResultForStorage
} from './message-utils.js'
import {
  recordAssistantCompletion,
  recordAssistantFailure,
  recordAssistantPersist,
  recordVisibleAssistantDelta
} from './run-debug.js'
import type { AgentSessionRunState } from './session-run-state.js'

type AgentEventPersistenceDeps = {
  sessionRunState: AgentSessionRunState
  consumeAssistantTextDelta: (sessionId: string, delta: string) => string
  resetAssistantTextFilter: (sessionId: string) => void
  stripThinkingTags: (sessionId: string, text: string) => string
}

export class AgentEventPersistence {
  private readonly assistantDraftsBySession = new Map<string, string>()
  private readonly pendingAssistantAttachmentsBySession = new Map<string, MessageAttachment[]>()
  private readonly assistantModelMetadataBySession = new Map<string, MessageModelMetadata>()
  private readonly assistantFailuresBySession = new Map<string, string>()

  constructor(private readonly deps: AgentEventPersistenceDeps) {}

  rememberAssistantModelId(sessionId: string, modelId: string): void {
    this.assistantModelMetadataBySession.set(sessionId, {
      ...this.assistantModelMetadataBySession.get(sessionId),
      modelId
    })
  }

  currentAssistantModelId(sessionId: string, fallbackModelId?: string | null): string | null {
    return this.assistantModelMetadataBySession.get(sessionId)?.modelId ?? fallbackModelId ?? null
  }

  clearAssistantModelMetadata(sessionId: string): void {
    this.assistantModelMetadataBySession.delete(sessionId)
  }

  clearAssistantFailure(sessionId: string): void {
    this.assistantFailuresBySession.delete(sessionId)
  }

  consumeAssistantFailure(sessionId: string): string | null {
    const failure = this.assistantFailuresBySession.get(sessionId) ?? null
    this.assistantFailuresBySession.delete(sessionId)
    return failure
  }

  setAssistantDraft(sessionId: string, text: string): void {
    this.assistantDraftsBySession.set(sessionId, text)
  }

  currentAssistantDraft(sessionId: string): string {
    return this.assistantDraftsBySession.get(sessionId) ?? ''
  }

  persistTextMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    visibility?: PichuMessageVisibility
  ): void {
    if (!content.trim()) return
    const messageVisibility = visibility ?? normalizeMessageVisibility(undefined, role)
    addMessage({
      id: crypto.randomUUID(),
      sessionId,
      role,
      content,
      agentContent: '',
      visibility: messageVisibility,
      sortOrder: getNextSortOrder(sessionId),
      createdAt: new Date().toISOString(),
      parts: []
    })
  }

  flushAssistantDraft(sessionId: string): void {
    const text = this.assistantDraftsBySession.get(sessionId)
    const attachments = this.pendingAssistantAttachmentsBySession.get(sessionId)
    if (!text && (!attachments || attachments.length === 0)) return

    this.assistantDraftsBySession.delete(sessionId)
    this.pendingAssistantAttachmentsBySession.delete(sessionId)
    this.persistAssistantMessage(sessionId, text ?? '', attachments)
  }

  discardAssistantDraft(sessionId: string): void {
    this.assistantDraftsBySession.delete(sessionId)
  }

  captureAssistantModelMetadata(sessionId: string, event: AgentEvent): void {
    const metadata = extractEventAssistantModelMetadata(event)
    if (!metadata) return
    this.assistantModelMetadataBySession.set(sessionId, {
      ...this.assistantModelMetadataBySession.get(sessionId),
      ...metadata
    })
  }

  persistToolEventForSession(sessionId: string, event: AgentEvent): void {
    const e = event as Record<string, unknown>
    const modelMetadata = this.currentAssistantModelMetadata(sessionId)
    const runId = this.deps.sessionRunState.activeRunId(sessionId)

    if (e.type === 'message_update') {
      for (const toolCall of extractToolCallsFromMessageUpdate(event)) {
        upsertToolCallMessage({
          sessionId,
          runId,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          args: toolCall.args,
          assistantContent: toolCall.assistantContent,
          ...modelMetadata
        })
      }
    }

    if (e.type === 'message_end') {
      for (const toolCall of extractToolCallsFromAssistantMessage(e.message)) {
        upsertToolCallMessage({
          sessionId,
          runId,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          args: toolCall.args,
          assistantContent: toolCall.assistantContent,
          ...modelMetadata
        })
      }
    }

    if (e.type === 'tool_execution_start') {
      const toolCallId = e.toolCallId as string | undefined
      const name = e.toolName as string | undefined
      const args = e.args as Record<string, unknown> | undefined
      if (!toolCallId) return

      upsertToolCallMessage({
        sessionId,
        runId,
        toolCallId,
        toolName: name,
        args,
        ...modelMetadata
      })
    }

    if (e.type === 'tool_execution_end') {
      const toolCallId = e.toolCallId as string | undefined
      const result = e.result as unknown
      if (!toolCallId) return
      if (getHumanInputSuspensionMarkerFromResult(result)) return

      this.appendPendingAssistantAttachments(sessionId, collectAttachmentsFromToolResult(result))
      const resultStr = serializeToolResultForStorage(result)

      if (!completeHumanInputToolResult({ sessionId, toolCallId, toolCallResult: resultStr })) {
        updateMessageToolCallResult(sessionId, toolCallId, resultStr)
      }
    }
  }

  persistAgentEventForSession(sessionId: string, event: AgentEvent): void {
    this.captureAssistantModelMetadata(sessionId, event)

    const failureText = extractAssistantFailureText(event)
    if (failureText) {
      this.assistantFailuresBySession.set(sessionId, failureText)
      recordAssistantFailure(sessionId)
      if (this.assistantDraftsBySession.has(sessionId)) {
        this.flushAssistantDraft(sessionId)
      } else {
        this.persistAssistantMessage(sessionId, failureText)
      }
      this.deps.resetAssistantTextFilter(sessionId)
      return
    }

    const completionText = extractAssistantCompletionText(event)
    if (completionText !== null) {
      const visibleCompletionText = this.deps.stripThinkingTags(sessionId, completionText)
      recordAssistantCompletion(sessionId, completionText, visibleCompletionText)
      if (visibleCompletionText.trim() || !this.assistantDraftsBySession.has(sessionId)) {
        this.assistantDraftsBySession.set(sessionId, visibleCompletionText)
      }
      this.flushAssistantDraft(sessionId)
      this.deps.resetAssistantTextFilter(sessionId)
      return
    }

    const delta = extractAssistantTextDelta(event)
    if (delta) {
      const visibleDelta = this.deps.consumeAssistantTextDelta(sessionId, delta)
      if (visibleDelta) {
        recordVisibleAssistantDelta(sessionId, visibleDelta)
        this.assistantDraftsBySession.set(
          sessionId,
          (this.assistantDraftsBySession.get(sessionId) ?? '') + visibleDelta
        )
      }
    }

    const isToolBoundary = isToolBoundaryEvent(event)
    if (isToolBoundary) {
      this.persistToolEventForSession(sessionId, event)
      this.discardAssistantDraft(sessionId)
      this.deps.resetAssistantTextFilter(sessionId)
    }

    if (!isToolBoundary) {
      this.persistToolEventForSession(sessionId, event)
    }

    if (event.type === 'agent_end' || event.type === 'turn_end') {
      this.flushAssistantDraft(sessionId)
      this.assistantModelMetadataBySession.delete(sessionId)
      this.deps.resetAssistantTextFilter(sessionId)
    }
  }

  private currentAssistantModelMetadata(sessionId: string): MessageModelMetadata {
    return this.assistantModelMetadataBySession.get(sessionId) ?? {}
  }

  private persistAssistantMessage(
    sessionId: string,
    content: string,
    attachments?: MessageAttachment[],
    runId = this.deps.sessionRunState.activeRunId(sessionId)
  ): void {
    if (!content.trim() && (!attachments || attachments.length === 0)) return

    recordAssistantPersist(sessionId, content)
    const modelMetadata = this.assistantModelMetadataBySession.get(sessionId)
    addMessage({
      id: crypto.randomUUID(),
      sessionId,
      role: 'assistant',
      content,
      agentContent: '',
      visibility: 'shared',
      sortOrder: getNextSortOrder(sessionId),
      createdAt: new Date().toISOString(),
      runId,
      attachmentsJson: stringifyMessageAttachments(attachments),
      modelId: modelMetadata?.modelId ?? null,
      modelProvider: modelMetadata?.modelProvider ?? null,
      modelApi: modelMetadata?.modelApi ?? null,
      modelUsageJson: modelMetadata?.modelUsageJson ?? null,
      parts: []
    })
    this.assistantModelMetadataBySession.delete(sessionId)
  }

  private appendPendingAssistantAttachments(
    sessionId: string,
    attachments: MessageAttachment[]
  ): void {
    if (attachments.length === 0) return
    const current = this.pendingAssistantAttachmentsBySession.get(sessionId) ?? []
    const seen = new Set(current.map((attachment) => attachment.path))
    const next = [...current]
    for (const attachment of attachments) {
      if (seen.has(attachment.path)) continue
      seen.add(attachment.path)
      next.push(attachment)
    }
    this.pendingAssistantAttachmentsBySession.set(sessionId, next)
  }
}
