import {
  BottomChatComposer,
  CenteredChatStart,
  SetupEmptyState
} from '@renderer/components/chat/ChatComposerPanels'
import { ChatDropOverlay } from '@renderer/components/chat/ChatDropOverlay'
import { ChatMessageList } from '@renderer/components/chat/ChatMessageList'
import type { OpenSideChatEventDetail } from '@renderer/components/chat/chat-composer-types'
import { SIDE_CHAT_OPEN_EVENT } from '@renderer/components/chat/composer-events'
import { handleUserMessageSelectionCopy } from '@renderer/components/chat/MessageBubble'
import { ScrollToBottomButton } from '@renderer/components/chat/ScrollToBottomButton'
import { useChatComposerActions } from '@renderer/components/chat/useChatComposerActions'
import { useChatExternalLink } from '@renderer/components/chat/useChatExternalLink'
import { useChatRenderState } from '@renderer/components/chat/useChatRenderState'
import { useChatScrollController } from '@renderer/components/chat/useChatScrollController'
import { usePageAttachmentDrop } from '@renderer/components/chat/usePageAttachmentDrop'
import { useProjectWorkState } from '@renderer/components/chat/useProjectWorkState'
import { Toast, ToastViewport } from '@renderer/components/ui/toast'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { useProjectsStore } from '@renderer/stores/projects-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useTeamStore } from '@renderer/stores/team-store'
import { useToolApprovalStore } from '@renderer/stores/tool-approval-store'
import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect } from 'react'

export function ChatPage(): React.JSX.Element {
  const { t } = useI18n()
  const dataRoot = useSettingsStore((state) => state.dataRoot)
  const workingDirectory = useSettingsStore((state) => state.workingDirectory)
  const debugMode = useSettingsStore((state) => state.debugMode)
  const followUpBehavior = useSettingsStore((state) => state.followUpBehavior)
  const load = useSettingsStore((state) => state.load)
  const loaded = useSettingsStore((state) => state.loaded)
  const loadProjects = useProjectsStore((state) => state.load)
  const messages = useSessionStore((state) => state.messages)
  const busy = useSessionStore((state) => state.busy)
  const streamingAssistant = useSessionStore((state) => state.streamingAssistant)
  const setupStatus = useSessionStore((state) => state.setupStatus)
  const lastError = useSessionStore((state) => state.lastError)
  const pendingReconnectStatus = useSessionStore((state) => state.pendingReconnectStatus)
  const widgets = useSessionStore((state) => state.widgets)
  const activeRunIdsBySession = useSessionStore((state) => state.activeRunIdsBySession)
  const activeRunStartedAtsBySession = useSessionStore(
    (state) => state.activeRunStartedAtsBySession
  )
  const sessionId = useSessionStore((state) => state.sessionId)
  const sessionLoadingId = useSessionStore((state) => state.sessionLoadingId)
  const queuedPrompts = useSessionStore((state) => state.queuedPrompts)
  const toolApprovalRequests = useToolApprovalStore((state) => state.requests)
  const loadSession = useSessionStore((state) => state.loadSession)
  const reduceMotion = Boolean(useReducedMotion())
  const isSessionLoading = Boolean(sessionLoadingId)
  const ready = loaded && !isSessionLoading && (sessionId ? true : Boolean(workingDirectory))
  const composerPlaceholder = ready
    ? busy
      ? followUpBehavior === 'queue'
        ? t('chat.placeholder.followUp')
        : t('chat.placeholder.steer')
      : t('chat.placeholder.ready')
    : t('chat.placeholder.notReady')
  const showCenteredComposer = ready && messages.length === 0 && !busy
  const showSetupEmptyState = !ready && !isSessionLoading && messages.length === 0 && !busy
  const showBottomComposer = !showCenteredComposer
  const showSessionLoadStatus = isSessionLoading && messages.length === 0
  const showSessionLoadError = Boolean(
    !isSessionLoading && !busy && messages.length === 0 && lastError
  )
  const projectWork = useProjectWorkState({ dataRoot, workingDirectory })
  const composerActions = useChatComposerActions({ ready, sessionId, workingDirectory })
  const onOpenLink = useChatExternalLink()
  const drop = usePageAttachmentDrop()
  const renderState = useChatRenderState({
    activeRunIdsBySession,
    activeRunStartedAtsBySession,
    busy,
    debugMode,
    messages,
    pendingReconnectStatus,
    setupStatus,
    streamingAssistant,
    widgets
  })
  const activeApprovalRequest = sessionId
    ? toolApprovalRequests.find((request) => request.sessionId === sessionId)
    : undefined
  const activeWorkedRunPaused = Boolean(activeApprovalRequest)
  const activeWorkedRunPausedAt = activeApprovalRequest?.createdAt ?? null
  const scroll = useChatScrollController({
    busy,
    loadSession,
    messages,
    pendingReconnectStatus,
    queuedPrompts,
    reduceMotion,
    sessionId,
    showBottomComposer,
    streamingAssistant,
    widgets
  })
  const handleOpenSideChat = useCallback(
    (initialText?: string, options?: { focusComposer?: boolean }): void => {
      const detail: OpenSideChatEventDetail = { forceNew: true }
      if (options?.focusComposer) {
        detail.focusComposer = true
      }
      if (initialText !== undefined) {
        detail.initialText = initialText
      }
      window.dispatchEvent(
        new CustomEvent<OpenSideChatEventDetail>(SIDE_CHAT_OPEN_EVENT, {
          detail
        })
      )
    },
    []
  )
  const dismissSessionLoadError = useCallback((): void => {
    useSessionStore.setState({ lastError: null })
  }, [])
  const composerProps = {
    busy,
    currentModelId: composerActions.model,
    currentThinkingLevel: composerActions.thinkingLevel,
    followUpBehavior,
    onCancel: composerActions.handleCancel,
    onModelChange: composerActions.handleModelChange,
    onOpenSideChat: sessionId ? handleOpenSideChat : undefined,
    onSend: composerActions.handleSend,
    onSteer: composerActions.handleSteer,
    onThinkingLevelChange: composerActions.handleThinkingLevelChange,
    placeholder: composerPlaceholder,
    ready,
    sessionId,
    showModelSwitcher: composerActions.showModelSwitcher
  }

  useEffect(() => {
    document.addEventListener('copy', handleUserMessageSelectionCopy)
    return () => document.removeEventListener('copy', handleUserMessageSelectionCopy)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    useTeamStore.getState().bindEvents()
    void useTeamStore.getState().refreshStatus()
    void useTeamStore.getState().loadAgents()
    return () => {
      useTeamStore.getState().unsubscribeEvents?.()
    }
  }, [])

  useEffect(() => {
    useSessionStore.getState().bindSessionListener()
    return () => {
      useSessionStore.getState().unsubscribeSession?.()
    }
  }, [])

  return (
    <main
      className="relative flex min-h-0 flex-1 overflow-hidden bg-card"
      aria-label={t('chat.attachment.dropRegion')}
      onDragEnter={drop.handlePageDragEnter}
      onDragOver={drop.handlePageDragOver}
      onDragLeave={drop.handlePageDragLeave}
      onDrop={drop.handlePageDrop}
    >
      <ChatDropOverlay active={drop.pageDragActive} reduceMotion={reduceMotion} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1">
          <div
            ref={scroll.scrollRef}
            className={cn(
              'chat-scrollbar absolute inset-0 overflow-y-auto px-5',
              showCenteredComposer ? 'py-0' : 'pt-6',
              !showCenteredComposer && (showBottomComposer ? 'pb-0' : 'pb-6')
            )}
          >
            <div
              ref={scroll.scrollContentRef}
              className={
                showCenteredComposer
                  ? 'flex min-h-full items-center justify-center'
                  : 'flex min-h-full flex-col'
              }
            >
              {showCenteredComposer ? (
                <CenteredChatStart
                  composer={composerProps}
                  currentProject={projectWork.currentProject}
                  emptyChatTitle={projectWork.emptyChatTitle}
                  loaded={loaded}
                  onAddProject={projectWork.handleAddProjectFromHome}
                  onSelectProject={projectWork.handleSelectProject}
                  onWorkLocally={projectWork.handleWorkLocally}
                  projects={projectWork.projects}
                  reduceMotion={reduceMotion}
                />
              ) : null}

              {showSetupEmptyState ? <SetupEmptyState reduceMotion={reduceMotion} /> : null}

              {showSessionLoadStatus ? (
                <div className="mx-auto flex w-full max-w-[var(--pichu-chat-content-max-width)] flex-1 items-center justify-center text-[14px] text-muted-foreground">
                  <span className="pichu-activity-shimmer">{t('chat.session.opening')}</span>
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
                setupStatus={setupStatus}
                shouldShowThinkingActivity={renderState.shouldShowThinkingActivity}
                streamingAssistant={streamingAssistant}
              />

              {showBottomComposer ? (
                <BottomChatComposer
                  composer={composerProps}
                  composerContentRef={scroll.bottomComposerContentRef}
                  queuedPrompts={queuedPrompts}
                  onSteerQueuedPrompt={composerActions.handleSteerQueuedPrompt}
                  onSteerQueuedPrompts={composerActions.handleSteerQueuedPrompts}
                  onRemoveQueuedPrompt={composerActions.handleRemoveQueuedPrompt}
                  onReorderQueuedPrompts={composerActions.handleReorderQueuedPrompts}
                />
              ) : null}
            </div>
          </div>

          <ScrollToBottomButton
            visible={scroll.showScrollDown && !showCenteredComposer}
            bottom={scroll.bottomComposerHeight + 24}
            onClick={scroll.handleScrollToBottom}
          />
        </div>
      </div>
      <ToastViewport>
        {showSessionLoadError ? (
          <Toast
            title={t('chat.session.openFailed')}
            description={lastError ?? undefined}
            variant="error"
            onClose={dismissSessionLoadError}
            closeLabel={t('chat.session.dismissError')}
            className="max-w-[min(520px,calc(100vw-24px))]"
            descriptionClassName="line-clamp-none break-words"
          />
        ) : null}
      </ToastViewport>
    </main>
  )
}
