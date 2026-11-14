import type { AgentRunStatePayload, MessageRow } from '../../../../preload/index.d'
import {
  isUserVisibleMessage,
  normalizeMessageKind,
  normalizeMessageVisibility
} from '../../../../shared/agent-message-visibility'
import type { ToolWidgetState } from '../../components/tool-widgets/types'
import { parseMessageAttachments } from './attachments'
import { deriveToolTitle, mergeHumanInputWidget, parseStoredValue } from './tool-widgets'
import type { ChatMessage, SessionStoreSet } from './types'
import { isRecord } from './utils'

export function rowRunFields(
  row: MessageRow
): Pick<
  ChatMessage,
  'runId' | 'runStatus' | 'runStartedAt' | 'runCompletedAt' | 'runDurationMs' | 'runError'
> {
  return {
    runId: row.runId ?? null,
    runStatus: row.runStatus ?? null,
    runStartedAt: row.runStartedAt ?? null,
    runCompletedAt: row.runCompletedAt ?? null,
    runDurationMs: row.runDurationMs ?? null,
    runError: row.runError ?? null
  }
}

export function systemMessagesFromRows(rows: MessageRow[]): ChatMessage[] {
  return rows
    .filter((row) => row.role === 'system')
    .map((row) => ({
      id: row.id,
      role: 'system' as const,
      kind: normalizeMessageKind(row.kind),
      content: row.content,
      parts: row.parts ?? [],
      visibility: normalizeMessageVisibility(row.visibility, row.role),
      createdAt: row.createdAt,
      ...rowRunFields(row)
    }))
}

export function chatMessageFromRow(row: MessageRow): ChatMessage | null {
  const visibility = normalizeMessageVisibility(row.visibility, row.role)
  if (!isUserVisibleMessage(visibility) || row.role === 'tool') return null

  return {
    id: row.id,
    role: row.role as 'user' | 'assistant' | 'system',
    kind: normalizeMessageKind(row.kind),
    content: row.content,
    parts: row.parts ?? [],
    visibility,
    createdAt: row.createdAt,
    ...rowRunFields(row),
    attachments: parseMessageAttachments(row.attachmentsJson)
  }
}

function normalizedAssistantContent(message: ChatMessage): string {
  return message.content.replace(/\r\n/g, '\n').trim()
}

function attachmentSignature(message: ChatMessage): string {
  return (message.attachments ?? [])
    .map((attachment) => `${attachment.kind}:${attachment.path}`)
    .sort()
    .join('\n')
}

function isEquivalentAssistantMessage(left: ChatMessage, right: ChatMessage): boolean {
  if (left.role !== 'assistant' || right.role !== 'assistant') return false
  if (!left.runId || !right.runId || left.runId !== right.runId) return false
  const leftContent = normalizedAssistantContent(left)
  if (!leftContent || leftContent !== normalizedAssistantContent(right)) return false
  if (attachmentSignature(left) !== attachmentSignature(right)) return false
  return true
}

export function applyUpdatedMessageRow(row: MessageRow, set: SessionStoreSet): void {
  const nextMessage = chatMessageFromRow(row)
  set((state) => {
    if (row.sessionId !== state.sessionId || !nextMessage) return {}

    const existingIndex = state.messages.findIndex((message) => message.id === row.id)
    if (existingIndex === -1) {
      const duplicateAssistantIndex = state.messages.findIndex((message) =>
        isEquivalentAssistantMessage(message, nextMessage)
      )
      if (duplicateAssistantIndex !== -1) {
        const messages = [...state.messages]
        messages[duplicateAssistantIndex] = nextMessage
        return { messages }
      }
      return { messages: [...state.messages, nextMessage] }
    }

    const messages = [...state.messages]
    messages[existingIndex] = {
      ...messages[existingIndex],
      ...nextMessage
    }
    return { messages }
  })
}

export function applyCompletedRunToMessages(
  messages: ChatMessage[],
  completedRun: NonNullable<AgentRunStatePayload['completedRun']>
): ChatMessage[] {
  let changed = false
  const nextMessages = messages.map((message) => {
    if (message.runId !== completedRun.id) return message
    changed = true
    return {
      ...message,
      runStatus: completedRun.status,
      runStartedAt: completedRun.startedAt,
      runCompletedAt: completedRun.completedAt ?? null,
      runDurationMs: completedRun.durationMs ?? null,
      runError: completedRun.error ?? null
    }
  })
  return changed ? nextMessages : messages
}

export function mergeLoadedAndLiveMessages(
  loadedMessages: ChatMessage[],
  liveMessages: ChatMessage[]
): ChatMessage[] {
  if (liveMessages.length === 0) return loadedMessages

  const messageIds = new Set(loadedMessages.map((message) => message.id))
  const toolCallIds = new Set(
    loadedMessages.flatMap((message) =>
      message.role === 'tool' && message.toolCallId ? [message.toolCallId] : []
    )
  )
  const merged = [...loadedMessages]

  for (const message of liveMessages) {
    if (messageIds.has(message.id)) continue
    if (
      message.role === 'assistant' &&
      merged.some((loadedMessage) => isEquivalentAssistantMessage(loadedMessage, message))
    ) {
      continue
    }
    if (message.role === 'tool' && message.toolCallId && toolCallIds.has(message.toolCallId)) {
      continue
    }
    messageIds.add(message.id)
    if (message.role === 'tool' && message.toolCallId) {
      toolCallIds.add(message.toolCallId)
    }
    merged.push(message)
  }

  return merged
}

export function buildLoadedSessionView({
  rows,
  humanInputs
}: {
  rows: MessageRow[]
  humanInputs: Parameters<typeof mergeHumanInputWidget>[1][]
}): {
  messages: ChatMessage[]
  widgets: Map<string, ToolWidgetState>
} {
  const messages: ChatMessage[] = []
  const widgets = new Map<string, ToolWidgetState>()

  for (const row of rows) {
    const visibility = normalizeMessageVisibility(row.visibility, row.role)
    if (row.role === 'tool' && row.toolCallId) {
      if (!isUserVisibleMessage(visibility)) continue
      try {
        const callInfo = JSON.parse(row.content)
        const toolName =
          typeof row.toolName === 'string' && row.toolName.trim()
            ? row.toolName
            : typeof callInfo.name === 'string'
              ? callInfo.name
              : 'tool'
        const args = isRecord(callInfo.arguments) ? callInfo.arguments : {}
        const hasToolResult = row.toolCallResult != null
        const isInterruptedToolCall = row.runStatus === 'failed' || row.runStatus === 'cancelled'

        widgets.set(row.toolCallId, {
          toolCallId: row.toolCallId,
          toolName,
          title: deriveToolTitle(toolName, args),
          args,
          result: parseStoredValue(row.toolCallResult),
          status: hasToolResult ? 'complete' : isInterruptedToolCall ? 'error' : 'running',
          isError: !hasToolResult && isInterruptedToolCall
        })
        messages.push({
          id: row.id,
          role: 'tool',
          content: '',
          visibility,
          createdAt: row.createdAt,
          ...rowRunFields(row),
          toolCallId: row.toolCallId
        })
      } catch {
        // skip malformed
      }
      continue
    }

    if (row.role === 'tool') continue
    if (!isUserVisibleMessage(visibility)) continue

    messages.push({
      id: row.id,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
      parts: row.parts ?? [],
      visibility,
      createdAt: row.createdAt,
      ...rowRunFields(row),
      attachments: parseMessageAttachments(row.attachmentsJson)
    })
  }

  for (const request of humanInputs) {
    mergeHumanInputWidget(widgets, request)
  }

  return { messages, widgets }
}
