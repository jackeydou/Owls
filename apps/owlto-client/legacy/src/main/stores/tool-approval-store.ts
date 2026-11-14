import { and, eq, inArray } from 'drizzle-orm'
import type {
  ToolApprovalAutoReviewAction,
  ToolApprovalParsedCommand,
  ToolApprovalRequestForRenderer,
  ToolApprovalResolvedEvent,
  ToolApprovalSubject,
  ToolApprovalUiSpec
} from '../../shared/tool-approval.js'
import { db } from '../db/index.js'
import { toolApprovalRequests } from '../db/schema.js'
import type { ToolApprovalRequest } from '../tool-approval-engine.js'
import { buildToolApprovalRememberRuleProposal } from '../tool-approval-rules.js'

export type ToolApprovalStoredStatus =
  | 'pending'
  | 'allowed'
  | 'denied'
  | 'timeout'
  | 'cancelled'
  | 'unavailable'

type ToolApprovalRequestRow = typeof toolApprovalRequests.$inferSelect
export type StoredToolApprovalRequestForRenderer = ToolApprovalRequestForRenderer & {
  status: ToolApprovalStoredStatus
}

const MAX_STORED_JSON_CHARS = 16_384
const MAX_STORED_STRING_CHARS = 2_000
const MAX_STORED_ARRAY_ITEMS = 50
const MAX_STORED_OBJECT_KEYS = 80
const MAX_STORED_DEPTH = 4
const REDACTED_VALUE = '[redacted]'
const secretKeyPattern =
  /(?:token|secret|password|passwd|api[_-]?key|authorization|cookie|credential|refresh|access[_-]?token)/i
const secretTextPatterns: Array<[RegExp, string]> = [
  [/(Authorization:\s*(?:Bearer|Basic)\s+)[^\s'"]+/gi, `$1${REDACTED_VALUE}`],
  [/(Cookie:\s*)[^\r\n]+/gi, `$1${REDACTED_VALUE}`],
  [
    /(\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|AUTH)[A-Z0-9_]*\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s'"]+)/gi,
    `$1${REDACTED_VALUE}`
  ]
]

function truncateString(value: string): string {
  const redacted = secretTextPatterns.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value
  )
  if (redacted.length <= MAX_STORED_STRING_CHARS) return redacted
  return `${redacted.slice(0, MAX_STORED_STRING_CHARS)}...[truncated ${redacted.length - MAX_STORED_STRING_CHARS} chars]`
}

function sanitizeForStorage(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return truncateString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value !== 'object') return `[${typeof value}]`
  if (seen.has(value)) return '[circular]'
  if (depth >= MAX_STORED_DEPTH) return '[max-depth]'

  seen.add(value)
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_STORED_ARRAY_ITEMS)
      .map((item) => sanitizeForStorage(item, depth + 1, seen))
    if (value.length > MAX_STORED_ARRAY_ITEMS) {
      items.push(`[truncated ${value.length - MAX_STORED_ARRAY_ITEMS} items]`)
    }
    seen.delete(value)
    return items
  }

  const entries = Object.entries(value as Record<string, unknown>)
  const sanitizedEntries = entries
    .slice(0, MAX_STORED_OBJECT_KEYS)
    .map(([key, item]) => [
      key,
      secretKeyPattern.test(key) ? REDACTED_VALUE : sanitizeForStorage(item, depth + 1, seen)
    ])
  if (entries.length > MAX_STORED_OBJECT_KEYS) {
    sanitizedEntries.push([
      '[truncated]',
      `${entries.length - MAX_STORED_OBJECT_KEYS} additional keys`
    ])
  }
  seen.delete(value)
  return Object.fromEntries(sanitizedEntries)
}

function stringifyPersistedJson(value: unknown): string {
  const json = JSON.stringify(sanitizeForStorage(value) ?? null)
  if (json.length <= MAX_STORED_JSON_CHARS) return json
  return JSON.stringify({
    truncated: true,
    originalLength: json.length,
    preview: json.slice(0, MAX_STORED_JSON_CHARS)
  })
}

function parseJson(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function parseObjectJson<T extends object>(value: string | null): T | undefined {
  const parsed = parseJson(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : undefined
}

function rowToRenderer(row: ToolApprovalRequestRow): ToolApprovalRequestForRenderer {
  const request = {
    id: row.id,
    sessionId: row.sessionId,
    cwd: row.cwd,
    toolName: row.toolName,
    toolUseId: row.toolUseId,
    toolInput: parseJson(row.toolInputJson),
    approvalMode: row.approvalMode,
    approvalReason: row.approvalReason ?? undefined,
    description: row.description,
    approvalUi: parseObjectJson<ToolApprovalUiSpec>(row.approvalUiJson),
    approvalSubject: parseObjectJson<ToolApprovalSubject>(row.approvalSubjectJson),
    parsedCommand: parseObjectJson<ToolApprovalParsedCommand>(row.parsedCommandJson),
    autoReviewAction: parseObjectJson<ToolApprovalAutoReviewAction>(row.autoReviewActionJson),
    source: row.source,
    createdAt: row.createdAt
  }
  return {
    ...request,
    rememberRule: buildToolApprovalRememberRuleProposal(request)
  }
}

function rowToStoredRenderer(row: ToolApprovalRequestRow): StoredToolApprovalRequestForRenderer {
  return {
    ...rowToRenderer(row),
    status: row.status
  }
}

function eventStatusToStoredStatus(
  behavior: ToolApprovalResolvedEvent['behavior']
): Exclude<ToolApprovalStoredStatus, 'pending'> {
  switch (behavior) {
    case 'allow':
      return 'allowed'
    case 'deny':
      return 'denied'
    case 'timeout':
      return 'timeout'
    case 'cancelled':
      return 'cancelled'
    case 'unavailable':
      return 'unavailable'
  }
}

export function createToolApprovalRequest(params: {
  request: ToolApprovalRequest
  runId?: string | null
}): void {
  const now = new Date().toISOString()
  db()
    .insert(toolApprovalRequests)
    .values({
      id: params.request.id,
      sessionId: params.request.sessionId,
      runId: params.runId ?? null,
      status: 'pending',
      cwd: params.request.cwd,
      toolName: params.request.toolName,
      toolUseId: params.request.toolUseId,
      toolInputJson: stringifyPersistedJson(params.request.toolInput),
      approvalMode: params.request.approvalMode,
      approvalReason: params.request.approvalReason ?? null,
      description: params.request.description,
      approvalUiJson: params.request.approvalUi
        ? stringifyPersistedJson(params.request.approvalUi)
        : null,
      approvalSubjectJson: params.request.approvalSubject
        ? stringifyPersistedJson(params.request.approvalSubject)
        : null,
      parsedCommandJson: params.request.parsedCommand
        ? stringifyPersistedJson(params.request.parsedCommand)
        : null,
      autoReviewActionJson: params.request.autoReviewAction
        ? stringifyPersistedJson(params.request.autoReviewAction)
        : null,
      source: params.request.source,
      createdAt: params.request.createdAt,
      updatedAt: now,
      resolvedAt: null,
      resolveReason: null
    })
    .onConflictDoNothing()
    .run()
}

export function getStoredToolApprovalRequest(
  id: string
): StoredToolApprovalRequestForRenderer | null {
  const row = db().select().from(toolApprovalRequests).where(eq(toolApprovalRequests.id, id)).get()
  return row ? rowToStoredRenderer(row) : null
}

export function listPendingToolApprovalRequestRows(): ToolApprovalRequestForRenderer[] {
  return db()
    .select()
    .from(toolApprovalRequests)
    .where(eq(toolApprovalRequests.status, 'pending'))
    .all()
    .map(rowToRenderer)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function resolveStoredToolApprovalRequest(params: {
  id: string
  behavior: ToolApprovalResolvedEvent['behavior']
  reason?: string
}): ToolApprovalRequestForRenderer | null {
  const existing = db()
    .select()
    .from(toolApprovalRequests)
    .where(eq(toolApprovalRequests.id, params.id))
    .get()
  if (!existing) return null

  if (existing.status !== 'pending') return null

  const now = new Date().toISOString()
  const result = db()
    .update(toolApprovalRequests)
    .set({
      status: eventStatusToStoredStatus(params.behavior),
      updatedAt: now,
      resolvedAt: now,
      resolveReason: params.reason ?? null
    })
    .where(and(eq(toolApprovalRequests.id, params.id), eq(toolApprovalRequests.status, 'pending')))
    .run()
  if (result.changes === 0) return null

  const updated = db()
    .select()
    .from(toolApprovalRequests)
    .where(eq(toolApprovalRequests.id, params.id))
    .get()
  return rowToRenderer(updated ?? existing)
}

export function cancelPendingStoredToolApprovalRequestsForSession(
  sessionId: string,
  reason: string
): number {
  const rows = db()
    .select({ id: toolApprovalRequests.id })
    .from(toolApprovalRequests)
    .where(
      and(eq(toolApprovalRequests.sessionId, sessionId), eq(toolApprovalRequests.status, 'pending'))
    )
    .all()

  for (const row of rows) {
    resolveStoredToolApprovalRequest({ id: row.id, behavior: 'cancelled', reason })
  }
  return rows.length
}

export function cancelPendingStoredToolApprovalRequestsForRun(
  runId: string,
  reason: string
): number {
  const rows = db()
    .select({ id: toolApprovalRequests.id })
    .from(toolApprovalRequests)
    .where(and(eq(toolApprovalRequests.runId, runId), eq(toolApprovalRequests.status, 'pending')))
    .all()

  for (const row of rows) {
    resolveStoredToolApprovalRequest({ id: row.id, behavior: 'cancelled', reason })
  }
  return rows.length
}

export function pendingToolApprovalIdsBySession(): Map<string, string> {
  const rows = db()
    .select({
      id: toolApprovalRequests.id,
      sessionId: toolApprovalRequests.sessionId,
      createdAt: toolApprovalRequests.createdAt
    })
    .from(toolApprovalRequests)
    .where(eq(toolApprovalRequests.status, 'pending'))
    .all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return new Map(rows.map((row) => [row.sessionId, row.id]))
}

export function failPendingStoredToolApprovalRequestsForRuns(
  runIds: string[],
  reason: string
): void {
  if (runIds.length === 0) return
  const now = new Date().toISOString()
  db()
    .update(toolApprovalRequests)
    .set({
      status: 'unavailable',
      updatedAt: now,
      resolvedAt: now,
      resolveReason: reason
    })
    .where(
      and(inArray(toolApprovalRequests.runId, runIds), eq(toolApprovalRequests.status, 'pending'))
    )
    .run()
}
