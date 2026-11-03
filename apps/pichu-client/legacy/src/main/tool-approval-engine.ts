import crypto from 'node:crypto'
import { type ParseEntry, parse } from 'shell-quote'
import type {
  ToolApprovalAutoReviewAction,
  ToolApprovalAutoReviewEvent,
  ToolApprovalMode,
  ToolApprovalParsedCommand,
  ToolApprovalRememberRuleProposal,
  ToolApprovalRequestForRenderer,
  ToolApprovalResolveBehavior,
  ToolApprovalResolvedEvent,
  ToolApprovalSubject,
  ToolApprovalUiSpec
} from '../shared/tool-approval.js'
import { isKnownBackgroundTerminalPidForSession } from './background-terminals.js'
import { parseShellCommandForApproval } from './shell-command-parser.js'
import { isKnownSafeReadOnlyShellCommand } from './shell-command-safety.js'
import {
  findMatchingToolApprovalRule,
  rememberToolApprovalRuleForRequest
} from './stores/tool-approval-rule-store.js'
import {
  cancelPendingStoredToolApprovalRequestsForSession,
  createToolApprovalRequest,
  getStoredToolApprovalRequest,
  listPendingToolApprovalRequestRows,
  resolveStoredToolApprovalRequest
} from './stores/tool-approval-store.js'
import type { ToolApprovalMetadata } from './tool-approval-metadata.js'
import { buildToolApprovalRememberRuleProposal } from './tool-approval-rules.js'
import {
  reviewToolApprovalRequest,
  summarizeAutoReviewAction,
  type ToolAutoReviewResult
} from './tool-auto-reviewer.js'
import { isPichuBashSandboxSupported } from './tools/pichu-bash-sandbox.js'

export type { ToolApprovalMode, ToolApprovalRequestForRenderer, ToolApprovalResolveBehavior }

export type ToolApprovalRequest = {
  id: string
  sessionId: string
  cwd: string
  toolName: string
  toolUseId: string
  toolInput: unknown
  approvalMode: Exclude<ToolApprovalMode, 'none'>
  approvalReason?: string
  description: string
  approvalUi?: ToolApprovalUiSpec
  approvalSubject?: ToolApprovalSubject
  parsedCommand?: ToolApprovalParsedCommand
  autoReviewAction?: ToolApprovalAutoReviewAction
  rememberRule?: ToolApprovalRememberRuleProposal
  reviewContext?: ToolApprovalReviewContext
  source: 'chat' | 'automation'
  createdAt: string
}

export type ToolApprovalReviewContext = {
  latestUserRequest?: string
  assistantMessage?: string
  recentMessages?: Array<{
    role: string
    text: string
  }>
}

export type ToolApprovalDecision =
  | {
      behavior: 'allow'
      request: ToolApprovalRequest
    }
  | {
      behavior: 'deny'
      request: ToolApprovalRequest
      reason: string
    }
  | {
      behavior: 'unavailable'
      request: ToolApprovalRequest
      reason: string
    }

type ToolApprovalEventSender = {
  isAvailable: () => boolean
  requested: (request: ToolApprovalRequestForRenderer) => boolean | undefined
  resolved: (event: ToolApprovalResolvedEvent) => boolean | undefined
  autoReviewStarted?: (event: ToolApprovalAutoReviewEvent) => boolean | undefined
  autoReviewCompleted?: (event: ToolApprovalAutoReviewEvent) => boolean | undefined
}

type ToolApprovalRunStateHandler = {
  waiting: (request: Pick<ToolApprovalRequest, 'id' | 'sessionId'>) => string | null
  resolved: (
    request: Pick<ToolApprovalRequest, 'id' | 'sessionId'>,
    behavior: ToolApprovalResolvedEvent['behavior']
  ) => void
}

type StoredToolApprovalResolutionHandler = (params: {
  request: ToolApprovalRequestForRenderer
  behavior: ToolApprovalResolveBehavior
  reason?: string
}) => Promise<void>

type PendingToolApprovalRequest = {
  request: ToolApprovalRequest
  resolve: (decision: ToolApprovalDecision) => void
}

const pendingToolApprovals = new Map<string, PendingToolApprovalRequest>()
let eventSender: ToolApprovalEventSender | null = null
let runStateHandler: ToolApprovalRunStateHandler | null = null
let storedResolutionHandler: StoredToolApprovalResolutionHandler | null = null
const pendingStoredResolutionContinuations = new Map<
  string,
  Parameters<StoredToolApprovalResolutionHandler>[0]
>()

function isShellOperator(entry: ParseEntry): boolean {
  return typeof entry === 'object' && entry !== null && 'op' in entry
}

function parseKillTargetToken(token: string, endOfOptions: boolean): number | null {
  if (/^\d+$/.test(token)) {
    const pid = Number(token)
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null
  }
  if (endOfOptions && /^-\d+$/.test(token)) {
    const processGroupId = Number(token.slice(1))
    return Number.isSafeInteger(processGroupId) && processGroupId > 0 ? processGroupId : null
  }
  return null
}

function isSignalOption(token: string): boolean {
  return /^-[A-Za-z][A-Za-z0-9_-]*$/.test(token) || /^-\d+$/.test(token)
}

function isPichuManagedKillCommand(command: string, sessionId: string): boolean {
  let entries: ParseEntry[]
  try {
    entries = parse(command)
  } catch {
    return false
  }

  if (entries.some(isShellOperator)) return false
  const tokens = entries.filter((entry): entry is string => typeof entry === 'string')
  if (tokens.length < 2 || tokens[0] !== 'kill') return false

  let hasManagedPid = false
  let endOfOptions = false
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!endOfOptions && token === '--') {
      endOfOptions = true
      continue
    }
    if (!endOfOptions && token === '-s') {
      index += 1
      if (index >= tokens.length || !/^[A-Za-z0-9_-]+$/.test(tokens[index])) return false
      continue
    }
    if (!endOfOptions && isSignalOption(token)) continue

    const target = parseKillTargetToken(token, endOfOptions)
    if (target === null || !isKnownBackgroundTerminalPidForSession(target, sessionId)) return false
    hasManagedPid = true
  }

  return hasManagedPid
}

function deterministicLocalApprovalDecision(
  request: ToolApprovalRequest
): ToolApprovalDecision | null {
  const toolCommand = shellCommandForToolApprovalRequest(request)
  const autoCommand =
    request.autoReviewAction?.type === 'command' ? request.autoReviewAction.command : undefined
  if (
    request.approvalMode !== 'deny' &&
    typeof toolCommand === 'string' &&
    typeof autoCommand === 'string' &&
    toolCommand === autoCommand &&
    isPichuManagedKillCommand(autoCommand, request.sessionId)
  ) {
    return { behavior: 'allow', request }
  }
  return null
}

function reasonForToolInput(
  toolInput: unknown,
  approval?: ToolApprovalMetadata
): string | undefined {
  if (!approval?.reason) return undefined
  if (typeof approval.reason !== 'function') return approval.reason
  try {
    return approval.reason(toolInput)
  } catch (error) {
    console.warn('[tool-approval] approval.reason failed', { error: errorMessage(error) })
    return undefined
  }
}

function stringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const fieldValue = (value as Record<string, unknown>)[field]
  return typeof fieldValue === 'string' && fieldValue.trim() ? fieldValue.trim() : undefined
}

function shellCommandForToolApprovalRequest(request: ToolApprovalRequest): string | undefined {
  if (request.toolName === 'exec_command') {
    return stringField(request.toolInput, 'cmd') ?? stringField(request.toolInput, 'command')
  }
  return undefined
}

function explicitApprovalQuestion(toolInput: unknown): string | undefined {
  return (
    stringField(toolInput, 'justification') ??
    stringField(toolInput, 'approvalReason') ??
    stringField(toolInput, 'approval_reason')
  )
}

function questionForToolInput(
  toolInput: unknown,
  approval?: ToolApprovalMetadata
): string | undefined {
  const explicitQuestion = explicitApprovalQuestion(toolInput)
  if (explicitQuestion) return explicitQuestion
  if (approval?.question) {
    if (typeof approval.question !== 'function') return approval.question
    try {
      return approval.question(toolInput)
    } catch (error) {
      console.warn('[tool-approval] approval.question failed', { error: errorMessage(error) })
    }
  }
  return reasonForToolInput(toolInput, approval)
}

function defaultDescription(
  toolName: string,
  toolInput: unknown,
  approval?: ToolApprovalMetadata
): string {
  return reasonForToolInput(toolInput, approval) ?? toolName
}

function descriptionForToolInput(
  toolName: string,
  toolInput: unknown,
  approval?: ToolApprovalMetadata
): string {
  let described: string | undefined
  try {
    described = approval?.describe?.(toolInput)?.trim()
  } catch (error) {
    console.warn('[tool-approval] approval.describe failed', { error: errorMessage(error) })
  }
  return described || defaultDescription(toolName, toolInput, approval)
}

function parsedCommandForToolInput(
  toolName: string,
  toolInput: unknown
): ToolApprovalParsedCommand | undefined {
  if (toolName !== 'exec_command') return undefined
  if (typeof toolInput !== 'object' || toolInput === null || Array.isArray(toolInput)) {
    return undefined
  }
  const command =
    (toolInput as { cmd?: unknown; command?: unknown }).cmd ??
    (toolInput as { command?: unknown }).command
  return typeof command === 'string' ? parseShellCommandForApproval(command) : undefined
}

function approvalSubjectForToolInput(
  toolInput: unknown,
  approval?: ToolApprovalMetadata
): ToolApprovalSubject | undefined {
  try {
    return approval?.approvalSubject?.(toolInput)
  } catch (error) {
    console.warn('[tool-approval] approval.approvalSubject failed', { error: errorMessage(error) })
    return undefined
  }
}

export function buildToolApprovalRequest(params: {
  sessionId: string
  cwd: string
  toolName: string
  toolUseId: string
  toolInput: unknown
  approval?: ToolApprovalMetadata
  approvalUi?: ToolApprovalUiSpec
  reviewContext?: ToolApprovalReviewContext
  source?: 'chat' | 'automation'
}): ToolApprovalRequest | null {
  let approvalMode: ToolApprovalMode
  try {
    approvalMode =
      typeof params.approval?.mode === 'function'
        ? params.approval.mode()
        : (params.approval?.mode ?? 'none')
  } catch (error) {
    console.warn('[tool-approval] approval.mode failed; defaulting to prompt', {
      error: errorMessage(error)
    })
    approvalMode = 'prompt'
  }
  if (approvalMode === 'none') return null
  const shouldPrompt = params.approval?.shouldPrompt
  if (shouldPrompt) {
    try {
      if (!shouldPrompt(params.toolInput)) return null
    } catch {
      // Fail closed: classifier errors should ask, not silently allow a tool call.
    }
  }

  let autoReviewAction: ToolApprovalAutoReviewAction | undefined
  try {
    autoReviewAction = params.approval?.autoReviewAction?.(params.toolInput)
  } catch (error) {
    console.warn('[tool-approval] approval.autoReviewAction failed', { error: errorMessage(error) })
  }

  const request: ToolApprovalRequest = {
    id: crypto.randomUUID(),
    sessionId: params.sessionId,
    cwd: params.cwd,
    toolName: params.toolName,
    toolUseId: params.toolUseId,
    toolInput: params.toolInput,
    approvalMode,
    approvalReason: questionForToolInput(params.toolInput, params.approval),
    description: descriptionForToolInput(params.toolName, params.toolInput, params.approval),
    approvalUi: params.approvalUi ?? params.approval?.approvalUi,
    approvalSubject: approvalSubjectForToolInput(params.toolInput, params.approval),
    parsedCommand: parsedCommandForToolInput(params.toolName, params.toolInput),
    autoReviewAction,
    reviewContext: params.reviewContext,
    source: params.source ?? 'chat',
    createdAt: new Date().toISOString()
  }
  return {
    ...request,
    rememberRule: buildToolApprovalRememberRuleProposal(request)
  }
}

export function setToolApprovalEventSender(sender: ToolApprovalEventSender | null): void {
  eventSender = sender
}

export function setToolApprovalRunStateHandler(handler: ToolApprovalRunStateHandler | null): void {
  runStateHandler = handler
}

export function setStoredToolApprovalResolutionHandler(
  handler: StoredToolApprovalResolutionHandler | null
): void {
  storedResolutionHandler = handler
  if (!handler) return
  for (const [id, params] of pendingStoredResolutionContinuations) {
    pendingStoredResolutionContinuations.delete(id)
    continueAfterStoredApprovalResolution(params)
  }
}

export function shouldResumeRunAfterToolApprovalResolution(
  behavior: ToolApprovalResolvedEvent['behavior']
): boolean {
  return (
    behavior === 'allow' ||
    behavior === 'deny' ||
    behavior === 'timeout' ||
    behavior === 'unavailable'
  )
}

export function toolApprovalRequestForRenderer(
  request: ToolApprovalRequest
): ToolApprovalRequestForRenderer {
  return {
    id: request.id,
    sessionId: request.sessionId,
    cwd: request.cwd,
    toolName: request.toolName,
    toolUseId: request.toolUseId,
    toolInput: request.toolInput,
    approvalMode: request.approvalMode,
    approvalReason: request.approvalReason,
    description: request.description,
    approvalUi: request.approvalUi,
    parsedCommand: request.parsedCommand,
    autoReviewAction: request.autoReviewAction,
    rememberRule: request.rememberRule,
    source: request.source,
    createdAt: request.createdAt
  }
}

export function listPendingToolApprovalRequests(): ToolApprovalRequestForRenderer[] {
  const memoryRequests = [...pendingToolApprovals.values()].map((entry) =>
    toolApprovalRequestForRenderer(entry.request)
  )
  const byId = new Map(listPendingToolApprovalRequestRows().map((request) => [request.id, request]))
  for (const request of memoryRequests) {
    byId.set(request.id, request)
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function emitResolved(event: ToolApprovalResolvedEvent): void {
  try {
    eventSender?.resolved(event)
  } catch (error) {
    console.warn('[tool-approval] failed to emit approval resolution', {
      id: event.id,
      behavior: event.behavior,
      error: errorMessage(error)
    })
  }
}

function emitAutoReviewStarted(event: ToolApprovalAutoReviewEvent): void {
  try {
    eventSender?.autoReviewStarted?.(event)
  } catch (error) {
    console.warn('[tool-approval] failed to emit auto-review started', {
      id: event.id,
      requestId: event.requestId,
      error: errorMessage(error)
    })
  }
}

function emitAutoReviewCompleted(event: ToolApprovalAutoReviewEvent): void {
  try {
    eventSender?.autoReviewCompleted?.(event)
  } catch (error) {
    console.warn('[tool-approval] failed to emit auto-review completed', {
      id: event.id,
      requestId: event.requestId,
      status: event.status,
      error: errorMessage(error)
    })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function continueAfterStoredApprovalResolution(
  params: Parameters<StoredToolApprovalResolutionHandler>[0]
): void {
  if (!storedResolutionHandler) {
    pendingStoredResolutionContinuations.set(params.request.id, params)
    return
  }

  void Promise.resolve()
    .then(() => storedResolutionHandler?.(params))
    .catch((error) => {
      console.error('[tool-approval] failed to continue after stored approval resolution', {
        id: params.request.id,
        sessionId: params.request.sessionId,
        toolName: params.request.toolName,
        error: errorMessage(error)
      })
    })
}

function persistToolApprovalRequest(request: ToolApprovalRequest, runId: string | null): void {
  try {
    createToolApprovalRequest({ request, runId })
  } catch (error) {
    console.warn('[tool-approval] failed to persist approval request', {
      id: request.id,
      sessionId: request.sessionId,
      toolName: request.toolName,
      error: errorMessage(error)
    })
  }
}

function persistToolApprovalResolution(params: {
  id: string
  behavior: ToolApprovalResolvedEvent['behavior']
  reason?: string
}): ToolApprovalRequestForRenderer | null {
  try {
    return resolveStoredToolApprovalRequest(params)
  } catch (error) {
    console.warn('[tool-approval] failed to persist approval resolution', {
      id: params.id,
      behavior: params.behavior,
      error: errorMessage(error)
    })
    return null
  }
}

function persistRememberRuleForApproval(request: ToolApprovalRequestForRenderer): void {
  rememberToolApprovalRuleForRequest(request)
}

function findSavedApprovalRule(
  request: ToolApprovalRequest
): ToolApprovalRememberRuleProposal | null {
  try {
    return findMatchingToolApprovalRule(toolApprovalRequestForRenderer(request))
  } catch (error) {
    console.warn('[tool-approval] failed to evaluate saved approval rules', {
      id: request.id,
      sessionId: request.sessionId,
      toolName: request.toolName,
      error: errorMessage(error)
    })
    return null
  }
}

function resolvePendingToolApproval(
  id: string,
  behavior: ToolApprovalResolvedEvent['behavior'],
  decision: ToolApprovalDecision,
  reason?: string
): ToolApprovalRequest | null {
  const pending = pendingToolApprovals.get(id)
  if (!pending) return null

  pendingToolApprovals.delete(id)
  persistToolApprovalResolution({ id, behavior, reason })
  runStateHandler?.resolved(pending.request, behavior)
  emitResolved({ id, behavior, reason })
  pending.resolve(decision)
  return pending.request
}

export async function resolveToolApprovalRequest(
  id: string,
  behavior: ToolApprovalResolveBehavior,
  reason?: string,
  options: { rememberRule?: boolean } = {}
): Promise<ToolApprovalRequestForRenderer | null> {
  const pending = pendingToolApprovals.get(id)
  if (!pending) {
    const existing = getStoredToolApprovalRequest(id)
    if (existing && existing.status !== 'pending') {
      return existing
    }
    if (existing) {
      if (behavior === 'allow' && options.rememberRule) {
        persistRememberRuleForApproval(existing)
      }
      const stored = persistToolApprovalResolution({ id, behavior, reason })
      if (!stored) return existing
      runStateHandler?.resolved(stored, behavior)
      emitResolved({ id, behavior, reason })
      continueAfterStoredApprovalResolution({ request: stored, behavior, reason })
      return stored
    }
    const stored = persistToolApprovalResolution({
      id,
      behavior: 'unavailable',
      reason: 'Approval request is no longer attached to a running tool call.'
    })
    if (stored) {
      runStateHandler?.resolved(stored, 'unavailable')
      emitResolved({
        id,
        behavior: 'unavailable',
        reason: 'Approval request is no longer attached to a running tool call.'
      })
    }
    return stored
  }

  const decision: ToolApprovalDecision =
    behavior === 'allow'
      ? { behavior: 'allow', request: pending.request }
      : {
          behavior: 'deny',
          request: pending.request,
          reason: reason ?? `Tool ${pending.request.toolName} was denied by the user.`
        }
  const rendererRequest = toolApprovalRequestForRenderer(pending.request)
  if (behavior === 'allow' && options.rememberRule) {
    persistRememberRuleForApproval(rendererRequest)
  }
  resolvePendingToolApproval(id, behavior, decision, reason)
  return rendererRequest
}

export function cancelToolApprovalRequestsForSession(sessionId: string, reason: string): number {
  let cancelled = 0
  for (const pending of [...pendingToolApprovals.values()]) {
    if (pending.request.sessionId !== sessionId) continue
    cancelled += 1
    resolvePendingToolApproval(
      pending.request.id,
      'cancelled',
      {
        behavior: 'deny',
        request: pending.request,
        reason
      },
      reason
    )
  }
  return cancelled + cancelPendingStoredToolApprovalRequestsForSession(sessionId, reason)
}

export function evaluateToolApprovalRequest(request: ToolApprovalRequest): ToolApprovalDecision {
  const deterministicDecision = deterministicLocalApprovalDecision(request)
  if (deterministicDecision) return deterministicDecision

  if (request.approvalMode === 'deny') {
    return {
      behavior: 'deny',
      request,
      reason: request.approvalReason ?? `Tool ${request.toolName} was denied by approval policy.`
    }
  }

  if (!eventSender?.isAvailable()) {
    return {
      behavior: 'unavailable',
      request,
      reason: `Tool ${request.toolName} requires approval, but interactive tool approval is not available.`
    }
  }

  return { behavior: 'allow', request }
}

function autoReviewEventForRequest(
  request: ToolApprovalRequest,
  status: ToolApprovalAutoReviewEvent['status'],
  result?: ToolAutoReviewResult
): ToolApprovalAutoReviewEvent {
  const now = new Date().toISOString()
  return {
    id: `auto-review:${request.id}`,
    requestId: request.id,
    sessionId: request.sessionId,
    toolName: request.toolName,
    toolUseId: request.toolUseId,
    action: request.autoReviewAction,
    status,
    riskLevel: result?.riskLevel,
    userAuthorization: result?.userAuthorization,
    summary: summarizeAutoReviewAction(request),
    rationale: result?.rationale,
    reviewedActionTruncated: result?.reviewedActionTruncated,
    createdAt: request.createdAt,
    ...(status === 'inProgress' ? {} : { completedAt: now })
  }
}

function deterministicAutoReviewResult(request: ToolApprovalRequest): ToolAutoReviewResult | null {
  if (deterministicLocalApprovalDecision(request)) {
    return {
      status: 'approved',
      riskLevel: 'medium',
      userAuthorization: 'medium',
      rationale: 'Allowed because the command only terminates a process Owls started.'
    }
  }

  if (
    request.autoReviewAction?.type === 'command' &&
    isPichuBashSandboxSupported() &&
    isKnownSafeReadOnlyShellCommand(request.autoReviewAction.command)
  ) {
    return {
      status: 'approved',
      riskLevel: 'low',
      userAuthorization: 'low',
      rationale: 'Low-risk local read-only inspection.'
    }
  }
  return null
}

function savedRuleAutoReviewResult(rule: ToolApprovalRememberRuleProposal): ToolAutoReviewResult {
  return {
    status: 'approved',
    riskLevel: 'medium',
    userAuthorization: 'medium',
    rationale: `Allowed by saved rule: commands starting with ${rule.display}.`
  }
}

async function runAutoReview(params: {
  request: ToolApprovalRequest
  modelId?: string
  signal?: AbortSignal
}): Promise<ToolAutoReviewResult> {
  emitAutoReviewStarted(autoReviewEventForRequest(params.request, 'inProgress'))
  const deterministicResult = deterministicAutoReviewResult(params.request)
  if (deterministicResult) {
    emitAutoReviewCompleted(
      autoReviewEventForRequest(params.request, deterministicResult.status, deterministicResult)
    )
    return deterministicResult
  }
  const result = await reviewToolApprovalRequest(params.request, {
    modelId: params.modelId,
    signal: params.signal
  })
  emitAutoReviewCompleted(autoReviewEventForRequest(params.request, result.status, result))
  return result
}

function interactivePromptUnavailableDecision(
  request: ToolApprovalRequest
): Extract<ToolApprovalDecision, { behavior: 'unavailable' }> {
  const reason =
    request.source === 'automation'
      ? `Tool ${request.toolName} requires approval, but automation runs cannot show interactive prompts.`
      : `Tool ${request.toolName} requires approval, but interactive tool approval is not available.`
  return {
    behavior: 'unavailable',
    request,
    reason
  }
}

function sendToolApprovalRequestToRenderer(request: ToolApprovalRequest): boolean {
  const sender = eventSender
  if (!sender) return false
  try {
    const result = sender.requested(toolApprovalRequestForRenderer(request))
    if (result === undefined) return true
    if (result === true || result === false) return result

    console.warn('[tool-approval] requested() returned non-boolean', {
      id: request.id,
      sessionId: request.sessionId,
      toolName: request.toolName,
      result
    })
    return false
  } catch (error) {
    console.warn('[tool-approval] failed to send approval request to renderer', {
      id: request.id,
      sessionId: request.sessionId,
      toolName: request.toolName,
      error: errorMessage(error)
    })
    return false
  }
}

export async function requestToolApproval(
  request: ToolApprovalRequest,
  options: {
    modelId?: string
    signal?: AbortSignal
  } = {}
): Promise<ToolApprovalDecision> {
  if (request.approvalMode === 'deny') {
    return evaluateToolApprovalRequest(request)
  }

  const deterministicDecision = deterministicLocalApprovalDecision(request)
  if (deterministicDecision && request.approvalMode !== 'auto-review') return deterministicDecision

  const savedRule = findSavedApprovalRule(request)
  if (savedRule) {
    emitAutoReviewCompleted(
      autoReviewEventForRequest(request, 'approved', savedRuleAutoReviewResult(savedRule))
    )
    return { behavior: 'allow', request }
  }

  if (request.approvalMode === 'auto-review') {
    const review = await runAutoReview({
      request,
      modelId: options.modelId,
      signal: options.signal
    })
    if (review.status === 'approved') {
      return { behavior: 'allow', request }
    }
    if (review.status === 'aborted') {
      return {
        behavior: 'deny',
        request,
        reason: review.rationale
      }
    }
    if (request.source === 'automation') {
      return {
        behavior: 'deny',
        request,
        reason: review.rationale
      }
    }
  }

  if (request.source === 'automation') {
    return interactivePromptUnavailableDecision(request)
  }

  if (!eventSender?.isAvailable()) {
    return interactivePromptUnavailableDecision(request)
  }

  return new Promise<ToolApprovalDecision>((resolve) => {
    pendingToolApprovals.set(request.id, { request, resolve })
    const runId = runStateHandler?.waiting(request) ?? null
    persistToolApprovalRequest(request, runId)
    if (!sendToolApprovalRequestToRenderer(request)) {
      const decision = interactivePromptUnavailableDecision(request)
      resolvePendingToolApproval(request.id, 'unavailable', decision, decision.reason)
    }
  })
}
