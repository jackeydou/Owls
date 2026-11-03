import type {
  AfterToolCallContext,
  Agent,
  BeforeToolCallContext
} from '@earendil-works/pi-agent-core'
import {
  isPichuAssistantMessageRole,
  isPichuContextSummaryMessageRole,
  isPichuUserMessageRole
} from '../../shared/agent-message-visibility.js'
import { agentMessageText } from '../ipc-handlers/context-compaction.js'
import {
  type HookRunContext,
  runAgentHookEvent,
  runPermissionRequestHooks,
  runPostToolUseHooks,
  runPreToolUseHooks
} from '../plugins/hooks/hook-runner.js'
import {
  buildToolApprovalRequest,
  requestToolApproval,
  type ToolApprovalReviewContext
} from '../tool-approval-engine.js'
import {
  findToolApprovalMetadata,
  findToolHookIdentity,
  type ToolApprovalMetadata,
  type ToolHookIdentity
} from '../tool-approval-metadata.js'
import { registerPichuBashSandboxEscalationForApproval } from '../tools/pichu-bash-sandbox.js'
import { isRecord } from './message-utils.js'
import type { AgentRunSource } from './system-prompt.js'

export const MAX_STOP_HOOK_CONTINUATIONS = 3
const AUTO_REVIEW_CONTEXT_MESSAGE_LIMIT = 6
const AUTO_REVIEW_CONTEXT_TEXT_LIMIT = 2_000
const AUTO_REVIEW_CONTEXT_MESSAGE_BUDGET_CHARS = 10_000

export function appendHookDeveloperContext(basePrompt: string, contexts: string[]): string {
  const cleanedContexts = contexts.map((context) => context.trim()).filter(Boolean)
  if (cleanedContexts.length === 0) return basePrompt
  return [
    basePrompt,
    '',
    '<plugin_hook_context>',
    cleanedContexts.join('\n\n'),
    '</plugin_hook_context>'
  ].join('\n')
}

function hookRunContext(params: {
  sessionId: string
  cwd: string
  model?: string
  turnId?: string
  signal?: AbortSignal
}): HookRunContext {
  return {
    sessionId: params.sessionId,
    cwd: params.cwd,
    model: params.model,
    turnId: params.turnId,
    signal: params.signal
  }
}

export async function runSessionStartHooks(params: {
  sessionId: string
  cwd: string
  model: string
  source: 'startup' | 'resume' | 'clear'
  signal?: AbortSignal
}): Promise<string[]> {
  const decision = await runAgentHookEvent({
    eventName: 'SessionStart',
    matcherValue: params.source,
    context: hookRunContext({
      sessionId: params.sessionId,
      cwd: params.cwd,
      model: params.model,
      signal: params.signal
    }),
    extraInput: { source: params.source }
  })
  return decision.additionalContext
}

export async function runUserPromptSubmitHooks(params: {
  sessionId: string
  cwd: string
  model: string
  turnId: string
  prompt: string
  signal?: AbortSignal
}): Promise<string[]> {
  const decision = await runAgentHookEvent({
    eventName: 'UserPromptSubmit',
    context: hookRunContext({
      sessionId: params.sessionId,
      cwd: params.cwd,
      model: params.model,
      turnId: params.turnId,
      signal: params.signal
    }),
    extraInput: { prompt: params.prompt }
  })
  if (decision.blockReason) {
    throw new Error(decision.blockReason)
  }
  return decision.additionalContext
}

export async function runToolApprovalGate(params: {
  sessionId: string
  cwd: string
  model: string
  source: AgentRunSource
  toolUseId: string
  toolInput: unknown
  approval?: ToolApprovalMetadata
  preToolPermissionDecision?: 'allow' | 'ask'
  approvalUi?: ToolApprovalMetadata['approvalUi']
  reviewContext?: ToolApprovalReviewContext
  hookIdentity: ToolHookIdentity
  signal?: AbortSignal
}) {
  const hookRequestedApproval = params.preToolPermissionDecision === 'ask'
  const hookOnlyAllow =
    params.preToolPermissionDecision === 'allow' && params.approval === undefined

  const request = buildToolApprovalRequest({
    sessionId: params.sessionId,
    cwd: params.cwd,
    toolName: params.hookIdentity.toolName,
    toolUseId: params.toolUseId,
    toolInput: params.toolInput,
    approval: hookRequestedApproval
      ? {
          mode: 'prompt',
          reason: params.approval?.reason ?? 'A PreToolUse hook requested approval.',
          question: params.approval?.question,
          describe: params.approval?.describe
        }
      : params.approval,
    approvalUi: params.approvalUi,
    reviewContext: params.reviewContext,
    source: params.source
  })
  if (hookOnlyAllow && !request) return undefined
  if (!request) return undefined
  if (request.approvalMode === 'deny') {
    const decision = await requestToolApproval(request, {
      modelId: params.model,
      signal: params.signal
    })
    return {
      block: true,
      reason:
        decision.behavior === 'allow'
          ? `Tool ${request.toolName} was denied by approval policy.`
          : decision.reason
    }
  }

  const permissionDecision = await runPermissionRequestHooks({
    context: hookRunContext({
      sessionId: params.sessionId,
      cwd: params.cwd,
      model: params.model,
      signal: params.signal
    }),
    toolName: params.hookIdentity.toolName,
    matcherValues: params.hookIdentity.matcherValues,
    toolUseId: params.toolUseId,
    toolInput: params.toolInput,
    description: request.description,
    signal: params.signal
  })
  if (
    permissionDecision.behavior === 'allow' &&
    hookRequestedApproval &&
    params.approval === undefined
  ) {
    return undefined
  }
  if (permissionDecision.behavior === 'deny') {
    return { block: true, reason: permissionDecision.reason ?? 'Tool approval was denied.' }
  }

  const decision = await requestToolApproval(request, {
    modelId: params.model,
    signal: params.signal
  })
  if (decision.behavior === 'allow') {
    registerPichuBashSandboxEscalationForApproval(request)
    return undefined
  }
  return { block: true, reason: decision.reason }
}

export async function runBeforeToolCallInterceptors(params: {
  sessionId: string
  cwd: string
  model: string
  source: AgentRunSource
  context: BeforeToolCallContext
  signal?: AbortSignal
}) {
  // Matches Codex unified exec: write_stdin is transport for an already-started
  // managed terminal. Ownership is enforced by the terminal registry before
  // stdin is written, and the original exec_command owns hooks/approval.
  if (params.context.toolCall.name === 'write_stdin') return undefined

  const hookIdentity = findToolHookIdentity(
    params.context.context.tools,
    params.context.toolCall.name
  )
  const preTool = await runPreToolUseHooks({
    context: hookRunContext({
      sessionId: params.sessionId,
      cwd: params.cwd,
      model: params.model,
      signal: params.signal
    }),
    toolName: hookIdentity.toolName,
    matcherValues: hookIdentity.matcherValues,
    toolUseId: params.context.toolCall.id,
    toolInput: params.context.args,
    signal: params.signal
  })
  if (preTool?.block) return preTool

  const toolInput = applyPreToolUpdatedInput(params.context.args, preTool?.updatedInput)
  if (toolInput.block) return { block: true, reason: toolInput.reason }

  const approval = await runToolApprovalGate({
    sessionId: params.sessionId,
    cwd: params.cwd,
    model: params.model,
    source: params.source,
    toolUseId: params.context.toolCall.id,
    toolInput: toolInput.value,
    approval: findToolApprovalMetadata(params.context.context.tools, params.context.toolCall.name),
    preToolPermissionDecision: preTool?.permissionDecision,
    approvalUi: preTool?.approvalUi,
    reviewContext: toolApprovalReviewContext(params.context),
    hookIdentity,
    signal: params.signal
  })
  if (approval) return approval

  return undefined
}

function managedExecHookDetails(result: unknown):
  | {
      hookToolName: string
      hookToolUseId: string
      hookInput: Record<string, unknown>
      hookResponse?: string
    }
  | undefined {
  if (!isRecord(result)) return undefined
  const details = result.details
  if (!isRecord(details)) return undefined
  if (details.hookToolName !== 'exec_command') return undefined
  if (typeof details.hookToolUseId !== 'string') return undefined
  if (!isRecord(details.hookInput)) return undefined
  return {
    hookToolName: details.hookToolName,
    hookToolUseId: details.hookToolUseId,
    hookInput: details.hookInput,
    hookResponse: typeof details.hookResponse === 'string' ? details.hookResponse : undefined
  }
}

export async function runAfterToolCallHooks(params: {
  sessionId: string
  cwd: string
  model: string
  context: AfterToolCallContext
  signal?: AbortSignal
}) {
  const managedExec = managedExecHookDetails(params.context.result)
  if (params.context.toolCall.name === 'write_stdin') {
    // write_stdin is transport for an already-started managed terminal. Only
    // completion polls synthesize the original exec_command PostToolUse event.
    if (managedExec) {
      if (managedExec.hookResponse === undefined) return undefined
      return runPostToolUseHooks({
        context: hookRunContext({
          sessionId: params.sessionId,
          cwd: params.cwd,
          model: params.model,
          signal: params.signal
        }),
        toolName: managedExec.hookToolName,
        matcherValues: [managedExec.hookToolName],
        toolUseId: managedExec.hookToolUseId,
        toolInput: managedExec.hookInput,
        toolResponse: managedExec.hookResponse,
        isError: params.context.isError,
        signal: params.signal
      })
    }
  }

  const hookIdentity = findToolHookIdentity(
    params.context.context.tools,
    params.context.toolCall.name
  )
  return runPostToolUseHooks({
    context: hookRunContext({
      sessionId: params.sessionId,
      cwd: params.cwd,
      model: params.model,
      signal: params.signal
    }),
    toolName: hookIdentity.toolName,
    matcherValues: hookIdentity.matcherValues,
    toolUseId: params.context.toolCall.id,
    toolInput: params.context.args,
    toolResponse: params.context.result,
    isError: params.context.isError,
    signal: params.signal
  })
}

function clipAutoReviewContextText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= AUTO_REVIEW_CONTEXT_TEXT_LIMIT) return trimmed
  const marker = `...[truncated ${trimmed.length - AUTO_REVIEW_CONTEXT_TEXT_LIMIT} chars]...`
  const available = AUTO_REVIEW_CONTEXT_TEXT_LIMIT - marker.length
  if (available <= 0) return marker
  const prefix = Math.floor(available / 2)
  const suffix = available - prefix
  return `${trimmed.slice(0, prefix)}${marker}${trimmed.slice(trimmed.length - suffix)}`
}

function messageRole(message: unknown): string | undefined {
  return isRecord(message) && typeof message.role === 'string' ? message.role : undefined
}

function isUserRequestRole(role: string | undefined): boolean {
  return role === 'user' || isPichuUserMessageRole(role)
}

function isAssistantRole(role: string | undefined): boolean {
  return role === 'assistant' || isPichuAssistantMessageRole(role)
}

function isContextRole(role: string | undefined): boolean {
  return isPichuContextSummaryMessageRole(role)
}

function safeAgentMessageText(message: unknown): string {
  try {
    return agentMessageText(message)
  } catch {
    return ''
  }
}

function latestMessageTextForRole(
  messages: readonly unknown[],
  predicate: (role: string | undefined) => boolean
): string | undefined {
  for (const message of [...messages].reverse()) {
    const role = messageRole(message)
    if (!predicate(role)) continue
    const text = clipAutoReviewContextText(safeAgentMessageText(message))
    if (text) return text
  }
  return undefined
}

function recentAutoReviewMessages(
  messages: readonly unknown[]
): ToolApprovalReviewContext['recentMessages'] {
  const candidates = messages.flatMap((message, index) => {
    const role = messageRole(message)
    if (!role || (!isUserRequestRole(role) && !isAssistantRole(role) && !isContextRole(role))) {
      return []
    }
    const text = clipAutoReviewContextText(safeAgentMessageText(message))
    return text ? [{ index, role, text }] : []
  })
  if (candidates.length === 0) return []

  const included = new Set<number>()
  const userIndices = candidates
    .filter((entry) => isUserRequestRole(entry.role))
    .map((entry) => entry.index)
  const firstUserIndex = userIndices[0]
  if (firstUserIndex !== undefined) included.add(firstUserIndex)
  const lastUserIndex = userIndices.at(-1)
  if (lastUserIndex !== undefined) included.add(lastUserIndex)

  let retainedNonUser = 0
  for (const entry of [...candidates].reverse()) {
    if (included.has(entry.index) || isUserRequestRole(entry.role)) continue
    if (retainedNonUser >= AUTO_REVIEW_CONTEXT_MESSAGE_LIMIT) break
    included.add(entry.index)
    retainedNonUser += 1
  }

  const selected = candidates
    .filter((entry) => included.has(entry.index))
    .sort((left, right) => left.index - right.index)

  let usedChars = 0
  return selected.flatMap((entry) => {
    if (usedChars + entry.text.length > AUTO_REVIEW_CONTEXT_MESSAGE_BUDGET_CHARS) return []
    usedChars += entry.text.length
    return [{ role: entry.role, text: entry.text }]
  })
}

function toolApprovalReviewContext(context: BeforeToolCallContext): ToolApprovalReviewContext {
  const messages = context.context.messages ?? []
  const assistantMessage = clipAutoReviewContextText(safeAgentMessageText(context.assistantMessage))
  return {
    latestUserRequest: latestMessageTextForRole(messages, isUserRequestRole),
    assistantMessage: assistantMessage || undefined,
    recentMessages: recentAutoReviewMessages(messages)
  }
}

export function applyPreToolUpdatedInput(
  originalInput: unknown,
  updatedInput: unknown
): { value: unknown; block: false } | { block: true; reason: string } {
  if (updatedInput === undefined) return { value: originalInput, block: false }
  if (!isRecord(originalInput) || !isRecord(updatedInput)) {
    return {
      block: true,
      reason: 'PreToolUse updatedInput must be an object matching the original tool input shape.'
    }
  }
  for (const key of Object.keys(originalInput)) {
    delete originalInput[key]
  }
  Object.assign(originalInput, updatedInput)
  return { value: originalInput, block: false }
}

export function latestAssistantMessageText(agent: Agent): string {
  const message = [...agent.state.messages]
    .reverse()
    .find((candidate) => isRecord(candidate) && isPichuAssistantMessageRole(candidate.role))
  return message ? agentMessageText(message) : ''
}

export { hookRunContext, runPostToolUseHooks, runPreToolUseHooks }
