import { inspect } from 'node:util'

/** Most characters of a run's result and logs the agent sees. */
export const BROWSER_RESULT_LIMIT = 20_000
export const BROWSER_DEFAULT_TIMEOUT_MS = 60_000
export const BROWSER_MAX_TIMEOUT_MS = 300_000

export type BrowserRunOutcome = { ok: boolean; text: string }

type AsyncFn = (...args: unknown[]) => Promise<unknown>
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => AsyncFn

/**
 * Runs an agent's script as the body of an async function. `scope` names the
 * values the script sees, such as `page` and `context`; a `console` that
 * records into the outcome is added. The run fails when the script throws or
 * outlives `timeoutMs`; a timed-out script is not stopped here, so the host
 * process that calls this restarts when a run hangs.
 */
export async function runBrowserCode(
  code: string,
  scope: Record<string, unknown>,
  timeoutMs: number,
  saveImage: (bytes: Uint8Array) => Promise<string>
): Promise<BrowserRunOutcome> {
  const logs: string[] = []
  const record =
    (level: string) =>
    (...args: unknown[]) =>
      logs.push(`[${level}] ${args.map((a) => (typeof a === 'string' ? a : show(a))).join(' ')}`)
  const console = {
    log: record('log'),
    info: record('info'),
    warn: record('warn'),
    error: record('error')
  }
  const names = Object.keys(scope)
  let timer: NodeJS.Timeout | undefined
  try {
    const run = new AsyncFunction(...names, 'console', code)
    const value = await Promise.race([
      run(...names.map((name) => scope[name]), console),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`The script did not finish within ${timeoutMs} ms.`)),
          timeoutMs
        )
      })
    ])
    const result = value instanceof Uint8Array ? { image: await saveImage(value) } : value
    return { ok: true, text: formatOutcome(result, logs) }
  } catch (error) {
    const message =
      error instanceof Error
        ? `${error.name === 'Error' ? '' : `${error.name}: `}${stripAnsi(error.message)}`
        : show(error)
    return { ok: false, text: formatOutcome(undefined, logs, message) }
  } finally {
    clearTimeout(timer)
  }
}

/** The text an agent sees: the result, then console lines, then any error; clipped to the limit. */
export function formatOutcome(result: unknown, logs: string[], error?: string): string {
  const parts: string[] = []
  if (error) parts.push(`Error: ${error}`)
  else parts.push(`Result: ${result === undefined ? 'undefined' : show(result)}`)
  if (logs.length) parts.push(`Console:\n${logs.join('\n')}`)
  const text = parts.join('\n\n')
  return text.length > BROWSER_RESULT_LIMIT
    ? `${text.slice(0, BROWSER_RESULT_LIMIT)}\n… (cut at ${BROWSER_RESULT_LIMIT} characters; return less, such as a selector's text instead of the whole page)`
    : text
}

// Playwright colors its call logs for terminals.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const stripAnsi = (text: string) => text.replace(ANSI, '')

function show(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const json = JSON.stringify(value, null, 2)
    if (json !== undefined) return json
  } catch {
    // Cycles and BigInts fall through to inspect.
  }
  return inspect(value, { depth: 4, breakLength: 100 })
}
