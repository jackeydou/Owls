import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core'
import type { HumanInputRequestForRenderer } from '../../shared/human-input.js'
import type { SessionModelPreference } from '../../shared/model-settings.js'
import type { HumanInputSuspensionMarker } from '../human-input-runtime.js'
import { resolveSessionRuntimePaths } from '../ipc-handlers/session-workspace.js'
import { listHumanInputRequests } from '../stores/human-input-store.js'
import {
  getSessionById,
  getSessionMessages,
  getSessionModelPreference,
  type MessageRow
} from '../stores/settings-store.js'
import {
  findToolApprovalMetadata,
  findToolHookIdentity,
  type ToolHookIdentity
} from '../tool-approval-metadata.js'
import { createToolsForCwd } from '../tools/index.js'
import {
  applyPreToolUpdatedInput,
  hookRunContext,
  runPostToolUseHooks,
  runPreToolUseHooks,
  runToolApprovalGate
} from './hooks.js'
import { isRecord } from './message-utils.js'
import { buildPichuModel, resolvePichuModelConfig } from './pi-models.js'
import type { AgentSessionRunState } from './session-run-state.js'
import type { AgentRunFinishStatus, AgentRunSource, SessionRuntime } from './types.js'

type ContinueSessionAfterHumanInputDeps = {
  sessionRunState: AgentSessionRunState
  humanInputSuspensionsBySession: Map<string, HumanInputSuspensionMarker>
  getCurrentRuntime: () => SessionRuntime | null
  removeSessionRuntimeForWaiting: (sessionId: string) => void
  beginSessionRun: (sessionId: string) => string
  forwardEvent: (sessionId: string, event: AgentEvent) => void
  sendHumanInputRequested: (request: HumanInputRequestForRenderer) => void
  sendHumanInputUpdated: (request: HumanInputRequestForRenderer) => void
  resumeAgentSession: (sessionId: string) => Promise<SessionModelPreference>
  getSessionRuntime: (sessionId: string) => SessionRuntime | undefined
  continueQueuedAgentMessages: (agent: Agent, sessionId: string) => Promise<void>
  runStopHooksOnce: (params: { runtime: SessionRuntime }) => Promise<void>
  notifySessionComplete: (sessionId: string, source: AgentRunSource) => void
  flushAssistantDraft: (sessionId: string) => void
  consumeAssistantFailure: (sessionId: string) => string | null
}

function findContinuableHumanInputToolRow(
  sessionId: string,
  requestId?: string
): {
  request: HumanInputRequestForRenderer
  row: MessageRow & { toolCallId: string }
  args: Record<string, unknown>
} {
  const request = listHumanInputRequests(sessionId).find(
    (candidate) =>
      (requestId ? candidate.id === requestId : true) &&
      (candidate.status === 'submitted' || candidate.status === 'cancelled')
  )
  if (!request) {
    throw new Error('No submitted or cancelled human input request is ready to continue.')
  }

  const row = getSessionMessages(sessionId).find(
    (message) =>
      message.role === 'tool' &&
      message.toolCallId === request.toolCallId &&
      message.toolCallResult == null
  )
  if (!row?.toolCallId) {
    throw new Error('The human input tool call is no longer waiting for a result.')
  }

  try {
    const parsed = JSON.parse(row.content) as unknown
    const args = isRecord(parsed) && isRecord(parsed.arguments) ? parsed.arguments : {}
    return { request, row: row as MessageRow & { toolCallId: string }, args }
  } catch {
    throw new Error('The human input tool call arguments are invalid.')
  }
}

export async function continueSessionAfterHumanInputFlow(
  sessionId: string,
  requestId: string | undefined,
  deps: ContinueSessionAfterHumanInputDeps
): Promise<void> {
  const entry = getSessionById(sessionId)
  if (!entry) {
    throw new Error(`Unknown session: ${sessionId}`)
  }

  deps.removeSessionRuntimeForWaiting(sessionId)
  const { sessionCwd, cronJobCwd } = resolveSessionRuntimePaths(entry.cwd, sessionId)
  const { request, row, args } = findContinuableHumanInputToolRow(sessionId, requestId)
  const toolCallId = row.toolCallId
  const sessionModelId = getSessionModelPreference(sessionId).modelId
  const modelIdForApproval = (() => {
    try {
      return resolvePichuModelConfig(sessionModelId).id
    } catch {
      return resolvePichuModelConfig().id
    }
  })()
  const source = entry.agentId.startsWith('automation:') ? 'automation' : 'chat'
  const tools = await createToolsForCwd(sessionCwd, cronJobCwd, {
    getFallbackModelId: () => deps.getCurrentRuntime()?.agent.state.model.id,
    getCurrentSessionId: () => sessionId,
    getCurrentRunId: () => deps.sessionRunState.activeRunId(sessionId),
    includeCronJobTool: source !== 'automation',
    source,
    interactive: source !== 'automation',
    onHumanInputSuspended: (marker) => {
      deps.humanInputSuspensionsBySession.set(sessionId, marker)
    },
    onHumanInputRequestCreated: deps.sendHumanInputRequested
  })
  const tool = tools.find((candidate) => candidate.name === request.toolName)
  if (!tool) {
    throw new Error(`Tool is not available for human input continuation: ${request.toolName}`)
  }

  deps.beginSessionRun(sessionId)
  const abortController = new AbortController()
  let runStatus: AgentRunFinishStatus = 'completed'
  let runError: unknown
  try {
    deps.forwardEvent(sessionId, {
      type: 'tool_execution_start',
      toolCallId,
      toolName: request.toolName,
      args
    } as AgentEvent)

    let result: unknown
    let isError = false
    let postToolHookIdentity: ToolHookIdentity | null = null
    let postToolInput: unknown = args
    let toolExecutionStarted = false
    try {
      const hookIdentity = findToolHookIdentity(tools, request.toolName)
      postToolHookIdentity = hookIdentity
      const preTool = await runPreToolUseHooks({
        context: hookRunContext({
          sessionId,
          cwd: sessionCwd,
          model: modelIdForApproval,
          signal: abortController.signal
        }),
        toolName: hookIdentity.toolName,
        matcherValues: hookIdentity.matcherValues,
        toolUseId: toolCallId,
        toolInput: args,
        signal: abortController.signal
      })
      const toolInput = applyPreToolUpdatedInput(args, preTool?.updatedInput)
      const approval =
        preTool?.block || toolInput.block
          ? undefined
          : await runToolApprovalGate({
              sessionId,
              cwd: sessionCwd,
              model: modelIdForApproval,
              source,
              toolUseId: toolCallId,
              toolInput: toolInput.value,
              approval: findToolApprovalMetadata(tools, request.toolName),
              preToolPermissionDecision: preTool?.permissionDecision,
              approvalUi: preTool?.approvalUi,
              hookIdentity,
              signal: abortController.signal
            })
      if (preTool?.block || toolInput.block || approval?.block) {
        isError = true
        result = {
          content: [
            {
              type: 'text',
              text:
                preTool?.reason ??
                (toolInput.block ? toolInput.reason : undefined) ??
                approval?.reason ??
                'Tool execution was blocked'
            }
          ],
          details: {}
        }
      } else {
        postToolInput = toolInput.value
        toolExecutionStarted = true
        result = await tool.execute(toolCallId, toolInput.value, abortController.signal)
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
          sessionId,
          cwd: sessionCwd,
          model: modelIdForApproval,
          signal: abortController.signal
        }),
        toolName: postToolHookIdentity.toolName,
        matcherValues: postToolHookIdentity.matcherValues,
        toolUseId: toolCallId,
        toolInput: postToolInput,
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

    deps.forwardEvent(sessionId, {
      type: 'tool_execution_end',
      toolCallId,
      toolName: request.toolName,
      result,
      isError
    } as AgentEvent)
    const resolvedRequest = listHumanInputRequests(sessionId).find(
      (candidate) => candidate.id === request.id
    )
    if (resolvedRequest) {
      deps.sendHumanInputUpdated(resolvedRequest)
    }

    const sessionModel = await deps.resumeAgentSession(sessionId)
    const runtime = deps.getSessionRuntime(sessionId)
    if (!runtime) {
      throw new Error('Failed to recreate session runtime after human input.')
    }
    runtime.agent.state.model = buildPichuModel(resolvePichuModelConfig(sessionModel.modelId))
    await runtime.agent.continue()
    const assistantFailure = deps.consumeAssistantFailure(sessionId)
    if (assistantFailure) {
      runStatus = 'failed'
      runError = new Error(assistantFailure)
      return
    }
    await deps.continueQueuedAgentMessages(runtime.agent, sessionId)
    if (!deps.humanInputSuspensionsBySession.has(sessionId)) {
      await deps.runStopHooksOnce({ runtime })
      deps.notifySessionComplete(sessionId, 'chat')
    }
  } catch (error) {
    runStatus = 'failed'
    runError = error
    throw error
  } finally {
    abortController.abort()
    const suspension = deps.humanInputSuspensionsBySession.get(sessionId)
    if (suspension) {
      deps.sessionRunState.finishRun(sessionId, runStatus, runError)
      deps.removeSessionRuntimeForWaiting(sessionId)
      deps.sessionRunState.setWaitingForHumanInput(suspension)
    } else {
      deps.flushAssistantDraft(sessionId)
      deps.sessionRunState.finishRun(sessionId, runStatus, runError)
    }
  }
}
