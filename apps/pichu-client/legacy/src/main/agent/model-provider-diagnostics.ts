import type { Api, Model, ProviderResponse, SimpleStreamOptions } from '@earendil-works/pi-ai'

export type ModelProviderDiagnostics = {
  status?: number
  traceHeaders?: Record<string, string>
}

export const MODEL_PROVIDER_TRACE_HEADER_NAMES = [
  'x-account-id',
  'x-account-deployment',
  'x-model-request-id',
  'x-request-model',
  'x-request-id',
  'x-correlation-id',
  'traceparent',
  'cf-ray'
] as const

const MODEL_PROVIDER_TRACE_HEADER_NAME_SET = new Set<string>(MODEL_PROVIDER_TRACE_HEADER_NAMES)
const MAX_DIAGNOSTIC_SEARCH_DEPTH = 4

type ProviderDiagnosticsTracker = {
  record: (value: unknown) => void
  get: (fallback?: unknown) => ModelProviderDiagnostics | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readStatus(value: Record<string, unknown>): number | undefined {
  for (const key of ['status', 'statusCode', 'code']) {
    const rawStatus = value[key]
    const status = typeof rawStatus === 'number' ? rawStatus : undefined
    if (status && Number.isInteger(status) && status >= 100 && status <= 599) {
      return status
    }
  }
  return undefined
}

function readHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const normalized: Record<string, string> = {}
  if (typeof Headers !== 'undefined' && value instanceof Headers) {
    value.forEach((headerValue, headerName) => {
      normalized[headerName.toLowerCase()] = headerValue
    })
    return Object.keys(normalized).length > 0 ? normalized : undefined
  }

  if ('forEach' in value && typeof value.forEach === 'function') {
    try {
      value.forEach((headerValue: unknown, headerName: unknown) => {
        if (typeof headerName !== 'string') {
          return
        }
        if (
          typeof headerValue === 'string' ||
          typeof headerValue === 'number' ||
          typeof headerValue === 'boolean'
        ) {
          normalized[headerName.toLowerCase()] = String(headerValue)
        }
      })
      return Object.keys(normalized).length > 0 ? normalized : undefined
    } catch {
      return undefined
    }
  }

  for (const [headerName, headerValue] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof headerValue === 'string' ||
      typeof headerValue === 'number' ||
      typeof headerValue === 'boolean'
    ) {
      normalized[headerName.toLowerCase()] = String(headerValue)
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function selectTraceHeaders(headers: Record<string, string>): Record<string, string> | undefined {
  const traceHeaders: Record<string, string> = {}
  for (const [headerName, headerValue] of Object.entries(headers)) {
    const normalizedName = headerName.toLowerCase()
    if (MODEL_PROVIDER_TRACE_HEADER_NAME_SET.has(normalizedName) && headerValue.trim()) {
      traceHeaders[normalizedName] = headerValue
    }
  }
  return Object.keys(traceHeaders).length > 0 ? traceHeaders : undefined
}

function mergeDiagnostics(
  current: ModelProviderDiagnostics,
  next: ModelProviderDiagnostics
): ModelProviderDiagnostics {
  return {
    ...(next.status ? { status: next.status } : current.status ? { status: current.status } : {}),
    ...(current.traceHeaders || next.traceHeaders
      ? { traceHeaders: { ...current.traceHeaders, ...next.traceHeaders } }
      : {})
  }
}

export function extractProviderDiagnostics(value: unknown): ModelProviderDiagnostics | undefined {
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  const seen = new WeakSet<object>()
  let diagnostics: ModelProviderDiagnostics = {}

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || current.depth > MAX_DIAGNOSTIC_SEARCH_DEPTH || !isRecord(current.value)) {
      continue
    }
    if (seen.has(current.value)) {
      continue
    }
    seen.add(current.value)

    const status = readStatus(current.value)
    const headers = readHeaders(current.value.headers)
    diagnostics = mergeDiagnostics(diagnostics, {
      ...(status ? { status } : {}),
      ...(headers ? { traceHeaders: selectTraceHeaders(headers) } : {})
    })

    for (const key of ['response', 'cause', 'error']) {
      if (isRecord(current.value[key])) {
        queue.push({ value: current.value[key], depth: current.depth + 1 })
      }
    }
  }

  return diagnostics.status || diagnostics.traceHeaders ? diagnostics : undefined
}

export function formatProviderDiagnosticsSuffix(value: unknown): string {
  const diagnostics = extractProviderDiagnostics(value)
  if (!diagnostics) {
    return ''
  }

  const parts = [
    ...(diagnostics.status ? [`status=${diagnostics.status}`] : []),
    ...Object.entries(diagnostics.traceHeaders ?? {}).map(
      ([headerName, headerValue]) => `${headerName}=${headerValue}`
    )
  ]
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

export function providerDiagnosticsAnalytics(
  diagnostics: ModelProviderDiagnostics | undefined
): Record<string, string | number> {
  if (!diagnostics) {
    return {}
  }

  return {
    ...(diagnostics.status ? { provider_status_code: diagnostics.status } : {}),
    ...Object.fromEntries(
      Object.entries(diagnostics.traceHeaders ?? {}).map(([headerName, headerValue]) => [
        `provider_${headerName.replaceAll('-', '_')}`,
        headerValue
      ])
    )
  }
}

export function createProviderDiagnosticsTracker(): ProviderDiagnosticsTracker {
  let diagnostics: ModelProviderDiagnostics | undefined

  return {
    record: (value) => {
      const nextDiagnostics = extractProviderDiagnostics(value)
      if (!nextDiagnostics) {
        return
      }
      diagnostics = diagnostics ? mergeDiagnostics(diagnostics, nextDiagnostics) : nextDiagnostics
    },
    get: (fallback) => {
      const fallbackDiagnostics = extractProviderDiagnostics(fallback)
      if (diagnostics && fallbackDiagnostics) {
        return mergeDiagnostics(diagnostics, fallbackDiagnostics)
      }
      return diagnostics ?? fallbackDiagnostics
    }
  }
}

export function withProviderDiagnosticsTracking(
  options: SimpleStreamOptions,
  tracker: ProviderDiagnosticsTracker
): SimpleStreamOptions {
  const originalOnResponse = options.onResponse
  return {
    ...options,
    onResponse: async (response: ProviderResponse, model: Model<Api>) => {
      tracker.record(response)
      await originalOnResponse?.(response, model)
    }
  }
}
