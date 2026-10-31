import i18next from 'i18next'
import type { CodexFailure } from '../../../shared/codex'

export class CodexUIError extends Error {
  constructor(readonly failure: CodexFailure) {
    super(failure.message)
  }
}
export function uiFailure(error: unknown): CodexFailure {
  return error instanceof CodexUIError
    ? error.failure
    : { code: 'native_error', message: error instanceof Error ? error.message : '' }
}
export function failureMessage(failure: CodexFailure | null): string {
  if (!failure) return ''
  if (failure.code === 'native_error' && failure.message) return failure.message
  return String(i18next.t(`errors.${failure.code}`))
}
