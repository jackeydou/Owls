import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const SENSITIVE_KEY_PATTERN = /(token|jwt|authorization|cookie|secret|password|credential)/i
const JWT_PATTERN = /\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\b/g
let diagnosticLogWriteQueue: Promise<void> = Promise.resolve()

function redactString(value: string): string {
  return value
    .replace(JWT_PATTERN, '[redacted-jwt]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[redacted]')
    .slice(0, 1000)
}

function redactValue(key: string, value: unknown): unknown {
  if (value === undefined) return null
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    if (typeof value === 'boolean' || value === null) return value
    return '[redacted]'
  }
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map((item) => redactValue(key, item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactValue(childKey, childValue)
      ])
    )
  }
  return value
}

async function appendJsonlLine(filePath: string, line: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, line, 'utf8')
}

function enqueueJsonlLine(filePath: string, line: string): void {
  diagnosticLogWriteQueue = diagnosticLogWriteQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        await appendJsonlLine(filePath, line)
      } catch (error) {
        console.warn('[diagnostics] Failed to write diagnostic log:', error)
      }
    })
}

export function appendJsonlLog(filePath: string, event: Record<string, unknown>): void {
  try {
    const payload = {
      ts: new Date().toISOString(),
      ...Object.fromEntries(
        Object.entries(event).map(([key, value]) => [key, redactValue(key, value)])
      )
    }
    enqueueJsonlLine(filePath, `${JSON.stringify(payload)}\n`)
  } catch (error) {
    console.warn('[diagnostics] Failed to prepare diagnostic log:', error)
  }
}
