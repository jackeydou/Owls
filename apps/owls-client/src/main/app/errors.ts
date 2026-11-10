import { z } from 'zod'
import type { Failure } from '../../shared/app.js'
import { safeText } from '../codex/protocol.js'

export class OwlsError extends Error {
  constructor(
    readonly code: Failure['code'],
    message: string = code
  ) {
    super(message)
    this.name = 'OwlsError'
  }
}
export function toFailure(error: unknown): Failure {
  if (error instanceof OwlsError) {
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
