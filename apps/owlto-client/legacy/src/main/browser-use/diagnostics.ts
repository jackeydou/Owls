import { type BrowserUseTraceRecord, getBrowserManager } from './browser-manager.js'
import { captureCdpScreenshot } from './cdp-backend.js'
import { captureBrowserUseSnapshot } from './snapshot.js'

const MAX_TRACE_RECORDS = 50
const MAX_LOG_RECORDS_PER_TRACE = 20
const MAX_STRING_LENGTH = 800
const SECRET_KEY_PATTERN =
  /(authorization|cookie|set-cookie|token|secret|password|credential|session|csrf|jwt|api[-_]?key)/i
const PRIVATE_PATH_PATTERN = /\/Users\/[^/\s]+/g

function redactString(value: string): string {
  const trimmed =
    value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value
  return trimmed
    .replace(PRIVATE_PATH_PATTERN, '/Users/[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(token|secret|password|authorization|cookie)=([^&\s]+)/gi, '$1=[redacted]')
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[max-depth]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value))
    return value.slice(0, 50).map((entry) => sanitizeUnknown(entry, depth + 1))
  if (typeof value !== 'object') return String(value)

  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      output[key] = '[redacted]'
      continue
    }
    output[key] = sanitizeUnknown(entry, depth + 1)
  }
  return output
}

function boundedPushTrace(sessionKey: string, record: BrowserUseTraceRecord): void {
  const runtime = getBrowserManager()?.getSession(sessionKey)
  if (!runtime) return
  runtime.traces.push(record)
  if (runtime.traces.length > MAX_TRACE_RECORDS) {
    runtime.traces.splice(0, runtime.traces.length - MAX_TRACE_RECORDS)
  }
}

export function getBrowserUseTraces(sessionKey: string): BrowserUseTraceRecord[] {
  return getBrowserManager()?.getSession(sessionKey)?.traces ?? []
}

export async function runBrowserUseTrace<T>(
  sessionKey: string,
  action: string,
  input: unknown,
  run: () => Promise<T>
): Promise<T> {
  const startedAt = new Date().toISOString()
  try {
    const result = await run()
    const runtime = getBrowserManager()?.getSession(sessionKey)
    boundedPushTrace(sessionKey, {
      action,
      status: 'ok',
      url: runtime?.url ?? null,
      title: runtime?.title ?? null,
      startedAt,
      finishedAt: new Date().toISOString(),
      input: sanitizeUnknown(input),
      error: null,
      screenshotPngBase64: null,
      snapshot: null,
      consoleLogs: []
    })
    return result
  } catch (error) {
    const runtime = getBrowserManager()?.getSession(sessionKey)
    const [screenshotPngBase64, snapshot] = await Promise.all([
      captureCdpScreenshot(sessionKey).catch(() => null),
      captureBrowserUseSnapshot(sessionKey).catch(() => null)
    ])
    const record: BrowserUseTraceRecord = {
      action,
      status: 'error',
      url: runtime?.url ?? null,
      title: runtime?.title ?? null,
      startedAt,
      finishedAt: new Date().toISOString(),
      input: sanitizeUnknown(input),
      error: error instanceof Error ? redactString(error.message) : redactString(String(error)),
      screenshotPngBase64,
      snapshot: sanitizeUnknown(snapshot),
      consoleLogs: Array.isArray(runtime?.consoleLogs)
        ? runtime.consoleLogs
            .slice(-MAX_LOG_RECORDS_PER_TRACE)
            .map((entry) => sanitizeUnknown(entry))
        : []
    }
    boundedPushTrace(sessionKey, record)
    throw error
  }
}
