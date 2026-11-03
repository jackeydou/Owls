import { useSessionStore } from '@renderer/stores/session-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useCallback } from 'react'
import type { MessageAttachment } from '../../../../preload/index.d'
import type { PichuReasoningMenuLevel, PichuThinkingLevel } from '../../../../shared/model-settings'
import type { ComposerSubmitOptions } from './chat-composer-types'

function hasPromptOnlyParts(options: ComposerSubmitOptions | undefined): boolean {
  return options?.parts?.some((part) => part.type === 'skill' || part.type === 'comment') ?? false
}

export function useChatComposerActions({
  ready,
  sessionId,
  workingDirectory
}: {
  ready: boolean
  sessionId: string | null
  workingDirectory: string
}) {
  const settingsModel = useSettingsStore((state) => state.model)
  const thinkingLevel = useSettingsStore((state) => state.thinkingLevel)
  const showModelSwitcher = useSettingsStore((state) => state.showModelSwitcher)
  const updateModel = useSettingsStore((state) => state.updateModel)
  const updateThinkingLevel = useSettingsStore((state) => state.updateThinkingLevel)
  const activeSessionModel = useSessionStore((state) => state.activeSessionModel)
  const sendPrompt = useSessionStore((state) => state.sendPrompt)
  const steerPrompt = useSessionStore((state) => state.steerPrompt)
  const steerQueuedPrompt = useSessionStore((state) => state.steerQueuedPrompt)
  const steerQueuedPrompts = useSessionStore((state) => state.steerQueuedPrompts)
  const removeQueuedPrompt = useSessionStore((state) => state.removeQueuedPrompt)
  const reorderQueuedPrompts = useSessionStore((state) => state.reorderQueuedPrompts)
  const cancel = useSessionStore((state) => state.cancel)

  const handleSend = useCallback(
    async (
      text: string,
      attachments: MessageAttachment[] = [],
      options?: ComposerSubmitOptions
    ): Promise<void> => {
      if (
        !ready ||
        (!options?.agentText?.trim() &&
          !text.trim() &&
          attachments.length === 0 &&
          !hasPromptOnlyParts(options))
      )
        return
      await sendPrompt(text, workingDirectory, attachments, options)
    },
    [ready, sendPrompt, workingDirectory]
  )

  const handleSteer = useCallback(
    async (
      text: string,
      attachments: MessageAttachment[] = [],
      options?: ComposerSubmitOptions
    ): Promise<void> => {
      if (
        !ready ||
        (!options?.agentText?.trim() &&
          !text.trim() &&
          attachments.length === 0 &&
          !hasPromptOnlyParts(options))
      )
        return
      await steerPrompt(text, workingDirectory, attachments, undefined, options)
    },
    [ready, steerPrompt, workingDirectory]
  )

  const handleSteerQueuedPrompt = useCallback(
    (id: string): void => {
      void steerQueuedPrompt(id)
    },
    [steerQueuedPrompt]
  )

  const handleSteerQueuedPrompts = useCallback(
    (ids: string[]): void => {
      void steerQueuedPrompts(ids)
    },
    [steerQueuedPrompts]
  )

  const handleRemoveQueuedPrompt = useCallback(
    (id: string): void => {
      removeQueuedPrompt(id)
    },
    [removeQueuedPrompt]
  )

  const handleReorderQueuedPrompts = useCallback(
    (ids: string[]): void => {
      reorderQueuedPrompts(ids)
    },
    [reorderQueuedPrompts]
  )

  const handleCancel = useCallback((): void => {
    void cancel()
  }, [cancel])

  const handleModelChange = useCallback(
    (modelId: string, defaultThinkingLevel?: PichuThinkingLevel) => {
      if (!sessionId) {
        void (async () => {
          await updateModel(modelId)
          if (defaultThinkingLevel) {
            await updateThinkingLevel(defaultThinkingLevel)
          }
        })()
        return
      }
      const previous = useSessionStore.getState().activeSessionModel
      if (!previous) return
      const nextThinkingLevel =
        defaultThinkingLevel && previous.updatedBy !== 'user'
          ? defaultThinkingLevel
          : previous.thinkingLevel
      const optimistic = {
        ...previous,
        modelId,
        thinkingLevel: nextThinkingLevel,
        updatedAt: new Date().toISOString(),
        updatedBy: 'user' as const
      }
      useSessionStore.setState({ activeSessionModel: optimistic })
      void window.api.agent
        .setSessionModel({
          sessionId,
          modelId,
          thinkingLevel: nextThinkingLevel
        })
        .then((result) => {
          useSessionStore.setState({ activeSessionModel: result.sessionModel })
        })
        .catch((error) => {
          useSessionStore.setState({ activeSessionModel: previous })
          console.error(error)
        })
    },
    [sessionId, updateModel, updateThinkingLevel]
  )

  const handleThinkingLevelChange = useCallback(
    (level: PichuReasoningMenuLevel) => {
      if (!sessionId) {
        void updateThinkingLevel(level)
        return
      }
      const previous = useSessionStore.getState().activeSessionModel
      if (!previous) return
      useSessionStore.setState({
        activeSessionModel: {
          ...previous,
          thinkingLevel: level,
          updatedAt: new Date().toISOString(),
          updatedBy: 'user'
        }
      })
      void window.api.agent
        .setSessionModel({
          sessionId,
          modelId: previous.modelId,
          thinkingLevel: level
        })
        .then((result) => {
          useSessionStore.setState({ activeSessionModel: result.sessionModel })
        })
        .catch((error) => {
          useSessionStore.setState({ activeSessionModel: previous })
          console.error(error)
        })
    },
    [sessionId, updateThinkingLevel]
  )

  return {
    handleCancel,
    handleModelChange,
    handleRemoveQueuedPrompt,
    handleReorderQueuedPrompts,
    handleSend,
    handleSteer,
    handleSteerQueuedPrompt,
    handleSteerQueuedPrompts,
    handleThinkingLevelChange,
    model: sessionId ? (activeSessionModel?.modelId ?? settingsModel) : settingsModel,
    showModelSwitcher: showModelSwitcher && (!sessionId || Boolean(activeSessionModel)),
    thinkingLevel: sessionId ? (activeSessionModel?.thinkingLevel ?? thinkingLevel) : thinkingLevel
  }
}
