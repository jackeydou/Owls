export const HUMAN_INPUT_STATUSES = [
  'pending',
  'submitted',
  'cancelled',
  'resolved',
  'expired'
] as const

export type HumanInputStatus = (typeof HUMAN_INPUT_STATUSES)[number]

export type HumanInputResolvedOutcome = 'submitted' | 'cancelled'

export type HumanInputCancelMode = 'return_cancelled_result' | 'stop_task'

export type HumanInputSelectOption = {
  label: string
  value: string
}

export type HumanInputControl =
  | { type: 'text'; multiline?: boolean; required?: boolean }
  | {
      type: 'select'
      required?: boolean
      multiple?: boolean
      options: HumanInputSelectOption[]
    }
  | { type: 'confirmation' }

export type HumanInputRequestPayload = {
  title: string
  prompt: string
  input: HumanInputControl
  defaultValue?: unknown
  toolArgsSnapshot: Record<string, unknown>
}

export type HumanInputResponsePayload =
  | {
      ok: true
      value: unknown
    }
  | {
      ok: false
      cancelled: true
      reason: string
    }
  | {
      ok: false
      expired: true
      reason: string
    }

export type HumanInputResponseForRenderer =
  | {
      ok: true
      value: unknown
      displayValue: string
    }
  | {
      ok: false
      cancelled: true
      reason: string
    }
  | {
      ok: false
      expired: true
      reason: string
    }

export type HumanInputRequestForRenderer = {
  id: string
  sessionId: string
  runId: string | null
  toolCallId: string
  toolName: string
  status: HumanInputStatus
  title: string
  prompt: string
  input: HumanInputControl
  defaultValue?: unknown
  resolvedOutcome: HumanInputResolvedOutcome | null
  response?: HumanInputResponseForRenderer
  createdAt: string
  updatedAt: string
}

export type SubmitHumanInputPayload = {
  requestId: string
  value: string | string[] | boolean
}

export type CancelHumanInputPayload = {
  requestId: string
  mode?: HumanInputCancelMode
}

export type ContinueAfterHumanInputPayload = {
  sessionId: string
  requestId?: string
}
