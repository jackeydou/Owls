import {
  isModelVisibleMessage,
  normalizeMessageKind,
  normalizeMessageVisibility,
  type PichuMessageKind,
  type PichuMessageVisibility
} from '../../shared/agent-message-visibility.js'
import type { MessageAttachment } from '../../shared/attachments.js'
import type { MessagePart } from '../../shared/message-parts.js'
import {
  normalizePichuThinkingLevel,
  type PichuThinkingLevel,
  type RunModelUsage,
  type SessionModelPreference
} from '../../shared/model-settings.js'
import { expandSkillPromptParts } from '../skill-loader.js'
import {
  addMessage,
  addMessages,
  addSessionToIndex,
  getNextSortOrder,
  getSessionById,
  getSessionMessages,
  getSettingsForRenderer,
  type MessageRow,
  stringifyMessageAttachments,
  updateSessionTitle
} from '../stores/settings-store.js'
import { deriveSessionTitle } from './session-title.js'
import { SIDE_CONVERSATION_CONTEXT_PROMPT } from './system-prompt.js'
import type { PromptAgentPayload } from './types.js'

export type SessionStatusSnapshotSource = {
  sessionId: string | null
  runStatusBySession: Record<
    string,
    'idle' | 'running' | 'waiting_for_user' | 'waiting_for_approval'
  >
  activeRunIdsBySession: Record<string, string>
  activeRunStartedAtsBySession: Record<string, string>
  waitingInputIdBySession: Record<string, string>
  waitingApprovalIdBySession?: Record<string, string>
}

export type SessionCommandDeps = {
  createSession: (
    cwd: string,
    model?: string,
    thinkingLevel?: PichuThinkingLevel,
    prompt?: string,
    options?: {
      parentSessionId?: string | null
      reuseCwd?: boolean
    }
  ) => Promise<{
    sessionId: string
    cwd: string
    systemPrompt: string
    sessionModel: SessionModelPreference
  }>
  persistTextMessage: (
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ) => void
  persistPromptInputMessages: (params: {
    sessionId: string
    cwd: string
    content: string
    agentContent: string
    attachments?: MessageAttachment[]
    parts?: MessagePart[]
  }) => Promise<{ contextRow?: MessageRow; userRow: MessageRow }>
  promptAgent: (payload: PromptAgentPayload) => Promise<{
    effectiveModelId: string
    effectiveThinkingLevel: PichuThinkingLevel
    effectiveReason: RunModelUsage['effectiveReason']
  }>
  generateSessionTitle: (
    sessionId: string,
    fallbackText: string,
    hasImages?: boolean
  ) => Promise<string>
  assertCanAcceptPrompt: (sessionId: string) => void
}

export type SessionStatusView = {
  sessionId: string | null
  status: 'idle' | 'running' | 'waiting_for_user' | 'waiting_for_approval'
  activeRunId: string | null
  activeRunStartedAt: string | null
  waitingInputId: string | null
  waitingApprovalId: string | null
}

const promptInFlightSessionIds = new Set<string>()

function cloneMessagePartsForSnapshot(parts: MessagePart[] | undefined): MessagePart[] {
  return (parts ?? []).map((part) => ({
    ...part,
    id: crypto.randomUUID()
  }))
}

function buildSideConversationSnapshotRows(params: {
  parentSessionId: string
  sessionId: string
}): MessageRow[] {
  const baseSortOrder = getNextSortOrder(params.sessionId)
  const createdAt = new Date().toISOString()
  const parentRows = getSessionMessages(params.parentSessionId)
  const snapshotRows = parentRows
    .filter((row) => row.role !== 'system')
    .filter((row) => isModelVisibleMessage(normalizeMessageVisibility(row.visibility, row.role)))
    .map((row, index): MessageRow => {
      const visibility: PichuMessageVisibility = 'model-only'
      return {
        id: crypto.randomUUID(),
        sessionId: params.sessionId,
        role: row.role,
        kind: normalizeMessageKind(row.kind),
        content: row.content,
        agentContent: row.agentContent,
        visibility,
        sortOrder: baseSortOrder + index,
        createdAt: row.createdAt,
        runId: null,
        toolCallId: row.toolCallId ?? null,
        toolName: row.toolName ?? null,
        toolCallResult: row.toolCallResult ?? null,
        attachmentsJson: row.attachmentsJson ?? null,
        modelId: null,
        modelProvider: null,
        modelApi: null,
        modelUsageJson: null,
        runStatus: null,
        runStartedAt: null,
        runCompletedAt: null,
        runDurationMs: null,
        runError: null,
        parts: cloneMessagePartsForSnapshot(row.parts)
      }
    })

  return [
    ...snapshotRows,
    {
      id: crypto.randomUUID(),
      sessionId: params.sessionId,
      role: 'user',
      runId: null,
      kind: 'default',
      content: SIDE_CONVERSATION_CONTEXT_PROMPT,
      agentContent: SIDE_CONVERSATION_CONTEXT_PROMPT,
      visibility: 'model-only',
      sortOrder: baseSortOrder + snapshotRows.length,
      createdAt,
      toolCallId: null,
      toolName: null,
      toolCallResult: null,
      attachmentsJson: null,
      modelId: null,
      modelProvider: null,
      modelApi: null,
      modelUsageJson: null,
      parts: []
    }
  ]
}

export async function createAgentSessionIndexed(
  deps: SessionCommandDeps,
  params: {
    cwd: string
    model?: string
    thinkingLevel?: PichuThinkingLevel
    titleHint?: string
    sessionKind?: 'main' | 'side'
    parentSessionId?: string | null
  }
): Promise<{ sessionId: string; sessionModel: SessionModelPreference }> {
  const resolvedCwd = params.cwd.trim()
  if (!resolvedCwd) {
    throw new Error('Working directory is required')
  }
  const sessionKind = params.sessionKind ?? 'main'
  const parentSessionId = params.parentSessionId?.trim() || null
  if (sessionKind === 'side') {
    if (!parentSessionId) {
      throw new Error('Parent session id is required')
    }
    const parentSession = getSessionById(parentSessionId)
    if (!parentSession) {
      throw new Error(`Unknown parent session: ${parentSessionId}`)
    }
    if (parentSession.sessionKind === 'side') {
      throw new Error('Side chats cannot be nested')
    }
  }
  const {
    sessionId,
    cwd: sessionCwd,
    systemPrompt,
    sessionModel
  } = await deps.createSession(
    resolvedCwd,
    params.model,
    params.thinkingLevel,
    params.titleHint?.trim(),
    {
      parentSessionId,
      reuseCwd: sessionKind === 'side'
    }
  )
  const now = sessionModel.updatedAt
  addSessionToIndex({
    sessionId,
    agentId: 'pi-agent',
    cwd: sessionCwd,
    title: '',
    sessionKind,
    parentSessionId,
    createdAt: now,
    updatedAt: now,
    sessionModelId: sessionModel.modelId,
    sessionThinkingLevel: sessionModel.thinkingLevel,
    sessionModelUpdatedAt: sessionModel.updatedAt,
    sessionModelUpdatedBy: sessionModel.updatedBy
  })
  deps.persistTextMessage(sessionId, 'system', systemPrompt)
  if (sessionKind === 'side' && parentSessionId) {
    addMessages(buildSideConversationSnapshotRows({ parentSessionId, sessionId }))
  }
  return { sessionId, sessionModel }
}

function isFirstSharedUserMessage(sessionId: string): boolean {
  return !getSessionMessages(sessionId).some(
    (row) =>
      row.role === 'user' && normalizeMessageVisibility(row.visibility, row.role) === 'shared'
  )
}

function hasCommentParts(parts: MessagePart[] | undefined): boolean {
  return parts?.some((part) => part.type === 'comment') ?? false
}

export async function persistSessionUserMessage(
  deps: Pick<SessionCommandDeps, 'persistPromptInputMessages'>,
  params: {
    sessionId: string
    content: string
    agentContent?: string | null
    attachments?: MessageAttachment[]
    parts?: MessagePart[]
    persistRuntimeContext?: boolean | null
    kind?: PichuMessageKind | null
    runId?: string | null
    visibility?: PichuMessageVisibility | null
  }
): Promise<MessageRow> {
  const sessionId = params.sessionId.trim()
  const content = params.content
  if (!sessionId) {
    throw new Error('Session id is required')
  }
  if (!content.trim() && !hasCommentParts(params.parts)) {
    throw new Error('Prompt text is required')
  }
  const entry = getSessionById(sessionId)
  if (!entry) {
    throw new Error(`Unknown session: ${sessionId}`)
  }
  const agentContent = await expandSkillPromptParts(params.agentContent ?? '', params.parts, {
    cwd: entry.cwd
  })
  const visibility = normalizeMessageVisibility(params.visibility, 'user')
  const kind = normalizeMessageKind(params.kind)
  if (params.persistRuntimeContext && visibility === 'shared') {
    const { userRow } = await deps.persistPromptInputMessages({
      sessionId,
      cwd: entry.cwd,
      content,
      agentContent,
      attachments: params.attachments,
      parts: params.parts
    })
    return userRow
  }
  const createdAt = new Date().toISOString()
  const row: MessageRow = {
    id: crypto.randomUUID(),
    sessionId,
    role: 'user',
    runId: params.runId ?? null,
    kind,
    content,
    agentContent,
    visibility,
    sortOrder: getNextSortOrder(sessionId),
    createdAt,
    toolCallId: null,
    toolName: null,
    attachmentsJson: stringifyMessageAttachments(params.attachments),
    modelId: null,
    modelProvider: null,
    modelApi: null,
    modelUsageJson: null,
    parts: params.parts ?? []
  }
  addMessage(row)
  return row
}

export async function persistUserPromptMessage(
  deps: SessionCommandDeps,
  params: { sessionId: string; text: string }
): Promise<void> {
  const sessionId = params.sessionId.trim()
  const trimmed = params.text.trim()
  await persistSessionUserMessage(deps, {
    sessionId,
    content: trimmed,
    agentContent: trimmed,
    persistRuntimeContext: isFirstSharedUserMessage(sessionId),
    kind: 'default',
    visibility: 'shared'
  })
}

function assertAndMarkSessionPromptInFlight(deps: SessionCommandDeps, sessionId: string): void {
  deps.assertCanAcceptPrompt(sessionId)
  if (promptInFlightSessionIds.has(sessionId)) {
    throw new Error(
      'Agent response is already starting for this session. Wait before sending another prompt.'
    )
  }
  promptInFlightSessionIds.add(sessionId)
}

function runSessionPromptInBackground(
  deps: SessionCommandDeps,
  sessionId: string,
  text: string
): void {
  void (async () => {
    try {
      const shouldGenerateTitle = isFirstSharedUserMessage(sessionId)
      await persistUserPromptMessage(deps, { sessionId, text })
      if (shouldGenerateTitle) {
        updateSessionTitle(sessionId, deriveSessionTitle(text))
        void deps.generateSessionTitle(sessionId, text).catch((error) => {
          console.warn('[session-commands] failed to generate session title', {
            sessionId,
            message: error instanceof Error ? error.message : String(error)
          })
        })
      }
      await deps.promptAgent({ sessionId, text })
    } catch (error) {
      console.error('[session-commands] background prompt failed', {
        sessionId,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      promptInFlightSessionIds.delete(sessionId)
    }
  })()
}

export async function acceptNewSessionPrompt(
  deps: SessionCommandDeps,
  params: {
    prompt: string
    cwd?: string
    model?: string
    thinkingLevel?: PichuThinkingLevel
    skills?: string[]
  }
): Promise<{ accepted: true; sessionId: string }> {
  const prompt = params.prompt.trim()
  if (!prompt) {
    throw new Error('Prompt text is required')
  }
  const resolvedCwd = params.cwd?.trim() || getSettingsForRenderer().workingDirectory.trim()
  if (!resolvedCwd) {
    throw new Error('Working directory is required')
  }
  const thinkingLevel =
    params.thinkingLevel === undefined
      ? undefined
      : normalizePichuThinkingLevel(params.thinkingLevel)
  // Explicit skill invocation: inline the named skills' SKILL.md into the prompt,
  // mirroring the chat composer's `/skill` parts path.
  const skillParts = (params.skills ?? []).map((qualifiedName, index) => ({
    id: `skill-${index}`,
    type: 'skill' as const,
    text: `@${qualifiedName.split(':').pop() ?? qualifiedName}`,
    target: { name: qualifiedName.split(':').pop() ?? qualifiedName, qualifiedName }
  }))
  const expandedPrompt = skillParts.length
    ? await expandSkillPromptParts(prompt, skillParts, { cwd: resolvedCwd })
    : prompt
  const { sessionId } = await createAgentSessionIndexed(deps, {
    cwd: resolvedCwd,
    model: params.model?.trim() || undefined,
    thinkingLevel,
    titleHint: prompt
  })
  assertAndMarkSessionPromptInFlight(deps, sessionId)
  runSessionPromptInBackground(deps, sessionId, expandedPrompt)
  return { accepted: true, sessionId }
}

export function acceptSessionPrompt(
  deps: SessionCommandDeps,
  params: { sessionId: string; prompt: string }
): { accepted: true; sessionId: string } {
  const sessionId = params.sessionId.trim()
  const prompt = params.prompt.trim()
  if (!sessionId) {
    throw new Error('Session id is required')
  }
  if (!prompt) {
    throw new Error('Prompt text is required')
  }
  if (!getSessionById(sessionId)) {
    throw new Error(`Unknown session: ${sessionId}`)
  }
  assertAndMarkSessionPromptInFlight(deps, sessionId)
  runSessionPromptInBackground(deps, sessionId, prompt)
  return { accepted: true, sessionId }
}

export function getSessionStatusView(
  snapshot: SessionStatusSnapshotSource,
  requestedSessionId?: string
): SessionStatusView {
  const trimmedRequest = requestedSessionId?.trim()
  const sessionId = trimmedRequest || snapshot.sessionId
  if (!sessionId) {
    return {
      sessionId: null,
      status: 'idle',
      activeRunId: null,
      activeRunStartedAt: null,
      waitingInputId: null,
      waitingApprovalId: null
    }
  }
  if (trimmedRequest && !getSessionById(sessionId)) {
    throw new Error(`Unknown session: ${sessionId}`)
  }
  return {
    sessionId,
    status: snapshot.runStatusBySession[sessionId] ?? 'idle',
    activeRunId: snapshot.activeRunIdsBySession[sessionId] ?? null,
    activeRunStartedAt: snapshot.activeRunStartedAtsBySession[sessionId] ?? null,
    waitingInputId: snapshot.waitingInputIdBySession[sessionId] ?? null,
    waitingApprovalId: snapshot.waitingApprovalIdBySession?.[sessionId] ?? null
  }
}
