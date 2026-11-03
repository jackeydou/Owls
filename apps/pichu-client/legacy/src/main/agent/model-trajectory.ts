import { randomUUID } from 'node:crypto'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  ProviderResponse,
  SimpleStreamOptions
} from '@earendil-works/pi-ai'
import { MODEL_TRAJECTORY_LOG_DIR_NAME } from '../../shared/model-trajectory.js'
import { getDataRoot } from '../pichu-paths.js'
import { getModelTrajectoryLoggingEnabled } from '../stores/settings-store.js'
import { extractProviderDiagnostics } from './model-provider-diagnostics.js'

type ModelTrajectoryRecordType =
  | 'request_start'
  | 'attempt_start'
  | 'provider_payload'
  | 'provider_payload_replaced'
  | 'provider_response'
  | 'stream_event'
  | 'request_end'
  | 'request_error'

type ModelTrajectoryRecord = {
  ts: string
  requestId: string
  sessionId?: string
  type: ModelTrajectoryRecordType
  data?: unknown
}

type ModelTrajectoryRecorder = {
  requestId: string
  filePath?: string
  wrapOptions: (options: SimpleStreamOptions) => SimpleStreamOptions
  recordAttemptStart: (context: Context, attempt: number) => void
  recordStreamEvent: (event: AssistantMessageEvent) => void
  recordRequestEnd: (message: AssistantMessage | undefined, data?: Record<string, unknown>) => void
  recordRequestError: (error: unknown) => void
}

const CREDENTIAL_KEY_PATTERN =
  /^(authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|app[-_]?secret|client[-_]?secret|password)$/i
const SENSITIVE_URL_QUERY_KEY_PATTERN =
  /^(ak|authorization|key|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|app[-_]?secret|client[-_]?secret)$/i
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/giu

export function modelTrajectoryLogDirectory(): string {
  return join(getDataRoot(), MODEL_TRAJECTORY_LOG_DIR_NAME)
}

function isModelTrajectoryLoggingEnabled(): boolean {
  return getModelTrajectoryLoggingEnabled()
}

function createNoopModelTrajectoryRecorder(): ModelTrajectoryRecorder {
  return {
    requestId: 'disabled',
    wrapOptions: (options) => options,
    recordAttemptStart: () => {},
    recordStreamEvent: () => {},
    recordRequestEnd: () => {},
    recordRequestError: () => {}
  }
}

function safePathSegment(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  if (!trimmed) return fallback
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || fallback
}

function trajectoryFileStem(sessionId: string | undefined, source: string): string {
  const scope = sessionId?.trim() ? safePathSegment(sessionId, 'session') : 'no-session'
  if (source === 'agent_stream') {
    return scope
  }
  return `${scope}.${safePathSegment(source, 'unknown-source')}`
}

function redactUrl(value: string): string {
  return value.replace(URL_PATTERN, (rawUrl) => {
    try {
      const url = new URL(rawUrl)
      for (const key of Array.from(url.searchParams.keys())) {
        if (SENSITIVE_URL_QUERY_KEY_PATTERN.test(key)) {
          url.searchParams.set(key, '[redacted]')
        }
      }
      return url.toString()
    } catch {
      return rawUrl
    }
  })
}

function serializable(value: unknown): unknown {
  const seen = new WeakSet<object>()
  try {
    return JSON.parse(
      JSON.stringify(value, (key, current) => {
        if (CREDENTIAL_KEY_PATTERN.test(key)) {
          return '[redacted]'
        }
        if (typeof current === 'function') {
          return `[Function${current.name ? `:${current.name}` : ''}]`
        }
        if (typeof current === 'string') {
          return redactUrl(current)
        }
        if (current instanceof AbortSignal) {
          return '[AbortSignal]'
        }
        if (typeof current === 'object' && current !== null) {
          if (seen.has(current)) {
            return '[Circular]'
          }
          seen.add(current)
        }
        return current
      })
    ) as unknown
  } catch (error) {
    return {
      unserializable: true,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function errorPayload(error: unknown): unknown {
  const diagnostics = extractProviderDiagnostics(error)
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactUrl(error.message),
      stack: error.stack ? redactUrl(error.stack) : undefined,
      ...(diagnostics ? { diagnostics } : {})
    }
  }
  return diagnostics ? { diagnostics, error: serializable(error) } : serializable(error)
}

function writeRecord(stream: WriteStream, record: ModelTrajectoryRecord): void {
  stream.write(`${JSON.stringify(record)}\n`, 'utf8')
}

function safeModel(model: Model<Api>): unknown {
  return serializable({
    provider: model.provider,
    id: model.id,
    name: model.name,
    api: model.api,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning,
    input: model.input,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    compat: model.compat
  })
}

function shouldRecordStreamEvent(event: AssistantMessageEvent): boolean {
  return (
    event.type === 'start' ||
    event.type === 'toolcall_start' ||
    event.type === 'toolcall_end' ||
    event.type === 'done' ||
    event.type === 'error'
  )
}

export function createModelTrajectoryRecorder(params: {
  model: Model<Api>
  context: Context
  options: SimpleStreamOptions
  source: string
}): ModelTrajectoryRecorder {
  if (!isModelTrajectoryLoggingEnabled()) {
    return createNoopModelTrajectoryRecorder()
  }

  const sessionId = params.options.sessionId
  const requestId = randomUUID()
  const root = modelTrajectoryLogDirectory()
  mkdirSync(root, { recursive: true })
  const filePath = join(root, `${trajectoryFileStem(sessionId, params.source)}.jsonl`)
  const stream = createWriteStream(filePath, { flags: 'a' })
  stream.on('error', (error) => {
    console.warn('[model-trajectory] failed to write request=%s: %s', requestId, error.message)
  })

  const record = (type: ModelTrajectoryRecordType, data?: unknown): void => {
    writeRecord(stream, {
      ts: new Date().toISOString(),
      requestId,
      ...(sessionId ? { sessionId } : {}),
      type,
      data: serializable(data)
    })
  }

  record('request_start', {
    source: params.source,
    model: safeModel(params.model),
    context: params.context,
    options: params.options
  })
  console.info('[model-trajectory] recording request=%s path=%s', requestId, filePath)

  return {
    requestId,
    filePath,
    wrapOptions: (options) => {
      const originalOnPayload = options.onPayload
      const originalOnResponse = options.onResponse
      return {
        ...options,
        onPayload: async (payload, model) => {
          record('provider_payload', {
            model: safeModel(model),
            payload
          })
          const nextPayload = await originalOnPayload?.(payload, model)
          if (nextPayload !== undefined) {
            record('provider_payload_replaced', {
              model: safeModel(model),
              payload: nextPayload
            })
          }
          return nextPayload
        },
        onResponse: async (response: ProviderResponse, model) => {
          record('provider_response', {
            model: safeModel(model),
            response,
            diagnostics: extractProviderDiagnostics(response)
          })
          await originalOnResponse?.(response, model)
        }
      }
    },
    recordAttemptStart: (context, attempt) => {
      record('attempt_start', { attempt, context })
    },
    recordStreamEvent: (event) => {
      if (!shouldRecordStreamEvent(event)) return
      record('stream_event', event)
    },
    recordRequestEnd: (message, data) => {
      record('request_end', {
        ...data,
        message
      })
      stream.end()
    },
    recordRequestError: (error) => {
      record('request_error', errorPayload(error))
      stream.end()
    }
  }
}
