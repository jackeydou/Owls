import {
  type AfterToolCallContext,
  Agent,
  type AgentEvent,
  type AgentMessage,
  type BeforeToolCallContext,
  type StreamFn
} from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { WebContents } from 'electron'
import {
  normalizeMessageVisibility,
  PICHU_USER_MESSAGE_ROLE
} from '../../shared/agent-message-visibility.js'
import type { MessageAttachment } from '../../shared/attachments.js'
import type { HumanInputRequestForRenderer } from '../../shared/human-input.js'
import type { MessagePart } from '../../shared/message-parts.js'
import {
  DEFAULT_PICHU_THINKING_LEVEL,
  normalizePichuThinkingLevel,
  type PichuThinkingLevel,
  type RunModelUsage,
  type SessionModelPreference
} from '../../shared/model-settings.js'
import {
  shouldStripLeadingThinkClosePrefix,
  stripThinkingTags,
  ThinkingTagFilter,
  type ThinkingTagFilterOptions
} from '../../shared/thinking-tags.js'
import { writeChatDiagnosticEvent } from '../diagnostics.js'
import {
  getHumanInputSuspensionMarkerFromResult,
  type HumanInputSuspensionMarker
} from '../human-input-runtime.js'
import { registerAgentIpcHandlers } from '../ipc-handlers/agent-ipc-handler.js'
import { registerArtifactIpcHandlers } from '../ipc-handlers/artifact-ipc-handler.js'
import { compactContextForSession } from '../ipc-handlers/context-compaction.js'
import { registerMessageIpcHandlers } from '../ipc-handlers/message-ipc-handler.js'
import {
  sendSessionApprovalNotification,
  sendSessionCompleteNotification,
  sendSessionQuestionNotification
} from '../ipc-handlers/permissions-handler.js'
import { registerSessionIpcHandlers } from '../ipc-handlers/session-ipc-handler.js'
import {
  assertWithinDirectory,
  createSessionWorkspace,
  ensureSessionWorkingDirectory,
  listSessionDirectory,
  resolveSessionDirectory,
  resolveSessionRuntimePaths
} from '../ipc-handlers/session-workspace.js'
import { registerSettingsIpcHandlers } from '../ipc-handlers/settings-ipc-handler.js'
import { registerToolApprovalIpcHandlers } from '../ipc-handlers/tool-approval-ipc-handler.js'
import { runAgentHookEvent } from '../plugins/hooks/hook-runner.js'
import { getUsePluginStatusesAsync } from '../plugins/use-plugin-status.js'
import { expandSkillPromptParts } from '../skill-loader.js'
import { getUnresolvedHumanInputRequest } from '../stores/human-input-store.js'
import { getProjectByPath, touchProject } from '../stores/project-store.js'
import {
  addMessages,
  getNextSortOrder,
  getSessionById,
  getSessionMessages,
  getSessionModelPreference,
  getSettingsForRenderer,
  type MessageRow,
  setSessionModelPreference,
  stringifyMessageAttachments,
  updateAgentRunModelUsage
} from '../stores/settings-store.js'
import {
  cancelToolApprovalRequestsForSession,
  setStoredToolApprovalResolutionHandler,
  setToolApprovalEventSender,
  setToolApprovalRunStateHandler,
  shouldResumeRunAfterToolApprovalResolution
} from '../tool-approval-engine.js'
import { createToolsForCwd } from '../tools/index.js'
import { runDetachedSessionPromptFlow } from './detached-prompt-flow.js'
import { AgentEventPersistence } from './event-persistence.js'
import {
  appendHookDeveloperContext,
  hookRunContext,
  latestAssistantMessageText,
  MAX_STOP_HOOK_CONTINUATIONS,
  runAfterToolCallHooks,
  runBeforeToolCallInterceptors,
  runSessionStartHooks
} from './hooks.js'
import { continueSessionAfterHumanInputFlow } from './human-input-continuation.js'
import {
  buildUserAgentMessage,
  isRecord,
  isToolBoundaryEvent,
  rowsToAgentMessages
} from './message-utils.js'
import {
  buildPichuModel,
  convertAgentMessagesToLlm,
  createPichuStreamFn,
  defaultThinkingLevelForModelId,
  type PichuModelConfig,
  resolvePichuImageModelConfig,
  resolvePichuModelConfig
} from './pi-models.js'
import { ensureSessionAndPromptFlow, promptAgentFromIpcFlow } from './prompt-flow.js'
import { finishAgentRunDebug, recordAgentRunEvent, startAgentRunDebug } from './run-debug.js'
import {
  acceptNewSessionPrompt,
  acceptSessionPrompt,
  createAgentSessionIndexed,
  getSessionStatusView,
  type SessionCommandDeps,
  type SessionStatusView
} from './session-commands.js'
import { AgentSessionRunState } from './session-run-state.js'
import { generateAndSaveSessionTitle } from './session-title.js'
import {
  AGENT_CONTEXT_PROMPT_PREFIX,
  buildAgentContextPrompt,
  buildSystemPrompt,
  isSideConversationContextPrompt,
  SIDE_CONVERSATION_CONTEXT_PROMPT
} from './system-prompt.js'
import { continueSessionAfterToolApprovalFlow } from './tool-approval-continuation.js'
import type {
  AgentRunSource,
  DetachedSessionPromptOptions,
  PromptAgentPayload,
  SessionRuntime,
  SteerAgentPayload
} from './types.js'

let getRendererWebContents: () => WebContents | null = () => null
let currentSessionId: string | null = null
let currentMainSessionId: string | null = null
const assistantToolSeenBySession = new Set<string>()
const assistantTextFiltersBySession = new Map<string, ThinkingTagFilter>()
const sessionRunState = new AgentSessionRunState(() => getRendererWebContents())
const eventPersistence = new AgentEventPersistence({
  sessionRunState,
  consumeAssistantTextDelta,
  resetAssistantTextFilter,
  stripThinkingTags: (sessionId, text) =>
    stripThinkingTags(text, thinkingTagFilterOptionsForSession(sessionId))
})
const humanInputSuspensionsBySession = new Map<string, HumanInputSuspensionMarker>()

const persistTextMessage = eventPersistence.persistTextMessage.bind(eventPersistence)
const flushAssistantDraft = eventPersistence.flushAssistantDraft.bind(eventPersistence)
const consumeAssistantFailure = eventPersistence.consumeAssistantFailure.bind(eventPersistence)
const persistToolEventForSession =
  eventPersistence.persistToolEventForSession.bind(eventPersistence)
const captureAssistantModelMetadata =
  eventPersistence.captureAssistantModelMetadata.bind(eventPersistence)

function consumeAssistantTextDelta(sessionId: string, delta: string): string {
  let filter = assistantTextFiltersBySession.get(sessionId)
  if (!filter) {
    filter = new ThinkingTagFilter(streamingThinkingTagFilterOptionsForSession(sessionId))
    assistantTextFiltersBySession.set(sessionId, filter)
  }
  return filter.consume(delta)
}

function thinkingTagFilterOptionsForSession(sessionId: string): ThinkingTagFilterOptions {
  return {
    stripLeadingCloseTagPrefix: shouldStripLeadingThinkClosePrefix(
      currentAssistantModelId(sessionId)
    )
  }
}

function streamingThinkingTagFilterOptionsForSession(sessionId: string): ThinkingTagFilterOptions {
  const options = thinkingTagFilterOptionsForSession(sessionId)
  return {
    ...options,
    stripLeadingCloseTagPrefix:
      options.stripLeadingCloseTagPrefix && !assistantToolSeenBySession.has(sessionId)
  }
}

function currentAssistantModelId(sessionId: string): string | null {
  return eventPersistence.currentAssistantModelId(
    sessionId,
    sessionRuntimes.get(sessionId)?.agent.state.model.id
  )
}

function rememberAssistantModelId(sessionId: string, modelId: string): void {
  eventPersistence.rememberAssistantModelId(sessionId, modelId)
}

function resetAssistantTextFilter(sessionId: string): void {
  assistantTextFiltersBySession.delete(sessionId)
}

function flushAssistantTextFilter(sessionId: string): string {
  const filter = assistantTextFiltersBySession.get(sessionId)
  if (!filter) return ''
  assistantTextFiltersBySession.delete(sessionId)
  return filter.flush()
}

const sessionRuntimes = new Map<string, SessionRuntime>()

function createStreamFn(): StreamFn {
  return createPichuStreamFn()
}

const convertToLlm = convertAgentMessagesToLlm

export function setPiWebContentsGetter(getter: () => WebContents | null): void {
  getRendererWebContents = getter
  const sendToRenderer = (channel: string, payload: unknown): boolean => {
    const webContents = getter()
    if (!webContents || webContents.isDestroyed()) return false
    webContents.send(channel, payload)
    return true
  }
  setToolApprovalEventSender({
    isAvailable: () => {
      const webContents = getter()
      return Boolean(webContents && !webContents.isDestroyed())
    },
    requested: (request) => {
      const sent = sendToRenderer('tool-approval:requested', request)
      if (sent) {
        notifySessionApprovalNeeded(request.sessionId)
      }
      return sent
    },
    resolved: (event) => sendToRenderer('tool-approval:resolved', event),
    autoReviewStarted: (event) => sendToRenderer('tool-approval:auto-review-started', event),
    autoReviewCompleted: (event) => sendToRenderer('tool-approval:auto-review-completed', event)
  })
  setToolApprovalRunStateHandler({
    waiting: (request) => sessionRunState.setWaitingForToolApproval(request.sessionId, request.id),
    resolved: (request, behavior) =>
      sessionRunState.clearWaitingForToolApproval(
        request.sessionId,
        request.id,
        shouldResumeRunAfterToolApprovalResolution(behavior)
      )
  })
  setStoredToolApprovalResolutionHandler((params) =>
    continueSessionAfterToolApprovalFlow(params.request, params.behavior, params.reason, {
      sessionRunState,
      humanInputSuspensionsBySession,
      getCurrentRuntime,
      removeSessionRuntimeForWaiting,
      beginSessionRun,
      forwardEvent,
      sendHumanInputRequested,
      resumeAgentSession,
      getSessionRuntime: (id) => sessionRuntimes.get(id),
      continueQueuedAgentMessages,
      runStopHooksOnce,
      notifySessionComplete,
      flushAssistantDraft
    })
  )
}

function notifySessionComplete(sessionId: string, source: AgentRunSource, title?: string): void {
  const sessionTitle = title ?? getSessionById(sessionId)?.title
  writeChatDiagnosticEvent({
    event: 'agent_session_completed',
    sessionId,
    details: {
      source,
      hasTitle: Boolean(sessionTitle)
    }
  })
  void sendSessionCompleteNotification({
    sessionId,
    source,
    title: sessionTitle
  }).catch((error) => {
    console.error('[pi-handler] failed to send session completion notification:', error)
  })
}

function notifySessionApprovalNeeded(sessionId: string): void {
  void sendSessionApprovalNotification({
    sessionId,
    title: getSessionById(sessionId)?.title
  }).catch((error) => {
    console.error('[pi-handler] failed to send approval notification:', error)
  })
}

function notifySessionQuestionNeeded(sessionId: string): void {
  void sendSessionQuestionNotification({
    sessionId,
    title: getSessionById(sessionId)?.title
  }).catch((error) => {
    console.error('[pi-handler] failed to send question notification:', error)
  })
}

function sendHumanInputRequested(request: HumanInputRequestForRenderer): void {
  getRendererWebContents()?.send('agent:human-input-requested', request)
  notifySessionQuestionNeeded(request.sessionId)
}

function sendHumanInputUpdated(request: HumanInputRequestForRenderer): void {
  getRendererWebContents()?.send('agent:human-input-updated', request)
}

function forwardEvent(sessionId: string, event: AgentEvent): void {
  if (
    event.type === 'tool_execution_end' &&
    getHumanInputSuspensionMarkerFromResult((event as { result?: unknown }).result)
  ) {
    return
  }

  recordAgentRunEvent(sessionId, event)
  eventPersistence.persistAgentEventForSession(sessionId, event)
  if (isToolBoundaryEvent(event)) {
    assistantToolSeenBySession.add(sessionId)
  }
  if (event.type === 'agent_end' || event.type === 'turn_end') {
    assistantToolSeenBySession.delete(sessionId)
  }

  const wc = getRendererWebContents()
  if (!wc) {
    return
  }
  wc.send('agent:event', {
    sessionId,
    modelId: currentAssistantModelId(sessionId),
    event
  })
}

function beginSessionRun(sessionId: string): string {
  humanInputSuspensionsBySession.delete(sessionId)
  eventPersistence.clearAssistantFailure(sessionId)
  return sessionRunState.beginRun(sessionId)
}

function recordRunModelUsage(runId: string, usage: RunModelUsage): void {
  updateAgentRunModelUsage({ runId, usage })
}

function resolveModelConfig(modelId?: string): PichuModelConfig {
  return resolvePichuModelConfig(modelId)
}

function resolveFirstAvailableModelConfig(
  ...modelIds: Array<string | null | undefined>
): PichuModelConfig {
  for (const modelId of modelIds) {
    const trimmed = modelId?.trim()
    if (!trimmed) continue
    try {
      return resolveModelConfig(trimmed)
    } catch {
      console.warn('[agent] unknown session model id; falling back: %s', trimmed)
    }
  }
  return resolveModelConfig(undefined)
}

function thinkingLevelForModel(
  model: Model<Api>,
  level: string | null | undefined = getSettingsForRenderer().thinkingLevel
): PichuThinkingLevel {
  if (!model.reasoning) return 'off'
  return normalizePichuThinkingLevel(level)
}

function contentHasImage(content: unknown): boolean {
  return (
    Array.isArray(content) && content.some((block) => isRecord(block) && block.type === 'image')
  )
}

function agentMessagesHaveImages(messages: AgentMessage[]): boolean {
  return messages.some((message) => {
    if (!isRecord(message)) return false
    return contentHasImage(message.content)
  })
}

function resolvePromptModelForImages(
  sessionId: string,
  currentModel: Model<Api>,
  messages: AgentMessage[],
  images?: string[],
  hasImages?: boolean
): Model<Api> {
  const promptImageCount = images?.length ?? 0
  const promptHasImages = promptImageCount > 0 || hasImages === true
  const contextHasImages = agentMessagesHaveImages(messages)
  if (!promptHasImages && !contextHasImages) {
    return currentModel
  }

  if (currentModel.input?.includes('image')) {
    return currentModel
  }

  const imageModel = buildPichuModel(resolvePichuImageModelConfig())
  if (currentModel.id !== imageModel.id) {
    console.info(
      '[pi-handler] image prompt model fallback session=%s from=%s to=%s images=%d contextHasImages=%s',
      sessionId,
      currentModel.id,
      imageModel.id,
      promptHasImages ? Math.max(promptImageCount, 1) : 0,
      contextHasImages
    )
  }
  return imageModel
}

function buildInitialRuntimeMessages(params: {
  parentSessionId?: string | null
  sideSessionMessages: MessageRow[]
  model: Model<Api>
}): AgentMessage[] {
  const sideMessages = rowsToAgentMessages(params.sideSessionMessages, params.model)
  const parentSessionId = params.parentSessionId?.trim()
  if (!parentSessionId) {
    return sideMessages
  }
  if (
    params.sideSessionMessages.some(
      (row) => row.visibility === 'model-only' && isSideConversationContextPrompt(row.content)
    )
  ) {
    return sideMessages
  }

  const parentMessages = rowsToAgentMessages(getSessionMessages(parentSessionId), params.model)
  if (parentMessages.length === 0) {
    return sideMessages
  }

  return [
    ...parentMessages,
    {
      role: PICHU_USER_MESSAGE_ROLE,
      visibility: 'model-only',
      content: SIDE_CONVERSATION_CONTEXT_PROMPT,
      timestamp: Date.now()
    },
    ...sideMessages
  ]
}

async function persistPromptInputMessages(params: {
  sessionId: string
  cwd: string
  content: string
  agentContent: string
  hookContext?: string[]
  attachments?: MessageAttachment[]
  parts?: MessagePart[]
}): Promise<{ contextRow: MessageRow; userRow: MessageRow }> {
  const createdAt = new Date().toISOString()
  const sortOrder = getNextSortOrder(params.sessionId)
  const contextPrompt = appendHookDeveloperContext(
    await buildAgentContextPrompt({ cwd: params.cwd }),
    params.hookContext ?? []
  )
  const contextRow: MessageRow = {
    id: crypto.randomUUID(),
    sessionId: params.sessionId,
    role: 'user',
    content: contextPrompt,
    agentContent: contextPrompt,
    visibility: 'model-only',
    sortOrder,
    createdAt,
    parts: []
  }
  const userRow: MessageRow = {
    id: crypto.randomUUID(),
    sessionId: params.sessionId,
    role: 'user',
    content: params.content,
    agentContent: params.agentContent,
    visibility: 'shared',
    sortOrder: sortOrder + 1,
    createdAt,
    attachmentsJson: stringifyMessageAttachments(params.attachments),
    parts: params.parts ?? []
  }
  addMessages([contextRow, userRow])
  return { contextRow, userRow }
}

function findLatestStoredRuntimeContextPrompt(sessionId: string): string | undefined {
  const rows = getSessionMessages(sessionId)
  for (let i = rows.length - 1; i > 0; i -= 1) {
    const row = rows[i]
    if (row.role !== 'user') continue
    if (normalizeMessageVisibility(row.visibility, row.role) !== 'shared') continue

    const previous = rows[i - 1]
    if (
      previous.role === 'user' &&
      normalizeMessageVisibility(previous.visibility, previous.role) === 'model-only' &&
      previous.content.startsWith(AGENT_CONTEXT_PROMPT_PREFIX)
    ) {
      return previous.content
    }
    return undefined
  }
  return undefined
}

function getCurrentRuntime(): SessionRuntime | null {
  return currentSessionId ? (sessionRuntimes.get(currentSessionId) ?? null) : null
}

function getCurrentMainRuntime(): SessionRuntime | null {
  return currentMainSessionId ? (sessionRuntimes.get(currentMainSessionId) ?? null) : null
}

async function continueQueuedAgentMessages(agent: Agent, sessionId: string): Promise<void> {
  while (sessionRuntimes.get(sessionId)?.agent === agent && agent.hasQueuedMessages()) {
    await agent.continue()
  }
}

async function runStopHooksOnce(params: { runtime: SessionRuntime }): Promise<void> {
  const continuationCount = params.runtime.stopHookContinuationCount
  const decision = await runAgentHookEvent({
    eventName: 'Stop',
    context: hookRunContext({
      sessionId: params.runtime.sessionId,
      cwd: params.runtime.cwd,
      model: params.runtime.agent.state.model.id
    }),
    extraInput: {
      stop_hook_active: continuationCount > 0,
      stop_hook_continuation_count: continuationCount,
      stop_hook_max_continuations: MAX_STOP_HOOK_CONTINUATIONS,
      last_assistant_message: latestAssistantMessageText(params.runtime.agent)
    }
  })
  if (decision.stopContinueFalse || !decision.stopContinuationMessage) return
  if (params.runtime.stopHookContinuationCount >= MAX_STOP_HOOK_CONTINUATIONS) return

  params.runtime.stopHookContinuationCount += 1
  await params.runtime.agent.prompt([
    {
      role: PICHU_USER_MESSAGE_ROLE,
      visibility: 'model-only',
      content: decision.stopContinuationMessage,
      timestamp: Date.now()
    }
  ])
  if (!humanInputSuspensionsBySession.has(params.runtime.sessionId)) {
    await continueQueuedAgentMessages(params.runtime.agent, params.runtime.sessionId)
  }
}

async function createAgentRuntime(params: {
  sessionId: string
  cwd: string
  cronJobCwd: string
  model: Model<Api>
  thinkingLevel: PichuThinkingLevel
  initialMessages: AgentMessage[]
  parentSessionId?: string | null
  source?: AgentRunSource
  sessionStartSource?: 'startup' | 'resume' | 'clear'
}): Promise<string> {
  const existing = sessionRuntimes.get(params.sessionId)
  if (existing) {
    currentSessionId = params.sessionId
    if (!params.parentSessionId) {
      currentMainSessionId = params.sessionId
    }
    return existing.systemPrompt
  }

  currentSessionId = params.sessionId
  if (!params.parentSessionId) {
    currentMainSessionId = params.sessionId
  }
  const source = params.source ?? 'chat'
  const usePlugins = await getUsePluginStatusesAsync()
  let systemPrompt = await buildSystemPrompt({
    usePlugins,
    source,
    sideConversation: Boolean(params.parentSessionId)
  })
  systemPrompt = appendHookDeveloperContext(
    systemPrompt,
    await runSessionStartHooks({
      sessionId: params.sessionId,
      cwd: params.cwd,
      model: params.model.id,
      source: params.sessionStartSource ?? 'startup',
      signal: sessionRunState.activeRunSignal(params.sessionId)
    })
  )
  let agentRef: Agent | null = null
  const agent = new Agent({
    sessionId: params.sessionId,
    streamFn: createStreamFn(),
    convertToLlm,
    transformContext: async (messages, signal) => {
      const compacted = await compactContextForSession({
        sessionId: params.sessionId,
        messages,
        model: agentRef?.state.model ?? params.model,
        signal,
        getRendererWebContents,
        persistTextMessage
      })
      if (compacted !== messages && agentRef) {
        agentRef.state.messages = compacted
      }
      return compacted
    },
    beforeToolCall: (context: BeforeToolCallContext, signal?: AbortSignal) =>
      runBeforeToolCallInterceptors({
        sessionId: params.sessionId,
        cwd: params.cwd,
        model: agentRef?.state.model.id ?? params.model.id,
        source: params.source ?? 'chat',
        context,
        signal
      }),
    afterToolCall: (context: AfterToolCallContext, signal?: AbortSignal) =>
      runAfterToolCallHooks({
        sessionId: params.sessionId,
        cwd: params.cwd,
        model: agentRef?.state.model.id ?? params.model.id,
        context,
        signal
      }),
    initialState: {
      model: params.model,
      systemPrompt,
      thinkingLevel: thinkingLevelForModel(params.model, params.thinkingLevel),
      tools: await createToolsForCwd(params.cwd, params.cronJobCwd, {
        getFallbackModelId: () => agentRef?.state.model.id,
        getCurrentSessionId: () => params.sessionId,
        getCurrentRunId: () => sessionRunState.activeRunId(params.sessionId),
        includeCronJobTool: params.source !== 'automation',
        source: params.source ?? 'chat',
        interactive: params.source !== 'automation',
        onHumanInputSuspended: (marker) => {
          humanInputSuspensionsBySession.set(params.sessionId, marker)
        },
        onHumanInputRequestCreated: sendHumanInputRequested
      }),
      messages: params.initialMessages
    }
  })
  agentRef = agent

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    forwardEvent(params.sessionId, event)
  })
  sessionRuntimes.set(params.sessionId, {
    sessionId: params.sessionId,
    cwd: params.cwd,
    agent,
    unsubscribe,
    systemPrompt,
    stopHookContinuationCount: 0
  })

  return systemPrompt
}

async function createSession(
  cwd: string,
  model?: string,
  thinkingLevel?: PichuThinkingLevel,
  prompt?: string,
  options: {
    parentSessionId?: string | null
    reuseCwd?: boolean
  } = {}
): Promise<{
  sessionId: string
  cwd: string
  systemPrompt: string
  sessionModel: SessionModelPreference
}> {
  const project = getProjectByPath(cwd)
  const parentSessionId = options.parentSessionId?.trim() || null
  const workspace = options.reuseCwd
    ? {
        sessionId: crypto.randomUUID(),
        sessionCwd: cwd,
        cronJobCwd: project?.path ?? cwd
      }
    : project
      ? {
          sessionId: crypto.randomUUID(),
          sessionCwd: ensureSessionWorkingDirectory(project.path),
          cronJobCwd: project.path
        }
      : createSessionWorkspace(cwd, prompt)
  const modelConfig = resolveModelConfig(model)
  const resolvedModel = buildPichuModel(modelConfig)
  const sessionThinkingLevel = normalizePichuThinkingLevel(
    thinkingLevel,
    defaultThinkingLevelForModelId(resolvedModel.id) ?? DEFAULT_PICHU_THINKING_LEVEL
  )
  const sessionModel: SessionModelPreference = {
    sessionId: workspace.sessionId,
    modelId: resolvedModel.id,
    thinkingLevel: sessionThinkingLevel,
    updatedAt: new Date().toISOString(),
    updatedBy: 'default'
  }

  const systemPrompt = await createAgentRuntime({
    sessionId: workspace.sessionId,
    cwd: workspace.sessionCwd,
    cronJobCwd: workspace.cronJobCwd,
    model: resolvedModel,
    thinkingLevel: sessionThinkingLevel,
    initialMessages: buildInitialRuntimeMessages({
      parentSessionId,
      sideSessionMessages: [],
      model: resolvedModel
    }),
    parentSessionId,
    source: 'chat',
    sessionStartSource: 'startup'
  })
  if (project) {
    touchProject(project.path)
  }

  return {
    sessionId: workspace.sessionId,
    cwd: workspace.sessionCwd,
    systemPrompt,
    sessionModel
  }
}

async function resumeAgentSession(sessionId: string): Promise<SessionModelPreference> {
  const existingRuntime = sessionRuntimes.get(sessionId)
  if (existingRuntime) {
    currentSessionId = sessionId
    const existingEntry = getSessionById(sessionId)
    if (existingEntry?.sessionKind !== 'side') {
      currentMainSessionId = sessionId
    }
    return getSessionModelPreference(sessionId)
  }

  const entry = getSessionById(sessionId)
  if (!entry) {
    throw new Error(`Unknown session: ${sessionId}`)
  }
  const { sessionCwd, cronJobCwd } = resolveSessionRuntimePaths(entry.cwd, sessionId)

  const rows = getSessionMessages(sessionId)
  const sessionModel = getSessionModelPreference(sessionId)
  const settingsModel = getSettingsForRenderer().model?.trim()
  const modelConfig = resolveFirstAvailableModelConfig(sessionModel.modelId, settingsModel)
  const resolvedSessionModel =
    modelConfig.id === sessionModel.modelId
      ? sessionModel
      : setSessionModelPreference({
          sessionId,
          modelId: modelConfig.id,
          thinkingLevel: sessionModel.thinkingLevel,
          updatedBy: 'migration'
        })
  const resolvedModel = buildPichuModel(modelConfig)
  const initialMessages = buildInitialRuntimeMessages({
    parentSessionId: entry.sessionKind === 'side' ? entry.parentSessionId : null,
    sideSessionMessages: rows,
    model: resolvedModel
  })

  await createAgentRuntime({
    sessionId,
    cwd: sessionCwd,
    cronJobCwd,
    model: resolvedModel,
    thinkingLevel: resolvedSessionModel.thinkingLevel,
    initialMessages,
    parentSessionId: entry.sessionKind === 'side' ? entry.parentSessionId : null,
    source: entry.agentId.startsWith('automation:') ? 'automation' : 'chat',
    sessionStartSource: 'resume'
  })
  const unresolvedHumanInput = getUnresolvedHumanInputRequest(sessionId)
  if (unresolvedHumanInput) {
    sessionRunState.markWaiting(sessionId, unresolvedHumanInput.id)
  }
  return resolvedSessionModel
}

async function continueSessionAfterHumanInput(
  sessionId: string,
  requestId?: string
): Promise<void> {
  await continueSessionAfterHumanInputFlow(sessionId, requestId, {
    sessionRunState,
    humanInputSuspensionsBySession,
    getCurrentRuntime,
    removeSessionRuntimeForWaiting,
    beginSessionRun,
    forwardEvent,
    sendHumanInputRequested,
    sendHumanInputUpdated,
    resumeAgentSession,
    getSessionRuntime: (id) => sessionRuntimes.get(id),
    continueQueuedAgentMessages,
    runStopHooksOnce,
    notifySessionComplete,
    flushAssistantDraft,
    consumeAssistantFailure
  })
}

async function disposeSessionRuntime(sessionId: string, force = false): Promise<void> {
  if (sessionRunState.isRunning(sessionId) && !force) {
    throw new Error('Agent response is still running. Stop it before closing this session.')
  }

  const runtime = sessionRuntimes.get(sessionId)
  sessionRunState.abortActiveRun(sessionId, 'Session was disposed')
  runtime?.unsubscribe()
  runtime?.agent.abort()
  runtime?.agent.reset()
  sessionRuntimes.delete(sessionId)
  sessionRunState.clearSession(sessionId)
  humanInputSuspensionsBySession.delete(sessionId)
  flushAssistantDraft(sessionId)
  eventPersistence.clearAssistantModelMetadata(sessionId)
  if (force) {
    sessionRunState.finishRun(sessionId, 'cancelled')
  }
  if (currentSessionId === sessionId) {
    currentSessionId = null
  }
  if (currentMainSessionId === sessionId) {
    currentMainSessionId = null
  }
}

function removeSessionRuntimeForWaiting(sessionId: string): void {
  const runtime = sessionRuntimes.get(sessionId)
  runtime?.unsubscribe()
  runtime?.agent.abort()
  runtime?.agent.reset()
  sessionRuntimes.delete(sessionId)
  flushAssistantDraft(sessionId)
  if (currentSessionId === sessionId) {
    currentSessionId = null
  }
  if (currentMainSessionId === sessionId) {
    currentMainSessionId = null
  }
}

async function disposeCurrentSession(force = false): Promise<void> {
  if (!currentSessionId) return
  await disposeSessionRuntime(currentSessionId, force)
}

export function getActiveAgentState(): {
  agent: Agent | null
  sessionId: string | null
} {
  return { agent: getCurrentRuntime()?.agent ?? null, sessionId: currentSessionId }
}

export function getRunningAgentSessionIds(): string[] {
  return sessionRunState.runningSessionIds()
}

export async function ensureSessionAndPrompt(
  text: string,
  cwd?: string
): Promise<{ sessionId: string }> {
  return ensureSessionAndPromptFlow(text, cwd, {
    sessionRunState,
    humanInputSuspensionsBySession,
    getCurrentSessionId: () => currentSessionId,
    getCurrentRuntime,
    createSession,
    persistTextMessage,
    beginSessionRun,
    persistPromptInputMessages,
    recordRunModelUsage,
    continueQueuedAgentMessages,
    runStopHooksOnce,
    removeSessionRuntimeForWaiting,
    flushAssistantDraft,
    consumeAssistantFailure,
    notifySessionComplete
  })
}

export async function runDetachedSessionPrompt(
  text: string,
  cwd?: string,
  options?: DetachedSessionPromptOptions
): Promise<{ sessionId: string }> {
  return runDetachedSessionPromptFlow(text, cwd, options, {
    sessionRunState,
    humanInputSuspensionsBySession,
    createStreamFn,
    convertToLlm,
    getRendererWebContents,
    persistTextMessage,
    persistPromptInputMessages,
    getCurrentRuntime,
    beginSessionRun,
    captureAssistantModelMetadata,
    persistToolEventForSession,
    consumeAssistantTextDelta,
    flushAssistantTextFilter,
    resetAssistantTextFilter,
    rememberAssistantModelId,
    thinkingLevelForModel,
    runStopHooksOnce,
    flushAssistantDraft,
    setAssistantDraft: (sessionId, assistantText) =>
      eventPersistence.setAssistantDraft(sessionId, assistantText),
    notifySessionComplete,
    sendHumanInputRequested
  })
}

export function disposeAgent(): void {
  for (const sessionId of [...sessionRuntimes.keys()]) {
    void disposeSessionRuntime(sessionId, true)
  }
}

async function promptAgentFromIpc(payload: PromptAgentPayload): Promise<{
  effectiveModelId: string
  effectiveThinkingLevel: PichuThinkingLevel
  effectiveReason: RunModelUsage['effectiveReason']
}> {
  return promptAgentFromIpcFlow(payload, {
    sessionRunState,
    humanInputSuspensionsBySession,
    getCurrentSessionId: () => currentSessionId,
    setCurrentSessionId: (sessionId) => {
      currentSessionId = sessionId
    },
    getCurrentRuntime,
    createSession,
    persistTextMessage,
    beginSessionRun,
    persistPromptInputMessages,
    continueQueuedAgentMessages,
    runStopHooksOnce,
    removeSessionRuntimeForWaiting,
    flushAssistantDraft,
    consumeAssistantFailure,
    notifySessionComplete,
    hasSessionRuntime: (sessionId) => sessionRuntimes.has(sessionId),
    getSessionRuntime: (sessionId) => sessionRuntimes.get(sessionId),
    resumeAgentSession,
    resolvePromptModelForImages,
    rememberAssistantModelId,
    recordRunModelUsage,
    startAgentRunDebug,
    finishAgentRunDebug,
    findLatestStoredRuntimeContextPrompt
  })
}

async function steerAgentFromIpc(payload: SteerAgentPayload): Promise<{
  effectiveModelId: string
  effectiveThinkingLevel: PichuThinkingLevel
  effectiveReason: RunModelUsage['effectiveReason']
}> {
  const requestedSessionId = payload.sessionId?.trim() || currentSessionId
  if (!requestedSessionId) {
    throw new Error('No active session — create one first')
  }
  const runtime = sessionRuntimes.get(requestedSessionId)
  if (!runtime || !sessionRunState.isRunning(requestedSessionId)) {
    throw new Error('No active agent response to steer')
  }
  const activeRunId = sessionRunState.activeRunId(requestedSessionId)
  const expectedRunId = payload.expectedRunId?.trim()
  if (!expectedRunId) {
    throw new Error('Expected active run id is required')
  }
  if (!activeRunId || activeRunId !== expectedRunId) {
    throw new Error(
      `Expected active run id \`${expectedRunId}\` but found \`${activeRunId ?? 'none'}\``
    )
  }
  const effectiveModelId = runtime.agent.state.model.id
  const effectiveThinkingLevel = normalizePichuThinkingLevel(runtime.agent.state.thinkingLevel)

  const expandedText = await expandSkillPromptParts(payload.text?.trim() ?? '', payload.parts, {
    cwd: runtime.cwd
  })
  if (!expandedText.trim()) {
    throw new Error('Prompt text is required')
  }

  runtime.agent.steer(buildUserAgentMessage(expandedText, payload.images))
  return { effectiveModelId, effectiveThinkingLevel, effectiveReason: 'normal' }
}

function cancelAgentSessionFromIpc(sessionId?: string): void {
  const requestedSessionId = sessionId?.trim() || currentSessionId
  if (!requestedSessionId) return

  cancelToolApprovalRequestsForSession(requestedSessionId, 'Session was cancelled')
  sessionRunState.abortActiveRun(requestedSessionId, 'Session was cancelled')
  sessionRuntimes.get(requestedSessionId)?.agent.abort()
  flushAssistantDraft(requestedSessionId)
  sessionRunState.finishRun(requestedSessionId, 'cancelled')
}

async function setSessionModelFromIpc(params: {
  sessionId: string
  modelId: string
  thinkingLevel: PichuThinkingLevel
}): Promise<SessionModelPreference> {
  const sessionId = params.sessionId.trim()
  if (!sessionId) {
    throw new Error('Session id is required')
  }
  const config = resolveModelConfig(params.modelId)
  const model = buildPichuModel(config)
  const sessionModel = setSessionModelPreference({
    sessionId,
    modelId: model.id,
    thinkingLevel: normalizePichuThinkingLevel(params.thinkingLevel),
    updatedBy: 'user'
  })
  const runtime = sessionRuntimes.get(sessionId)
  if (runtime) {
    runtime.agent.state.model = model
    runtime.agent.state.thinkingLevel = thinkingLevelForModel(model, sessionModel.thinkingLevel)
  }
  return sessionModel
}

export type AgentStatusSnapshot = {
  hasSession: boolean
  sessionId: string | null
  runningSessionIds: string[]
  waitingSessionIds: string[]
  activeRunIdsBySession: Record<string, string>
  activeRunStartedAtsBySession: Record<string, string>
  runStatusBySession: Record<
    string,
    'idle' | 'running' | 'waiting_for_user' | 'waiting_for_approval'
  >
  waitingInputIdBySession: Record<string, string>
  waitingApprovalIdBySession: Record<string, string>
  modelId: string | null
}

export function getAgentStatusSnapshot(): AgentStatusSnapshot {
  const waitingInputIds = sessionRunState.waitingInputIds()
  const currentMainRuntime = getCurrentMainRuntime()
  const waitingApprovalIds = sessionRunState.waitingApprovalIds()
  return {
    hasSession: Boolean(currentMainRuntime),
    sessionId: currentMainSessionId,
    runningSessionIds: sessionRunState.runningSessionIds(),
    waitingSessionIds: [...new Set([...waitingInputIds.keys(), ...waitingApprovalIds.keys()])],
    activeRunIdsBySession: Object.fromEntries(sessionRunState.activeRunIds()),
    activeRunStartedAtsBySession: Object.fromEntries(sessionRunState.activeRunStartedAts()),
    runStatusBySession: sessionRunState.runStatusBySession(waitingInputIds, waitingApprovalIds),
    waitingInputIdBySession: Object.fromEntries(waitingInputIds),
    waitingApprovalIdBySession: Object.fromEntries(waitingApprovalIds),
    modelId: currentMainRuntime?.agent.state.model.id ?? null
  }
}

function assertSessionCanAcceptPrompt(sessionId: string): void {
  if (sessionRunState.isRunning(sessionId)) {
    throw new Error(
      'Agent response is already running for this session. Stop it before sending another prompt.'
    )
  }
  if (
    sessionRunState.isWaiting(sessionId, sessionRunState.waitingApprovalIds()) ||
    getUnresolvedHumanInputRequest(sessionId)
  ) {
    throw new Error('Resolve the pending input request before sending another prompt.')
  }
}

function getSessionCommandDeps(): SessionCommandDeps {
  return {
    createSession,
    persistTextMessage,
    persistPromptInputMessages,
    promptAgent: promptAgentFromIpc,
    generateSessionTitle: generateAndSaveSessionTitle,
    assertCanAcceptPrompt: assertSessionCanAcceptPrompt
  }
}

export async function localRpcAcceptNewSessionPrompt(params: {
  prompt: string
  cwd?: string
  model?: string
  thinkingLevel?: PichuThinkingLevel
  skills?: string[]
}): Promise<{ accepted: true; sessionId: string }> {
  return acceptNewSessionPrompt(getSessionCommandDeps(), params)
}

export function localRpcAcceptSessionPrompt(params: { sessionId: string; prompt: string }): {
  accepted: true
  sessionId: string
} {
  return acceptSessionPrompt(getSessionCommandDeps(), params)
}

export function localRpcGetSessionStatus(requestedSessionId?: string): SessionStatusView {
  return getSessionStatusView(getAgentStatusSnapshot(), requestedSessionId)
}

export type { SessionStatusView }

export function registerPiIpc(): void {
  registerSettingsIpcHandlers()
  registerToolApprovalIpcHandlers()
  registerAgentIpcHandlers({
    getCurrentSessionId: () => currentSessionId,
    getCurrentRuntime,
    getCurrentMainSessionId: () => currentMainSessionId,
    getCurrentMainRuntime,
    getRuntimeBySession: (sessionId) => sessionRuntimes.get(sessionId) ?? null,
    getRunningSessionIds: () => sessionRunState.runningSessionIds(),
    getWaitingInputIdsBySession: () => sessionRunState.waitingInputIds(),
    getWaitingApprovalIdsBySession: () => sessionRunState.waitingApprovalIds(),
    getActiveRunIdsBySession: () => sessionRunState.activeRunIds(),
    getActiveRunStartedAtsBySession: () => sessionRunState.activeRunStartedAts(),
    getRunStatusBySession: (waitingInputIds) => sessionRunState.runStatusBySession(waitingInputIds),
    getAssistantDraft: (sessionId) => eventPersistence.currentAssistantDraft(sessionId),
    createSession,
    createIndexedSession: (params) => createAgentSessionIndexed(getSessionCommandDeps(), params),
    resumeAgentSession,
    persistTextMessage,
    promptAgent: promptAgentFromIpc,
    steerAgent: steerAgentFromIpc,
    cancelAgentSession: cancelAgentSessionFromIpc,
    continueSessionAfterHumanInput,
    disposeSession: (sessionId) =>
      sessionId ? disposeSessionRuntime(sessionId) : disposeCurrentSession(),
    setSessionModel: setSessionModelFromIpc,
    sendHumanInputUpdated
  })

  registerSessionIpcHandlers({
    hasSessionRuntime: (sessionId) => sessionRuntimes.has(sessionId),
    disposeSessionRuntime,
    resolveSessionDirectory,
    listSessionDirectory,
    assertWithinDirectory,
    generateAndSaveSessionTitle
  })
  registerMessageIpcHandlers({
    persistPromptInputMessages
  })
  registerArtifactIpcHandlers()
}
