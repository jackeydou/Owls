import type { Agent } from '@earendil-works/pi-agent-core'
import type { Usage } from '@earendil-works/pi-ai'
import { ipcMain, shell } from 'electron'
import { PICHU_ASSISTANT_MESSAGE_ROLE } from '../../shared/agent-message-visibility.js'
import { parseContextCompactionMarker } from '../../shared/context-compaction.js'
import type { HumanInputRequestForRenderer } from '../../shared/human-input.js'
import type { MessagePart } from '../../shared/message-parts.js'
import {
  DEFAULT_PICHU_THINKING_LEVEL,
  isPichuThinkingLevel,
  type PichuThinkingLevel,
  type RunModelUsage,
  type SessionModelPreference
} from '../../shared/model-settings.js'
import {
  DEFAULT_CONTEXT_WINDOW,
  effectiveContextWindowForModelId,
  listAvailableModels
} from '../agent/pi-models.js'
import { writeChatDiagnosticEvent } from '../diagnostics.js'
import { deleteSkill, listSkills, readSkillContent } from '../skill-loader.js'
import {
  cancelHumanInputRequest,
  listHumanInputRequests,
  submitHumanInputRequest
} from '../stores/human-input-store.js'
import {
  getSessionById,
  getSessionMessages,
  getSideSessionsForParent,
  type SessionIndexEntry,
  updateSessionCwd
} from '../stores/settings-store.js'
import { getUsageStats } from '../stores/usage-stats-store.js'
import { cancelToolApprovalRequestsForSession } from '../tool-approval-engine.js'
import { getLatestContextCompactionMarker } from './context-compaction.js'

type AgentSessionRunStatus = 'idle' | 'running' | 'waiting_for_user' | 'waiting_for_approval'

function readStringParam(params: unknown, key: string): string | undefined {
  if (!params || typeof params !== 'object') return undefined
  const value = (params as Record<string, unknown>)[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readBooleanParam(params: unknown, key: string): boolean | undefined {
  if (!params || typeof params !== 'object') return undefined
  const value = (params as Record<string, unknown>)[key]
  if (typeof value === 'undefined') return undefined
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`)
  }
  return value
}

function normalizeSideSessionCwd(
  sideSession: SessionIndexEntry,
  parentSession: SessionIndexEntry
): SessionIndexEntry {
  if (sideSession.cwd === parentSession.cwd) {
    return sideSession
  }
  updateSessionCwd(sideSession.sessionId, parentSession.cwd)
  return { ...sideSession, cwd: parentSession.cwd }
}

function sessionModelPreferenceFromEntry(
  entry: SessionIndexEntry,
  fallback: SessionIndexEntry
): SessionModelPreference {
  const thinkingLevel = entry.sessionThinkingLevel ?? fallback.sessionThinkingLevel
  return {
    sessionId: entry.sessionId,
    modelId: entry.sessionModelId ?? fallback.sessionModelId ?? '',
    thinkingLevel: isPichuThinkingLevel(thinkingLevel)
      ? thinkingLevel
      : DEFAULT_PICHU_THINKING_LEVEL,
    updatedAt: entry.sessionModelUpdatedAt ?? fallback.sessionModelUpdatedAt ?? entry.updatedAt,
    updatedBy: entry.sessionModelUpdatedBy ?? fallback.sessionModelUpdatedBy ?? 'default'
  }
}

export type AgentContextUsageForRenderer = {
  modelId: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  contextWindow: number
  messageId?: string
}

type AgentRuntimeView = {
  sessionId: string
  cwd: string
  agent: Agent
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function payloadSessionId(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  return typeof payload.sessionId === 'string' && payload.sessionId.trim()
    ? payload.sessionId.trim()
    : null
}

function usageTotal(usage: Usage | undefined): number {
  if (!usage) return 0
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite
}

function contextWindowForModel(
  modelId: string | null | undefined,
  fallbackContextWindow = DEFAULT_CONTEXT_WINDOW
): number {
  return effectiveContextWindowForModelId(modelId ?? undefined, fallbackContextWindow)
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function parseStoredUsage(value: string | null | undefined): Usage | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (!isRecord(parsed)) return undefined
    const cost = isRecord(parsed.cost) ? parsed.cost : {}
    return {
      input: numberOrZero(parsed.input),
      output: numberOrZero(parsed.output),
      cacheRead: numberOrZero(parsed.cacheRead),
      cacheWrite: numberOrZero(parsed.cacheWrite),
      totalTokens: numberOrZero(parsed.totalTokens),
      cost: {
        input: numberOrZero(cost.input),
        output: numberOrZero(cost.output),
        cacheRead: numberOrZero(cost.cacheRead),
        cacheWrite: numberOrZero(cost.cacheWrite),
        total: numberOrZero(cost.total)
      }
    }
  } catch {
    return undefined
  }
}

function latestStoredCompactionCreatedAt(rows: ReturnType<typeof getSessionMessages>): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const marker = parseContextCompactionMarker(rows[index].content)
    if (!marker) continue
    return Date.parse(marker.createdAt)
  }
  return NaN
}

function latestAssistantRuntimeUsage(
  runtime: AgentRuntimeView,
  sessionId: string
): AgentContextUsageForRenderer | null {
  const { model } = runtime.agent.state
  const messages = runtime.agent.state.messages as unknown[]
  const compactionCreatedAt = Date.parse(
    getLatestContextCompactionMarker(sessionId)?.createdAt ?? ''
  )
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message)) continue
    if (message.role !== 'assistant' && message.role !== PICHU_ASSISTANT_MESSAGE_ROLE) continue
    if (Number.isFinite(compactionCreatedAt)) {
      const timestamp = typeof message.timestamp === 'number' ? message.timestamp : null
      if (!timestamp || timestamp <= compactionCreatedAt) continue
    }

    const usage = message.usage as Usage | undefined
    const totalTokens = usageTotal(usage)
    if (totalTokens <= 0 || !usage) continue
    const messageModelId =
      typeof message.model === 'string' && message.model.trim() ? message.model : model.id
    const fallbackContextWindow = Number.isFinite(model.contextWindow)
      ? model.contextWindow
      : DEFAULT_CONTEXT_WINDOW

    return {
      modelId: messageModelId,
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      totalTokens,
      contextWindow: contextWindowForModel(messageModelId, fallbackContextWindow),
      messageId: typeof message.id === 'string' ? message.id : undefined
    }
  }

  return null
}

function latestAssistantStoredUsage(sessionId: string): AgentContextUsageForRenderer | null {
  const rows = getSessionMessages(sessionId)
  const rememberedCompactionCreatedAt = Date.parse(
    getLatestContextCompactionMarker(sessionId)?.createdAt ?? ''
  )
  const compactionCreatedAt = Number.isFinite(rememberedCompactionCreatedAt)
    ? rememberedCompactionCreatedAt
    : latestStoredCompactionCreatedAt(rows)
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row.role !== 'assistant') continue
    if (Number.isFinite(compactionCreatedAt)) {
      const timestamp = Date.parse(row.createdAt)
      if (!Number.isFinite(timestamp) || timestamp <= compactionCreatedAt) continue
    }

    const usage = parseStoredUsage(row.modelUsageJson)
    const totalTokens = usageTotal(usage)
    if (!usage || totalTokens <= 0) continue

    const modelId = row.modelId?.trim() || ''
    return {
      modelId,
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      totalTokens,
      contextWindow: contextWindowForModel(modelId),
      messageId: row.id
    }
  }

  return null
}

type AgentIpcContext = {
  getCurrentSessionId: () => string | null
  getCurrentRuntime: () => AgentRuntimeView | null
  getCurrentMainSessionId: () => string | null
  getCurrentMainRuntime: () => AgentRuntimeView | null
  getRuntimeBySession: (sessionId: string) => AgentRuntimeView | null
  getRunningSessionIds: () => string[]
  getWaitingInputIdsBySession: () => Map<string, string>
  getWaitingApprovalIdsBySession: () => Map<string, string>
  getActiveRunIdsBySession: () => Map<string, string>
  getActiveRunStartedAtsBySession: () => Map<string, string>
  getRunStatusBySession: (
    waitingInputIds?: Map<string, string>,
    waitingApprovalIds?: Map<string, string>
  ) => Record<string, AgentSessionRunStatus>
  getAssistantDraft: (sessionId: string) => string
  createSession: (
    cwd: string,
    model?: string,
    thinkingLevel?: PichuThinkingLevel,
    prompt?: string
  ) => Promise<{
    sessionId: string
    cwd: string
    systemPrompt: string
    sessionModel: SessionModelPreference
  }>
  createIndexedSession: (params: {
    cwd: string
    model?: string
    thinkingLevel?: PichuThinkingLevel
    titleHint?: string
    sessionKind?: 'main' | 'side'
    parentSessionId?: string | null
  }) => Promise<{ sessionId: string; sessionModel: SessionModelPreference }>
  resumeAgentSession: (sessionId: string) => Promise<SessionModelPreference>
  persistTextMessage: (
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ) => void
  promptAgent: (payload: {
    sessionId?: string
    text: string
    images?: string[]
    hasImages?: boolean
    parts?: MessagePart[]
  }) => Promise<{
    effectiveModelId: string
    effectiveThinkingLevel: PichuThinkingLevel
    effectiveReason: RunModelUsage['effectiveReason']
  }>
  steerAgent: (payload: {
    sessionId?: string
    text: string
    images?: string[]
    hasImages?: boolean
    expectedRunId?: string
    parts?: MessagePart[]
  }) => Promise<{
    effectiveModelId: string
    effectiveThinkingLevel: PichuThinkingLevel
    effectiveReason: RunModelUsage['effectiveReason']
  }>
  cancelAgentSession: (sessionId?: string) => void
  continueSessionAfterHumanInput: (sessionId: string, requestId?: string) => Promise<void>
  disposeSession: (sessionId?: string) => Promise<void>
  setSessionModel: (params: {
    sessionId: string
    modelId: string
    thinkingLevel: PichuThinkingLevel
  }) => Promise<SessionModelPreference>
  sendHumanInputUpdated: (request: HumanInputRequestForRenderer) => void
}

export function registerAgentIpcHandlers(context: AgentIpcContext): void {
  ipcMain.handle(
    'agent:new-session',
    async (
      _,
      params: {
        cwd?: string
        model?: string
        thinkingLevel?: PichuThinkingLevel
        titleHint?: string
      }
    ) => {
      const resolvedCwd = params.cwd?.trim()
      if (!resolvedCwd) {
        throw new Error('Working directory is required')
      }
      return context.createIndexedSession({
        cwd: resolvedCwd,
        model: params.model,
        thinkingLevel: params.thinkingLevel,
        titleHint: params.titleHint?.trim()
      })
    }
  )

  ipcMain.handle('agent:resume-session', async (_, sessionId: string) => {
    const resolvedSessionId = sessionId?.trim()
    if (!resolvedSessionId) {
      throw new Error('Session id is required')
    }
    const sessionModel = await context.resumeAgentSession(resolvedSessionId)
    return { sessionModel }
  })

  ipcMain.handle('agent:side-session-entry', async (_, params: unknown) => {
    const sessionId = readStringParam(params, 'sessionId')
    const parentSessionId = readStringParam(params, 'parentSessionId')
    if (!sessionId) {
      throw new Error('Side chat session id is required')
    }
    if (!parentSessionId) {
      throw new Error('Parent session id is required')
    }
    const entry = getSessionById(sessionId)
    if (!entry) {
      throw new Error(`Unknown side chat session: ${sessionId}`)
    }
    if (entry.sessionKind !== 'side' || entry.parentSessionId !== parentSessionId) {
      throw new Error(
        `Side chat session ${sessionId} does not belong to parent session ${parentSessionId}.`
      )
    }
    const parentSession = getSessionById(parentSessionId)
    if (!parentSession) {
      throw new Error(`Unknown parent session: ${parentSessionId}`)
    }
    return normalizeSideSessionCwd(entry, parentSession)
  })

  ipcMain.handle('agent:side-session', async (_, params: unknown) => {
    const parentSessionId = readStringParam(params, 'parentSessionId')
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

    const sideSessions = getSideSessionsForParent(parentSessionId)
    const sideSessionCount = sideSessions.length
    const titleHint = sideSessionCount === 0 ? 'Side chat' : `Side chat ${sideSessionCount + 1}`
    const requestedCwd = readStringParam(params, 'cwd')
    if (requestedCwd && requestedCwd !== parentSession.cwd) {
      throw new Error('Side chat cwd must match parent session cwd')
    }
    const forceNew = readBooleanParam(params, 'forceNew') === true
    const sideCwd = parentSession.cwd
    if (!forceNew) {
      const existing = sideSessions[0]
      if (existing) {
        const normalized = normalizeSideSessionCwd(existing, parentSession)
        return {
          sessionId: normalized.sessionId,
          sessionModel: sessionModelPreferenceFromEntry(normalized, parentSession),
          cwd: normalized.cwd,
          reused: true
        }
      }
    }

    const requestedModel = readStringParam(params, 'model')
    const requestedThinkingLevel = readStringParam(params, 'thinkingLevel')
    const created = await context.createIndexedSession({
      cwd: sideCwd,
      model: requestedModel ?? parentSession.sessionModelId ?? undefined,
      thinkingLevel: isPichuThinkingLevel(requestedThinkingLevel)
        ? requestedThinkingLevel
        : (parentSession.sessionThinkingLevel ?? undefined),
      titleHint,
      sessionKind: 'side',
      parentSessionId
    })
    const createdEntry = getSessionById(created.sessionId)
    return {
      ...created,
      cwd: createdEntry?.cwd ?? sideCwd,
      reused: false
    }
  })

  ipcMain.handle('agent:list-skills', () => listSkills())

  ipcMain.handle('agent:read-skill', (_, filePath: unknown) => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('Skill path is required')
    }
    return readSkillContent(filePath)
  })

  ipcMain.handle('agent:open-skill', async (_, filePath: unknown) => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('Skill path is required')
    }
    await readSkillContent(filePath)
    const error = await shell.openPath(filePath)
    if (error) {
      throw new Error(error)
    }
    return { opened: true }
  })

  ipcMain.handle('agent:delete-skill', (_, skillName: string) => deleteSkill(skillName))

  ipcMain.handle('agent:list-models', () => listAvailableModels())

  ipcMain.handle(
    'agent:context-usage',
    (_, sessionId: string): AgentContextUsageForRenderer | null => {
      const resolvedSessionId = sessionId?.trim()
      if (!resolvedSessionId) return null
      const runtime = context.getRuntimeBySession(resolvedSessionId)
      if (runtime) {
        return latestAssistantRuntimeUsage(runtime, resolvedSessionId)
      }
      return latestAssistantStoredUsage(resolvedSessionId)
    }
  )

  ipcMain.handle('agent:usage-stats', () => getUsageStats())

  ipcMain.handle('agent:assistant-draft', (_, sessionId: string): string => {
    const resolvedSessionId = sessionId?.trim()
    if (!resolvedSessionId) return ''
    return context.getAssistantDraft(resolvedSessionId)
  })

  ipcMain.handle('agent:prompt', async (_, payload) => {
    const sessionId = payloadSessionId(payload)
    writeChatDiagnosticEvent({
      event: 'agent_prompt_ipc_received',
      sessionId,
      details: {
        hasText: isRecord(payload) && typeof payload.text === 'string' && payload.text.length > 0,
        textLength: isRecord(payload) && typeof payload.text === 'string' ? payload.text.length : 0,
        hasImages: isRecord(payload) && payload.hasImages === true,
        partCount: isRecord(payload) && Array.isArray(payload.parts) ? payload.parts.length : 0
      }
    })
    try {
      const result = await context.promptAgent(payload)
      writeChatDiagnosticEvent({
        event: 'agent_prompt_ipc_completed',
        sessionId,
        details: {
          effectiveModelId: result.effectiveModelId,
          effectiveThinkingLevel: result.effectiveThinkingLevel,
          effectiveReason: result.effectiveReason ?? null
        }
      })
      return result
    } catch (error) {
      writeChatDiagnosticEvent({
        event: 'agent_prompt_ipc_failed',
        sessionId,
        details: {
          errorName: error instanceof Error ? error.name : 'Error',
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      })
      throw error
    }
  })

  ipcMain.handle('agent:steer', async (_, payload) => context.steerAgent(payload))

  ipcMain.handle('agent:cancel', (_, sessionId?: string) => {
    context.cancelAgentSession(sessionId)
  })

  ipcMain.handle('agent:status', () => {
    const waitingInputIds = context.getWaitingInputIdsBySession()
    const currentMainRuntime = context.getCurrentMainRuntime()
    const waitingApprovalIds = context.getWaitingApprovalIdsBySession()
    return {
      hasSession: Boolean(currentMainRuntime),
      sessionId: context.getCurrentMainSessionId(),
      runningSessionIds: context.getRunningSessionIds(),
      waitingSessionIds: [...new Set([...waitingInputIds.keys(), ...waitingApprovalIds.keys()])],
      activeRunIdsBySession: Object.fromEntries(context.getActiveRunIdsBySession()),
      activeRunStartedAtsBySession: Object.fromEntries(context.getActiveRunStartedAtsBySession()),
      runStatusBySession: context.getRunStatusBySession(waitingInputIds, waitingApprovalIds),
      waitingInputIdBySession: Object.fromEntries(waitingInputIds),
      waitingApprovalIdBySession: Object.fromEntries(waitingApprovalIds),
      modelId: currentMainRuntime?.agent.state.model.id ?? null
    }
  })

  ipcMain.handle('agent:list-human-inputs', (_, sessionId?: string) =>
    listHumanInputRequests(sessionId?.trim() || undefined)
  )

  ipcMain.handle(
    'agent:submit-human-input',
    (_, payload: { requestId: string; value: string | string[] | boolean }) => {
      const requestId = payload.requestId?.trim()
      if (!requestId) {
        throw new Error('Human input request id is required')
      }
      const request = submitHumanInputRequest({ requestId, value: payload.value })
      context.sendHumanInputUpdated(request)
      void context.continueSessionAfterHumanInput(request.sessionId, request.id).catch((error) => {
        console.error('[pi-handler] failed to continue after human input:', error)
      })
      return request
    }
  )

  ipcMain.handle(
    'agent:cancel-human-input',
    (_, payload: { requestId: string; mode?: 'return_cancelled_result' | 'stop_task' }) => {
      const requestId = payload.requestId?.trim()
      if (!requestId) {
        throw new Error('Human input request id is required')
      }
      const request = cancelHumanInputRequest({ requestId, mode: payload.mode })
      context.sendHumanInputUpdated(request)
      void context.continueSessionAfterHumanInput(request.sessionId, request.id).catch((error) => {
        console.error('[pi-handler] failed to continue after human input cancellation:', error)
      })
      return request
    }
  )

  ipcMain.handle(
    'agent:continue-after-human-input',
    (_, payload: { sessionId: string; requestId?: string }) => {
      const sessionId = payload.sessionId?.trim()
      if (!sessionId) {
        throw new Error('Session id is required')
      }
      return context.continueSessionAfterHumanInput(
        sessionId,
        payload.requestId?.trim() || undefined
      )
    }
  )

  ipcMain.handle('agent:dispose', (_, sessionId?: string) => {
    const requestedSessionId = sessionId?.trim()
    const currentSessionId = context.getCurrentSessionId()
    if (requestedSessionId) {
      cancelToolApprovalRequestsForSession(requestedSessionId, 'Session was disposed')
    } else if (currentSessionId) {
      cancelToolApprovalRequestsForSession(currentSessionId, 'Session was disposed')
    }
    return context.disposeSession(requestedSessionId)
  })

  ipcMain.handle(
    'agent:set-session-model',
    async (
      _,
      payload: {
        sessionId?: string
        modelId?: string
        thinkingLevel?: PichuThinkingLevel
      }
    ) => {
      const sessionId = payload.sessionId?.trim()
      const modelId = payload.modelId?.trim()
      if (!sessionId) {
        throw new Error('Session id is required')
      }
      if (!modelId) {
        throw new Error('Session model id is required')
      }
      if (!isPichuThinkingLevel(payload.thinkingLevel)) {
        throw new Error('Session thinking level is required')
      }
      const sessionModel = await context.setSessionModel({
        sessionId,
        modelId,
        thinkingLevel: payload.thinkingLevel
      })
      return { sessionModel }
    }
  )
}
