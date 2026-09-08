export type RawRecord = {
  timestamp?: string
  type?: string
  payload?: Record<string, unknown>
  [key: string]: unknown
}

export type NormalizedEvent = {
  id: string
  line: number
  timestamp: string
  timeLabel: string
  type: string
  payloadType: string
  category: EventCategory
  title: string
  excerpt: string
  content: string
  role: string
  phase: string
  visibility: string
  model: string
  modelProvider: string
  modelApi: string
  callId: string
  sizeLabel: string
  searchText: string
  raw: RawRecord
}

export type EventCategory =
  | 'meta'
  | 'message'
  | 'reasoning'
  | 'tool_call'
  | 'tool_output'
  | 'web'
  | 'token'
  | 'event'

export type PromptBlock = {
  id: string
  title: string
  source: string
  role: string
  text: string
  line: number
}

export type SessionFile = {
  source?: 'codex' | 'pichu' | 'trajectory'
  key?: string
  path: string
  name: string
  fileName?: string
  size: number
  modifiedAt: string
  sessionId?: string
  title?: string
  cwd?: string
  agentId?: string
  messageCount?: number
}

export type SessionView = {
  path: string
  records: RawRecord[]
  events: NormalizedEvent[]
  prompts: PromptBlock[]
  errors: Array<{ line: number; message: string }>
  meta: Record<string, string>
  context: Record<string, string>
  stats: {
    durationMs: number
    toolCalls: number
    toolOutputs: number
    totalTokens: number
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
  }
}

export type ParseProfile = {
  view: SessionView
  timings: {
    splitLinesMs: number
    jsonParseMs: number
    normalizeEventsMs: number
    extractPromptsMs: number
    extractMetaMs: number
    extractStatsMs: number
    totalMs: number
  }
  counts: {
    bytes: number
    lines: number
    records: number
    events: number
    prompts: number
    errors: number
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function nonEmptyRecord(value: Record<string, unknown>) {
  return Object.keys(value).length > 0
}

function trajectoryData(record: RawRecord) {
  return asRecord(record.data)
}

function isModelTrajectoryRecord(record: RawRecord) {
  return Boolean(
    asString(record.ts) && asString(record.requestId) && nonEmptyRecord(trajectoryData(record))
  )
}

function compactModelPayload(model: Record<string, unknown>) {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name,
    api: model.api,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens
  }
}

function modelFromTrajectoryData(data: Record<string, unknown>) {
  const model = asRecord(data.model)
  if (nonEmptyRecord(model)) return model
  const partial = asRecord(data.partial)
  if (nonEmptyRecord(partial)) {
    return {
      provider: partial.provider,
      id: partial.model,
      api: partial.api,
      name: partial.responseModel
    }
  }
  const message = asRecord(data.message)
  if (nonEmptyRecord(message)) {
    return {
      provider: message.provider,
      id: message.model,
      api: message.api,
      name: message.responseModel
    }
  }
  return {}
}

function payloadFor(record: RawRecord) {
  const payload = asRecord(record.payload)
  if (nonEmptyRecord(payload) || !isModelTrajectoryRecord(record)) return payload

  const data = trajectoryData(record)
  const recordType = asString(record.type)
  const streamType = recordType === 'stream_event' ? asString(data.type) : ''
  const model = modelFromTrajectoryData(data)
  const toolCall = asRecord(data.toolCall)
  const partial = asRecord(data.partial)

  return {
    type: streamType ? `stream_${streamType}` : recordType,
    request_id: asString(record.requestId),
    session_id: asString(record.sessionId),
    model: asString(model.id) || asString(partial.model),
    model_provider: asString(model.provider) || asString(partial.provider),
    model_api: asString(model.api) || asString(partial.api),
    response_model: asString(model.name) || asString(partial.responseModel),
    name: asString(toolCall.name),
    call_id: asString(toolCall.id),
    usage: recordType === 'request_end' ? asRecord(data.usage) : {},
    data
  }
}

function timestampFor(record: RawRecord) {
  return asString(record.timestamp) || asString(record.ts)
}

function compact(value: string, max = 260) {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max - 1)}…`
}

export function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function formatDuration(ms: number) {
  if (!ms) return '0s'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function formatTime(timestamp: string) {
  if (!timestamp) return 'no time'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function reasoningSummaryText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      const record = asRecord(item)
      return asString(record.text) || asString(record.summary_text) || asString(record.content)
    })
    .filter(Boolean)
    .join('\n\n')
}

function parseMaybeJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return asRecord(value)
  try {
    return asRecord(JSON.parse(value) as unknown)
  } catch {
    return {}
  }
}

function thinkingBlockText(record: Record<string, unknown>): string {
  const thinking = asString(record.thinking)
  if (thinking.trim()) return thinking

  const signature = parseMaybeJsonRecord(record.thinkingSignature)
  const summary = reasoningSummaryText(signature.summary)
  if (summary.trim()) return summary

  return asString(signature.encrypted_content) || asString(record.thinkingSignature)
    ? '[encrypted reasoning]'
    : ''
}

function contentItemToText(item: unknown): string {
  if (typeof item === 'string') return item
  const record = asRecord(item)
  const type = asString(record.type)

  if (type === 'thinking') return thinkingBlockText(record)
  if (type === 'reasoning') {
    return (
      reasoningSummaryText(record.summary) ||
      contentToText(record.content) ||
      (record.encrypted_content ? '[encrypted reasoning]' : '')
    )
  }
  if (type === 'toolCall') {
    return `Tool call: ${asString(record.name) || 'tool'}`
  }
  if (type === 'function_call') {
    return `Tool call: ${asString(record.name) || 'tool'}`
  }

  return asString(record.text) || asString(record.content) || JSON.stringify(record)
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => contentItemToText(item))
      .filter(Boolean)
      .join('\n\n')
  }
  if (content == null) return ''
  return JSON.stringify(content, null, 2)
}

function decodeHtmlEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|lt|gt|apos);/gi, (entity, code: string) => {
    const normalized = code.toLowerCase()
    if (normalized === 'quot') return '"'
    if (normalized === 'amp') return '&'
    if (normalized === 'lt') return '<'
    if (normalized === 'gt') return '>'
    if (normalized === 'apos') return "'"

    const parseCodePoint = (raw: string, radix: number) => {
      const codePoint = Number.parseInt(raw, radix)
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? codePoint
        : null
    }

    const codePoint = normalized.startsWith('#x')
      ? parseCodePoint(normalized.slice(2), 16)
      : normalized.startsWith('#')
        ? parseCodePoint(normalized.slice(1), 10)
        : null

    return codePoint == null ? entity : String.fromCodePoint(codePoint)
  })
}

function parseTagAttributes(text: string) {
  const attrs: Record<string, string> = {}
  text.replace(
    /([a-zA-Z_:][-a-zA-Z0-9_:]*)\s*=\s*"([^"]*)"/g,
    (_match, key: string, value: string) => {
      attrs[key] = decodeHtmlEntities(value)
      return ''
    }
  )
  return attrs
}

function shortenIdentifier(value: string) {
  if (value.length <= 28) return value
  return `${value.slice(0, 13)}…${value.slice(-6)}`
}

function workspaceLabelFor(type: string) {
  if (type === 'group') return 'Group'
  if (type === 'user') return 'User'
  if (type === 'doc') return 'Doc'
  return type ? type[0].toUpperCase() + type.slice(1) : 'Workspace'
}

function simplifyWorkspaceTag(attrsText: string, bodyText: string) {
  const attrs = parseTagAttributes(attrsText)
  const decodedBody = decodeHtmlEntities(bodyText).trim()
  const bodyRecord = parseMaybeJson(decodedBody)
  const body = asRecord(bodyRecord)
  const type = attrs.type || asString(body.type) || asString(body.subtitle).toLowerCase()
  let label = asString(body.name) || asString(body.title)
  let identifier = asString(body.identifier) || asString(body.chat_id) || asString(body.id)

  if (!label) {
    const pipeMatch = decodedBody.match(/^([^:|]+):\s*([^|]+?)(?:\s*\|\s*(.+))?$/)
    if (pipeMatch) {
      label = pipeMatch[2].trim()
      identifier ||= pipeMatch[3]?.trim() || ''
    } else {
      label = decodedBody || workspaceLabelFor(type)
    }
  }

  const prefix = workspaceLabelFor(type || asString(body.subtitle).toLowerCase())
  return identifier
    ? `[${prefix}: ${label} · ${shortenIdentifier(identifier)}]`
    : `[${prefix}: ${label}]`
}

function normalizeDisplayText(text: string) {
  const decoded = decodeHtmlEntities(text)
  return decoded.replace(
    /<workspace\b([^>]*)>([\s\S]*?)<\/workspace>/gi,
    (_match, attrsText: string, bodyText: string) => simplifyWorkspaceTag(attrsText, bodyText)
  )
}

function stringifyPayload(value: unknown) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return JSON.stringify(value, null, 2)
}

function parseMaybeJson(value: unknown) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function categoryFor(recordType: string, payloadType: string): EventCategory {
  if (
    recordType === 'session_meta' ||
    payloadType === 'session_meta' ||
    recordType === 'turn_context'
  )
    return 'meta'
  if (
    recordType === 'request_start' ||
    recordType === 'attempt_start' ||
    recordType === 'provider_payload' ||
    recordType === 'provider_response'
  )
    return 'meta'
  if (
    payloadType === 'message' ||
    payloadType === 'user_message' ||
    payloadType === 'agent_message'
  )
    return 'message'
  if (payloadType === 'reasoning') return 'reasoning'
  if (payloadType.startsWith('stream_toolcall')) return 'tool_call'
  if (payloadType === 'function_call' || payloadType === 'custom_tool_call') return 'tool_call'
  if (
    payloadType === 'function_call_output' ||
    payloadType === 'custom_tool_call_output' ||
    payloadType === 'patch_apply_end'
  )
    return 'tool_output'
  if (payloadType === 'web_search_call' || payloadType === 'web_search_end') return 'web'
  if (payloadType.startsWith('stream_text')) return 'token'
  if (payloadType === 'token_count') return 'token'
  return 'event'
}

function titleFor(recordType: string, payload: Record<string, unknown>, payloadType: string) {
  if (recordType === 'session_meta') return 'Session metadata'
  if (recordType === 'turn_context') return 'Turn context'
  if (payloadType === 'message') {
    const role = asString(payload.role) || 'unknown'
    const phase = asString(payload.phase)
    const visibility = asString(payload.visibility)
    if (role === 'user' && visibility === 'model-only' && phase === 'runtime_context')
      return 'model-only runtime context'
    if (role === 'user' && phase === 'agent_input') return 'agent-facing user message'
    if (visibility && visibility !== 'shared') return `${visibility} ${role} message`
    return `${role}${phase ? `/${phase}` : ''} message`
  }
  if (payloadType === 'agent_message') return 'Agent update'
  if (payloadType === 'user_message') return 'User event'
  if (payloadType === 'reasoning') return 'Reasoning item'
  if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
    return `${asString(payload.name) || 'tool'} call`
  }
  if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output')
    return 'Tool output'
  if (payloadType === 'web_search_call') return 'Web search call'
  if (payloadType === 'web_search_end') return 'Web search result'
  if (payloadType === 'token_count') return 'Token count'
  if (payloadType === 'task_started') return 'Task started'
  if (payloadType === 'patch_apply_end') return 'Patch applied'
  if (recordType === 'request_start') return 'Model request started'
  if (recordType === 'attempt_start')
    return `Attempt ${asNumber(asRecord(payload.data).attempt) || ''} started`.trim()
  if (recordType === 'provider_payload') return 'Provider payload'
  if (recordType === 'provider_response') return 'Provider response'
  if (recordType === 'request_end') return 'Model request ended'
  if (payloadType === 'stream_start') return 'Stream started'
  if (payloadType === 'stream_text_start') return 'Text stream started'
  if (payloadType === 'stream_text_delta') return 'Text delta'
  if (payloadType === 'stream_text_end') return 'Text completed'
  if (payloadType === 'stream_toolcall_start')
    return `${asString(payload.name) || 'tool'} call started`
  if (payloadType === 'stream_toolcall_delta')
    return `${asString(payload.name) || 'tool'} call delta`
  if (payloadType === 'stream_toolcall_end')
    return `${asString(payload.name) || 'tool'} call completed`
  if (payloadType === 'stream_done') return 'Stream completed'
  return payloadType || recordType || 'record'
}

function trajectoryMessageText(message: unknown) {
  const record = asRecord(message)
  return normalizeDisplayText(contentToText(record.content))
}

function trajectoryRequestEndText(data: Record<string, unknown>): string {
  const messageText = trajectoryMessageText(data.message)
  if (messageText.trim()) return messageText

  return stringifyPayload({
    result: data.result,
    retryCount: data.retryCount,
    durationMs: data.durationMs,
    usage: data.usage,
    debug: data.debug
  })
}

function trajectoryPartialText(data: Record<string, unknown>) {
  const partial = asRecord(data.partial)
  return normalizeDisplayText(contentToText(partial.content))
}

function trajectoryToolCall(data: Record<string, unknown>) {
  const direct = asRecord(data.toolCall)
  if (nonEmptyRecord(direct)) return direct
  const partial = asRecord(data.partial)
  const content = partial.content
  if (!Array.isArray(content)) return {}
  const toolCall = content
    .map((item) => asRecord(item))
    .find((item) => asString(item.type) === 'toolCall')
  return toolCall || {}
}

function contentFor(recordType: string, payload: Record<string, unknown>, payloadType: string) {
  if (recordType === 'session_meta') {
    const base = asRecord(payload.base_instructions)
    return [
      `id: ${asString(payload.id)}`,
      `title: ${asString(payload.title)}`,
      `source: ${asString(payload.source)}`,
      `cwd: ${asString(payload.cwd)}`,
      `originator: ${asString(payload.originator)}`,
      `agent: ${asString(payload.agent_id)}`,
      `cli: ${asString(payload.cli_version)}`,
      `base instructions: ${asString(base.text).length.toLocaleString()} chars`
    ]
      .filter((line) => !line.endsWith(': '))
      .join('\n')
  }

  if (recordType === 'turn_context') {
    return JSON.stringify(
      {
        cwd: payload.cwd,
        model: payload.model,
        effort: payload.effort,
        approval_policy: payload.approval_policy,
        sandbox_policy: payload.sandbox_policy,
        collaboration_mode: payload.collaboration_mode
      },
      null,
      2
    )
  }

  if (payloadType === 'message') return normalizeDisplayText(contentToText(payload.content))
  if (payloadType === 'agent_message' || payloadType === 'user_message')
    return normalizeDisplayText(asString(payload.message))
  if (payloadType === 'reasoning') {
    const summary = contentToText(payload.summary)
    const content = contentToText(payload.content)
    return summary || content || (payload.encrypted_content ? '[encrypted reasoning]' : '')
  }
  if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
    const parsed = parseMaybeJson(payload.arguments ?? payload.input)
    return stringifyPayload(parsed)
  }
  if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output')
    return stringifyPayload(payload.output)
  if (payloadType === 'web_search_call' || payloadType === 'web_search_end')
    return stringifyPayload(payload.action || payload.query || payload)
  if (payloadType === 'token_count')
    return stringifyPayload(asRecord(payload.info).total_token_usage || payload.info)
  if (recordType === 'request_start' || recordType === 'attempt_start') {
    const data = asRecord(payload.data)
    const context = asRecord(data.context)
    const messages = context.messages
    return stringifyPayload({
      requestId: payload.request_id,
      sessionId: payload.session_id,
      source: data.source,
      attempt: data.attempt,
      model: compactModelPayload(modelFromTrajectoryData(data)),
      systemPromptChars: asString(context.systemPrompt).length,
      messages: Array.isArray(messages) ? messages.length : 0,
      options: data.options
    })
  }
  if (recordType === 'provider_payload') {
    const data = asRecord(payload.data)
    const providerPayload = asRecord(data.payload)
    return stringifyPayload({
      model: providerPayload.model || asString(payload.model),
      messages: Array.isArray(providerPayload.messages) ? providerPayload.messages.length : 0,
      tools: Array.isArray(providerPayload.tools) ? providerPayload.tools.length : 0,
      temperature: providerPayload.temperature,
      max_tokens: providerPayload.max_tokens,
      stream: providerPayload.stream
    })
  }
  if (recordType === 'provider_response') {
    const response = asRecord(asRecord(payload.data).response)
    return stringifyPayload({
      status: response.status,
      contentType: asRecord(response.headers)['content-type'],
      serverTiming: asRecord(response.headers)['server-timing']
    })
  }
  if (recordType === 'request_end') {
    const data = asRecord(payload.data)
    return trajectoryRequestEndText(data)
  }
  if (payloadType === 'stream_text_delta')
    return normalizeDisplayText(asString(asRecord(payload.data).delta))
  if (payloadType === 'stream_text_start' || payloadType === 'stream_text_end') {
    const data = asRecord(payload.data)
    return normalizeDisplayText(asString(data.content) || trajectoryPartialText(data))
  }
  if (payloadType.startsWith('stream_toolcall')) {
    const toolCall = trajectoryToolCall(asRecord(payload.data))
    return stringifyPayload({
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
      partialArgs: toolCall.partialArgs
    })
  }
  if (payloadType === 'stream_done') {
    const data = asRecord(payload.data)
    return trajectoryMessageText(data.message) || stringifyPayload(data)
  }
  if (payloadType === 'stream_start')
    return stringifyPayload(compactModelPayload(modelFromTrajectoryData(asRecord(payload.data))))
  return stringifyPayload(payload)
}

function normalizeEvent(record: RawRecord, index: number): NormalizedEvent {
  const payload = payloadFor(record)
  const recordType = asString(record.type)
  const payloadType = asString(payload.type) || recordType
  const category = categoryFor(recordType, payloadType)
  const content = contentFor(recordType, payload, payloadType)
  const role = asString(payload.role)
  const phase = asString(payload.phase)
  const visibility = asString(payload.visibility)
  const model = asString(payload.model) || asString(payload.model_id)
  const modelProvider = asString(payload.model_provider)
  const modelApi = asString(payload.model_api)
  const callId = asString(payload.call_id)
  const size = content.length

  const event: NormalizedEvent = {
    id: `${index + 1}:${recordType}:${payloadType}:${callId}`,
    line: index + 1,
    timestamp: timestampFor(record),
    timeLabel: formatTime(timestampFor(record)),
    type: recordType,
    payloadType,
    category,
    title: titleFor(recordType, payload, payloadType),
    excerpt: compact(content || titleFor(recordType, payload, payloadType)),
    content,
    role,
    phase,
    visibility,
    model,
    modelProvider,
    modelApi,
    callId,
    sizeLabel: size ? `${size.toLocaleString()} chars` : '',
    searchText: '',
    raw: record
  }

  event.searchText = [
    event.title,
    event.excerpt,
    event.type,
    event.payloadType,
    event.category,
    event.role,
    event.phase,
    event.visibility,
    event.model,
    event.modelProvider,
    event.modelApi,
    event.callId
  ]
    .join('\n')
    .toLowerCase()

  return event
}

function addPrompt(
  prompts: PromptBlock[],
  title: string,
  source: string,
  role: string,
  text: string,
  line: number
) {
  if (!text.trim()) return
  prompts.push({
    id: `${line}:${source}:${prompts.length}`,
    title,
    source,
    role,
    text,
    line
  })
}

function extractPrompts(records: RawRecord[]) {
  const prompts: PromptBlock[] = []

  records.forEach((record, index) => {
    const payload = payloadFor(record)
    const recordType = asString(record.type)
    const payloadType = asString(payload.type)
    const line = index + 1
    const data = asRecord(payload.data)
    const context = asRecord(data.context)
    const providerPayload = asRecord(data.payload)

    if (recordType === 'session_meta') {
      addPrompt(
        prompts,
        'Base instructions (system)',
        'session_meta.base_instructions',
        'system',
        asString(asRecord(payload.base_instructions).text),
        line
      )
      addPrompt(
        prompts,
        'Session instructions',
        'session_meta.instructions',
        'system',
        asString(asRecord(payload.instructions).text),
        line
      )
    }

    if (recordType === 'request_start' || recordType === 'attempt_start') {
      addPrompt(
        prompts,
        'Trajectory system prompt',
        `${recordType}.context.systemPrompt`,
        'system',
        asString(context.systemPrompt),
        line
      )
      const messages = context.messages
      if (Array.isArray(messages)) {
        messages.forEach((message, messageIndex) => {
          const role = asString(asRecord(message).role) || 'message'
          addPrompt(
            prompts,
            `Trajectory input ${messageIndex + 1} (${role})`,
            `${recordType}.context.messages.${messageIndex}`,
            role,
            trajectoryMessageText(message),
            line
          )
        })
      }
    }

    if (recordType === 'provider_payload') {
      const messages = providerPayload.messages
      if (Array.isArray(messages)) {
        messages.forEach((message, messageIndex) => {
          const role = asString(asRecord(message).role) || 'message'
          addPrompt(
            prompts,
            `Provider message ${messageIndex + 1} (${role})`,
            `provider_payload.messages.${messageIndex}`,
            role,
            trajectoryMessageText(message),
            line
          )
        })
      }
    }

    if (recordType === 'turn_context') {
      addPrompt(
        prompts,
        'Developer instructions',
        'turn_context.developer_instructions',
        'developer',
        asString(payload.developer_instructions),
        line
      )
      addPrompt(
        prompts,
        'User instructions',
        'turn_context.user_instructions',
        'user',
        asString(payload.user_instructions),
        line
      )
      const collaboration = asRecord(payload.collaboration_mode)
      const settings = asRecord(collaboration.settings)
      addPrompt(
        prompts,
        'Collaboration mode instructions',
        'turn_context.collaboration_mode',
        'developer',
        asString(settings.developer_instructions),
        line
      )
    }

    if (payloadType === 'message') {
      const role = asString(payload.role) || 'message'
      const phase = asString(payload.phase)
      const visibility = asString(payload.visibility)
      const title =
        role === 'user' && visibility === 'model-only' && phase === 'runtime_context'
          ? 'Model-only runtime context'
          : role === 'user' && phase === 'agent_input'
            ? 'Agent-facing user message'
            : `${role}${phase ? `/${phase}` : ''} message`
      addPrompt(
        prompts,
        title,
        'response_item.message',
        role,
        normalizeDisplayText(contentToText(payload.content)),
        line
      )
    }
  })

  return prompts
}

function extractMeta(records: RawRecord[]) {
  const sessionMeta = records.find((record) => record.type === 'session_meta')
  const turnContext = records.find((record) => record.type === 'turn_context')
  const trajectoryStart = records.find((record) => isModelTrajectoryRecord(record))
  const titleEvent = [...records]
    .reverse()
    .find((record) => asString(payloadFor(record).type) === 'thread_name_updated')
  const metaPayload = sessionMeta ? payloadFor(sessionMeta) : {}
  const contextPayload = turnContext ? payloadFor(turnContext) : {}
  const titlePayload = titleEvent ? payloadFor(titleEvent) : {}
  const trajectoryPayload = trajectoryStart ? payloadFor(trajectoryStart) : {}
  const trajectoryDataPayload = asRecord(trajectoryPayload.data)
  const trajectoryContext = asRecord(trajectoryDataPayload.context)
  const firstTrajectoryMessage = Array.isArray(trajectoryContext.messages)
    ? asRecord(trajectoryContext.messages[0])
    : {}
  const cwdMatch = asString(firstTrajectoryMessage.content).match(/<cwd>([\s\S]*?)<\/cwd>/)

  return {
    meta: {
      id: asString(metaPayload.id) || asString(trajectoryPayload.session_id),
      title: asString(metaPayload.title) || asString(titlePayload.thread_name),
      source: asString(metaPayload.source) || (trajectoryStart ? 'trajectory' : ''),
      cwd: asString(metaPayload.cwd) || cwdMatch?.[1]?.trim() || '',
      model: asString(metaPayload.model_provider) || asString(trajectoryPayload.model_provider),
      model_id: asString(metaPayload.model) || asString(trajectoryPayload.model),
      model_api: asString(metaPayload.model_api) || asString(trajectoryPayload.model_api),
      originator:
        asString(metaPayload.originator) || (trajectoryStart ? 'Owls model trajectory' : ''),
      cli: asString(metaPayload.cli_version),
      timestamp:
        asString(metaPayload.timestamp) || (trajectoryStart ? timestampFor(trajectoryStart) : '')
    },
    context: {
      cwd: asString(contextPayload.cwd) || cwdMatch?.[1]?.trim() || '',
      model: asString(contextPayload.model) || asString(trajectoryPayload.model),
      effort: asString(contextPayload.effort),
      approval_policy: asString(contextPayload.approval_policy)
    }
  }
}

function extractStats(records: RawRecord[], events: NormalizedEvent[]) {
  const first = events.find((event) => event.timestamp)?.timestamp
  const last = [...events].reverse().find((event) => event.timestamp)?.timestamp
  const durationMs =
    first && last ? Math.max(0, new Date(last).getTime() - new Date(first).getTime()) : 0
  const tokenEvents = records
    .map((record) => payloadFor(record))
    .filter((payload) => payload.type === 'token_count')
  const lastTokenInfo = asRecord(asRecord(tokenEvents.at(-1)?.info).total_token_usage)
  const usagePayloads = records
    .map((record) => asRecord(payloadFor(record).usage))
    .filter((usage) => Object.keys(usage).length > 0)
  const usageTotals = usagePayloads.reduce<{
    totalTokens: number
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
  }>(
    (acc, usage) => {
      acc.totalTokens += asNumber(usage.totalTokens) || asNumber(usage.total_tokens)
      acc.inputTokens +=
        asNumber(usage.input) || asNumber(usage.inputTokens) || asNumber(usage.input_tokens)
      acc.outputTokens +=
        asNumber(usage.output) || asNumber(usage.outputTokens) || asNumber(usage.output_tokens)
      acc.reasoningTokens +=
        asNumber(usage.reasoning) ||
        asNumber(usage.reasoningTokens) ||
        asNumber(usage.reasoning_tokens)
      return acc
    },
    { totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0 }
  )

  return {
    durationMs,
    toolCalls: events.filter((event) => event.category === 'tool_call').length,
    toolOutputs: events.filter((event) => event.category === 'tool_output').length,
    totalTokens: asNumber(lastTokenInfo.total_tokens) || usageTotals.totalTokens,
    inputTokens: asNumber(lastTokenInfo.input_tokens) || usageTotals.inputTokens,
    outputTokens: asNumber(lastTokenInfo.output_tokens) || usageTotals.outputTokens,
    reasoningTokens: asNumber(lastTokenInfo.reasoning_output_tokens) || usageTotals.reasoningTokens
  }
}

export function parseCodexSession(jsonl: string, sourcePath: string): SessionView {
  return profileParseCodexSession(jsonl, sourcePath).view
}

export function profileParseCodexSession(jsonl: string, sourcePath: string): ParseProfile {
  const totalStart = performance.now()
  const records: RawRecord[] = []
  const errors: Array<{ line: number; message: string }> = []

  const splitStart = performance.now()
  const lines = jsonl.split(/\r?\n/)
  const splitEnd = performance.now()

  const jsonParseStart = performance.now()
  lines.forEach((line, index) => {
    if (!line.trim()) return
    try {
      records.push(JSON.parse(line) as RawRecord)
    } catch (error) {
      errors.push({
        line: index + 1,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })
  const jsonParseEnd = performance.now()

  const normalizeStart = performance.now()
  const events = records.map(normalizeEvent)
  const normalizeEnd = performance.now()

  const promptsStart = performance.now()
  const prompts = extractPrompts(records)
  const promptsEnd = performance.now()

  const metaStart = performance.now()
  const { meta, context } = extractMeta(records)
  const metaEnd = performance.now()

  const statsStart = performance.now()
  const stats = extractStats(records, events)
  const statsEnd = performance.now()

  const view = {
    path: sourcePath,
    records,
    events,
    prompts,
    errors,
    meta,
    context,
    stats
  }

  return {
    view,
    timings: {
      splitLinesMs: splitEnd - splitStart,
      jsonParseMs: jsonParseEnd - jsonParseStart,
      normalizeEventsMs: normalizeEnd - normalizeStart,
      extractPromptsMs: promptsEnd - promptsStart,
      extractMetaMs: metaEnd - metaStart,
      extractStatsMs: statsEnd - statsStart,
      totalMs: performance.now() - totalStart
    },
    counts: {
      bytes: jsonl.length,
      lines: lines.length,
      records: records.length,
      events: events.length,
      prompts: prompts.length,
      errors: errors.length
    }
  }
}
