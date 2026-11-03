import { ChatComposer } from '@renderer/components/chat/ChatComposer'
import { ChatMessageList } from '@renderer/components/chat/ChatMessageList'
import type { ComposerSubmitOptions } from '@renderer/components/chat/chat-composer-types'
import {
  COMPOSER_ADD_TEXT_EVENT,
  SIDE_CHAT_OPEN_EVENT
} from '@renderer/components/chat/composer-events'
import { ScrollToBottomButton } from '@renderer/components/chat/ScrollToBottomButton'
import { useChatExternalLink } from '@renderer/components/chat/useChatExternalLink'
import { useChatRenderState } from '@renderer/components/chat/useChatRenderState'
import { useI18n } from '@renderer/lib/i18n'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useSideChatStore } from '@renderer/stores/side-chat-store'
import { useToolApprovalStore } from '@renderer/stores/tool-approval-store'
import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MessageAttachment } from '../../../preload/index.d'
import type { PichuReasoningMenuLevel } from '../../../shared/model-settings'

function hasPromptOnlyPart(options?: ComposerSubmitOptions): boolean {
  return options?.parts?.some((part) => part.type === 'skill') ?? false
}

export function SideChatPanel({
  cwd,
  parentSessionId,
  sideSessionId
}: {
  cwd: string
  parentSessionId: string | null
  sideSessionId?: string | null
}): React.JSX.Element {
  const { t } = useI18n()
  const reduceMotion = Boolean(useReducedMotion())
  const debugMode = useSettingsStore((state) => state.debugMode)
  const followUpBehavior = useSettingsStore((state) => state.followUpBehavior)
  const settingsModel = useSettingsStore((state) => state.model)
  const settingsThinkingLevel = useSettingsStore((state) => state.thinkingLevel)
  const showModelSwitcher = useSettingsStore((state) => state.showModelSwitcher)
  const updateModel = useSettingsStore((state) => state.updateModel)
  const updateThinkingLevel = useSettingsStore((state) => state.updateThinkingLevel)
  const sessionId = useSideChatStore((state) => state.sessionId)
  const activeSessionModel = useSideChatStore((state) => state.activeSessionModel)
  const messages = useSideChatStore((state) => state.messages)
  const busy = useSideChatStore((state) => state.busy)
  const lastError = useSideChatStore((state) => state.lastError)
  const streamingAssistant = useSideChatStore((state) => state.streamingAssistant)
  const pendingReconnectStatus = useSideChatStore((state) => state.pendingReconnectStatus)
  const widgets = useSideChatStore((state) => state.widgets)
  const activeRunIdsBySession = useSideChatStore((state) => state.activeRunIdsBySession)
  const activeRunStartedAtsBySession = useSideChatStore(
    (state) => state.activeRunStartedAtsBySession
  )
  const queuedPrompts = useSideChatStore((state) => state.queuedPrompts)
  const sendPrompt = useSideChatStore((state) => state.sendPrompt)
  const steerPrompt = useSideChatStore((state) => state.steerPrompt)
  const steerQueuedPrompt = useSideChatStore((state) => state.steerQueuedPrompt)
  const steerQueuedPrompts = useSideChatStore((state) => state.steerQueuedPrompts)
  const removeQueuedPrompt = useSideChatStore((state) => state.removeQueuedPrompt)
  const reorderQueuedPrompts = useSideChatStore((state) => state.reorderQueuedPrompts)
  const cancel = useSideChatStore((state) => state.cancel)
  const bindSessionListener = useSideChatStore((state) => state.bindSessionListener)
  const storeParentSessionId = useSideChatStore((state) => state.parentSessionId)
  const storeParentCwd = useSideChatStore((state) => state.parentCwd)
  const expiredSideSessionId = useSideChatStore((state) => state.expiredSideSessionId)
  const openForParent = useSideChatStore((state) => state.openForParent)
  const loadSideChatSession = useSideChatStore((state) => state.loadSideChatSession)
  const pendingComposerTexts = useSideChatStore((state) => state.pendingComposerTexts)
  const removePendingComposerText = useSideChatStore((state) => state.removePendingComposerText)
  const toolApprovalRequests = useToolApprovalStore((state) => state.requests)
  const onOpenLink = useChatExternalLink()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const scrollContentRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [composerHeight, setComposerHeight] = useState(0)
  const effectiveCwd =
    storeParentSessionId === parentSessionId && storeParentCwd.trim()
      ? storeParentCwd
      : cwd.trim() || storeParentCwd
  const ready = Boolean(parentSessionId && effectiveCwd.trim())
  const sideChatExpired = Boolean(sideSessionId && expiredSideSessionId === sideSessionId)
  const placeholder = ready
    ? busy && followUpBehavior !== 'queue'
      ? t('chat.placeholder.steer')
      : t('chat.placeholder.followUp')
    : t('sideChat.unavailable')
  const showEmptyNotice =
    messages.length === 0 && !busy && (sideChatExpired || Boolean(lastError) || !ready)
  const renderState = useChatRenderState({
    activeRunIdsBySession,
    activeRunStartedAtsBySession,
    busy,
    debugMode,
    messages,
    pendingReconnectStatus,
    setupStatus: null,
    streamingAssistant,
    widgets
  })
  const activeApprovalRequest = sessionId
    ? toolApprovalRequests.find((request) => request.sessionId === sessionId)
    : undefined
  const activeWorkedRunPaused = Boolean(activeApprovalRequest)
  const activeWorkedRunPausedAt = activeApprovalRequest?.createdAt ?? null

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior })
  }, [])

  const startNewSideChat = useCallback((): void => {
    if (!parentSessionId || !effectiveCwd.trim()) return
    window.dispatchEvent(
      new CustomEvent(SIDE_CHAT_OPEN_EVENT, {
        detail: {
          parentSessionId,
          forceNew: true
        }
      })
    )
  }, [effectiveCwd, parentSessionId])

  const updateStickToBottom = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    const atBottom = distance <= 24
    stickToBottomRef.current = atBottom
    setShowScrollDown(element.scrollHeight - element.clientHeight > 24 && !atBottom)
  }, [])

  useEffect(() => {
    bindSessionListener()
    return () => {
      useSideChatStore.getState().unsubscribeSession?.()
    }
  }, [bindSessionListener])

  useEffect(() => {
    if (!parentSessionId) return
    if (sideSessionId) {
      if (sessionId === sideSessionId && storeParentSessionId === parentSessionId) return
      void loadSideChatSession({
        sessionId: sideSessionId,
        parentSessionId,
        cwd: effectiveCwd
      }).catch(console.error)
      return
    }
    if (storeParentSessionId === parentSessionId) return
    void openForParent({ parentSessionId, cwd: effectiveCwd }).catch(console.error)
  }, [
    effectiveCwd,
    loadSideChatSession,
    openForParent,
    parentSessionId,
    sessionId,
    sideSessionId,
    storeParentSessionId
  ])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    updateStickToBottom()
    element.addEventListener('scroll', updateStickToBottom, { passive: true })
    return () => element.removeEventListener('scroll', updateStickToBottom)
  }, [updateStickToBottom])

  useEffect(() => {
    const content = scrollContentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) {
        scrollToBottom('auto')
      }
      updateStickToBottom()
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [scrollToBottom, updateStickToBottom])

  useEffect(() => {
    const composer = composerRef.current
    if (!composer || typeof ResizeObserver === 'undefined') return
    const update = () => setComposerHeight(composer.getBoundingClientRect().height)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(composer)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (pendingComposerTexts.length === 0) return

    const timeout = window.setTimeout(() => {
      for (const item of pendingComposerTexts) {
        if (item.parentSessionId !== parentSessionId) continue
        if (item.sideSessionId !== sideSessionId) continue
        window.dispatchEvent(
          new CustomEvent(COMPOSER_ADD_TEXT_EVENT, {
            detail: {
              target: 'side',
              text: item.text,
              sourceMessageId: item.sourceMessageId
            }
          })
        )
        removePendingComposerText(item.id)
      }
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [parentSessionId, pendingComposerTexts, removePendingComposerText, sideSessionId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: sync scroll to latest side-chat message/stream/widget
  useEffect(() => {
    if (!stickToBottomRef.current) return
    scrollToBottom(busy || reduceMotion ? 'auto' : 'smooth')
  }, [
    busy,
    messages,
    pendingReconnectStatus,
    reduceMotion,
    scrollToBottom,
    streamingAssistant,
    widgets
  ])

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
          !hasPromptOnlyPart(options))
      ) {
        return
      }
      await sendPrompt(text, effectiveCwd, attachments, options)
    },
    [effectiveCwd, ready, sendPrompt]
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
          !hasPromptOnlyPart(options))
      ) {
        return
      }
      await steerPrompt(text, effectiveCwd, attachments, undefined, options)
    },
    [effectiveCwd, ready, steerPrompt]
  )

  const handleModelChange = useCallback(
    (modelId: string): void => {
      if (!sessionId) {
        void updateModel(modelId)
        return
      }
      const previous = useSideChatStore.getState().activeSessionModel
      if (!previous) return
      const optimistic = {
        ...previous,
        modelId,
        updatedAt: new Date().toISOString(),
        updatedBy: 'user' as const
      }
      useSideChatStore.setState({ activeSessionModel: optimistic })
      void window.api.agent
        .setSessionModel({
          sessionId,
          modelId,
          thinkingLevel: previous.thinkingLevel
        })
        .then((result) => {
          useSideChatStore.setState({ activeSessionModel: result.sessionModel })
        })
        .catch((error) => {
          useSideChatStore.setState({ activeSessionModel: previous })
          console.error(error)
        })
    },
    [sessionId, updateModel]
  )

  const handleThinkingLevelChange = useCallback(
    (level: PichuReasoningMenuLevel): void => {
      if (!sessionId) {
        void updateThinkingLevel(level)
        return
      }
      const previous = useSideChatStore.getState().activeSessionModel
      if (!previous) return
      useSideChatStore.setState({
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
          useSideChatStore.setState({ activeSessionModel: result.sessionModel })
        })
        .catch((error) => {
          useSideChatStore.setState({ activeSessionModel: previous })
          console.error(error)
        })
    },
    [sessionId, updateThinkingLevel]
  )

  return (
    <section className="flex h-full min-h-0 flex-col bg-card">
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="chat-scrollbar absolute inset-0 overflow-y-auto px-4 pt-4">
          <div ref={scrollContentRef} className="flex min-h-full flex-col">
            {showEmptyNotice ? (
              <div className="flex min-h-[240px] flex-1 items-center justify-center px-5 text-center">
                <div className="max-w-[260px]">
                  <div className="text-[14px] font-semibold text-foreground">
                    {sideChatExpired
                      ? t('sideChat.expiredTitle')
                      : lastError
                        ? t('sideChat.error')
                        : t('sideChat.unavailable')}
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                    {sideChatExpired
                      ? t('sideChat.expiredDescription')
                      : lastError
                        ? lastError
                        : t('sideChat.unavailableDescription')}
                  </p>
                  {sideChatExpired ? (
                    <button
                      type="button"
                      onClick={startNewSideChat}
                      className="mt-4 inline-flex h-8 items-center justify-center rounded-md bg-foreground px-3 text-[12px] font-semibold text-background transition hover:bg-foreground/90"
                    >
                      {t('sideChat.startNew')}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <ChatMessageList
              activeToolGroupId={renderState.activeToolGroupId}
              activeWorkedRunPaused={activeWorkedRunPaused}
              activeWorkedRunPausedAt={activeWorkedRunPausedAt}
              activeWorkedRunId={renderState.activeWorkedRun?.id ?? null}
              busy={busy}
              debugMode={debugMode}
              generatedImageAttachmentPaths={renderState.generatedImageAttachmentPaths}
              onOpenLink={onOpenLink}
              pendingReconnectStatus={pendingReconnectStatus}
              pendingThinkingAssistantMessageId={renderState.pendingThinkingAssistantMessageId}
              persistentCopyMessageIds={renderState.persistentCopyMessageIds}
              reduceMotion={reduceMotion}
              renderItems={renderState.renderItems}
              sessionId={sessionId}
              setupStatus={null}
              shouldShowThinkingActivity={renderState.shouldShowThinkingActivity}
              streamingAssistant={streamingAssistant}
            />
          </div>
        </div>

        <ScrollToBottomButton
          visible={showScrollDown}
          bottom={composerHeight + 18}
          onClick={() => {
            stickToBottomRef.current = true
            setShowScrollDown(false)
            scrollToBottom(reduceMotion ? 'auto' : 'smooth')
          }}
        />
      </div>

      <div
        ref={composerRef}
        className="chat-composer-fade pointer-events-none shrink-0 px-4 pt-8 pb-4"
      >
        <div className="pointer-events-auto">
          <label className="sr-only" htmlFor="side-chat-input">
            {t('sideChat.messageLabel')}
          </label>
          <ChatComposer
            id="side-chat-input"
            composerTarget="side"
            busy={busy}
            currentModelId={
              sessionId ? (activeSessionModel?.modelId ?? settingsModel) : settingsModel
            }
            currentThinkingLevel={
              sessionId
                ? (activeSessionModel?.thinkingLevel ?? settingsThinkingLevel)
                : settingsThinkingLevel
            }
            followUpBehavior={followUpBehavior}
            onCancel={() => {
              void cancel()
            }}
            onModelChange={handleModelChange}
            onSend={handleSend}
            onSteer={handleSteer}
            onThinkingLevelChange={handleThinkingLevelChange}
            placeholder={placeholder}
            ready={ready}
            sessionId={sessionId}
            showModelSwitcher={showModelSwitcher && (!sessionId || Boolean(activeSessionModel))}
            queuedPrompts={queuedPrompts}
            onSteerQueuedPrompt={(id) => {
              void steerQueuedPrompt(id)
            }}
            onSteerQueuedPrompts={(ids) => {
              void steerQueuedPrompts(ids)
            }}
            onRemoveQueuedPrompt={removeQueuedPrompt}
            onReorderQueuedPrompts={reorderQueuedPrompts}
          />
        </div>
      </div>
    </section>
  )
}
