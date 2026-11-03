import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type {
  HumanInputControl,
  HumanInputRequestForRenderer,
  HumanInputRequestPayload,
  HumanInputResponsePayload
} from '../shared/human-input.js'
import {
  createPendingHumanInputRequest,
  findHumanInputRequest
} from './stores/human-input-store.js'

export const HUMAN_INPUT_SUSPENSION_CODE = 'PICHU_HUMAN_INPUT_REQUIRED'

export type HumanInputSuspensionMarker = {
  code: typeof HUMAN_INPUT_SUSPENSION_CODE
  requestId: string
  sessionId: string
  toolCallId: string
}

export type HumanInputRuntimeContext = {
  source: 'chat' | 'automation'
  interactive: boolean
  getCurrentSessionId: () => string | null
  getCurrentRunId: () => string | null
  onHumanInputSuspended?: (marker: HumanInputSuspensionMarker) => void
  onHumanInputRequestCreated?: (request: HumanInputRequestForRenderer) => void
}

export type InterruptForHumanInputParams = {
  toolCallId: string
  toolName: string
  interruptKey: string
  title: string
  prompt: string
  input: HumanInputControl
  defaultValue?: unknown
  toolArgsSnapshot: Record<string, unknown>
}

export class HumanInputRequiredError extends Error {
  readonly name = 'HumanInputRequiredError'
  readonly code = HUMAN_INPUT_SUSPENSION_CODE

  constructor(
    readonly sessionId: string,
    readonly requestId: string,
    readonly toolCallId: string
  ) {
    super('Human input is required to continue.')
  }
}

export function isHumanInputSuspensionMarker(value: unknown): value is HumanInputSuspensionMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { code?: unknown }).code === HUMAN_INPUT_SUSPENSION_CODE &&
    typeof (value as { requestId?: unknown }).requestId === 'string' &&
    typeof (value as { sessionId?: unknown }).sessionId === 'string' &&
    typeof (value as { toolCallId?: unknown }).toolCallId === 'string'
  )
}

export function getHumanInputSuspensionMarkerFromResult(
  result: unknown
): HumanInputSuspensionMarker | null {
  if (isHumanInputSuspensionMarker(result)) return result
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return null
  const details = (result as { details?: unknown }).details
  return isHumanInputSuspensionMarker(details) ? details : null
}

function buildNonInteractiveCancellationResult(): HumanInputResponsePayload {
  return {
    ok: false,
    cancelled: true,
    reason: 'This run was triggered by an automation and cannot request interactive input.'
  }
}

function buildResponseToolResult(
  response: HumanInputResponsePayload
): AgentToolResult<HumanInputResponsePayload> {
  return {
    content: [{ type: 'text', text: JSON.stringify(response) }],
    details: response
  }
}

function buildSuspensionToolResult(
  marker: HumanInputSuspensionMarker
): AgentToolResult<HumanInputSuspensionMarker> {
  return {
    content: [{ type: 'text', text: 'Human input is required to continue.' }],
    details: marker,
    terminate: true
  }
}

function getSubmittedResponse(response: unknown): HumanInputResponsePayload | null {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return null
  if ((response as { ok?: unknown }).ok === true) {
    return { ok: true, value: (response as { value?: unknown }).value }
  }
  if (
    (response as { ok?: unknown }).ok === false &&
    (response as { cancelled?: unknown }).cancelled === true &&
    typeof (response as { reason?: unknown }).reason === 'string'
  ) {
    return {
      ok: false,
      cancelled: true,
      reason: (response as { reason: string }).reason
    }
  }
  if (
    (response as { ok?: unknown }).ok === false &&
    (response as { expired?: unknown }).expired === true &&
    typeof (response as { reason?: unknown }).reason === 'string'
  ) {
    return {
      ok: false,
      expired: true,
      reason: (response as { reason: string }).reason
    }
  }
  return null
}

export async function interruptForHumanInput(
  context: HumanInputRuntimeContext,
  params: InterruptForHumanInputParams
): Promise<AgentToolResult<HumanInputResponsePayload | HumanInputSuspensionMarker>> {
  if (!context.interactive || context.source === 'automation') {
    return buildResponseToolResult(buildNonInteractiveCancellationResult())
  }

  const sessionId = context.getCurrentSessionId()
  if (!sessionId) {
    return buildResponseToolResult({
      ok: false,
      cancelled: true,
      reason: 'No active session is available for interactive input.'
    })
  }

  const existing = findHumanInputRequest({
    sessionId,
    toolCallId: params.toolCallId,
    interruptKey: params.interruptKey
  })

  if (existing?.status === 'submitted' || existing?.status === 'cancelled') {
    const response = getSubmittedResponse(existing.response)
    if (response) {
      return buildResponseToolResult(response)
    }
    return buildResponseToolResult({
      ok: false,
      expired: true,
      reason: 'The stored human input response is invalid.'
    })
  }

  if (existing?.status === 'expired') {
    const response = getSubmittedResponse(existing.response)
    return buildResponseToolResult(
      response ?? {
        ok: false,
        expired: true,
        reason: 'The human input request has expired.'
      }
    )
  }

  if (existing?.status === 'resolved') {
    throw new Error('Human input request is already resolved.')
  }

  const request: HumanInputRequestPayload = {
    title: params.title,
    prompt: params.prompt,
    input: params.input,
    defaultValue: params.defaultValue,
    toolArgsSnapshot: params.toolArgsSnapshot
  }
  const pending =
    existing ??
    createPendingHumanInputRequest({
      sessionId,
      runId: context.getCurrentRunId(),
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      interruptKey: params.interruptKey,
      request
    })

  const marker: HumanInputSuspensionMarker = {
    code: HUMAN_INPUT_SUSPENSION_CODE,
    requestId: pending.id,
    sessionId,
    toolCallId: params.toolCallId
  }
  context.onHumanInputRequestCreated?.(pending)
  context.onHumanInputSuspended?.(marker)
  return buildSuspensionToolResult(marker)
}
