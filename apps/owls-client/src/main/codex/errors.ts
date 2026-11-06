import { z } from 'zod'
import type { CodexFailure } from '../../shared/codex.js'
import { safeText } from './protocol.js'

export class CodexRuntimeError extends Error {
  constructor(
    readonly code: CodexFailure['code'],
    message: string = code
  ) {
    super(message)
    this.name = 'CodexRuntimeError'
  }
}
export function codexFailure(error: unknown): CodexFailure {
  if (error instanceof CodexRuntimeError) {
    return { code: error.code, message: safeText(error.message).slice(0, 1000) }
  }
  if (error instanceof z.ZodError) return { code: 'protocol_error', message: '' }
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_')
  ) {
    return { code: 'storage_error', message: '' }
  }
  return {
    code: 'native_error',
    message: safeText(error instanceof Error ? error.message : '').slice(0, 1000)
  }
}
