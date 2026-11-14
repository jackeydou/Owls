import {
  CardsIcon,
  GaugeIcon,
  GitPullRequestIcon,
  NetworkIcon,
  PlusIcon,
  SettingsIcon
} from '@renderer/components/ui/icons'
import { AnchoredPopover } from '@renderer/components/ui/popover'
import { ResizeHandle } from '@renderer/components/ui/resize-handle'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Router } from '../../../shared/app'
import { agentConnection, useAppStore } from '../app/store'
import { watchUsage } from '../usage/store'
import { UsagePanel } from '../usage/UsagePanel'
import { UsageSummary } from '../usage/UsageSummary'
import { byRecent, isWaitingOnUser, isWorking, threadTitle, useThreadTitle } from './activity'
import { usePaneWidth } from './pane-width'
import { useRouterStore } from './store'

function ThreadEntry({ thread }: { thread: Router }) {
  const { t } = useTranslation()
  const current = useAppStore((s) => s.view === 'chat' && s.threadId === thread.id)
  const showThread = useAppStore((s) => s.showThread)
  const untitled = useThreadTitle()
  const state = useRouterStore((s) => {
    const workers = s.workers.filter((w) => w.routerId === thread.id && w.status !== 'removed')
    if (workers.some(isWaitingOnUser)) return 'wait'
    return thread.status === 'running' || workers.some(isWorking) ? 'run' : null
  })
  const title = threadTitle(thread, untitled)
  return (
    <button
      type="button"
      className="router-thread"
      aria-label={state ? t(`thread.state.${state}`, { title }) : title}
      aria-current={current || undefined}
      onClick={() => showThread(thread.id)}
    >
      <span>{title}</span>
      {state ? <i className={state} aria-hidden /> : null}
    </button>
  )
}
/** Each agent's tightest limit at a glance; a click opens the full Usage popover beside it. */
function UsageEntry() {
  const { t } = useTranslation()
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => watchUsage(), [])
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className="router-sidebar-item router-sidebar-action router-sidebar-usage"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-current={open || undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="router-sidebar-usage-label">
          <GaugeIcon size={17} />
          <span>{t('usage.title')}</span>
        </span>
        <UsageSummary />
      </button>
      <AnchoredPopover
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        label={t('usage.title')}
        placement="right-end"
      >
        <UsagePanel />
      </AnchoredPopover>
    </>
  )
}
export function Sidebar() {
  const { t } = useTranslation()
  const { width, handle } = usePaneWidth('sidebar', 'right')
  const onMap = useAppStore((s) => s.view === 'map')
  const onCards = useAppStore((s) => s.view === 'cards')
  const onPulls = useAppStore((s) => s.view === 'pulls')
  const pullsVisible = useAppStore((s) => s.settings.pullRequestsVisible)
  const drafting = useAppStore((s) => s.view === 'chat' && s.threadId === null)
  const { showMap, showCards, showPullRequests, showSettings, newThread } = useAppStore()
  const routers = useRouterStore((s) => s.routers)
  // A thread exists once it has its first message; this hides one whose send failed.
  const threads = useMemo(() => routers.filter((r) => r.itemCount).sort(byRecent), [routers])
  const provider = useAppStore((s) => s.settings.provider)
  const connection = useAppStore((s) => agentConnection(s, provider))
  return (
    <nav className="router-sidebar" style={{ width }} aria-label={t('router.sidebar')}>
      <div className="router-sidebar-head" />
      <button
        type="button"
        className="router-sidebar-item router-sidebar-action"
        aria-current={drafting || undefined}
        onClick={() => newThread()}
      >
        <PlusIcon size={17} />
        <span>{t('thread.new')}</span>
        <kbd>⌘ N</kbd>
      </button>
      <button
        type="button"
        className="router-sidebar-item router-sidebar-action"
        aria-current={onMap || undefined}
        onClick={showMap}
      >
        <NetworkIcon size={17} />
        <span>{t('map.title')}</span>
        <kbd>⌘ J</kbd>
      </button>
      <button
        type="button"
        className="router-sidebar-item router-sidebar-action"
        aria-current={onCards || undefined}
        onClick={showCards}
      >
        <CardsIcon size={17} />
        <span>{t('cards.title')}</span>
        <kbd>⌘ K</kbd>
      </button>
      {pullsVisible ? (
        <button
          type="button"
          className="router-sidebar-item router-sidebar-action"
          aria-current={onPulls || undefined}
          onClick={showPullRequests}
        >
          <GitPullRequestIcon size={17} />
          <span>{t('pulls.title')}</span>
        </button>
      ) : null}
      <section className="router-sidebar-threads" aria-label={t('thread.title')}>
        <header>
          <h2>{t('thread.title')}</h2>
        </header>
        {threads.length ? (
          <div className="router-sidebar-list">
            {threads.map((thread) => (
              <ThreadEntry key={thread.id} thread={thread} />
            ))}
          </div>
        ) : (
          <p>{t('thread.none')}</p>
        )}
      </section>
      <UsageEntry />
      <button
        type="button"
        className={`router-sidebar-item router-sidebar-action router-sidebar-settings ${connection.status}`}
        onClick={() => showSettings()}
      >
        <SettingsIcon size={17} />
        <span>{t('settings')}</span>
      </button>
      <ResizeHandle {...handle} />
    </nav>
  )
}
