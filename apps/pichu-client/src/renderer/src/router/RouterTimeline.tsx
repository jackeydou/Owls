import { Button } from '@renderer/components/ui/button'
import { AlertCircle, Loader2 } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { CodexItem, CodexRouter } from '../../../shared/codex'
import { ConversationItem } from '../codex/Conversation'
import { failureMessage } from '../codex/failures'
import { DispatchGroup } from './DispatchGroup'
import { isSetupFailure } from './RouterSetup'
import { useRouterStore } from './store'
import { RouterIdContext, WorkerLink, workerMarkdown } from './WorkerLink'

type Entry = { id: string; item: CodexItem } | { id: string; workerIds: string[] }

/** Hides tool calls and folds the worker items between them into one dispatch group. */
function entriesOf(items: CodexItem[]): Entry[] {
  const entries: Entry[] = []
  for (const item of items) {
    if (item.kind === 'tool') continue
    const last = entries.at(-1)
    if (item.kind !== 'worker') entries.push({ id: item.id, item })
    else if (!item.workerId) continue
    else if (last && 'workerIds' in last) last.workerIds.push(item.workerId)
    else entries.push({ id: item.id, workerIds: [item.workerId] })
  }
  return entries
}
function DirectedMessage({ item }: { item: CodexItem }) {
  const { t } = useTranslation()
  const worker = useRouterStore((s) => s.workers.find((w) => w.id === item.workerId))
  return (
    <>
      {worker ? (
        <div className="router-directed">
          <span>{t('router.directedTo')}</span>
          <WorkerLink worker={worker} />
        </div>
      ) : null}
      <div className="codex-user-message">{item.text}</div>
    </>
  )
}
export function RouterTimeline({
  router,
  intro
}: {
  router: CodexRouter
  /** The card above the conversation; told whether there is a conversation yet. */
  intro: (hasEntries: boolean) => ReactNode
}) {
  const { t } = useTranslation()
  const resolveBatch = useRouterStore((s) => s.resolveBatch)
  const entries = useMemo(() => entriesOf(router.items), [router.items])
  const bottom = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const running = router.status === 'running'
  useEffect(() => {
    if (entries.length && nearBottom.current) bottom.current?.scrollIntoView({ block: 'end' })
  }, [entries])
  return (
    <RouterIdContext.Provider value={router.id}>
      <div
        className="codex-conversation-scroll"
        ref={scroll}
        onScroll={() => {
          const el = scroll.current
          if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
        }}
      >
        <div className="codex-conversation">
          {intro(entries.length > 0)}
          {entries.map((entry) =>
            'workerIds' in entry ? (
              <DispatchGroup key={entry.id} workerIds={entry.workerIds} />
            ) : entry.item.kind === 'user' && entry.item.workerId ? (
              <DirectedMessage key={entry.id} item={entry.item} />
            ) : (
              <ConversationItem
                key={entry.id}
                item={entry.item}
                agent={t('router.agent')}
                markdown={workerMarkdown}
              />
            )
          )}
          {running ? (
            <div className="codex-working" role="status">
              <Loader2 size={13} className="animate-spin" />
              {t('router.working')}
            </div>
          ) : null}
          {router.unknownBatches.map((batch) => (
            <div className="codex-inline-error router-unknown-batch" role="alert" key={batch.id}>
              <AlertCircle size={15} />
              <span>{t('router.unknownBatch', { count: batch.events })}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void resolveBatch(router.id, batch.id, 'retry')}
              >
                {t('router.retryBatch')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void resolveBatch(router.id, batch.id, 'ignore')}
              >
                {t('router.ignoreBatch')}
              </Button>
            </div>
          ))}
          {router.error && !isSetupFailure(router.error) ? (
            <div className="codex-inline-error" role="alert">
              <AlertCircle size={15} />
              <span>{failureMessage(router.error)}</span>
            </div>
          ) : null}
          <div ref={bottom} />
        </div>
      </div>
    </RouterIdContext.Provider>
  )
}
