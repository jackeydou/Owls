import i18next from 'i18next'
import type { Failure } from '../../../shared/app'

export class UIError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.message)
  }
}
export function uiFailure(error: unknown): Failure {
  return error instanceof UIError
    ? error.failure
    : { code: 'native_error', message: error instanceof Error ? error.message : '' }
}
export function failureMessage(failure: Failure | null): string {
  if (!failure) return ''
  if (failure.code === 'native_error' && failure.message) return failure.message
  return String(i18next.t(`errors.${failure.code}`))
}
