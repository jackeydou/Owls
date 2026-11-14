import type { AgentEvent } from '@earendil-works/pi-agent-core'
import type { HumanInputRequestForRenderer } from '../../../../shared/human-input'
import type { ToolWidgetState } from '../../components/tool-widgets/types'
import type { ChatMessage } from './types'
import { isRecord } from './utils'

export function activeToolWidgetCount(widgets: Map<string, ToolWidgetState>): number {
  let count = 0
  widgets.forEach((widget) => {
    if (
      widget.toolName !== 'streamingUITool' &&
      (widget.status === 'streaming' ||
        widget.status === 'running' ||
        widget.status === 'waiting_for_user')
    ) {
      count += 1
    }
  })
  return count
}

export function toolName(event: AgentEvent): string {
  if (
    event.type === 'tool_execution_start' ||
    event.type === 'tool_execution_update' ||
    event.type === 'tool_execution_end'
  ) {
    return event.toolName || 'tool'
  }
  return 'tool'
}

export function isImageGenerationToolName(name: string): boolean {
  return name.toLowerCase().replace(/[-\s]+/g, '_') === 'image_generate'
}

export function deriveToolTitle(toolName: string, args: Record<string, unknown>): string {
  if (typeof args.title === 'string' && args.title.trim()) {
    return args.title
  }
  return toolName || 'Tool'
}

export function parseStoredValue(value: string | null | undefined): unknown {
  if (value == null) return undefined

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function extractToolCallsFromMessageUpdate(event: AgentEvent): Array<{
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}> {
  if (event.type !== 'message_update') return []

  const assistantMessageEvent = (event as Record<string, unknown>).assistantMessageEvent as
    | { type?: string }
    | undefined

  if (
    assistantMessageEvent?.type !== 'toolcall_start' &&
    assistantMessageEvent?.type !== 'toolcall_delta' &&
    assistantMessageEvent?.type !== 'toolcall_end'
  ) {
    return []
  }

  const message = (event as Record<string, unknown>).message as
    | { content?: Array<Record<string, unknown>> }
    | undefined

  if (!Array.isArray(message?.content)) return []

  return message.content.flatMap((block) => {
    if (block.type !== 'toolCall' || typeof block.id !== 'string') return []

    return [
      {
        toolCallId: block.id,
        toolName: typeof block.name === 'string' ? block.name : 'tool',
        args: isRecord(block.arguments) ? block.arguments : {}
      }
    ]
  })
}

export function upsertToolWidget(
  widgets: Map<string, ToolWidgetState>,
  payload: {
    toolCallId: string
    toolName: string
    args?: Record<string, unknown>
    result?: unknown
    humanInput?: HumanInputRequestForRenderer
    status?: ToolWidgetState['status']
    isError?: boolean
  }
): void {
  const existing = widgets.get(payload.toolCallId)
  const nextArgs = payload.args
    ? { ...(existing?.args ?? {}), ...payload.args }
    : (existing?.args ?? {})
  const nextToolName = payload.toolName || existing?.toolName || 'tool'

  widgets.set(payload.toolCallId, {
    toolCallId: payload.toolCallId,
    toolName: nextToolName,
    title: deriveToolTitle(nextToolName, nextArgs),
    args: nextArgs,
    result: payload.result ?? existing?.result,
    humanInput: payload.humanInput ?? existing?.humanInput,
    status: payload.status ?? existing?.status ?? 'streaming',
    isError: payload.isError ?? existing?.isError ?? false
  })
}

export function ensureToolMessage(
  messages: ChatMessage[],
  toolCallId: string,
  runId?: string | null
): ChatMessage[] {
  const existingIndex = messages.findIndex(
    (message) => message.role === 'tool' && message.toolCallId === toolCallId
  )
  if (existingIndex !== -1) {
    if (!runId || messages[existingIndex]?.runId) return messages
    return messages.map((message, index) =>
      index === existingIndex ? { ...message, runId } : message
    )
  }

  return [
    ...messages,
    {
      id: `tool-${toolCallId}`,
      role: 'tool',
      content: '',
      runId: runId ?? null,
      createdAt: new Date().toISOString(),
      toolCallId
    }
  ]
}

export function applyActiveRunIdToOptimisticToolMessages(
  messages: ChatMessage[],
  runId: string | null | undefined
): ChatMessage[] {
  if (!runId) return messages

  let changed = false
  const nextMessages = messages.map((message) => {
    if (
      message.role !== 'tool' ||
      message.runId ||
      !message.toolCallId ||
      message.id !== `tool-${message.toolCallId}`
    ) {
      return message
    }

    changed = true
    return { ...message, runId }
  })

  return changed ? nextMessages : messages
}

function humanInputWidgetStatus(request: HumanInputRequestForRenderer): ToolWidgetState['status'] {
  if (request.status === 'resolved') return 'complete'
  if (request.status === 'expired') return 'error'
  return 'waiting_for_user'
}

export function mergeHumanInputWidget(
  widgets: Map<string, ToolWidgetState>,
  request: HumanInputRequestForRenderer
): void {
  upsertToolWidget(widgets, {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    humanInput: request,
    status: humanInputWidgetStatus(request),
    isError: request.status === 'expired'
  })
}
