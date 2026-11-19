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
  const text = String(i18next.t(`errors.${failure.code}`))
  // A failed connection carries the system's reason, such as EHOSTUNREACH, for diagnosis.
  if (failure.code === 'remote_unreachable' && /^E[A-Z]+$/.test(failure.message ?? ''))
    return `${text} (${failure.message})`
  return text
}
