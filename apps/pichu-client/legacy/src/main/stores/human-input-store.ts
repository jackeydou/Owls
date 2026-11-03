import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type {
  HumanInputCancelMode,
  HumanInputControl,
  HumanInputRequestForRenderer,
  HumanInputRequestPayload,
  HumanInputResolvedOutcome,
  HumanInputResponseForRenderer,
  HumanInputResponsePayload,
  HumanInputStatus
} from '../../shared/human-input.js'
import { db } from '../db/index.js'
import { humanInputRequests, messages, sessions } from '../db/schema.js'

type HumanInputRequestRow = typeof humanInputRequests.$inferSelect

const UNRESOLVED_HUMAN_INPUT_STATUSES: HumanInputStatus[] = ['pending', 'submitted', 'cancelled']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return false
  return typeof value === 'boolean' ? value : undefined
}

function isHumanInputControl(value: unknown): value is HumanInputControl {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'confirmation') return true
  if (value.type === 'text') {
    return (
      optionalBoolean(value.multiline) !== undefined &&
      optionalBoolean(value.required) !== undefined
    )
  }
  if (value.type !== 'select') return false
  if (
    optionalBoolean(value.required) === undefined ||
    optionalBoolean(value.multiple) === undefined ||
    !Array.isArray(value.options)
  ) {
    return false
  }
  return value.options.every(
    (option) =>
      isRecord(option) && typeof option.label === 'string' && typeof option.value === 'string'
  )
}

function parseHumanInputRequestPayload(value: string): HumanInputRequestPayload | null {
  const parsed = parseJsonRecord(value)
  if (!parsed) return null
  if (
    typeof parsed.title !== 'string' ||
    typeof parsed.prompt !== 'string' ||
    !isHumanInputControl(parsed.input) ||
    !isRecord(parsed.toolArgsSnapshot)
  ) {
    return null
  }
  return {
    title: parsed.title,
    prompt: parsed.prompt,
    input: parsed.input,
    defaultValue: parsed.defaultValue,
    toolArgsSnapshot: parsed.toolArgsSnapshot
  }
}

function parseHumanInputResponsePayload(value: string | null): HumanInputResponsePayload | null {
  if (!value) return null
  const parsed = parseJsonRecord(value)
  if (!parsed || typeof parsed.ok !== 'boolean') return null
  if (parsed.ok === true) {
    return { ok: true, value: parsed.value }
  }
  if (parsed.cancelled === true && typeof parsed.reason === 'string') {
    return { ok: false, cancelled: true, reason: parsed.reason }
  }
  if (parsed.expired === true && typeof parsed.reason === 'string') {
    return { ok: false, expired: true, reason: parsed.reason }
  }
  return null
}

function displayHumanInputValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'Confirmed' : 'Not confirmed'
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.join(', ')
  }
  if (value == null) return ''
  return '[submitted]'
}

function humanInputResponseForRenderer(
  response: HumanInputResponsePayload | null
): HumanInputResponseForRenderer | undefined {
  if (!response) return undefined
  if (response.ok) {
    return {
      ok: true,
      value: response.value,
      displayValue: displayHumanInputValue(response.value)
    }
  }
  return response
}

function humanInputRequestForRenderer(
  row: HumanInputRequestRow
): HumanInputRequestForRenderer | null {
  const request = parseHumanInputRequestPayload(row.requestJson)
  if (!request) return null
  const response = parseHumanInputResponsePayload(row.responseJson)
  return {
    id: row.id,
    sessionId: row.sessionId,
    runId: row.runId,
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    status: row.status as HumanInputStatus,
    title: request.title,
    prompt: request.prompt,
    input: request.input,
    defaultValue: request.defaultValue,
    resolvedOutcome: row.resolvedOutcome as HumanInputResolvedOutcome | null,
    response: humanInputResponseForRenderer(response),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function listHumanInputRequests(sessionId?: string): HumanInputRequestForRenderer[] {
  const rows = sessionId
    ? db()
        .select()
        .from(humanInputRequests)
        .where(eq(humanInputRequests.sessionId, sessionId))
        .orderBy(humanInputRequests.createdAt)
        .all()
    : db().select().from(humanInputRequests).orderBy(humanInputRequests.createdAt).all()
  return rows.flatMap((row) => {
    const request = humanInputRequestForRenderer(row)
    return request ? [request] : []
  })
}

export function findHumanInputRequest(params: {
  sessionId: string
  toolCallId: string
  interruptKey: string
}): HumanInputRequestForRenderer | null {
  const row = db()
    .select()
    .from(humanInputRequests)
    .where(
      and(
        eq(humanInputRequests.sessionId, params.sessionId),
        eq(humanInputRequests.toolCallId, params.toolCallId),
        eq(humanInputRequests.interruptKey, params.interruptKey)
      )
    )
    .get()
  return row ? humanInputRequestForRenderer(row) : null
}

export function getUnresolvedHumanInputRequest(
  sessionId: string
): HumanInputRequestForRenderer | null {
  const row = db()
    .select()
    .from(humanInputRequests)
    .where(
      and(
        eq(humanInputRequests.sessionId, sessionId),
        inArray(humanInputRequests.status, UNRESOLVED_HUMAN_INPUT_STATUSES)
      )
    )
    .orderBy(humanInputRequests.createdAt)
    .get()
  return row ? humanInputRequestForRenderer(row) : null
}

function normalizeHumanInputValue(
  control: HumanInputControl,
  value: string | string[] | boolean
): HumanInputResponsePayload {
  if (control.type === 'confirmation') {
    if (typeof value !== 'boolean') {
      throw new Error('Confirmation input requires a boolean value.')
    }
    return { ok: true, value }
  }
  if (control.type === 'text') {
    if (typeof value !== 'string') {
      throw new Error('Text input requires a string value.')
    }
    const normalized = control.multiline ? value.replace(/\r\n/g, '\n') : value.trim()
    if (control.required && !normalized.trim()) {
      throw new Error('Input value is required.')
    }
    return { ok: true, value: normalized }
  }
  if (control.multiple === true) {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      throw new Error('Multi-select input requires an array of string values.')
    }
    const uniqueValues = [...new Set(value.map((item) => item.trim()).filter(Boolean))]
    if (control.required && uniqueValues.length === 0) {
      throw new Error('Select value is required.')
    }
    return { ok: true, value: uniqueValues }
  }
  if (typeof value !== 'string') {
    throw new Error('Text and select input require a string value.')
  }
  const normalized = value.trim()
  if (!normalized) {
    throw new Error('Select value is required.')
  }
  return { ok: true, value: normalized }
}

export function createPendingHumanInputRequest(params: {
  sessionId: string
  runId?: string | null
  toolCallId: string
  toolName: string
  interruptKey: string
  request: HumanInputRequestPayload
}): HumanInputRequestForRenderer {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const requestJson = JSON.stringify(params.request)
  const database = db()

  database.transaction((tx) => {
    const active = tx
      .select({ id: humanInputRequests.id })
      .from(humanInputRequests)
      .innerJoin(
        messages,
        and(
          eq(messages.sessionId, humanInputRequests.sessionId),
          eq(messages.toolCallId, humanInputRequests.toolCallId)
        )
      )
      .where(
        and(
          eq(humanInputRequests.sessionId, params.sessionId),
          inArray(humanInputRequests.status, UNRESOLVED_HUMAN_INPUT_STATUSES),
          isNull(messages.toolCallResult)
        )
      )
      .get()

    if (active) {
      throw new Error('This session is already waiting for human input.')
    }

    tx.insert(humanInputRequests)
      .values({
        id,
        sessionId: params.sessionId,
        runId: params.runId ?? null,
        toolCallId: params.toolCallId,
        toolName: params.toolName,
        interruptKey: params.interruptKey,
        status: 'pending',
        resolvedOutcome: null,
        requestJson,
        responseJson: null,
        createdAt: now,
        updatedAt: now
      })
      .run()

    tx.update(sessions)
      .set({ updatedAt: now })
      .where(eq(sessions.sessionId, params.sessionId))
      .run()
  })

  const created = findHumanInputRequest({
    sessionId: params.sessionId,
    toolCallId: params.toolCallId,
    interruptKey: params.interruptKey
  })
  if (!created) {
    throw new Error('Failed to create human input request.')
  }
  return created
}

function updateHumanInputRequestResponse(params: {
  requestId: string
  expectedStatus: 'pending'
  status: 'submitted' | 'cancelled'
  response: HumanInputResponsePayload
}): HumanInputRequestForRenderer {
  const now = new Date().toISOString()
  const responseJson = JSON.stringify(params.response)
  const database = db()

  database.transaction((tx) => {
    const row = tx
      .select()
      .from(humanInputRequests)
      .where(eq(humanInputRequests.id, params.requestId))
      .get()

    if (!row) {
      throw new Error('Human input request was not found.')
    }
    if (row.status !== params.expectedStatus) {
      throw new Error(`Human input request is already ${row.status}.`)
    }
    const pendingToolRow = tx
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.sessionId, row.sessionId),
          eq(messages.toolCallId, row.toolCallId),
          eq(messages.role, 'tool'),
          isNull(messages.toolCallResult)
        )
      )
      .get()

    if (!pendingToolRow) {
      tx.update(humanInputRequests)
        .set({
          status: 'expired',
          responseJson: JSON.stringify({
            ok: false,
            expired: true,
            reason: 'The original tool call is no longer waiting for input.'
          } satisfies HumanInputResponsePayload),
          updatedAt: now
        })
        .where(eq(humanInputRequests.id, params.requestId))
        .run()
      throw new Error('The original tool call is no longer waiting for input.')
    }

    tx.update(humanInputRequests)
      .set({
        status: params.status,
        responseJson,
        updatedAt: now
      })
      .where(eq(humanInputRequests.id, params.requestId))
      .run()

    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.sessionId, row.sessionId)).run()
  })

  const updated = db()
    .select()
    .from(humanInputRequests)
    .where(eq(humanInputRequests.id, params.requestId))
    .get()
  const request = updated ? humanInputRequestForRenderer(updated) : null
  if (!request) {
    throw new Error('Failed to load updated human input request.')
  }
  return request
}

export function submitHumanInputRequest(params: {
  requestId: string
  value: string | string[] | boolean
}): HumanInputRequestForRenderer {
  const row = db()
    .select()
    .from(humanInputRequests)
    .where(eq(humanInputRequests.id, params.requestId))
    .get()
  if (!row) {
    throw new Error('Human input request was not found.')
  }
  const request = parseHumanInputRequestPayload(row.requestJson)
  if (!request) {
    throw new Error('Human input request payload is invalid.')
  }
  return updateHumanInputRequestResponse({
    requestId: params.requestId,
    expectedStatus: 'pending',
    status: 'submitted',
    response: normalizeHumanInputValue(request.input, params.value)
  })
}

export function cancelHumanInputRequest(params: {
  requestId: string
  mode?: HumanInputCancelMode
}): HumanInputRequestForRenderer {
  if (params.mode && params.mode !== 'return_cancelled_result') {
    throw new Error('Only return_cancelled_result cancellation is supported.')
  }
  return updateHumanInputRequestResponse({
    requestId: params.requestId,
    expectedStatus: 'pending',
    status: 'cancelled',
    response: {
      ok: false,
      cancelled: true,
      reason: 'User cancelled the input request.'
    }
  })
}

export function expireHumanInputRequest(
  requestId: string,
  reason: string
): HumanInputRequestForRenderer {
  const now = new Date().toISOString()
  db()
    .update(humanInputRequests)
    .set({
      status: 'expired',
      responseJson: JSON.stringify({ ok: false, expired: true, reason }),
      updatedAt: now
    })
    .where(
      and(
        eq(humanInputRequests.id, requestId),
        or(
          eq(humanInputRequests.status, 'pending'),
          eq(humanInputRequests.status, 'submitted'),
          eq(humanInputRequests.status, 'cancelled')
        )
      )
    )
    .run()
  const updated = db()
    .select()
    .from(humanInputRequests)
    .where(eq(humanInputRequests.id, requestId))
    .get()
  const request = updated ? humanInputRequestForRenderer(updated) : null
  if (!request) {
    throw new Error('Failed to load expired human input request.')
  }
  return request
}

export function completeHumanInputToolResult(params: {
  sessionId: string
  toolCallId: string
  toolCallResult: string
}): boolean {
  const now = new Date().toISOString()
  const database = db()
  let completed = false

  database.transaction((tx) => {
    const request = tx
      .select()
      .from(humanInputRequests)
      .where(
        and(
          eq(humanInputRequests.sessionId, params.sessionId),
          eq(humanInputRequests.toolCallId, params.toolCallId),
          inArray(humanInputRequests.status, ['submitted', 'cancelled'])
        )
      )
      .get()

    if (!request) return

    const outcome: HumanInputResolvedOutcome =
      request.status === 'cancelled' ? 'cancelled' : 'submitted'

    const result = tx
      .update(messages)
      .set({ toolCallResult: params.toolCallResult })
      .where(
        and(
          eq(messages.sessionId, params.sessionId),
          eq(messages.toolCallId, params.toolCallId),
          isNull(messages.toolCallResult)
        )
      )
      .run()

    if (result.changes === 0) {
      throw new Error('Human input tool result could not be completed.')
    }

    tx.update(humanInputRequests)
      .set({
        status: 'resolved',
        resolvedOutcome: outcome,
        updatedAt: now
      })
      .where(eq(humanInputRequests.id, request.id))
      .run()

    tx.update(sessions)
      .set({ updatedAt: now })
      .where(eq(sessions.sessionId, params.sessionId))
      .run()
    completed = true
  })

  return completed
}
