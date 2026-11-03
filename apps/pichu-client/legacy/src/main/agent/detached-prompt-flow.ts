import {
  type AfterToolCallContext,
  Agent,
  type AgentEvent,
  type AgentMessage,
  type BeforeToolCallContext,
  type StreamFn
} from '@earendil-works/pi-agent-core'
import type { Api, Message, Model } from '@earendil-works/pi-ai'
import type { WebContents } from 'electron'
import type { HumanInputRequestForRenderer } from '../../shared/human-input.js'
import type { PichuThinkingLevel } from '../../shared/model-settings.js'
import type { HumanInputSuspensionMarker } from '../human-input-runtime.js'
import { compactContextForSession } from '../ipc-handlers/context-compaction.js'
import { createSessionWorkspace } from '../ipc-handlers/session-workspace.js'
import { getUsePluginStatusesAsync } from '../plugins/use-plugin-status.js'
import {
  addSessionToIndex,
  getSettingsForRenderer,
  type MessageRow
} from '../stores/settings-store.js'
import { createToolsForCwd } from '../tools/index.js'
import {
  appendHookDeveloperContext,
  runAfterToolCallHooks,
  runBeforeToolCallInterceptors,
  runSessionStartHooks,
  runUserPromptSubmitHooks
} from './hooks.js'
import { buildPromptAgentMessages, extractAssistantTextDelta } from './message-utils.js'
import { buildPichuModel, type PichuModelConfig, resolvePichuModelConfig } from './pi-models.js'
import type { AgentSessionRunState } from './session-run-state.js'
import { deriveSessionTitle } from './session-title.js'
import { buildSystemPrompt } from './system-prompt.js'
import type {
  AgentRunFinishStatus,
  AgentRunSource,
  DetachedSessionPromptOptions,
  SessionRuntime
} from './types.js'

type DetachedPromptDeps = {
  sessionRunState: AgentSessionRunState
  humanInputSuspensionsBySession: Map<string, HumanInputSuspensionMarker>
  createStreamFn: () => StreamFn
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>
  getRendererWebContents: () => WebContents | null
  persistTextMessage: (
    sessionId: string,
    role: 'system' | 'user' | 'assistant',
    text: string
  ) => void
  persistPromptInputMessages: (params: {
    sessionId: string
    cwd: string
    content: string
    agentContent: string
    hookContext: string[]
  }) => Promise<{ contextRow: MessageRow }>
  getCurrentRuntime: () => SessionRuntime | null
  beginSessionRun: (sessionId: string) => string
  captureAssistantModelMetadata: (sessionId: string, event: AgentEvent) => void
  persistToolEventForSession: (sessionId: string, event: AgentEvent) => void
  consumeAssistantTextDelta: (sessionId: string, delta: string) => string
  flushAssistantTextFilter: (sessionId: string) => string
  resetAssistantTextFilter: (sessionId: string) => void
  rememberAssistantModelId: (sessionId: string, modelId: string) => void
  thinkingLevelForModel: (model: Model<Api>) => PichuThinkingLevel
  runStopHooksOnce: (params: { runtime: SessionRuntime }) => Promise<void>
  flushAssistantDraft: (sessionId: string) => void
  setAssistantDraft: (sessionId: string, text: string) => void
  notifySessionComplete: (sessionId: string, source: AgentRunSource, title?: string) => void
  sendHumanInputRequested: (request: HumanInputRequestForRenderer) => void
}

export async function runDetachedSessionPromptFlow(
  text: string,
  cwd: string | undefined,
  options: DetachedSessionPromptOptions | undefined,
  deps: DetachedPromptDeps
): Promise<{ sessionId: string }> {
  const trimmedText = text.trim()
  if (!trimmedText) {
    throw new Error('Prompt text is required')
  }

  const resolvedCwd = cwd || getSettingsForRenderer().workingDirectory
  const workspace = createSessionWorkspace(resolvedCwd, options?.title?.trim() || trimmedText)
  const sessionId = workspace.sessionId
  const now = new Date().toISOString()
  const modelConfig: PichuModelConfig = resolvePichuModelConfig()
  const resolvedModel = buildPichuModel(modelConfig)
  const source =
    options?.source ?? (options?.agentId?.startsWith('automation:') ? 'automation' : 'chat')
  let assistantText = ''

  addSessionToIndex({
    sessionId: workspace.sessionId,
    agentId: options?.agentId ?? 'pi-agent',
    cwd: workspace.sessionCwd,
    title: options?.title?.trim() || deriveSessionTitle(trimmedText),
    createdAt: now,
    updatedAt: now
  })
  options?.onSessionCreated?.(workspace.sessionId)

  const usePlugins = await getUsePluginStatusesAsync()
  let systemPrompt = await buildSystemPrompt({ usePlugins, source })
  systemPrompt = appendHookDeveloperContext(
    systemPrompt,
    await runSessionStartHooks({
      sessionId,
      cwd: workspace.sessionCwd,
      model: resolvedModel.id,
      source: 'startup'
    })
  )
  const turnId = deps.beginSessionRun(sessionId)
  let runStatus: AgentRunFinishStatus = 'completed'
  let runError: unknown
  let hookContext: string[]
  try {
    hookContext = await runUserPromptSubmitHooks({
      sessionId,
      cwd: workspace.sessionCwd,
      model: resolvedModel.id,
      turnId,
      prompt: trimmedText,
      signal: deps.sessionRunState.activeRunSignal(sessionId)
    })
  } catch (error) {
    runStatus = 'failed'
    runError = error
    deps.sessionRunState.finishRun(sessionId, runStatus, runError)
    throw error
  }
  deps.persistTextMessage(sessionId, 'system', systemPrompt)
  const { contextRow } = await deps.persistPromptInputMessages({
    sessionId,
    cwd: workspace.sessionCwd,
    content: trimmedText,
    agentContent: trimmedText,
    hookContext
  })
  const agent = new Agent({
    sessionId,
    streamFn: deps.createStreamFn(),
    convertToLlm: deps.convertToLlm,
    transformContext: async (messages, signal) => {
      const compacted = await compactContextForSession({
        sessionId,
        messages,
        model: resolvedModel,
        signal,
        getRendererWebContents: deps.getRendererWebContents,
        persistTextMessage: deps.persistTextMessage
      })
      if (compacted !== messages) {
        agent.state.messages = compacted
      }
      return compacted
    },
    beforeToolCall: (context: BeforeToolCallContext, signal?: AbortSignal) =>
      runBeforeToolCallInterceptors({
        sessionId,
        cwd: workspace.sessionCwd,
        model: agent.state.model.id,
        source,
        context,
        signal
      }),
    afterToolCall: (context: AfterToolCallContext, signal?: AbortSignal) =>
      runAfterToolCallHooks({
        sessionId,
        cwd: workspace.sessionCwd,
        model: agent.state.model.id,
        context,
        signal
      }),
    initialState: {
      model: resolvedModel,
      systemPrompt,
      thinkingLevel: deps.thinkingLevelForModel(resolvedModel),
      tools: await createToolsForCwd(workspace.sessionCwd, workspace.cronJobCwd, {
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
      }),
      messages: []
    }
  })

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    deps.captureAssistantModelMetadata(sessionId, event)
    deps.persistToolEventForSession(sessionId, event)
    const delta = extractAssistantTextDelta(event)
    if (delta) {
      assistantText += deps.consumeAssistantTextDelta(sessionId, delta)
    }
  })

  deps.rememberAssistantModelId(sessionId, resolvedModel.id)
  const detachedRuntime: SessionRuntime = {
    sessionId,
    cwd: workspace.sessionCwd,
    agent,
    unsubscribe,
    systemPrompt,
    stopHookContinuationCount: 0
  }

  try {
    await agent.prompt(buildPromptAgentMessages(trimmedText, undefined, contextRow.content))
    assistantText += deps.flushAssistantTextFilter(sessionId)
    if (!deps.humanInputSuspensionsBySession.has(sessionId)) {
      await deps.runStopHooksOnce({ runtime: detachedRuntime })
    }
    if (assistantText) {
      deps.setAssistantDraft(sessionId, assistantText)
    }
    deps.flushAssistantDraft(sessionId)
    if (!deps.humanInputSuspensionsBySession.has(sessionId)) {
      deps.notifySessionComplete(sessionId, source, options?.title)
    }
    return { sessionId }
  } catch (error) {
    runStatus = 'failed'
    runError = error
    throw error
  } finally {
    unsubscribe()
    agent.abort()
    agent.reset()
    deps.resetAssistantTextFilter(sessionId)
    const suspension = deps.humanInputSuspensionsBySession.get(sessionId)
    if (suspension) {
      deps.sessionRunState.finishRun(sessionId, runStatus, runError)
      deps.sessionRunState.setWaitingForHumanInput(suspension)
    } else {
      deps.sessionRunState.finishRun(sessionId, runStatus, runError)
    }
  }
}
