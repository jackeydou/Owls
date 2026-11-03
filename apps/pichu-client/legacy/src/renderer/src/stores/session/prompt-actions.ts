import type { MessageAttachment, MessageRow } from '../../../../preload/index.d'
import type { ChatDiagnosticDetails, ChatDiagnosticEventName } from '../../../../shared/diagnostics'
import { partsToDisplayText, partsToModelText } from '../../../../shared/message-parts'
import { useEmbeddedBrowserStore } from '../embedded-browser-store'
import { useSettingsStore } from '../settings-store'
import {
  commitStreamingAssistant,
  rememberAssistantModelId,
  runStartTimesBySession,
  runToolCountsBySession,
  suppressAssistantCompletion
} from './assistant-flow'
import { buildAgentPrompt, hasImageAttachments, hasPromptOnlyParts } from './attachments'
import { appendAssistantFailureMessage, appendUserMessage } from './message-writes'
import { systemMessagesFromRows } from './messages'
import { popNextQueuedPrompt, queuePrompt } from './prompt-queue'
import { clearSessionFailed, markSessionFailed, setSessionRunning } from './session-status'
import { generateSessionTitleSoon } from './session-title'
import type {
  PromptRunOptions,
  RetryPrompt,
  SessionIndexEntry,
  SessionState,
  SessionStoreGet,
  SessionStoreSet
} from './types'

type PromptActions = Pick<
  SessionState,
  | 'sendPrompt'
  | 'retryLastFailedPrompt'
  | 'steerPrompt'
  | 'steerQueuedPrompt'
  | 'steerQueuedPrompts'
  | 'removeQueuedPrompt'
  | 'reorderQueuedPrompts'
  | 'cancel'
>

function requireModelId(modelId: string | null | undefined): string {
  const normalized = modelId?.trim()
  if (!normalized) {
    throw new Error('Unable to resolve the active model for this agent request.')
  }
  return normalized
}

function recordChatDiagnosticEvent(
  event: ChatDiagnosticEventName,
  sessionId?: string | null,
  details?: ChatDiagnosticDetails
): void {
  void window.api.diagnostics.recordChatEvent({ event, sessionId, details }).catch(console.error)
}

export function createPromptActions({
  get,
  set,
  onSessionTitleUpdated
}: {
  get: SessionStoreGet
  set: SessionStoreSet
  onSessionTitleUpdated?: (sessionId: string, title: string) => void
}): PromptActions {
  return {
    sendPrompt: async (
      text: string,
      cwd: string,
      attachments?: MessageAttachment[],
      options?: PromptRunOptions
    ) => {
      const trimmed = text.trim()
      const displayText = trimmed || partsToDisplayText(options?.parts ?? [])
      const agentText = (
        options?.agentText ??
        (trimmed || partsToModelText(options?.parts ?? []))
      ).trim()
      const normalizedAttachments = attachments && attachments.length > 0 ? attachments : undefined
      if (!agentText && !normalizedAttachments && !hasPromptOnlyParts(options?.parts)) return

      if (get().busy) {
        queuePrompt(displayText, cwd, normalizedAttachments, set, agentText, options?.parts)
        const queuedSessionId = get().sessionId
        recordChatDiagnosticEvent('renderer_send_queued', queuedSessionId, {
          messageLength: displayText.length,
          agentTextLength: agentText.length,
          attachmentCount: normalizedAttachments?.length ?? 0,
          partCount: options?.parts?.length ?? 0
        })
        return
      }

      const retryPrompt: RetryPrompt = {
        text: displayText,
        agentText,
        parts: options?.parts,
        cwd,
        attachments: normalizedAttachments
      }

      set({
        busy: true,
        lastError: null,
        streamingThinking: false,
        setupStatus: null,
        pendingReconnectStatus: null,
        retryPrompt
      })
      let sid = get().sessionId
      let runModelId: string | null = null
      const promptMode: 'new' | 'continue' = sid ? 'continue' : 'new'
      const now = new Date().toISOString()
      try {
        recordChatDiagnosticEvent('renderer_send_started', sid, {
          mode: promptMode,
          messageLength: displayText.length,
          agentTextLength: agentText.length,
          attachmentCount: normalizedAttachments?.length ?? 0,
          partCount: options?.parts?.length ?? 0
        })
        if (!sid) {
          const settings = useSettingsStore.getState()
          const selectedModel = settings.model.trim() || undefined
          const newSession = await window.api.agent.newSession(
            cwd.trim() || undefined,
            selectedModel,
            settings.thinkingLevel,
            displayText
          )
          sid = newSession.sessionId
          runModelId = requireModelId(newSession.sessionModel.modelId)
          recordChatDiagnosticEvent('renderer_new_session_created', sid, {
            modelId: runModelId,
            thinkingLevel: newSession.sessionModel.thinkingLevel
          })
          const persistedRows = (await window.api.messages.list(sid)) as MessageRow[]
          useEmbeddedBrowserStore.getState().migrateDraftToSession(sid)
          const newEntry: SessionIndexEntry = {
            sessionId: sid,
            agentId: 'pi-agent',
            cwd: cwd.trim(),
            title: 'New chat',
            createdAt: now,
            updatedAt: now,
            sessionModelId: newSession.sessionModel.modelId,
            sessionThinkingLevel: newSession.sessionModel.thinkingLevel,
            sessionModelUpdatedAt: newSession.sessionModel.updatedAt,
            sessionModelUpdatedBy: newSession.sessionModel.updatedBy
          }

          set((state) => ({
            sessionId: sid,
            activeSessionModel: newSession.sessionModel,
            messages: systemMessagesFromRows(persistedRows),
            streamingAssistant: '',
            streamingThinking: false,
            setupStatus: null,
            pendingReconnectStatus: null,
            pendingAssistantAttachments: [],
            lastError: null,
            sessionIndex: [
              newEntry,
              ...state.sessionIndex.filter((entry) => entry.sessionId !== sid)
            ]
          }))
        } else {
          const status = await window.api.agent.status()
          set({
            runningSessionIds: status.runningSessionIds ?? [],
            waitingSessionIds: status.waitingSessionIds ?? [],
            activeRunIdsBySession: status.activeRunIdsBySession ?? {},
            activeRunStartedAtsBySession: status.activeRunStartedAtsBySession ?? {}
          })
          if (!status.hasSession || status.sessionId !== sid) {
            const resumed = await window.api.agent.resumeSession(sid)
            runModelId = requireModelId(resumed.sessionModel.modelId)
            set({ activeSessionModel: resumed.sessionModel, setupStatus: null })
          } else {
            runModelId = get().activeSessionModel?.modelId ?? status.modelId?.trim() ?? null
            if (!runModelId) {
              const resumed = await window.api.agent.resumeSession(sid)
              runModelId = requireModelId(resumed.sessionModel.modelId)
              set({ activeSessionModel: resumed.sessionModel, setupStatus: null })
            }
          }
        }

        if (!runModelId) {
          throw new Error('Unable to resolve the active model for this agent request.')
        }
        rememberAssistantModelId(sid, runModelId)

        const isFirstMessage = !get().messages.some((message) => message.role === 'user')

        clearSessionFailed(sid, set)
        const userMessage = await appendUserMessage(
          sid,
          displayText,
          agentText,
          normalizedAttachments,
          options?.parts,
          isFirstMessage,
          'default',
          null,
          set
        )
        recordChatDiagnosticEvent('renderer_user_message_persisted', sid, {
          messageId: userMessage.id,
          messageKind: userMessage.kind ?? 'default',
          persistRuntimeContext: isFirstMessage
        })
        if (isFirstMessage) {
          generateSessionTitleSoon(
            sid,
            displayText,
            agentText,
            normalizedAttachments,
            options?.parts,
            set,
            onSessionTitleUpdated
          )
        }

        setSessionRunning(sid, true, set)
        runStartTimesBySession.set(sid, performance.now())
        runToolCountsBySession.set(sid, 0)
        recordChatDiagnosticEvent('renderer_agent_prompt_started', sid, {
          modelId: runModelId,
          hasImages: hasImageAttachments(normalizedAttachments)
        })
        set({ setupStatus: null })
        const promptResult = await window.api.agent.prompt(
          sid,
          buildAgentPrompt(agentText, normalizedAttachments),
          {
            hasImages: hasImageAttachments(normalizedAttachments),
            parts: options?.parts
          }
        )
        const effectiveModelId = requireModelId(promptResult.effectiveModelId)
        recordChatDiagnosticEvent('renderer_agent_prompt_completed', sid, {
          requestedModelId: runModelId,
          effectiveModelId,
          effectiveThinkingLevel: promptResult.effectiveThinkingLevel,
          effectiveReason: promptResult.effectiveReason ?? null
        })

        const statusAfterPrompt = await window.api.agent.status()
        set({
          runningSessionIds: statusAfterPrompt.runningSessionIds,
          waitingSessionIds: statusAfterPrompt.waitingSessionIds ?? [],
          activeRunIdsBySession: statusAfterPrompt.activeRunIdsBySession ?? {},
          activeRunStartedAtsBySession: statusAfterPrompt.activeRunStartedAtsBySession ?? {}
        })
        setSessionRunning(sid, false, set)
        if (get().sessionId === sid) {
          const committed = commitStreamingAssistant(get, set, 'optimistic')
          const lastMessage = get().messages.at(-1)
          if (committed && lastMessage?.role === 'assistant') {
            suppressAssistantCompletion(sid, lastMessage.id)
          }
          set({
            busy: false,
            streamingThinking: false,
            setupStatus: null,
            retryPrompt: get().lastError ? get().retryPrompt : null
          })
        }

        const next = get().sessionId === sid ? popNextQueuedPrompt(get, set) : null
        if (next && get().sessionId === sid) {
          void get().sendPrompt(next.text, next.cwd, next.attachments, {
            agentText: next.agentText,
            parts: next.parts
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        recordChatDiagnosticEvent('renderer_agent_prompt_failed', sid, {
          errorName: error instanceof Error ? error.name : 'Error',
          errorMessage: message
        })
        if (sid) {
          setSessionRunning(sid, false, set)
          markSessionFailed(sid, set)
        }
        if (!sid || !get().sessionId || get().sessionId === sid) {
          if (sid) {
            appendAssistantFailureMessage(sid, message, get, set)
          }
          set({
            lastError: message,
            busy: false,
            streamingThinking: false,
            setupStatus: null,
            retryPrompt
          })
        }
      }
    },

    retryLastFailedPrompt: async () => {
      const retryPrompt = get().retryPrompt
      if (!retryPrompt) return

      set({
        lastError: null,
        streamingThinking: false,
        setupStatus: null,
        pendingReconnectStatus: null
      })
      await get().sendPrompt(retryPrompt.text, retryPrompt.cwd, retryPrompt.attachments, {
        agentText: retryPrompt.agentText,
        parts: retryPrompt.parts
      })
    },

    steerPrompt: async (
      text: string,
      cwd: string,
      attachments?: MessageAttachment[],
      queuedPromptId?: string,
      options?: PromptRunOptions
    ) => {
      const trimmed = text.trim()
      const displayText = trimmed || partsToDisplayText(options?.parts ?? [])
      const agentText = (
        options?.agentText ??
        (trimmed || partsToModelText(options?.parts ?? []))
      ).trim()
      const normalizedAttachments = attachments && attachments.length > 0 ? attachments : undefined
      if (!agentText && !normalizedAttachments && !hasPromptOnlyParts(options?.parts)) return false

      if (!get().busy) {
        if (queuedPromptId) {
          set((state) => ({
            queuedPrompts: state.queuedPrompts.filter((item) => item.id !== queuedPromptId)
          }))
        }
        await get().sendPrompt(displayText, cwd, normalizedAttachments, {
          agentText,
          parts: options?.parts
        })
        return true
      }

      const sid = get().sessionId
      if (!sid) {
        queuePrompt(displayText, cwd, normalizedAttachments, set, agentText, options?.parts)
        return false
      }

      try {
        const expectedRunId = get().activeRunIdsBySession[sid]
        if (!expectedRunId) {
          throw new Error('No active agent run to steer')
        }
        // Preserve the transcript order users saw before inserting the steer message.
        commitStreamingAssistant(get, set, 'steer', undefined, expectedRunId)
        clearSessionFailed(sid, set)
        set((state) => ({
          lastError: null,
          streamingThinking: false,
          setupStatus: null,
          pendingReconnectStatus: null,
          queuedPrompts: queuedPromptId
            ? state.queuedPrompts.filter((item) => item.id !== queuedPromptId)
            : state.queuedPrompts
        }))
        await appendUserMessage(
          sid,
          displayText,
          agentText,
          normalizedAttachments,
          options?.parts,
          false,
          'steer',
          expectedRunId,
          set
        )
        const steerResult = await window.api.agent.steer(
          sid,
          buildAgentPrompt(agentText, normalizedAttachments),
          {
            hasImages: hasImageAttachments(normalizedAttachments),
            expectedRunId,
            parts: options?.parts
          }
        )
        requireModelId(steerResult.effectiveModelId)
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        markSessionFailed(sid, set)
        appendAssistantFailureMessage(sid, message, get, set)
        set({ lastError: message })
        return false
      }
    },

    steerQueuedPrompt: async (queuedPromptId: string) => {
      const queued = get().queuedPrompts.find((item) => item.id === queuedPromptId)
      if (!queued) return
      await get().steerPrompt(queued.text, queued.cwd, queued.attachments, queued.id, {
        agentText: queued.agentText,
        parts: queued.parts
      })
    },

    steerQueuedPrompts: async (queuedPromptIds: string[]) => {
      const queuedPromptIdSet = new Set(queuedPromptIds)
      const queuedPrompts = get().queuedPrompts.filter((item) => queuedPromptIdSet.has(item.id))
      if (queuedPrompts.length === 0) return
      for (const queued of queuedPrompts) {
        const steered = await get().steerPrompt(
          queued.text,
          queued.cwd,
          queued.attachments,
          queued.id,
          {
            agentText: queued.agentText,
            parts: queued.parts
          }
        )
        if (!steered) return
      }
    },

    removeQueuedPrompt: (queuedPromptId: string) => {
      set((state) => ({
        queuedPrompts: state.queuedPrompts.filter((item) => item.id !== queuedPromptId)
      }))
    },

    reorderQueuedPrompts: (queuedPromptIds: string[]) => {
      set((state) => {
        const queuedPromptById = new Map(state.queuedPrompts.map((item) => [item.id, item]))
        const orderedPrompts = queuedPromptIds.flatMap((id) => {
          const item = queuedPromptById.get(id)
          return item ? [item] : []
        })
        const orderedIds = new Set(queuedPromptIds)
        return {
          queuedPrompts: [
            ...orderedPrompts,
            ...state.queuedPrompts.filter((item) => !orderedIds.has(item.id))
          ]
        }
      })
    },

    cancel: async () => {
      const sid = get().sessionId
      await window.api.agent.cancel(sid ?? undefined)
      if (sid) {
        runStartTimesBySession.delete(sid)
        runToolCountsBySession.delete(sid)
        setSessionRunning(sid, false, set)
      } else {
        set({ busy: false, streamingThinking: false, setupStatus: null })
      }
    }
  }
}
