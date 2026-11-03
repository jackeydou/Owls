import type { ChatRenderItem } from '@renderer/components/chat/chat-render-items'
import { useI18n } from '@renderer/lib/i18n'
import type {
  ChatMessage,
  ModelReconnectStatus,
  SessionSetupStatus
} from '@renderer/stores/session-store'
import { AnimatePresence, motion } from 'motion/react'
import { MessageBubble, ReconnectStatusBlock, StreamingAssistantMessage } from './MessageBubble'
import { ToolActivityGroup } from './ToolActivityGroup'
import type { ChatLinkOpener } from './useChatExternalLink'
import { WorkedRunGroup } from './WorkedRunGroup'

export function ChatMessageList({
  activeToolGroupId,
  activeWorkedRunPaused,
  activeWorkedRunPausedAt,
  activeWorkedRunId,
  busy,
  debugMode,
  generatedImageAttachmentPaths,
  onOpenLink,
  pendingReconnectStatus,
  pendingThinkingAssistantMessageId,
  persistentCopyMessageIds,
  reduceMotion,
  renderItems,
  sessionId,
  setupStatus,
  shouldShowThinkingActivity,
  streamingAssistant
}: {
  activeToolGroupId: string | null
  activeWorkedRunPaused: boolean
  activeWorkedRunPausedAt: string | null
  activeWorkedRunId: string | null
  busy: boolean
  debugMode: boolean
  generatedImageAttachmentPaths: Set<string>
  onOpenLink: ChatLinkOpener
  pendingReconnectStatus: ModelReconnectStatus | null
  pendingThinkingAssistantMessageId: string | null
  persistentCopyMessageIds: Set<string>
  reduceMotion: boolean
  renderItems: ChatRenderItem[]
  sessionId: string | null
  setupStatus: SessionSetupStatus | null
  shouldShowThinkingActivity: boolean
  streamingAssistant: string
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <>
      <AnimatePresence initial={false}>
        {renderItems.map((item) => {
          if (item.kind === 'toolGroup') {
            return (
              <ToolActivityGroup
                key={item.id}
                sessionId={sessionId}
                items={item.items}
                debugMode={debugMode}
                busy={busy && item.id === activeToolGroupId}
              />
            )
          }

          if (item.kind === 'workedRun') {
            return (
              <WorkedRunGroup
                key={item.id}
                item={item}
                sessionId={sessionId}
                debugMode={debugMode}
                busy={busy && item.id === activeWorkedRunId}
                paused={activeWorkedRunPaused && item.id === activeWorkedRunId}
                pausedAt={activeWorkedRunPausedAt}
                onOpenLink={onOpenLink}
                suppressedAttachmentPaths={generatedImageAttachmentPaths}
                persistentCopyMessageIds={persistentCopyMessageIds}
              />
            )
          }

          return (
            <MessageBubble
              key={item.message.id}
              message={item.message}
              sessionId={sessionId}
              debugMode={debugMode}
              onOpenLink={onOpenLink}
              suppressedAttachmentPaths={generatedImageAttachmentPaths}
              persistentCopyIcon={persistentCopyMessageIds.has(item.message.id)}
              showFooter={showMessageFooter(
                item.message,
                item.showFooter,
                pendingThinkingAssistantMessageId
              )}
            />
          )
        })}
      </AnimatePresence>

      {busy && streamingAssistant ? (
        <StreamingAssistantMessage
          text={streamingAssistant}
          reduceMotion={reduceMotion}
          onOpenLink={onOpenLink}
        />
      ) : null}

      {busy && pendingReconnectStatus ? (
        <div className="mx-auto w-full max-w-[var(--pichu-chat-content-max-width)]">
          <ReconnectStatusBlock status={pendingReconnectStatus} />
        </div>
      ) : null}

      {busy && setupStatus ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mx-auto w-full max-w-[var(--pichu-chat-content-max-width)] text-[14px] text-muted-foreground"
        >
          <span className="pichu-activity-shimmer">{t('chat.setupWorkspace')}</span>
        </motion.div>
      ) : null}

      {shouldShowThinkingActivity ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mx-auto w-full max-w-[var(--pichu-chat-content-max-width)] text-[14px] text-muted-foreground"
        >
          <span className="pichu-activity-shimmer">{t('chat.thinking')}</span>
        </motion.div>
      ) : null}
    </>
  )
}

function showMessageFooter(
  message: ChatMessage,
  showFooter: boolean,
  pendingThinkingAssistantMessageId: string | null
): boolean {
  return showFooter && message.id !== pendingThinkingAssistantMessageId
}
