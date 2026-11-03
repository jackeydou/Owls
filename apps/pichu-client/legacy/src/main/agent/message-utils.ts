import { readFileSync } from 'node:fs'
import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  Api,
  ImageContent,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage
} from '@earendil-works/pi-ai'
import {
  isModelVisibleMessage,
  normalizeMessageVisibility,
  PICHU_ASSISTANT_MESSAGE_ROLE,
  PICHU_USER_MESSAGE_ROLE
} from '../../shared/agent-message-visibility.js'
import type { MessageAttachment } from '../../shared/attachments.js'
import { parseContextCompactionMarker } from '../../shared/context-compaction.js'
import { partsToModelText } from '../../shared/message-parts.js'
import { toMessageAttachment } from '../attachment-handler.js'
import {
  rememberContextCompactionMarker,
  replacementMessagesFromMarker
} from '../ipc-handlers/context-compaction.js'
import type { MessageRow } from '../stores/settings-store.js'

export type MessageModelMetadata = {
  modelId?: string
  modelProvider?: string
  modelApi?: string
  modelUsageJson?: string
}

export type AssistantReplayContent = Array<TextContent | ThinkingContent | ToolCall>

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pushUniqueString(values: string[], seen: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  if (!trimmed || seen.has(trimmed)) return
  seen.add(trimmed)
  values.push(trimmed)
}

function collectMediaPathsFromRecord(
  record: Record<string, unknown>,
  values: string[],
  seen: Set<string>
): void {
  pushUniqueString(values, seen, record.path)
  pushUniqueString(values, seen, record.filePath)
  pushUniqueString(values, seen, record.media)
  pushUniqueString(values, seen, record.mediaUrl)

  for (const key of ['paths', 'mediaUrls']) {
    const raw = record[key]
    if (!Array.isArray(raw)) continue
    for (const item of raw) {
      pushUniqueString(values, seen, item)
    }
  }

  if (isRecord(record.media)) {
    collectMediaPathsFromRecord(record.media, values, seen)
  }
}

function collectMediaPathsFromText(text: string, values: string[], seen: Set<string>): void {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.toLowerCase().startsWith('media:')) continue
    const value = trimmed
      .slice('media:'.length)
      .trim()
      .replace(/^['"`]+|['"`]+$/g, '')
    pushUniqueString(values, seen, value)
  }
}

function collectMediaPathsFromToolResult(result: unknown): string[] {
  const values: string[] = []
  const seen = new Set<string>()

  if (!isRecord(result)) return values

  const content = Array.isArray(result.content) ? result.content : []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      collectMediaPathsFromText(block.text, values, seen)
    }
  }

  collectMediaPathsFromRecord(result, values, seen)
  if (isRecord(result.details)) {
    collectMediaPathsFromRecord(result.details, values, seen)
  }

  return values
}

export function collectAttachmentsFromToolResult(result: unknown): MessageAttachment[] {
  return collectMediaPathsFromToolResult(result).flatMap((path) => {
    const attachment = toMessageAttachment({ path })
    return attachment ? [attachment] : []
  })
}

function stripImageDataFromToolResult(result: unknown): unknown {
  if (!isRecord(result)) return result
  const content = Array.isArray(result.content)
    ? result.content.map((block) => {
        if (!isRecord(block) || block.type !== 'image') return block
        return {
          type: 'image',
          mimeType: typeof block.mimeType === 'string' ? block.mimeType : 'image/png',
          dataBytes: typeof block.data === 'string' ? Buffer.byteLength(block.data, 'base64') : null
        }
      })
    : result.content

  return {
    ...result,
    content
  }
}

export function serializeToolResultForStorage(result: unknown): string {
  const storageValue = stripImageDataFromToolResult(result)
  return typeof storageValue === 'string' ? storageValue : JSON.stringify(storageValue ?? '')
}

export function readImageContentFromAttachment(attachment: MessageAttachment): ImageContent | null {
  if (attachment.kind !== 'image' || !attachment.mimeType?.startsWith('image/')) return null
  try {
    return {
      type: 'image',
      data: readFileSync(attachment.path).toString('base64'),
      mimeType: attachment.mimeType
    }
  } catch {
    return null
  }
}

function buildStoredToolResultContent(value: string): Array<TextContent | ImageContent> {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!isRecord(parsed)) {
      return [{ type: 'text', text: value }]
    }

    const textBlocks = Array.isArray(parsed.content)
      ? parsed.content.flatMap((block): TextContent[] => {
          if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') {
            return []
          }
          return [{ type: 'text', text: block.text }]
        })
      : []
    const imageBlocks = collectAttachmentsFromToolResult(parsed)
      .map(readImageContentFromAttachment)
      .filter((block): block is ImageContent => Boolean(block))

    if (textBlocks.length === 0 && imageBlocks.length === 0) {
      return [{ type: 'text', text: value }]
    }
    return [...textBlocks, ...imageBlocks]
  } catch {
    return [{ type: 'text', text: value }]
  }
}

export function extractToolCallsFromMessageUpdate(event: AgentEvent): Array<{
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  assistantContent: AssistantReplayContent
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

  const message = (event as Record<string, unknown>).message

  return extractToolCallsFromAssistantMessage(message)
}

export function extractToolCallsFromAssistantMessage(message: unknown): Array<{
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  assistantContent: AssistantReplayContent
}> {
  const assistantMessage = message as { content?: Array<Record<string, unknown>> } | undefined

  if (!Array.isArray(assistantMessage?.content)) return []

  const replayPrefix: AssistantReplayContent = []
  const calls: Array<{
    toolCallId: string
    toolName: string
    args: Record<string, unknown>
    assistantContent: AssistantReplayContent
  }> = []

  for (const block of assistantMessage.content) {
    const replayBlock = toAssistantReplayContentBlock(block)
    if (!replayBlock) continue

    if (replayBlock.type !== 'toolCall') {
      replayPrefix.push(replayBlock)
      continue
    }

    calls.push({
      toolCallId: replayBlock.id,
      toolName: replayBlock.name,
      args: replayBlock.arguments,
      assistantContent: [...replayPrefix, replayBlock]
    })
  }

  return calls
}

export function extractAssistantTextDelta(event: AgentEvent): string | null {
  if (event.type !== 'message_update') {
    return null
  }

  const assistantMessageEvent = event.assistantMessageEvent as
    | { type?: string; delta?: string }
    | undefined
  if (assistantMessageEvent?.type !== 'text_delta') {
    return null
  }
  return typeof assistantMessageEvent.delta === 'string' ? assistantMessageEvent.delta : null
}

export function extractAssistantText(message: unknown): string {
  const msg = message as { content?: unknown } | undefined
  if (!Array.isArray(msg?.content)) return ''
  return msg.content
    .flatMap((block) => {
      if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') return []
      return [block.text]
    })
    .join('')
    .trim()
}

function stringifyModelUsage(usage: unknown): string | undefined {
  if (!isRecord(usage)) return undefined
  try {
    return JSON.stringify(usage)
  } catch {
    return undefined
  }
}

function extractMessageModelMetadata(message: unknown): MessageModelMetadata | null {
  if (!isRecord(message) || message.role !== 'assistant') return null
  const modelId =
    typeof message.model === 'string' && message.model.trim() ? message.model : undefined
  const modelProvider =
    typeof message.provider === 'string' && message.provider.trim() ? message.provider : undefined
  const modelApi = typeof message.api === 'string' && message.api.trim() ? message.api : undefined
  const modelUsageJson = stringifyModelUsage(message.usage)
  if (!modelId && !modelProvider && !modelApi && !modelUsageJson) return null
  return { modelId, modelProvider, modelApi, modelUsageJson }
}

function extractEventAssistantMessage(event: AgentEvent): unknown {
  const e = event as Record<string, unknown>
  if (e.type === 'message_end') return e.message
  if (e.type === 'message_update') {
    if (isRecord(e.assistantMessageEvent) && 'partial' in e.assistantMessageEvent) {
      return e.assistantMessageEvent.partial
    }
    return e.partial ?? e.message
  }
  if (e.type === 'error') return e.error
  return null
}

export function extractEventAssistantModelMetadata(event: AgentEvent): MessageModelMetadata | null {
  return extractMessageModelMetadata(extractEventAssistantMessage(event))
}

function assistantMessageHasToolCalls(message: unknown): boolean {
  const msg = message as { content?: unknown } | undefined
  if (!Array.isArray(msg?.content)) return false
  return msg.content.some((block) => isRecord(block) && block.type === 'toolCall')
}

export function extractAssistantFailureText(event: AgentEvent): string | null {
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

  const reason =
    typeof message.errorMessage === 'string' && message.errorMessage.trim()
      ? message.errorMessage.trim()
      : 'Model request failed.'
  const text = extractAssistantText(message)
  return text || reason
}

export function extractAssistantCompletionText(event: AgentEvent): string | null {
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

  return extractAssistantText(message)
}

export function isToolBoundaryEvent(event: AgentEvent): boolean {
  const e = event as Record<string, unknown>
  if (e.type === 'tool_execution_start') return true
  if (e.type !== 'message_update') return false

  const assistantMessageEvent = e.assistantMessageEvent as { type?: string } | undefined
  return (
    assistantMessageEvent?.type === 'toolcall_start' ||
    assistantMessageEvent?.type === 'toolcall_delta' ||
    assistantMessageEvent?.type === 'toolcall_end'
  )
}

export function parseMessageAttachments(
  value: string | null | undefined
): MessageAttachment[] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return undefined
    const attachments = parsed.filter((item): item is MessageAttachment => {
      return (
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.path === 'string' &&
        (item.kind === 'image' || item.kind === 'file')
      )
    })
    return attachments.length > 0 ? attachments : undefined
  } catch {
    return undefined
  }
}

function buildAttachmentPrompt(text: string, attachments: MessageAttachment[] | undefined): string {
  if (!attachments || attachments.length === 0) return text
  const lines = attachments.map((attachment) => `- ${attachment.name}: ${attachment.path}`)
  const attachmentBlock = [
    'Attachments are available at these absolute paths. Use tools to read them when needed:',
    ...lines
  ].join('\n')
  return [text.trim(), attachmentBlock].filter(Boolean).join('\n\n')
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function parseStoredModelUsage(value: string | null | undefined): Usage {
  if (!value) return EMPTY_USAGE
  try {
    const parsed = JSON.parse(value)
    if (!isRecord(parsed)) return EMPTY_USAGE
    const cost = isRecord(parsed.cost) ? parsed.cost : {}
    return {
      input: numberOrZero(parsed.input),
      output: numberOrZero(parsed.output),
      cacheRead: numberOrZero(parsed.cacheRead),
      cacheWrite: numberOrZero(parsed.cacheWrite),
      totalTokens: numberOrZero(parsed.totalTokens),
      cost: {
        input: numberOrZero(cost.input),
        output: numberOrZero(cost.output),
        cacheRead: numberOrZero(cost.cacheRead),
        cacheWrite: numberOrZero(cost.cacheWrite),
        total: numberOrZero(cost.total)
      }
    }
  } catch {
    return EMPTY_USAGE
  }
}

function toAssistantReplayContentBlock(
  block: Record<string, unknown>
): TextContent | ThinkingContent | ToolCall | null {
  if (block.type === 'text' && typeof block.text === 'string') {
    return {
      type: 'text',
      text: block.text,
      ...(typeof block.textSignature === 'string' ? { textSignature: block.textSignature } : {})
    }
  }

  if (block.type === 'thinking') {
    const thinkingSignature =
      typeof block.thinkingSignature === 'string' ? block.thinkingSignature : undefined
    const thinking = typeof block.thinking === 'string' ? block.thinking : ''
    if (!thinkingSignature && !thinking.trim()) return null
    return {
      type: 'thinking',
      thinking,
      ...(thinkingSignature ? { thinkingSignature } : {}),
      ...(block.redacted === true ? { redacted: true } : {})
    }
  }

  if (block.type === 'toolCall' && typeof block.id === 'string') {
    return {
      type: 'toolCall',
      id: block.id,
      name: typeof block.name === 'string' ? block.name : 'tool',
      arguments: isRecord(block.arguments) ? block.arguments : {},
      ...(typeof block.thoughtSignature === 'string'
        ? { thoughtSignature: block.thoughtSignature }
        : {})
    }
  }

  return null
}

function parseAssistantReplayContent(value: unknown): AssistantReplayContent {
  if (!Array.isArray(value)) return []
  return value.flatMap((block) => {
    if (!isRecord(block)) return []
    const replayBlock = toAssistantReplayContentBlock(block)
    return replayBlock ? [replayBlock] : []
  })
}

function isResponsesApi(api: string | null | undefined): boolean {
  return (
    api === 'openai-responses' ||
    api === 'azure-openai-responses' ||
    api === 'openai-codex-responses'
  )
}

function isResponsesReasoningSignature(value: string | undefined): boolean {
  if (!value?.trim()) return false
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) && parsed.type === 'reasoning' && typeof parsed.id === 'string'
  } catch {
    return false
  }
}

function sanitizeAssistantReplayContentForApi(
  content: AssistantReplayContent,
  api: string | null | undefined
): AssistantReplayContent {
  if (!isResponsesApi(api)) return content

  const out: AssistantReplayContent = []
  for (const block of content) {
    if (block.type !== 'thinking') {
      out.push(block)
      continue
    }
    if (!block.thinkingSignature || isResponsesReasoningSignature(block.thinkingSignature)) {
      out.push(block)
      continue
    }

    const withoutSignature: ThinkingContent = {
      type: 'thinking',
      thinking: block.thinking,
      ...(block.redacted ? { redacted: true } : {})
    }
    if (withoutSignature.thinking.trim()) {
      out.push(withoutSignature)
    }
  }
  return out
}

function replayContentHasResponsesReasoningSignature(content: AssistantReplayContent): boolean {
  return content.some(
    (block) => block.type === 'thinking' && isResponsesReasoningSignature(block.thinkingSignature)
  )
}

function toolCallIdWithoutResponsesItemId(toolCallId: string): string {
  const [callId] = toolCallId.split('|')
  return callId || toolCallId
}

function buildToolAssistantReplayContent(params: {
  storedContent: unknown
  fallbackToolCallId: string
  fallbackToolName: string
  fallbackArgs: Record<string, unknown>
  sourceApi?: string | null
}): { content: AssistantReplayContent; toolCallId: string } {
  const storedReplayContent = sanitizeAssistantReplayContentForApi(
    isRecord(params.storedContent)
      ? parseAssistantReplayContent(params.storedContent.assistantContent)
      : [],
    params.sourceApi
  )
  const hasReasoningSignature = replayContentHasResponsesReasoningSignature(storedReplayContent)
  const toolCallId = hasReasoningSignature
    ? params.fallbackToolCallId
    : toolCallIdWithoutResponsesItemId(params.fallbackToolCallId)

  if (storedReplayContent.length > 0) {
    return {
      toolCallId,
      content: storedReplayContent.map((block) =>
        block.type === 'toolCall'
          ? {
              ...block,
              id: toolCallId,
              name: params.fallbackToolName,
              arguments: params.fallbackArgs
            }
          : block
      )
    }
  }

  return {
    toolCallId,
    content: [
      {
        type: 'toolCall',
        id: toolCallId,
        name: params.fallbackToolName,
        arguments: params.fallbackArgs
      }
    ]
  }
}

type ToolReplayRow = {
  row: MessageRow
  replay: { content: AssistantReplayContent; toolCallId: string }
  toolName: string
  timestamp: number
}

function toolReplayGroupKey(content: AssistantReplayContent): string | null {
  const prefix = content.filter((block) => block.type !== 'toolCall')
  const hasReasoningSignature = prefix.some(
    (block) => block.type === 'thinking' && isResponsesReasoningSignature(block.thinkingSignature)
  )
  return hasReasoningSignature ? JSON.stringify(prefix) : null
}

function parseToolReplayRow(row: MessageRow, model: Model<Api>): ToolReplayRow | null {
  if (row.role !== 'tool' || !row.toolCallId) return null
  const visibility = normalizeMessageVisibility(row.visibility, row.role)
  if (!isModelVisibleMessage(visibility)) return null

  try {
    const parsed = JSON.parse(row.content)
    const toolName = row.toolName ?? 'unknown'
    const args = isRecord(parsed.arguments) ? parsed.arguments : {}
    const replay = buildToolAssistantReplayContent({
      storedContent: parsed,
      fallbackToolCallId: row.toolCallId,
      fallbackToolName: toolName,
      fallbackArgs: args,
      sourceApi: row.modelApi ?? model.api
    })
    return {
      row,
      replay,
      toolName,
      timestamp: Date.parse(row.createdAt) || Date.now()
    }
  } catch {
    return null
  }
}

function toolReplayRowsToAgentMessages(rows: ToolReplayRow[], model: Model<Api>): AgentMessage[] {
  const out: AgentMessage[] = []
  const first = rows[0]
  if (!first) return out

  const prefix = first.replay.content.filter((block) => block.type !== 'toolCall')
  const toolCalls = rows.flatMap((item) =>
    item.replay.content.filter((block): block is ToolCall => block.type === 'toolCall')
  )

  out.push({
    role: 'assistant',
    content: [...prefix, ...toolCalls],
    api: modelApiFromRow(first.row, model),
    provider: modelProviderFromRow(first.row, model),
    model: modelIdFromRow(first.row, model),
    usage: parseStoredModelUsage(first.row.modelUsageJson),
    stopReason: 'toolUse',
    timestamp: first.timestamp
  })

  for (const item of rows) {
    if (item.row.toolCallResult == null) continue
    out.push({
      role: 'toolResult',
      toolCallId: item.replay.toolCallId,
      toolName: item.toolName,
      content: buildStoredToolResultContent(item.row.toolCallResult),
      isError: false,
      timestamp: item.timestamp
    } as unknown as AgentMessage)
  }

  return out
}

function modelApiFromRow(row: MessageRow, fallback: Model<Api>): Api {
  return (row.modelApi || fallback.api) as Api
}

function modelProviderFromRow(row: MessageRow, fallback: Model<Api>): string {
  return row.modelProvider || fallback.provider
}

function modelIdFromRow(row: MessageRow, fallback: Model<Api>): string {
  return row.modelId || fallback.id
}

function rowToAgentMessages(row: MessageRow, model: Model<Api>): AgentMessage[] {
  const out: AgentMessage[] = []
  const ts = Date.parse(row.createdAt) || Date.now()
  const visibility = normalizeMessageVisibility(row.visibility, row.role)
  if (row.role === 'user') {
    if (!isModelVisibleMessage(visibility)) return out
    const modelContent = row.agentContent || partsToModelText(row.parts ?? []) || row.content
    out.push({
      role: PICHU_USER_MESSAGE_ROLE,
      visibility,
      content: buildAttachmentPrompt(modelContent, parseMessageAttachments(row.attachmentsJson)),
      timestamp: ts
    })
  } else if (row.role === 'assistant') {
    if (!isModelVisibleMessage(visibility)) return out
    if (visibility === 'shared') {
      out.push({
        role: 'assistant',
        content: [{ type: 'text', text: row.content }],
        api: modelApiFromRow(row, model),
        provider: modelProviderFromRow(row, model),
        model: modelIdFromRow(row, model),
        usage: parseStoredModelUsage(row.modelUsageJson),
        stopReason: 'stop',
        timestamp: ts
      })
    } else {
      out.push({
        role: PICHU_ASSISTANT_MESSAGE_ROLE,
        visibility,
        content: row.agentContent || row.content,
        api: modelApiFromRow(row, model),
        provider: modelProviderFromRow(row, model),
        model: modelIdFromRow(row, model),
        usage: parseStoredModelUsage(row.modelUsageJson),
        stopReason: 'stop',
        timestamp: ts
      })
    }
  } else if (row.role === 'tool' && row.toolCallId) {
    const replayRow = parseToolReplayRow(row, model)
    if (replayRow) out.push(...toolReplayRowsToAgentMessages([replayRow], model))
  }
  return out
}

function rowsToAgentMessagesWithoutCompaction(
  rows: MessageRow[],
  model: Model<Api>
): AgentMessage[] {
  const out: AgentMessage[] = []

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const replayRow = parseToolReplayRow(row, model)
    if (!replayRow) {
      out.push(...rowToAgentMessages(row, model))
      continue
    }

    const groupKey = toolReplayGroupKey(replayRow.replay.content)
    if (!groupKey) {
      out.push(...toolReplayRowsToAgentMessages([replayRow], model))
      continue
    }

    const group = [replayRow]
    while (index + 1 < rows.length) {
      const next = parseToolReplayRow(rows[index + 1], model)
      if (!next || toolReplayGroupKey(next.replay.content) !== groupKey) break
      group.push(next)
      index += 1
    }
    out.push(...toolReplayRowsToAgentMessages(group, model))
  }

  return out
}

export function rowsToAgentMessages(rows: MessageRow[], model: Model<Api>): AgentMessage[] {
  const latestCompactionIndex = rows.findLastIndex((row) =>
    Boolean(parseContextCompactionMarker(row.content))
  )

  if (latestCompactionIndex >= 0) {
    const markerRow = rows[latestCompactionIndex]
    const marker = parseContextCompactionMarker(markerRow?.content ?? '')
    if (marker) {
      rememberContextCompactionMarker(markerRow?.sessionId ?? marker.id, marker)
      return [
        ...replacementMessagesFromMarker(marker),
        ...rowsToAgentMessagesWithoutCompaction(rows.slice(latestCompactionIndex + 1), model)
      ]
    }
  }

  return rowsToAgentMessagesWithoutCompaction(rows, model)
}

export function buildUserAgentMessage(
  text: string,
  images?: string[],
  timestamp = Date.now()
): AgentMessage {
  const imageBlocks =
    images?.map((data) => ({
      type: 'image' as const,
      data,
      mimeType: 'image/png'
    })) ?? []

  if (imageBlocks.length === 0) {
    return {
      role: PICHU_USER_MESSAGE_ROLE,
      visibility: 'shared',
      content: text,
      timestamp
    }
  }

  return {
    role: PICHU_USER_MESSAGE_ROLE,
    visibility: 'shared',
    content: [{ type: 'text' as const, text }, ...imageBlocks],
    timestamp
  }
}

export function buildPromptAgentMessages(
  text: string,
  images?: string[],
  storedContextPrompt?: string
): AgentMessage[] {
  const timestamp = Date.now()
  const messages: AgentMessage[] = []
  if (storedContextPrompt?.trim()) {
    messages.push({
      role: PICHU_USER_MESSAGE_ROLE,
      visibility: 'model-only',
      content: storedContextPrompt,
      timestamp
    })
  }
  messages.push(buildUserAgentMessage(text, images, timestamp))
  return messages
}
