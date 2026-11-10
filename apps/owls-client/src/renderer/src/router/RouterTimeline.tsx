import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { AlertCircleIcon, ForwardIcon, LoaderIcon, StopIcon } from '@renderer/components/ui/icons'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { CodexItem, CodexRouter } from '../../../shared/codex'
import { ConversationItem } from '../codex/Conversation'
import { failureMessage } from '../codex/failures'
import { useCodexStore } from '../codex/store'
import { DispatchGroup } from './DispatchGroup'
import { isSetupFailure } from './RouterSetup'
import { useRouterStore } from './store'
import { ThreadRow } from './ThreadRow'
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
const speakerOf = (entry: Entry) =>
  'item' in entry && (entry.item.kind === 'user' || entry.item.kind === 'forward')
    ? 'user'
    : 'router'
const canForward = (item: CodexItem) =>
  ['user', 'assistant', 'forward'].includes(item.kind) &&
  item.status !== 'running' &&
  Boolean(item.text)

/** Content brought from another thread: the user's note, then the frozen copy. */
function ForwardedMessage({ item }: { item: CodexItem }) {
  const { t } = useTranslation()
  const showThread = useCodexStore((s) => s.showThread)
  const origin = item.forward
  return (
    <>
      {item.detail ? <div className="codex-user-message">{item.detail}</div> : null}
      <blockquote className="router-forwarded">
        <button
          type="button"
          disabled={!origin}
          onClick={() => origin && showThread(origin.routerId)}
        >
          <ForwardIcon size={12} aria-hidden />
          {t('forward.from', { title: origin?.title ?? t('thread.untitled') })}
        </button>
        <p>{item.text}</p>
        {origin?.branch ? <code>{origin.branch}</code> : null}
      </blockquote>
    </>
  )
}
function ForwardAction({ item, router }: { item: CodexItem; router: CodexRouter }) {
  const { t } = useTranslation()
  const startForward = useRouterStore((s) => s.startForward)
  return (
    <IconButton
      className="router-row-action"
      size="sm"
      label={t('forward.action')}
      tooltip={t('forward.action')}
      icon={<ForwardIcon size={13} />}
      onClick={() =>
        startForward({
          source: { kind: 'item', routerId: router.id, itemId: item.id },
          preview: item.text,
          projectId: router.projectId
        })
      }
    />
  )
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
/** A focused editor under the rest; a click on the page's blank space lands there. */
function focusEditor(scroller: HTMLElement) {
  if (!window.getSelection()?.isCollapsed) return
  scroller
    .querySelector<HTMLTextAreaElement>('.router-editor textarea')
    ?.focus({ preventScroll: true })
}
export function RouterTimeline({
  router,
  editor
}: {
  /** Undefined for a new thread: the editor still works, and creates it on the first send. */
  router: CodexRouter | undefined
  /** The thread's end: whatever is pending, then the line being written. */
  editor: ReactNode
}) {
  const { t } = useTranslation()
  const resolveBatch = useRouterStore((s) => s.resolveBatch)
  const interrupt = useRouterStore((s) => s.interrupt)
  const threadItems = useRouterStore((s) => (router ? s.items[router.id] : undefined))
  const loaded = useRouterStore((s) => (router ? s.itemsLoaded[router.id] : true))
  const entries = useMemo(
    () => entriesOf((threadItems ?? []).map((entry) => entry.item)),
    [threadItems]
  )
  const scroll = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const running = router?.status === 'running'
  const last = entries.at(-1)
  const lastEntrySpeaker = last ? speakerOf(last) : null
  // Watches the size, not the entries: streaming, the tray, and the draft all grow the thread.
  useEffect(() => {
    const scroller = scroll.current
    if (!scroller || !content.current) return
    const observer = new ResizeObserver(() => {
      if (nearBottom.current) scroller.scrollTop = scroller.scrollHeight
    })
    observer.observe(content.current)
    return () => observer.disconnect()
  }, [])
  return (
    <RouterIdContext.Provider value={router?.id ?? null}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; Tab reaches the editor. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: a pointer shortcut; Tab reaches the editor. */}
      <div
        className="codex-conversation-scroll"
        ref={scroll}
        onScroll={() => {
          const el = scroll.current
          if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
        }}
        onClick={(event) => {
          if (event.target === scroll.current || event.target === content.current)
            focusEditor(event.currentTarget)
        }}
      >
        <div className="codex-conversation" ref={content}>
          {router?.itemCount && !loaded ? (
            <div className="codex-working" role="status">
              <LoaderIcon size={13} className="animate-spin" />
              {t('thread.loading')}
            </div>
          ) : null}
          {entries.map((entry, index) => {
            const speaker = speakerOf(entry)
            const previous = entries[index - 1]
            return (
              <ThreadRow
                key={entry.id}
                speaker={speaker}
                follows={Boolean(previous) && speakerOf(previous) === speaker}
              >
                {'workerIds' in entry ? (
                  <DispatchGroup workerIds={entry.workerIds} />
                ) : entry.item.kind === 'forward' ? (
                  <ForwardedMessage item={entry.item} />
                ) : entry.item.kind === 'user' && entry.item.workerId ? (
                  <DirectedMessage item={entry.item} />
                ) : (
                  <ConversationItem
                    item={entry.item}
                    agent={t('router.agent')}
                    markdown={workerMarkdown}
                  />
                )}
                {router && 'item' in entry && canForward(entry.item) ? (
                  <ForwardAction item={entry.item} router={router} />
                ) : null}
              </ThreadRow>
            )
          })}
          {router && running ? (
            <ThreadRow speaker="router" follows={lastEntrySpeaker === 'router'}>
              <div className="codex-working" role="status">
                <LoaderIcon size={13} className="animate-spin" />
                {t('router.working')}
                <IconButton
                  size="sm"
                  label={t('router.stop')}
                  tooltip={t('router.stop')}
                  icon={<StopIcon size={11} />}
                  onClick={() => void interrupt(router.id)}
                />
              </div>
            </ThreadRow>
          ) : null}
          {router?.unknownBatches.map((batch) => (
            <div className="codex-inline-error router-unknown-batch" role="alert" key={batch.id}>
              <AlertCircleIcon size={15} />
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
          {router?.error && !isSetupFailure(router.error) ? (
            <div className="codex-inline-error" role="alert">
              <AlertCircleIcon size={15} />
              <span>{failureMessage(router.error)}</span>
            </div>
          ) : null}
          {editor}
        </div>
      </div>
    </RouterIdContext.Provider>
  )
}
