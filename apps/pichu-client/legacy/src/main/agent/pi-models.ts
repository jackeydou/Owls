import { randomUUID } from 'node:crypto'
import type { AgentMessage, StreamFn } from '@earendil-works/pi-agent-core'
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Message,
  type Model,
  type OpenAICompletionsCompat,
  type SimpleStreamOptions,
  type Usage
} from '@earendil-works/pi-ai'
import { completeSimple, streamSimple } from '@earendil-works/pi-ai/compat'
import {
  isPichuAgentMessage,
  pichuAgentMessageToLlm
} from '../../shared/agent-message-visibility.js'
import type { UserModelConfig } from '../../shared/model-config.js'
import type { PichuReasoningMenuLevel, PichuThinkingLevel } from '../../shared/model-settings.js'
import { writeChatDiagnosticEvent } from '../diagnostics.js'
import { ModelRequestLimiter } from '../model-request-limiter.js'
import { getOpenAIOAuthRequestAuth } from '../openai-oauth.js'
import { getUserModelConfigs, resolveUserModelConfig } from '../stores/model-config-store.js'
import {
  createProviderDiagnosticsTracker,
  formatProviderDiagnosticsSuffix,
  type ModelProviderDiagnostics,
  providerDiagnosticsAnalytics,
  withProviderDiagnosticsTracking
} from './model-provider-diagnostics.js'
import { createModelTrajectoryRecorder } from './model-trajectory.js'

export const CUSTOM_PROVIDER = 'user-configured'
export const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 95
const DEFAULT_AUTO_COMPACT_CONTEXT_WINDOW_RATIO = 0.9
const MODEL_REQUEST_MAX_CONCURRENT_REQUESTS = 4
const MODEL_REQUEST_MAX_REQUESTS_PER_MINUTE = 30
const MODEL_REQUEST_WINDOW_MS = 60_000
const MODEL_REQUEST_MAX_QUEUED_REQUESTS = 100
const MODEL_REQUEST_MAX_QUEUE_WAIT_MS = 10 * 60_000
const MODEL_REQUEST_MAX_RECONNECT_ATTEMPTS = 5
const MODEL_REQUEST_RECONNECT_BASE_DELAY_MS = 100
const MODEL_REQUEST_OPAQUE_ERROR_RECONNECT_BASE_DELAY_MS = 500
const MODEL_REQUEST_OPAQUE_ERROR_RECONNECT_MAX_DELAY_MS = 8_000
const MODEL_REQUEST_RECONNECT_JITTER_MS = 300
const MODEL_REQUEST_STREAM_IDLE_TIMEOUT_MS = 120_000
const MODEL_RECONNECT_STATUS_MARKER = '[[pichu:model-reconnect]]'
const INVALID_ENCRYPTED_CONTENT_ERROR = 'invalid_encrypted_content'
const UNKNOWN_ERROR_NO_DETAILS = 'unknown error (no error details in response)'
const GENERIC_EMPTY_STREAM_ERROR_PATTERNS = [
  /unknown error/i,
  /unknown error occurred/i,
  /no error details/i,
  /no message/i
]
const MEANINGFUL_PROVIDER_ERROR_PATTERNS = [
  /invalid_encrypted_content/i,
  /content[_ -]?filter/i,
  /context/i,
  /token/i,
  /rate[_ -]?limit/i,
  /quota/i,
  /usage/i,
  /auth/i,
  /permission/i,
  /policy/i,
  /bad request/i,
  /invalid/i
]

type ModelRequestSource =
  | 'agent_stream'
  | 'auto_approval_review'
  | 'context_compaction'
  | 'session_title'
  | 'completion'
type PichuModelRequestOptions = SimpleStreamOptions & {
  source?: ModelRequestSource
}
type ModelStreamResult = {
  result: 'success' | 'error' | 'aborted'
  retryCount: number
  usage?: Usage
  message?: AssistantMessage
  debug: ModelStreamDebugStats
}
type ModelStreamDebugStats = {
  textDeltaChunks: number
  textDeltaChars: number
  thinkingDeltaChunks: number
  thinkingDeltaChars: number
  toolCallDeltaChunks: number
  errorEvents: number
  doneReason?: string
}

const modelRequestLimiter = new ModelRequestLimiter({
  maxConcurrentRequests: MODEL_REQUEST_MAX_CONCURRENT_REQUESTS,
  maxRequestsPerWindow: MODEL_REQUEST_MAX_REQUESTS_PER_MINUTE,
  windowMs: MODEL_REQUEST_WINDOW_MS,
  maxQueuedRequests: MODEL_REQUEST_MAX_QUEUED_REQUESTS,
  maxQueueWaitMs: MODEL_REQUEST_MAX_QUEUE_WAIT_MS
})

export type PichuModelConfig = UserModelConfig & {
  effectiveContextWindowPercent?: number
  autoCompactTokenLimit?: number
  compat?: OpenAICompletionsCompat
  supportedThinkingLevels?: PichuReasoningMenuLevel[]
  defaultThinkingLevel?: PichuThinkingLevel
}

function resolvedContextWindow(contextWindow?: number): number {
  return Number.isFinite(contextWindow) && contextWindow && contextWindow > 0
    ? contextWindow
    : DEFAULT_CONTEXT_WINDOW
}

function resolvedEffectiveContextWindowPercent(percent?: number): number {
  if (!Number.isFinite(percent) || !percent) return DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT
  return Math.min(100, Math.max(1, percent))
}

export function effectiveContextWindowForConfig(
  config: Pick<PichuModelConfig, 'contextWindow' | 'effectiveContextWindowPercent'>
): number {
  const contextWindow = resolvedContextWindow(config.contextWindow)
  const percent = resolvedEffectiveContextWindowPercent(config.effectiveContextWindowPercent)
  return Math.floor((contextWindow * percent) / 100)
}

export function effectiveContextWindowForModelId(
  modelId?: string,
  fallbackContextWindow = DEFAULT_CONTEXT_WINDOW
): number {
  const fallback = Math.floor(
    (resolvedContextWindow(fallbackContextWindow) * DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT) / 100
  )
  if (!modelId?.trim()) return fallback
  try {
    return effectiveContextWindowForConfig(resolvePichuModelConfig(modelId))
  } catch {
    return fallback
  }
}

export function autoCompactTokenLimitForConfig(config: PichuModelConfig): number {
  const contextWindow = resolvedContextWindow(config.contextWindow)
  const contextLimit = Math.floor(contextWindow * DEFAULT_AUTO_COMPACT_CONTEXT_WINDOW_RATIO)
  if (!Number.isFinite(config.autoCompactTokenLimit) || !config.autoCompactTokenLimit) {
    return contextLimit
  }
  return Math.min(config.autoCompactTokenLimit, contextLimit)
}

export function autoCompactTokenLimitForModelId(
  modelId?: string,
  fallbackContextWindow = DEFAULT_CONTEXT_WINDOW
): number {
  const fallback = Math.floor(
    resolvedContextWindow(fallbackContextWindow) * DEFAULT_AUTO_COMPACT_CONTEXT_WINDOW_RATIO
  )
  if (!modelId?.trim()) return fallback
  try {
    return autoCompactTokenLimitForConfig(resolvePichuModelConfig(modelId))
  } catch {
    return fallback
  }
}

export function buildPichuModel(config: PichuModelConfig): Model<Api> {
  const api = config.api as Api
  return {
    provider: CUSTOM_PROVIDER,
    id: config.id,
    name: config.name,
    api,
    baseUrl: config.baseUrl,
    reasoning: config.reasoning ?? false,
    ...(config.supportedThinkingLevels
      ? {
          thinkingLevelMap: {
            minimal: null,
            low: config.supportedThinkingLevels.includes('low') ? 'low' : null,
            medium: config.supportedThinkingLevels.includes('medium') ? 'medium' : null,
            high: config.supportedThinkingLevels.includes('high') ? 'high' : null,
            xhigh: config.supportedThinkingLevels.includes('xhigh') ? 'xhigh' : null
          }
        }
      : {}),
    input: config.supportsImages ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: config.maxTokens ?? 16384,
    ...(config.compat ? { compat: config.compat } : {})
  }
}

function storedApiKeyForModelId(modelId: string): string | undefined {
  try {
    return resolveUserModelConfig(modelId).apiKey || undefined
  } catch {
    return undefined
  }
}

async function requestApiKeyForModel(model: Model<Api>): Promise<string | undefined> {
  if (model.api === 'openai-codex-responses') {
    return (await getOpenAIOAuthRequestAuth()).accessToken
  }
  return storedApiKeyForModelId(model.id)
}

export function createPichuStreamFn(): StreamFn {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream()
    void pipeLimitedModelStream(stream, model, context, options ?? {})
    return stream
  }
}

export async function completePichuText(
  config: PichuModelConfig,
  context: Context,
  options?: PichuModelRequestOptions
): Promise<string> {
  const model = buildPichuModel(config)
  const apiKey = await requestApiKeyForModel(model)
  const { source = 'completion', ...baseRequestOptions } = options ?? {}
  const requestOptions = baseRequestOptions
  const diagnosticsTracker = createProviderDiagnosticsTracker()
  const requestOptionsWithDiagnostics = withProviderDiagnosticsTracking(
    requestOptions,
    diagnosticsTracker
  )
  const recorder = createModelTrajectoryRecorder({
    model,
    context,
    options: requestOptions,
    source
  })
  const startedAt = Date.now()
  try {
    const response = await withModelRequestSlot(requestOptions.signal, () =>
      completeSimple(
        model,
        context,
        recorder.wrapOptions({
          ...requestOptionsWithDiagnostics,
          ...(apiKey ? { apiKey } : {})
        })
      )
    )
    recorder.recordRequestEnd(response, {
      result: 'success',
      durationMs: Date.now() - startedAt,
      providerDiagnostics: diagnosticsTracker.get()
    })
    return response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()
  } catch (error) {
    recorder.recordRequestError(error)
    throw error
  }
}

export function resolvePichuModelConfig(modelId?: string): PichuModelConfig {
  const config = resolveUserModelConfig(modelId)
  return {
    ...config,
    ...(config.reasoning ? { supportedThinkingLevels: ['low', 'medium', 'high', 'xhigh'] } : {})
  }
}

export function resolvePichuImageModelConfig(): PichuModelConfig {
  const imageModel = getUserModelConfigs().find((model) => model.supportsImages)
  if (!imageModel) throw new Error('No image-capable LLM model is configured')
  return resolvePichuModelConfig(imageModel.id)
}

export function defaultThinkingLevelForModelId(
  modelId?: string | null
): PichuThinkingLevel | undefined {
  if (!modelId?.trim()) return undefined
  try {
    return resolvePichuModelConfig(modelId).defaultThinkingLevel
  } catch {
    return undefined
  }
}

export function listAvailableModels(): Array<{
  id: string
  name: string
  contextWindow: number
  reasoning?: boolean
  supportedThinkingLevels?: PichuReasoningMenuLevel[]
  defaultThinkingLevel?: PichuThinkingLevel
  hiddenFromModelSwitcher?: boolean
}> {
  return getUserModelConfigs().map((m) => ({
    id: m.id,
    name: m.name,
    contextWindow: effectiveContextWindowForConfig(m),
    ...(m.reasoning ? { reasoning: true } : {}),
    ...(m.reasoning
      ? { supportedThinkingLevels: ['low', 'medium', 'high', 'xhigh'] as PichuReasoningMenuLevel[] }
      : {})
  }))
}

export function convertAgentMessagesToLlm(messages: AgentMessage[]): Message[] {
  return messages.flatMap((message): Message[] => {
    if (isPichuAgentMessage(message)) {
      const llmMessage = pichuAgentMessageToLlm(message)
      return llmMessage ? [llmMessage] : []
    }

    if (
      typeof message === 'object' &&
      message !== null &&
      'role' in message &&
      (message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult')
    ) {
      return [message]
    }

    return []
  })
}

async function withModelRequestSlot<T>(
  signal: AbortSignal | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const release = await modelRequestLimiter.acquire(signal)
  try {
    return await fn()
  } finally {
    release()
  }
}

async function pipeLimitedModelStream(
  target: AssistantMessageEventStream,
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions
): Promise<void> {
  let release: (() => void) | undefined
  const diagnosticsTracker = createProviderDiagnosticsTracker()
  const optionsWithDiagnostics = withProviderDiagnosticsTracking(options, diagnosticsTracker)
  const recorder = createModelTrajectoryRecorder({
    model,
    context,
    options,
    source: 'agent_stream'
  })
  const requestId = randomUUID()
  const startedAt = Date.now()
  writeChatDiagnosticEvent({
    event: 'model_request_started',
    sessionId: options.sessionId,
    details: {
      requestId,
      source: 'agent_stream',
      modelId: model.id,
      modelProvider: model.provider,
      modelApi: model.api,
      contextMessageCount: context.messages.length,
      toolCount: context.tools?.length ?? 0
    }
  })
  console.info(
    '[pi-models] stream start model=%s api=%s contextMessages=%d tools=%d',
    model.id,
    model.api,
    context.messages.length,
    context.tools?.length ?? 0
  )
  try {
    const apiKey = await requestApiKeyForModel(model)
    const resolvedOptions = { ...optionsWithDiagnostics, ...(apiKey ? { apiKey } : {}) }
    release = await modelRequestLimiter.acquire(options.signal)
    const result = await pipeModelStreamWithReconnect(
      target,
      model,
      context,
      recorder.wrapOptions(resolvedOptions),
      recorder
    )
    recorder.recordRequestEnd(result.message, {
      result: result.result,
      retryCount: result.retryCount,
      usage: result.usage,
      debug: result.debug,
      durationMs: Date.now() - startedAt,
      providerDiagnostics: diagnosticsTracker.get()
    })
    writeChatDiagnosticEvent({
      event: 'model_request_finished',
      sessionId: options.sessionId,
      details: {
        requestId,
        source: 'agent_stream',
        result: result.result,
        modelId: model.id,
        durationMs: Date.now() - startedAt,
        retryCount: result.retryCount,
        ...providerDiagnosticDetails(diagnosticsTracker.get())
      }
    })
    logModelStreamEnd(model, startedAt, result)
  } catch (error) {
    recorder.recordRequestError(error)
    const message = createModelRequestErrorMessage(model, error, options.signal)
    writeChatDiagnosticEvent({
      event: 'model_request_finished',
      sessionId: options.sessionId,
      details: {
        requestId,
        source: 'agent_stream',
        result: options.signal?.aborted ? 'aborted' : 'error',
        modelId: model.id,
        durationMs: Date.now() - startedAt,
        retryCount: 0,
        errorName: error instanceof Error ? error.name : 'Error',
        errorMessage: error instanceof Error ? error.message : String(error),
        ...providerDiagnosticDetails(diagnosticsTracker.get(error))
      }
    })
    target.push({
      type: 'error',
      reason: message.stopReason === 'aborted' ? 'aborted' : 'error',
      error: message
    })
    target.end(message)
    logModelStreamEnd(model, startedAt, {
      result: message.stopReason === 'aborted' ? 'aborted' : 'error',
      retryCount: 0,
      usage: message.usage,
      debug: createModelStreamDebugStats()
    })
  } finally {
    release?.()
  }
}

async function pipeModelStreamWithReconnect(
  target: AssistantMessageEventStream,
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
  recorder: ReturnType<typeof createModelTrajectoryRecorder>
): Promise<ModelStreamResult> {
  let lastError: unknown
  let currentMessage: AssistantMessage | undefined
  let retryCount = 0
  let requestContext = context
  let retriedWithoutEncryptedReasoning = false
  const debug = createModelStreamDebugStats()

  for (let retry = 0; retry <= MODEL_REQUEST_MAX_RECONNECT_ATTEMPTS; retry += 1) {
    const attemptAbortController = new AbortController()
    const abortAttempt = (): void => attemptAbortController.abort()
    options.signal?.addEventListener('abort', abortAttempt, { once: true })
    try {
      recorder.recordAttemptStart(requestContext, retry + 1)
      const source = streamSimple(model, requestContext, {
        ...options,
        signal: attemptAbortController.signal
      })
      for await (const event of iterateModelStreamWithIdleTimeout(
        source,
        MODEL_REQUEST_STREAM_IDLE_TIMEOUT_MS,
        attemptAbortController,
        options.signal
      )) {
        recorder.recordStreamEvent(event)
        updateModelStreamDebugStats(debug, event)
        if (event.type === 'error') {
          lastError = event.error
          break
        }

        if (event.type === 'done' && event.message.stopReason === 'error') {
          lastError = event.message
          break
        }

        if (event.type === 'start' && currentMessage) {
          currentMessage = cloneAssistantMessage(event.partial)
          continue
        }

        if ('partial' in event) {
          currentMessage = cloneAssistantMessage(event.partial)
        } else if (event.type === 'done') {
          currentMessage = cloneAssistantMessage(event.message)
        }
        target.push(event)
      }

      if (!lastError) {
        target.end()
        return {
          result: 'success',
          retryCount,
          usage: currentMessage?.usage,
          message: currentMessage,
          debug
        }
      }
    } catch (error) {
      lastError = error
    } finally {
      options.signal?.removeEventListener('abort', abortAttempt)
    }

    if (options.signal?.aborted || retry >= MODEL_REQUEST_MAX_RECONNECT_ATTEMPTS) {
      break
    }

    const encryptedReasoningRetryReason = retryWithoutEncryptedReasoningReason(
      lastError,
      options.signal
    )
    if (!retriedWithoutEncryptedReasoning && encryptedReasoningRetryReason) {
      const fallback = stripEncryptedReasoningFromContext(requestContext)
      if (fallback.changed) {
        retriedWithoutEncryptedReasoning = true
        requestContext = fallback.context
        retryCount += 1
        console.warn(
          '[pi-models] %s; retrying once without encrypted reasoning state',
          encryptedReasoningRetryReason
        )
        currentMessage = appendAssistantStatusLine(
          target,
          model,
          currentMessage,
          'Retrying model request...'
        )
        await delay(reconnectDelayMs(lastError, retry), options.signal)
        lastError = undefined
        continue
      }
    }

    retryCount += 1
    console.warn(
      '[pi-models] model request failed; reconnecting %d/%d: %s',
      retry + 1,
      MODEL_REQUEST_MAX_RECONNECT_ATTEMPTS,
      modelRequestErrorText(lastError, options.signal)
    )
    currentMessage = appendAssistantStatusLine(
      target,
      model,
      currentMessage,
      `Reconnecting... ${retry + 1}/${MODEL_REQUEST_MAX_RECONNECT_ATTEMPTS}`
    )
    await delay(reconnectDelayMs(lastError, retry), options.signal)
    lastError = undefined
  }

  console.warn(
    '[pi-models] model request failed after reconnect attempts: %s',
    modelRequestErrorText(lastError, options.signal)
  )
  const finalMessage = appendAssistantStatusLine(
    target,
    model,
    currentMessage,
    modelRequestErrorText(lastError, options.signal)
  )
  finalMessage.stopReason = options.signal?.aborted ? 'aborted' : 'error'
  finalMessage.errorMessage = modelRequestErrorText(lastError, options.signal)
  target.push({
    type: 'error',
    reason: finalMessage.stopReason === 'aborted' ? 'aborted' : 'error',
    error: finalMessage
  })
  target.end(finalMessage)
  return {
    result: finalMessage.stopReason === 'aborted' ? 'aborted' : 'error',
    retryCount,
    usage: finalMessage.usage,
    debug
  }
}

function stripEncryptedReasoningFromContext(context: Context): {
  context: Context
  changed: boolean
} {
  let changed = false
  const messages = context.messages.map((message): Message => {
    if (message.role !== 'assistant') return message

    let messageChanged = false
    const hasEncryptedReasoning = message.content.some(
      (block) => block.type === 'thinking' && Boolean(block.thinkingSignature)
    )
    const content = message.content.map((block) => {
      if (block.type === 'thinking' && block.thinkingSignature) {
        messageChanged = true
        changed = true
        return { type: 'thinking' as const, thinking: block.thinking }
      }
      if (hasEncryptedReasoning && block.type === 'toolCall' && block.id.includes('|')) {
        const [callId] = block.id.split('|')
        if (callId) {
          messageChanged = true
          changed = true
          return { ...block, id: callId }
        }
      }
      return block
    })

    return messageChanged ? { ...message, content } : message
  })

  if (!changed) return { context, changed: false }
  return { context: { ...context, messages }, changed: true }
}

async function* iterateModelStreamWithIdleTimeout(
  source: AssistantMessageEventStream,
  timeoutMs: number,
  attemptAbortController: AbortController,
  externalSignal: AbortSignal | undefined
): AsyncGenerator<AssistantMessageEvent> {
  const iterator = source[Symbol.asyncIterator]()

  while (true) {
    const result = await nextModelStreamEventWithIdleTimeout(
      iterator,
      timeoutMs,
      attemptAbortController,
      externalSignal
    )
    if (result.done) return
    yield result.value
  }
}

function nextModelStreamEventWithIdleTimeout(
  iterator: AsyncIterator<AssistantMessageEvent>,
  timeoutMs: number,
  attemptAbortController: AbortController,
  externalSignal: AbortSignal | undefined
): Promise<IteratorResult<AssistantMessageEvent>> {
  if (externalSignal?.aborted) {
    return Promise.reject(new Error('Request was aborted.'))
  }

  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let abortListener: (() => void) | undefined

  const nextEvent = iterator.next()
  const timeout = new Promise<never>((_, reject) => {
    idleTimer = setTimeout(() => {
      attemptAbortController.abort()
      reject(new ModelStreamIdleTimeoutError(timeoutMs))
    }, timeoutMs)
  })
  const externalAbort = externalSignal
    ? new Promise<never>((_, reject) => {
        abortListener = () => {
          attemptAbortController.abort()
          reject(new Error('Request was aborted.'))
        }
        externalSignal.addEventListener('abort', abortListener, { once: true })
      })
    : undefined

  const raced = externalAbort
    ? Promise.race([nextEvent, timeout, externalAbort])
    : Promise.race([nextEvent, timeout])

  return raced.finally(() => {
    if (idleTimer) clearTimeout(idleTimer)
    if (abortListener && externalSignal) {
      externalSignal.removeEventListener('abort', abortListener)
    }
  })
}

class ModelStreamIdleTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Model stream stalled for ${Math.round(timeoutMs / 1000)}s without events.`)
    this.name = 'ModelStreamIdleTimeoutError'
  }
}

function createModelStreamDebugStats(): ModelStreamDebugStats {
  return {
    textDeltaChunks: 0,
    textDeltaChars: 0,
    thinkingDeltaChunks: 0,
    thinkingDeltaChars: 0,
    toolCallDeltaChunks: 0,
    errorEvents: 0
  }
}

function updateModelStreamDebugStats(
  stats: ModelStreamDebugStats,
  event: AssistantMessageEvent
): void {
  if (event.type === 'text_delta') {
    stats.textDeltaChunks += 1
    stats.textDeltaChars += event.delta.length
    return
  }

  if (event.type === 'thinking_delta') {
    stats.thinkingDeltaChunks += 1
    stats.thinkingDeltaChars += event.delta.length
    return
  }

  if (event.type === 'toolcall_delta') {
    stats.toolCallDeltaChunks += 1
    return
  }

  if (event.type === 'error') {
    stats.errorEvents += 1
    return
  }

  if (event.type === 'done') {
    stats.doneReason = event.reason
  }
}

function logModelStreamEnd(model: Model<Api>, startedAt: number, result: ModelStreamResult): void {
  console.info(
    '[pi-models] stream end model=%s result=%s durationMs=%d retries=%d doneReason=%s textChunks=%d textChars=%d thinkingChunks=%d thinkingChars=%d toolArgChunks=%d errorEvents=%d',
    model.id,
    result.result,
    Date.now() - startedAt,
    result.retryCount,
    result.debug.doneReason ?? 'none',
    result.debug.textDeltaChunks,
    result.debug.textDeltaChars,
    result.debug.thinkingDeltaChunks,
    result.debug.thinkingDeltaChars,
    result.debug.toolCallDeltaChunks,
    result.debug.errorEvents
  )
}

function providerDiagnosticDetails(
  diagnostics: ModelProviderDiagnostics | undefined
): Record<string, string | number | boolean | null> {
  const details: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(providerDiagnosticsAnalytics(diagnostics))) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      details[key] = value
    }
  }
  return details
}

function appendAssistantStatusLine(
  target: AssistantMessageEventStream,
  model: Model<Api>,
  message: AssistantMessage | undefined,
  line: string
): AssistantMessage {
  const next = message ? cloneAssistantMessage(message) : createModelRequestStatusMessage(model)
  const visibleDelta = `${next.content.length > 0 ? '\n' : ''}${line}`
  const eventDelta = `${MODEL_RECONNECT_STATUS_MARKER}${visibleDelta}`
  const lastIndex = next.content.length - 1
  const lastBlock = next.content[lastIndex]

  if (!message) {
    next.content.push({ type: 'thinking', thinking: '' })
    target.push({ type: 'start', partial: cloneAssistantMessage(next) })
    target.push({ type: 'thinking_start', contentIndex: 0, partial: cloneAssistantMessage(next) })
    next.content[0] = { type: 'thinking', thinking: visibleDelta }
    target.push({
      type: 'thinking_delta',
      contentIndex: 0,
      delta: eventDelta,
      partial: cloneAssistantMessage(next)
    })
    return next
  }

  if (lastBlock?.type === 'thinking') {
    next.content[lastIndex] = { ...lastBlock, thinking: `${lastBlock.thinking}${visibleDelta}` }
    target.push({
      type: 'thinking_delta',
      contentIndex: lastIndex,
      delta: eventDelta,
      partial: cloneAssistantMessage(next)
    })
    return next
  }

  const contentIndex = next.content.length
  next.content.push({ type: 'thinking', thinking: '' })
  target.push({ type: 'thinking_start', contentIndex, partial: cloneAssistantMessage(next) })
  next.content[contentIndex] = { type: 'thinking', thinking: visibleDelta }
  target.push({
    type: 'thinking_delta',
    contentIndex,
    delta: eventDelta,
    partial: cloneAssistantMessage(next)
  })
  return next
}

function createModelRequestStatusMessage(model: Model<Api>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'stop',
    timestamp: Date.now()
  }
}

function cloneAssistantMessage(message: AssistantMessage): AssistantMessage {
  return structuredClone(message) as AssistantMessage
}

function modelRequestErrorText(error: unknown, signal: AbortSignal | undefined): string {
  if (signal?.aborted) return 'Request was aborted.'
  let text: string
  if (isRecord(error) && typeof error.errorMessage === 'string' && error.errorMessage.trim()) {
    text = error.errorMessage.trim()
  } else if (error instanceof Error) {
    text = error.message
  } else {
    text = String(error || 'Model request failed.')
  }
  return `${text}${formatProviderDiagnosticsSuffix(error)}`
}

function isOpaqueProviderError(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return false
  const text = modelRequestErrorText(error, signal)
  const hasKnownDefaultMessage = text.toLowerCase().includes(UNKNOWN_ERROR_NO_DETAILS)
  if (!isEmptyAssistantStreamError(error)) {
    return hasKnownDefaultMessage
  }
  return (
    hasKnownDefaultMessage ||
    !hasMeaningfulProviderErrorText(text) ||
    hasGenericEmptyStreamErrorText(text)
  )
}

function reconnectDelayMs(error: unknown, retry: number): number {
  if (!isOpaqueProviderError(error, undefined)) {
    return MODEL_REQUEST_RECONNECT_BASE_DELAY_MS * Math.max(1, retry + 1)
  }
  const exponentialDelay =
    MODEL_REQUEST_OPAQUE_ERROR_RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, retry)
  const cappedDelay = Math.min(exponentialDelay, MODEL_REQUEST_OPAQUE_ERROR_RECONNECT_MAX_DELAY_MS)
  return cappedDelay + Math.floor(Math.random() * MODEL_REQUEST_RECONNECT_JITTER_MS)
}

function isEmptyAssistantStreamError(error: unknown): boolean {
  if (!isRecord(error)) return false
  if (error.stopReason !== 'error') return false

  const content = error.content
  if (!Array.isArray(content) || content.length > 0) return false

  const usage = error.usage
  if (!isRecord(usage)) return false

  return (
    usage.input === 0 &&
    usage.output === 0 &&
    usage.cacheRead === 0 &&
    usage.cacheWrite === 0 &&
    usage.totalTokens === 0
  )
}

function hasGenericEmptyStreamErrorText(text: string): boolean {
  return GENERIC_EMPTY_STREAM_ERROR_PATTERNS.some((pattern) => pattern.test(text))
}

function hasMeaningfulProviderErrorText(text: string): boolean {
  return MEANINGFUL_PROVIDER_ERROR_PATTERNS.some((pattern) => pattern.test(text))
}

function retryWithoutEncryptedReasoningReason(
  error: unknown,
  signal: AbortSignal | undefined
): string | null {
  const text = modelRequestErrorText(error, signal).toLowerCase()
  if (text.includes(INVALID_ENCRYPTED_CONTENT_ERROR)) {
    return 'invalid encrypted reasoning content'
  }
  if (text.includes(UNKNOWN_ERROR_NO_DETAILS)) {
    return 'opaque model provider error'
  }
  return null
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('Request was aborted'))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(new Error('Request was aborted'))
      },
      { once: true }
    )
  })
}

function createModelRequestErrorMessage(
  model: Model<Api>,
  error: unknown,
  signal: AbortSignal | undefined
): AssistantMessage {
  const stopReason = signal?.aborted ? 'aborted' : 'error'
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason,
    errorMessage: modelRequestErrorText(error, signal),
    timestamp: Date.now()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
