import type { WorkedRunRenderItem } from '@renderer/components/chat/chat-render-items'
import { MessageBubble } from '@renderer/components/chat/MessageBubble'
import { ToolActivityGroup } from '@renderer/components/chat/ToolActivityGroup'
import type { ChatLinkOpener } from '@renderer/components/chat/useChatExternalLink'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { ChevronRight } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

function formatWorkedDuration(durationMs: number | null): string {
  const totalSeconds = Math.max(0, Math.floor((durationMs ?? 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

export function WorkedRunGroup({
  item,
  sessionId,
  debugMode,
  busy,
  paused,
  pausedAt,
  onOpenLink,
  suppressedAttachmentPaths,
  persistentCopyMessageIds
}: {
  item: WorkedRunRenderItem
  sessionId: string | null
  debugMode: boolean
  busy: boolean
  paused: boolean
  pausedAt: string | null
  onOpenLink: ChatLinkOpener
  suppressedAttachmentPaths: Set<string>
  persistentCopyMessageIds: Set<string>
}): React.JSX.Element | null {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const active = busy && Boolean(item.activeStartedAt)
  const runIdentity = `${item.id}:${item.activeStartedAt ?? ''}`
  const wasActiveRef = useRef(active)
  const runIdentityRef = useRef(runIdentity)
  const pausedStartedMsRef = useRef<number | null>(null)
  const pausedDurationMsRef = useRef(0)
  const [expanded, setExpanded] = useState(active)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (runIdentityRef.current === runIdentity) return
    runIdentityRef.current = runIdentity
    pausedStartedMsRef.current = null
    pausedDurationMsRef.current = 0
    setNow(Date.now())
  }, [runIdentity])

  useEffect(() => {
    if (!active) {
      pausedStartedMsRef.current = null
      return
    }

    if (paused) {
      const parsedPausedAt = pausedAt ? Date.parse(pausedAt) : Number.NaN
      if (Number.isFinite(parsedPausedAt)) {
        pausedStartedMsRef.current =
          pausedStartedMsRef.current == null
            ? parsedPausedAt
            : Math.min(pausedStartedMsRef.current, parsedPausedAt)
      } else {
        pausedStartedMsRef.current ??= Date.now()
      }
      setNow(pausedStartedMsRef.current)
      return
    }

    if (pausedStartedMsRef.current != null) {
      pausedDurationMsRef.current += Math.max(0, Date.now() - pausedStartedMsRef.current)
      pausedStartedMsRef.current = null
      setNow(Date.now())
    }
  }, [active, paused, pausedAt])

  useEffect(() => {
    if (!active || paused) return undefined
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active, paused])

  useEffect(() => {
    if (active) {
      wasActiveRef.current = true
      setExpanded(true)
      return
    }
    if (wasActiveRef.current) {
      wasActiveRef.current = false
      setExpanded(false)
    }
  }, [active])

  if (item.detailItems.length === 0) return null

  const startedMs = item.activeStartedAt
    ? Date.parse(item.activeStartedAt)
    : item.startedAt
      ? Date.parse(item.startedAt)
      : Number.NaN
  const completedMs = item.completedAt ? Date.parse(item.completedAt) : Number.NaN
  const fallbackDuration =
    Number.isFinite(startedMs) && Number.isFinite(completedMs) ? completedMs - startedMs : null
  const activeDurationMs =
    active && Number.isFinite(startedMs) ? now - startedMs - pausedDurationMsRef.current : null
  const durationMs = activeDurationMs ?? item.durationMs ?? fallbackDuration
  const stopped = item.status === 'cancelled'
  const labelWithDuration = t(
    active ? 'chat.run.workingFor' : stopped ? 'chat.run.stoppedAfter' : 'chat.run.workedFor',
    {
      duration: formatWorkedDuration(durationMs)
    }
  )
  const canToggle = !active
  const activeToolGroupId = busy
    ? item.detailItems.findLast((detailItem) => detailItem.kind === 'toolGroup')?.id
    : null
  const promotedDetailItemIds = new Set(item.promotedDetailItemIds)
  const isPromotedDetailItem = (detailItem: (typeof item.detailItems)[number]): boolean =>
    detailItem.kind === 'toolGroup' && promotedDetailItemIds.has(detailItem.id)
  const regularDetailItems = item.detailItems.filter(
    (detailItem) => !isPromotedDetailItem(detailItem)
  )
  const promotedDetailItems = item.detailItems.filter(isPromotedDetailItem)
  const collapsedSteerMessages = regularDetailItems.filter(
    (detailItem) => detailItem.kind === 'message' && detailItem.message.kind === 'steer'
  )
  const renderDetailItem = (detailItem: (typeof item.detailItems)[number]) => {
    if (detailItem.kind === 'toolGroup') {
      return (
        <ToolActivityGroup
          key={detailItem.id}
          sessionId={sessionId}
          items={detailItem.items}
          debugMode={debugMode}
          busy={busy && detailItem.id === activeToolGroupId}
        />
      )
    }
    return (
      <MessageBubble
        key={detailItem.message.id}
        message={detailItem.message}
        sessionId={sessionId}
        debugMode={debugMode}
        onOpenLink={onOpenLink}
        suppressedAttachmentPaths={suppressedAttachmentPaths}
        persistentCopyIcon={persistentCopyMessageIds.has(detailItem.message.id)}
        showFooter={detailItem.message.role === 'user'}
      />
    )
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto mb-2 w-full max-w-[var(--pichu-chat-content-max-width)]"
    >
      <button
        type="button"
        className={cn(
          'flex max-w-full items-center gap-2 rounded-md py-0.5 text-left text-[14px] text-muted-foreground transition-colors',
          canToggle && 'cursor-pointer hover:text-foreground'
        )}
        disabled={!canToggle}
        aria-expanded={canToggle ? expanded : undefined}
        onClick={canToggle ? () => setExpanded((value) => !value) : undefined}
      >
        <span className="min-w-0 truncate text-muted-foreground/90">{labelWithDuration}</span>
        {canToggle ? (
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground/60 transition-transform',
              expanded && 'rotate-90'
            )}
            strokeWidth={1.8}
          />
        ) : null}
      </button>
      {!expanded && promotedDetailItems.length === 0 ? (
        <div className="mt-1 border-t border-border/70" />
      ) : null}
      {!expanded && collapsedSteerMessages.length > 0 ? (
        <div className="pt-2">
          {collapsedSteerMessages.map((detailItem) => {
            if (detailItem.kind !== 'message') return null
            return (
              <MessageBubble
                key={detailItem.message.id}
                message={detailItem.message}
                sessionId={sessionId}
                debugMode={debugMode}
                onOpenLink={onOpenLink}
                suppressedAttachmentPaths={suppressedAttachmentPaths}
                persistentCopyIcon={persistentCopyMessageIds.has(detailItem.message.id)}
                showFooter
              />
            )
          })}
        </div>
      ) : null}
      <AnimatePresence initial={false}>
        {expanded && regularDetailItems.length > 0 ? (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="mt-1 overflow-hidden border-t border-border/70 pt-2"
          >
            {regularDetailItems.map(renderDetailItem)}
          </motion.div>
        ) : null}
      </AnimatePresence>
      {promotedDetailItems.length > 0 ? (
        <div
          className={cn(
            'pt-2',
            expanded && regularDetailItems.length > 0 ? 'mt-1' : 'mt-1 border-t border-border/70'
          )}
        >
          {promotedDetailItems.map(renderDetailItem)}
        </div>
      ) : null}
    </motion.div>
  )
}
