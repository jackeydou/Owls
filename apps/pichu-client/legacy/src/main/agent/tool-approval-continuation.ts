import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core'
import type { HumanInputRequestForRenderer } from '../../shared/human-input.js'
import type {
  ToolApprovalRequestForRenderer,
  ToolApprovalResolveBehavior
} from '../../shared/tool-approval.js'
import type { HumanInputSuspensionMarker } from '../human-input-runtime.js'
import { resolveSessionRuntimePaths } from '../ipc-handlers/session-workspace.js'
import {
  getSessionById,
  getSessionMessages,
  getSessionModelPreference,
  type MessageRow
} from '../stores/settings-store.js'
import { findToolHookIdentity, type ToolHookIdentity } from '../tool-approval-metadata.js'
import { createToolsForCwd } from '../tools/index.js'
import { registerPichuBashSandboxEscalationForApproval } from '../tools/pichu-bash-sandbox.js'
import { hookRunContext, runPostToolUseHooks } from './hooks.js'
import { isRecord } from './message-utils.js'
import { buildPichuModel, resolvePichuModelConfig } from './pi-models.js'
import type { AgentSessionRunState } from './session-run-state.js'
import type { AgentRunFinishStatus, AgentRunSource, SessionRuntime } from './types.js'

type ContinueSessionAfterToolApprovalDeps = {
  sessionRunState: AgentSessionRunState
  humanInputSuspensionsBySession: Map<string, HumanInputSuspensionMarker>
  getCurrentRuntime: () => SessionRuntime | null
  removeSessionRuntimeForWaiting: (sessionId: string) => void
  beginSessionRun: (sessionId: string) => string
  forwardEvent: (sessionId: string, event: AgentEvent) => void
  sendHumanInputRequested: (request: HumanInputRequestForRenderer) => void
  resumeAgentSession: (sessionId: string) => Promise<{ modelId: string }>
  getSessionRuntime: (sessionId: string) => SessionRuntime | undefined
  continueQueuedAgentMessages: (agent: Agent, sessionId: string) => Promise<void>
  runStopHooksOnce: (params: { runtime: SessionRuntime }) => Promise<void>
  notifySessionComplete: (sessionId: string, source: AgentRunSource) => void
  flushAssistantDraft: (sessionId: string) => void
}

function findContinuableToolApprovalRow(request: ToolApprovalRequestForRenderer): {
  row: MessageRow & { toolCallId: string }
} {
  const row = getSessionMessages(request.sessionId).find(
    (message) =>
      message.role === 'tool' &&
      message.toolCallId === request.toolUseId &&
      message.toolCallResult == null
  )
  if (!row?.toolCallId) {
    throw new Error('The approved tool call is no longer waiting for a result.')
  }

  return { row: row as MessageRow & { toolCallId: string } }
}

function deniedToolResult(request: ToolApprovalRequestForRenderer, reason?: string): unknown {
  return {
    content: [
      {
        type: 'text',
        text: reason ?? `Tool ${request.toolName} was denied by the user.`
      }
    ],
    details: {}
  }
}

function modelConfigOrDefault(
  modelId: string | undefined
): ReturnType<typeof resolvePichuModelConfig> {
  try {
    return resolvePichuModelConfig(modelId)
  } catch {
    return resolvePichuModelConfig()
  }
}

export async function continueSessionAfterToolApprovalFlow(
  request: ToolApprovalRequestForRenderer,
  behavior: ToolApprovalResolveBehavior,
  reason: string | undefined,
  deps: ContinueSessionAfterToolApprovalDeps
): Promise<void> {
  const entry = getSessionById(request.sessionId)
  if (!entry) {
    throw new Error(`Unknown session: ${request.sessionId}`)
  }

  deps.removeSessionRuntimeForWaiting(request.sessionId)
  const { sessionCwd, cronJobCwd } = resolveSessionRuntimePaths(entry.cwd, request.sessionId)
  const { row } = findContinuableToolApprovalRow(request)
  const args = request.toolInput
  const toolCallId = row.toolCallId
  const sessionModelId = getSessionModelPreference(request.sessionId).modelId
  const modelIdForHooks = (() => {
    try {
      return resolvePichuModelConfig(sessionModelId).id
    } catch {
      return resolvePichuModelConfig().id
    }
  })()
  const source = entry.agentId.startsWith('automation:') ? 'automation' : 'chat'
  const tools = await createToolsForCwd(sessionCwd, cronJobCwd, {
    getFallbackModelId: () => deps.getCurrentRuntime()?.agent.state.model.id,
    getCurrentSessionId: () => request.sessionId,
    getCurrentRunId: () => deps.sessionRunState.activeRunId(request.sessionId),
    includeCronJobTool: source !== 'automation',
    source,
    interactive: source !== 'automation',
    onHumanInputSuspended: (marker) => {
      deps.humanInputSuspensionsBySession.set(request.sessionId, marker)
    },
    onHumanInputRequestCreated: deps.sendHumanInputRequested
  })
  const tool = tools.find((candidate) => candidate.name === request.toolName)
  if (!tool) {
    throw new Error(`Tool is not available for approval continuation: ${request.toolName}`)
  }

  deps.beginSessionRun(request.sessionId)
  const abortController = new AbortController()
  const activeRunSignal = deps.sessionRunState.activeRunSignal(request.sessionId)
  const abortFromActiveRun = (): void => {
    abortController.abort(activeRunSignal?.reason ?? new Error('Session run was cancelled.'))
  }
  if (activeRunSignal?.aborted) {
    abortFromActiveRun()
  } else {
    activeRunSignal?.addEventListener('abort', abortFromActiveRun, { once: true })
  }
  let runStatus: AgentRunFinishStatus = 'completed'
  let runError: unknown
  try {
    deps.forwardEvent(request.sessionId, {
      type: 'tool_execution_start',
      toolCallId,
      toolName: request.toolName,
      args
    } as AgentEvent)

    let result: unknown
    let isError = false
    let postToolHookIdentity: ToolHookIdentity | null = null
    let toolExecutionStarted = false
    try {
      if (behavior === 'deny') {
        isError = true
        result = deniedToolResult(request, reason)
      } else {
        postToolHookIdentity = findToolHookIdentity(tools, request.toolName)
        registerPichuBashSandboxEscalationForApproval(request)
        toolExecutionStarted = true
        result = await tool.execute(toolCallId, args, abortController.signal)
      }
    } catch (error) {
      isError = true
      result = {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        details: {}
      }
    }
    if (postToolHookIdentity && toolExecutionStarted) {
      const postTool = await runPostToolUseHooks({
        context: hookRunContext({
          sessionId: request.sessionId,
          cwd: sessionCwd,
          model: modelIdForHooks,
          signal: abortController.signal
        }),
        toolName: postToolHookIdentity.toolName,
        matcherValues: postToolHookIdentity.matcherValues,
        toolUseId: toolCallId,
        toolInput: args,
        toolResponse: result,
        isError,
        signal: abortController.signal
      })
      if (postTool) {
        const currentResult = isRecord(result) ? result : {}
        result = {
          ...currentResult,
          content: postTool.content ?? currentResult.content,
          details: postTool.details ?? currentResult.details,
          terminate: postTool.terminate ?? currentResult.terminate
        }
        isError = postTool.isError ?? isError
      }
    }

    deps.forwardEvent(request.sessionId, {
      type: 'tool_execution_end',
      toolCallId,
      toolName: request.toolName,
      result,
      isError
    } as AgentEvent)

    const sessionModel = await deps.resumeAgentSession(request.sessionId)
    const runtime = deps.getSessionRuntime(request.sessionId)
    if (!runtime) {
      throw new Error('Failed to recreate session runtime after tool approval.')
    }
    runtime.agent.state.model = buildPichuModel(modelConfigOrDefault(sessionModel.modelId))
    await runtime.agent.continue()
    await deps.continueQueuedAgentMessages(runtime.agent, request.sessionId)
    if (!deps.humanInputSuspensionsBySession.has(request.sessionId)) {
      await deps.runStopHooksOnce({ runtime })
      deps.notifySessionComplete(request.sessionId, source)
    }
  } catch (error) {
    runStatus = 'failed'
    runError = error
    throw error
  } finally {
    activeRunSignal?.removeEventListener('abort', abortFromActiveRun)
    abortController.abort()
    const suspension = deps.humanInputSuspensionsBySession.get(request.sessionId)
    if (suspension) {
      deps.sessionRunState.finishRun(request.sessionId, runStatus, runError)
      deps.removeSessionRuntimeForWaiting(request.sessionId)
      deps.sessionRunState.setWaitingForHumanInput(suspension)
    } else {
      deps.flushAssistantDraft(request.sessionId)
      deps.sessionRunState.finishRun(request.sessionId, runStatus, runError)
    }
  }
}
