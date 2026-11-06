import { ipcMain } from 'electron'
import type {
  BackgroundTerminalForRenderer,
  CleanBackgroundTerminalsRequest,
  CleanBackgroundTerminalsResult,
  ListBackgroundTerminalsResult,
  TerminateBackgroundTerminalRequest,
  TerminateBackgroundTerminalResult
} from '../../shared/background-terminals.js'
import {
  type BackgroundTerminalInfo,
  forceTerminateAllBackgroundTerminals,
  listBackgroundTerminals,
  terminateBackgroundTerminal
} from '../background-terminals.js'

const DEFAULT_BACKGROUND_TERMINAL_LIMIT = 50
const MAX_BACKGROUND_TERMINAL_LIMIT = 200

type BackgroundTerminalAccessOptions = {
  allowGlobalSessionScope?: boolean
}

type NormalizedListBackgroundTerminalsRequest = {
  sessionId: string | null | undefined
  cursor: string | null
  limit: number
}

function optionalString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`)
  return value
}

function normalizeSessionScope(
  value: unknown,
  field: string,
  options: BackgroundTerminalAccessOptions
): string | null | undefined {
  const sessionId = optionalString(value, field)
  if (options.allowGlobalSessionScope) return sessionId
  return null
}

function normalizeListRequest(
  input: unknown,
  options: BackgroundTerminalAccessOptions
): NormalizedListBackgroundTerminalsRequest {
  if (input === undefined || input === null) {
    return {
      sessionId: options.allowGlobalSessionScope ? undefined : null,
      cursor: null,
      limit: DEFAULT_BACKGROUND_TERMINAL_LIMIT
    }
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid background terminals list request.')
  }
  const raw = input as Record<string, unknown>
  const rawLimit = raw.limit
  const limit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit)
      ? Math.min(MAX_BACKGROUND_TERMINAL_LIMIT, Math.max(1, Math.floor(rawLimit)))
      : DEFAULT_BACKGROUND_TERMINAL_LIMIT
  return {
    sessionId: normalizeSessionScope(raw.sessionId, 'sessionId', options),
    cursor: optionalString(raw.cursor, 'cursor') ?? null,
    limit
  }
}

function normalizeTerminateRequest(
  input: unknown,
  options: BackgroundTerminalAccessOptions
): TerminateBackgroundTerminalRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid background terminal terminate request.')
  }
  const raw = input as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id) {
    throw new Error('Background terminal id is required.')
  }
  return {
    id: raw.id,
    sessionId: normalizeSessionScope(raw.sessionId, 'sessionId', options)
  }
}

function normalizeCleanRequest(
  input: unknown,
  options: BackgroundTerminalAccessOptions
): CleanBackgroundTerminalsRequest {
  if (input === undefined || input === null) {
    return {
      sessionId: options.allowGlobalSessionScope ? undefined : null
    }
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid background terminals clean request.')
  }
  const raw = input as Record<string, unknown>
  return {
    sessionId: normalizeSessionScope(raw.sessionId, 'sessionId', options)
  }
}

function terminalForRenderer(terminal: BackgroundTerminalInfo): BackgroundTerminalForRenderer {
  return {
    id: terminal.id,
    command: terminal.command,
    cwd: terminal.cwd,
    sessionId: terminal.sessionId,
    pid: terminal.pid,
    startedAt: terminal.startedAt,
    status: terminal.status === 'terminating' ? 'terminating' : 'running'
  }
}

export function listBackgroundTerminalsForRenderer(
  input?: unknown,
  options: BackgroundTerminalAccessOptions = {}
): ListBackgroundTerminalsResult {
  const request = normalizeListRequest(input, options)
  const terminals = listBackgroundTerminals({ sessionId: request.sessionId }).map(
    terminalForRenderer
  )
  let startIndex = 0
  if (request.cursor) {
    const cursorIndex = terminals.findIndex((terminal) => terminal.id === request.cursor)
    if (cursorIndex < 0) {
      throw new Error('Invalid background terminals cursor.')
    }
    startIndex = cursorIndex + 1
  }
  const data = terminals.slice(startIndex, startIndex + request.limit)
  const nextCursor =
    startIndex + request.limit < terminals.length ? (data[data.length - 1]?.id ?? null) : null
  return { data, nextCursor }
}

export function terminateBackgroundTerminalForRenderer(
  input: unknown,
  options: BackgroundTerminalAccessOptions = {}
): TerminateBackgroundTerminalResult {
  const request = normalizeTerminateRequest(input, options)
  return {
    terminated: terminateBackgroundTerminal(request.id, {
      force: true,
      sessionId: request.sessionId
    })
  }
}

export function cleanBackgroundTerminalsForRenderer(
  input?: unknown,
  options: BackgroundTerminalAccessOptions = {}
): CleanBackgroundTerminalsResult {
  const request = normalizeCleanRequest(input, options)
  return {
    terminated: forceTerminateAllBackgroundTerminals({ sessionId: request.sessionId })
  }
}

export function registerBackgroundTerminalsIpcHandlers(): void {
  ipcMain.handle('background-terminals:list', (_event, input?: unknown) =>
    listBackgroundTerminalsForRenderer(input)
  )
  ipcMain.handle('background-terminals:terminate', (_event, input: unknown) =>
    terminateBackgroundTerminalForRenderer(input)
  )
  ipcMain.handle('background-terminals:clean', (_event, input?: unknown) =>
    cleanBackgroundTerminalsForRenderer(input)
  )
}
