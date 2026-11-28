import {
  AutomationIcon,
  CardsIcon,
  FolderIcon,
  GaugeIcon,
  GitPullRequestIcon,
  NetworkIcon,
  PlusIcon,
  SettingsIcon
} from '@renderer/components/ui/icons'
import { AnchoredPopover } from '@renderer/components/ui/popover'
import { ResizeHandle } from '@renderer/components/ui/resize-handle'
import { AnchoredTooltip } from '@renderer/components/ui/tooltip'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Router } from '../../../shared/app'
import { DreamingOwl } from '../app/OwlAvatar'
import { useAppStore } from '../app/store'
import { useDreaming } from '../memory/dreaming'
import { DevicePicker } from '../remote/DevicePicker'
import { useViewingRemote } from '../remote/viewing'
import { usageSummaryRows, useUsageStore, watchUsage } from '../usage/store'
import { UsagePanel } from '../usage/UsagePanel'
import { UsageSummary } from '../usage/UsageSummary'
import { byRecent, isWaitingOnUser, isWorking, threadTitle, useThreadTitle } from './activity'
import { usePaneWidth } from './pane-width'
import { useRouterStore } from './store'
import { ThreadMenu, useThreadMenu } from './ThreadMenu'
import { ThreadTitleEditor } from './ThreadTitleEditor'

function ThreadEntry({ thread }: { thread: Router }) {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState(false)
  const menu = useThreadMenu()
  const current = useAppStore((s) => s.view === 'chat' && s.threadId === thread.id)
  const showThread = useAppStore((s) => s.showThread)
  const untitled = useThreadTitle()
  const state = useRouterStore((s) => {
    const workers = s.workers.filter((w) => w.routerId === thread.id && w.status !== 'removed')
    if (workers.some(isWaitingOnUser)) return 'wait'
    return thread.status === 'running' || workers.some(isWorking) ? 'run' : null
  })
  // Dreaming reads only quiet threads, so it never hides a run or a wait.
  const dreaming = useDreaming(thread.id) && state === null
  const title = threadTitle(thread, untitled)
  const label = state
    ? t(`thread.state.${state}`, { title })
    : dreaming
      ? t('thread.state.dream', { title })
      : title
  if (renaming)
    return (
      <ThreadTitleEditor
        thread={thread}
        className="router-thread-rename"
        onClose={() => setRenaming(false)}
      />
    )
  return (
    <>
      <button
        type="button"
        className="router-thread"
        aria-label={label}
        aria-current={current || undefined}
        aria-haspopup="menu"
        aria-expanded={menu.point !== null}
        data-menu-open={menu.point !== null || undefined}
        onClick={() => showThread(thread.id)}
        onContextMenu={menu.onContextMenu}
      >
        <span>{title}</span>
        {state ? <i className={state} aria-hidden /> : dreaming ? <DreamingOwl /> : null}
      </button>
      <ThreadMenu
        thread={thread}
        point={menu.point}
        row={menu.row}
        onClose={menu.close}
        onRename={() => setRenaming(true)}
      />
    </>
  )
}
/** A labeled group of thread rows; Pinned and the rest share one scrolling column. */
function ThreadGroup({ label, threads }: { label: string; threads: Router[] }) {
  return (
    <section className="router-sidebar-group" aria-label={label}>
      <header>
        <h2>{label}</h2>
      </header>
      <div className="router-sidebar-list">
        {threads.map((thread) => (
          <ThreadEntry key={thread.id} thread={thread} />
        ))}
      </div>
    </section>
  )
}
/** Hovering shows each agent's tightest limit; a click opens the full Usage popover above it. */
function UsageEntry() {
  const { t } = useTranslation()
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [peek, setPeek] = useState(false)
  const hasSummary = useUsageStore((s) => usageSummaryRows(s.overview).length > 0)
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
        onClick={() => {
          setPeek(false)
          setOpen((value) => !value)
        }}
        onMouseEnter={() => setPeek(true)}
        onMouseLeave={() => setPeek(false)}
        onFocus={(event) => setPeek(event.currentTarget.matches(':focus-visible'))}
        onBlur={() => setPeek(false)}
      >
        <GaugeIcon size={17} />
        <span>{t('usage.title')}</span>
      </button>
      <AnchoredTooltip
        reference={anchor}
        open={peek && !open && hasSummary}
        placement="top-start"
        className="owlto-usage-peek"
      >
        <UsageSummary />
      </AnchoredTooltip>
      <AnchoredPopover
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        label={t('usage.title')}
        placement="top-start"
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
  const onProjects = useAppStore((s) => s.view === 'projects')
  const onPulls = useAppStore((s) => s.view === 'pulls')
  const onAutomations = useAppStore((s) => s.view === 'automations')
  const pullsVisible = useAppStore((s) => s.settings.pullRequestsVisible)
  // Another device's Router shows only its threads and Overview; the rest is this Mac's.
  const remote = useViewingRemote()
  const drafting = useAppStore((s) => s.view === 'chat' && s.threadId === null)
  const {
    showMap,
    showCards,
    showProjects,
    showPullRequests,
    showAutomations,
    showSettings,
    newThread
  } = useAppStore()
  const routers = useRouterStore((s) => s.routers)
  // A thread exists once it has its first message; this hides one whose send failed.
  // Archived threads are listed in Settings instead.
  // Pinned threads keep the order they were pinned in, newest first.
  const { pinned, threads } = useMemo(() => {
    const listed = routers.filter((r) => r.itemCount && !r.archivedAt)
    return {
      pinned: listed
        .filter((r) => r.pinnedAt)
        .sort((a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? '') || byRecent(a, b)),
      threads: listed.filter((r) => !r.pinnedAt).sort(byRecent)
    }
  }, [routers])
  return (
    <nav className="router-sidebar" style={{ width }} aria-label={t('router.sidebar')}>
      <div className="router-sidebar-head" />
      <DevicePicker />
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
      {remote ? null : (
        <>
          <button
            type="button"
            className="router-sidebar-item router-sidebar-action"
            aria-current={onProjects || undefined}
            onClick={showProjects}
          >
            <FolderIcon size={17} />
            <span>{t('projectsPage.title')}</span>
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
          <button
            type="button"
            className="router-sidebar-item router-sidebar-action"
            aria-current={onAutomations || undefined}
            onClick={showAutomations}
          >
            <AutomationIcon size={17} />
            <span>{t('automations.title')}</span>
          </button>
        </>
      )}
      {pullsVisible && !remote ? (
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
      <div className="router-sidebar-threads">
        {pinned.length ? <ThreadGroup label={t('threadActions.pinned')} threads={pinned} /> : null}
        {threads.length ? (
          <ThreadGroup label={t('thread.title')} threads={threads} />
        ) : pinned.length ? null : (
          <section className="router-sidebar-group" aria-label={t('thread.title')}>
            <header>
              <h2>{t('thread.title')}</h2>
            </header>
            <p>{t('thread.none')}</p>
          </section>
        )}
      </div>
      {remote ? null : <UsageEntry />}
      <button
        type="button"
        className="router-sidebar-item router-sidebar-action router-sidebar-settings"
        onClick={() => showSettings()}
      >
        <SettingsIcon size={17} />
        <span>{t('settings')}</span>
      </button>
      <ResizeHandle {...handle} />
    </nav>
  )
}
