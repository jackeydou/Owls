import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import type {
  PichuThinkingLevel,
  RunModelUsage,
  SessionModelPreference
} from '../../shared/model-settings.js'
import { normalizePichuThinkingLevel } from '../../shared/model-settings.js'
import { writeChatDiagnosticEvent } from '../diagnostics.js'
import type { HumanInputSuspensionMarker } from '../human-input-runtime.js'
import { expandSkillPromptParts } from '../skill-loader.js'
import { getUnresolvedHumanInputRequest } from '../stores/human-input-store.js'
import {
  addSessionToIndex,
  getSettingsForRenderer,
  type MessageRow
} from '../stores/settings-store.js'
import { appendHookDeveloperContext, runUserPromptSubmitHooks } from './hooks.js'
import { buildPromptAgentMessages } from './message-utils.js'
import type { AgentSessionRunState } from './session-run-state.js'
import { deriveSessionTitle } from './session-title.js'
import { buildAgentContextPrompt } from './system-prompt.js'
import type {
  AgentRunFinishStatus,
  AgentRunSource,
  PromptAgentPayload,
  SessionRuntime
} from './types.js'

type RunPromptTurnDeps = {
  sessionRunState: AgentSessionRunState
  humanInputSuspensionsBySession: Map<string, HumanInputSuspensionMarker>
  continueQueuedAgentMessages: (agent: Agent, sessionId: string) => Promise<void>
  runStopHooksOnce: (params: { runtime: SessionRuntime }) => Promise<void>
  removeSessionRuntimeForWaiting: (sessionId: string) => void
  flushAssistantDraft: (sessionId: string) => void
  consumeAssistantFailure: (sessionId: string) => string | null
  notifySessionComplete: (sessionId: string, source: AgentRunSource) => void
  recordRunModelUsage: (runId: string, usage: RunModelUsage) => void
}

type PromptFlowDeps = RunPromptTurnDeps & {
  getCurrentSessionId: () => string | null
  getCurrentRuntime: () => SessionRuntime | null
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
  persistTextMessage: (
    sessionId: string,
    role: 'system' | 'user' | 'assistant',
    content: string
  ) => void
  beginSessionRun: (sessionId: string) => string
  persistPromptInputMessages: (params: {
    sessionId: string
    cwd: string
    content: string
    agentContent: string
    hookContext: string[]
  }) => Promise<{ contextRow: MessageRow }>
}

type PromptAgentFromIpcDeps = PromptFlowDeps & {
  setCurrentSessionId: (sessionId: string) => void
  hasSessionRuntime: (sessionId: string) => boolean
  getSessionRuntime: (sessionId: string) => SessionRuntime | undefined
  resumeAgentSession: (sessionId: string) => Promise<SessionModelPreference>
  resolvePromptModelForImages: (
    sessionId: string,
    previousModel: Model<Api>,
    messages: AgentMessage[],
    images?: string[],
    hasImages?: boolean
  ) => Model<Api>
  rememberAssistantModelId: (sessionId: string, modelId: string) => void
  recordRunModelUsage: (runId: string, usage: RunModelUsage) => void
  startAgentRunDebug: (
    sessionId: string,
    modelId: string,
    promptLength: number,
    imageCount: number
  ) => void
  finishAgentRunDebug: (sessionId: string, result: 'success' | 'error', error?: unknown) => void
  findLatestStoredRuntimeContextPrompt: (sessionId: string) => string | undefined
}

export async function runPromptTurn(params: {
  sessionId: string
  runtime: SessionRuntime
  modelId: string
  turnId: string
  promptForHooks: string
  source: AgentRunSource
  prepareMessages: (hookContext: string[]) => Promise<AgentMessage[]> | AgentMessage[]
  notifyOnComplete?: boolean
  onError?: (error: unknown) => void
  onFinally?: (state: { suspension: HumanInputSuspensionMarker | undefined }) => void
  deps: RunPromptTurnDeps
}): Promise<void> {
  let runStatus: AgentRunFinishStatus = 'completed'
  let promptError: unknown
  try {
    writeChatDiagnosticEvent({
      event: 'agent_hooks_started',
      sessionId: params.sessionId,
      runId: params.turnId,
      details: {
        source: params.source,
        modelId: params.modelId,
        promptLength: params.promptForHooks.length
      }
    })
    const hookContext = await runUserPromptSubmitHooks({
      sessionId: params.sessionId,
      cwd: params.runtime.cwd,
      model: params.modelId,
      turnId: params.turnId,
      prompt: params.promptForHooks,
      signal: params.deps.sessionRunState.activeRunSignal(params.sessionId)
    })
    writeChatDiagnosticEvent({
      event: 'agent_hooks_completed',
      sessionId: params.sessionId,
      runId: params.turnId,
      details: {
        hookContextCount: hookContext.length
      }
    })
    await params.runtime.agent.prompt(await params.prepareMessages(hookContext))
    const assistantFailure = params.deps.consumeAssistantFailure(params.sessionId)
    if (assistantFailure) {
      runStatus = 'failed'
      promptError = new Error(assistantFailure)
      writeChatDiagnosticEvent({
        event: 'agent_prompt_model_failed',
        sessionId: params.sessionId,
        runId: params.turnId,
        details: {
          errorMessage: assistantFailure
        }
      })
      return
    }
    writeChatDiagnosticEvent({
      event: 'agent_prompt_returned',
      sessionId: params.sessionId,
      runId: params.turnId
    })
    if (!params.deps.humanInputSuspensionsBySession.has(params.sessionId)) {
      await params.deps.continueQueuedAgentMessages(params.runtime.agent, params.sessionId)
      await params.deps.runStopHooksOnce({ runtime: params.runtime })
      if (params.notifyOnComplete ?? true) {
        params.deps.notifySessionComplete(params.sessionId, params.source)
      }
    }
  } catch (error) {
    runStatus = 'failed'
    promptError = error
    writeChatDiagnosticEvent({
      event: 'agent_prompt_failed',
      sessionId: params.sessionId,
      runId: params.turnId,
      details: {
        errorName: error instanceof Error ? error.name : 'Error',
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    })
    params.onError?.(error)
    throw error
  } finally {
    const suspension = params.deps.humanInputSuspensionsBySession.get(params.sessionId)
    if (suspension) {
      writeChatDiagnosticEvent({
        event: 'agent_waiting_for_human_input',
        sessionId: params.sessionId,
        runId: params.turnId,
        details: {
          requestId: suspension.requestId
        }
      })
      params.deps.sessionRunState.finishRun(params.sessionId, runStatus, promptError)
      params.deps.removeSessionRuntimeForWaiting(params.sessionId)
    } else {
      params.deps.flushAssistantDraft(params.sessionId)
    }
    params.onFinally?.({ suspension })
    if (suspension) {
      params.deps.sessionRunState.setWaitingForHumanInput(suspension)
    } else {
      params.deps.sessionRunState.finishRun(params.sessionId, runStatus, promptError)
    }
  }
}

export async function ensureSessionAndPromptFlow(
  text: string,
  cwd: string | undefined,
  deps: PromptFlowDeps
): Promise<{ sessionId: string }> {
  if (!deps.getCurrentRuntime()) {
    const resolvedCwd = cwd || getSettingsForRenderer().workingDirectory
    const {
      sessionId,
      cwd: sessionCwd,
      systemPrompt,
      sessionModel
    } = await deps.createSession(resolvedCwd, undefined, undefined, text.trim())
    const now = new Date().toISOString()
    addSessionToIndex({
      sessionId,
      agentId: 'pi-agent',
      cwd: sessionCwd,
      title: deriveSessionTitle(text.trim()),
      createdAt: now,
      updatedAt: now,
      sessionModelId: sessionModel.modelId,
      sessionThinkingLevel: sessionModel.thinkingLevel,
      sessionModelUpdatedAt: sessionModel.updatedAt,
      sessionModelUpdatedBy: sessionModel.updatedBy
    })
    deps.persistTextMessage(sessionId, 'system', systemPrompt)
  }
  const runtime = deps.getCurrentRuntime()
  const sid = deps.getCurrentSessionId()
  if (!runtime || !sid) {
    throw new Error('Failed to create agent session')
  }
  if (deps.sessionRunState.isRunning(sid)) {
    throw new Error('Agent response is already running for this session.')
  }

  const expandedText = await expandSkillPromptParts(text, undefined, { cwd: runtime.cwd })
  const turnId = deps.beginSessionRun(sid)
  deps.recordRunModelUsage(turnId, {
    requestedModelId: runtime.agent.state.model.id,
    requestedThinkingLevel: normalizePichuThinkingLevel(runtime.agent.state.thinkingLevel),
    effectiveModelId: runtime.agent.state.model.id,
    effectiveThinkingLevel: normalizePichuThinkingLevel(runtime.agent.state.thinkingLevel),
    effectiveReason: 'normal'
  })
  await runPromptTurn({
    sessionId: sid,
    runtime,
    modelId: runtime.agent.state.model.id,
    turnId,
    promptForHooks: expandedText,
    source: 'chat',
    notifyOnComplete: false,
    prepareMessages: async (hookContext) => {
      const { contextRow } = await deps.persistPromptInputMessages({
        sessionId: sid,
        cwd: runtime.cwd,
        content: text,
        agentContent: expandedText,
        hookContext
      })
      return buildPromptAgentMessages(expandedText, undefined, contextRow.content)
    },
    deps
  })
  if (!deps.humanInputSuspensionsBySession.has(sid)) {
    deps.notifySessionComplete(sid, 'chat')
  }
  return { sessionId: sid }
}

export async function promptAgentFromIpcFlow(
  payload: PromptAgentPayload,
  deps: PromptAgentFromIpcDeps
): Promise<{
  effectiveModelId: string
  effectiveThinkingLevel: PichuThinkingLevel
  effectiveReason: RunModelUsage['effectiveReason']
}> {
  const requestedSessionId = payload.sessionId?.trim() || deps.getCurrentSessionId()
  if (!requestedSessionId) {
    throw new Error('No active session — create one first')
  }
  writeChatDiagnosticEvent({
    event: 'agent_prompt_flow_started',
    sessionId: requestedSessionId,
    details: {
      textLength: payload.text.length,
      hasImages: payload.hasImages === true,
      imageCount: payload.images?.length ?? 0,
      partCount: payload.parts?.length ?? 0
    }
  })

  if (deps.sessionRunState.isRunning(requestedSessionId)) {
    throw new Error(
      'Agent response is already running for this session. Stop it before sending another prompt.'
    )
  }

  const waitingApprovalIds = deps.sessionRunState.waitingApprovalIds()
  if (
    deps.sessionRunState.isWaiting(requestedSessionId, waitingApprovalIds) ||
    getUnresolvedHumanInputRequest(requestedSessionId)
  ) {
    throw new Error('Resolve the pending input request before sending another prompt.')
  }

  if (!deps.hasSessionRuntime(requestedSessionId)) {
    await deps.resumeAgentSession(requestedSessionId)
    writeChatDiagnosticEvent({
      event: 'agent_session_resumed',
      sessionId: requestedSessionId
    })
  } else {
    deps.setCurrentSessionId(requestedSessionId)
  }

  const runtime = deps.getSessionRuntime(requestedSessionId)
  if (!runtime) {
    throw new Error('No active session — create one first')
  }
  writeChatDiagnosticEvent({
    event: 'agent_runtime_resolved',
    sessionId: requestedSessionId,
    details: {
      cwdSet: Boolean(runtime.cwd.trim())
    }
  })

  const expandedText = await expandSkillPromptParts(payload.text, payload.parts, {
    cwd: runtime.cwd
  })
  const previousModel = runtime.agent.state.model
  const previousThinkingLevel = normalizePichuThinkingLevel(runtime.agent.state.thinkingLevel)
  const promptModel = deps.resolvePromptModelForImages(
    requestedSessionId,
    previousModel,
    runtime.agent.state.messages,
    payload.images,
    payload.hasImages
  )
  const effectiveModelId = promptModel.id
  const effectiveThinkingLevel = promptModel.reasoning ? previousThinkingLevel : 'off'
  const effectiveReason = promptModel.id === previousModel.id ? 'normal' : 'image-fallback'
  runtime.agent.state.model = promptModel
  runtime.agent.state.thinkingLevel = effectiveThinkingLevel
  const turnId = deps.beginSessionRun(requestedSessionId)
  writeChatDiagnosticEvent({
    event: 'agent_run_started',
    sessionId: requestedSessionId,
    runId: turnId,
    details: {
      requestedModelId: previousModel.id,
      effectiveModelId,
      effectiveThinkingLevel,
      effectiveReason
    }
  })
  deps.rememberAssistantModelId(requestedSessionId, effectiveModelId)
  deps.recordRunModelUsage(turnId, {
    requestedModelId: previousModel.id,
    requestedThinkingLevel: previousThinkingLevel,
    effectiveModelId,
    effectiveThinkingLevel,
    effectiveReason
  })
  deps.startAgentRunDebug(
    requestedSessionId,
    effectiveModelId,
    expandedText.length,
    payload.hasImages ? Math.max(payload.images?.length ?? 0, 1) : (payload.images?.length ?? 0)
  )
  let result: 'success' | 'error' = 'success'
  let promptError: unknown
  await runPromptTurn({
    sessionId: requestedSessionId,
    runtime,
    modelId: effectiveModelId,
    turnId,
    promptForHooks: expandedText,
    source: 'chat',
    prepareMessages: async (hookContext) => {
      const messages = buildPromptMessagesWithHookContext({
        text: expandedText,
        images: payload.images,
        baseContext:
          deps.findLatestStoredRuntimeContextPrompt(requestedSessionId) ??
          (await buildAgentContextPrompt({ cwd: runtime.cwd })),
        hookContext
      })
      writeChatDiagnosticEvent({
        event: 'agent_prompt_messages_prepared',
        sessionId: requestedSessionId,
        runId: turnId,
        details: {
          messageCount: messages.length,
          hookContextCount: hookContext.length
        }
      })
      return messages
    },
    onError: (error) => {
      result = 'error'
      promptError = error
    },
    onFinally: () => {
      deps.finishAgentRunDebug(requestedSessionId, result, promptError)
      runtime.agent.state.model = previousModel
      runtime.agent.state.thinkingLevel = previousThinkingLevel
    },
    deps
  })
  return { effectiveModelId, effectiveThinkingLevel, effectiveReason }
}

export function buildPromptMessagesWithHookContext(params: {
  text: string
  images?: string[]
  baseContext: string
  hookContext: string[]
}): AgentMessage[] {
  return buildPromptAgentMessages(
    params.text,
    params.images,
    appendHookDeveloperContext(params.baseContext, params.hookContext)
  )
}
