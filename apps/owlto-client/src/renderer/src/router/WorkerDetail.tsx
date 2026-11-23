import { ActionIconButton } from '@renderer/components/ui/action-button'
import { IconButton } from '@renderer/components/ui/icon-button'
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CircleXIcon,
  ForwardIcon,
  GitBranchIcon,
  GlobeIcon,
  type IconComponent,
  LoaderIcon,
  StopIcon,
  TrashIcon
} from '@renderer/components/ui/icons'
import { MenuItem, MenuSeparator } from '@renderer/components/ui/menu'
import { type OverflowAction, OverflowBar } from '@renderer/components/ui/overflow-bar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RouterWorker } from '../../../shared/router'
import { useAppStore } from '../app/store'
import { showBrowserTab, useWorkerTab } from '../browser/store'
import { SaveCardAction, SaveCardMenuItem } from '../cards/CardActions'
import { canStop, type WorkerState, workerState, workerTitle } from './activity'
import { DiffCounts, DiffView } from './DiffView'
import { diffStats, parseDiff } from './diff'
import { useFollowScroll } from './follow-scroll'
import { OpenInButton, OpenInMenuItems } from './OpenInButton'
import { useRouterStore } from './store'
import { WorkerComposer } from './WorkerComposer'
import { WorkerConversation } from './WorkerConversation'
import { WorkerGitHub } from './WorkerGitHub'
import './worker-detail.css'
import { useViewingRemote } from '../remote/viewing'

/** The bar's padding and gaps, the back button, and the least room the title and its change counts keep. */
const HEADER_RESERVE = 14 + 8 + 32 + 200
const STATE_ICONS: Record<WorkerState, IconComponent> = {
  queued: CircleDashedIcon,
  running: LoaderIcon,
  waiting: AlertCircleIcon,
  blocked: AlertCircleIcon,
  needs_input: AlertCircleIcon,
  done: CircleCheckIcon,
  progress: CircleCheckIcon,
  stopped: CircleMinusIcon,
  failed: CircleXIcon
}
/** The worker's state as one icon; its name is the tooltip and the accessible label. */
function WorkerStateIcon({ worker }: { worker: RouterWorker }) {
  const { t } = useTranslation()
  const state = workerState(worker)
  const Icon = STATE_ICONS[state]
  const label = t(`workerState.${state}`)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="worker-state" data-state={state} role="img" aria-label={label}>
          <Icon size={18} className={state === 'running' ? 'animate-spin' : undefined} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
export function WorkerDetail({ worker }: { worker: RouterWorker }) {
  const { t } = useTranslation()
  const session = useAppStore((s) => s.sessions.find((x) => x.id === worker.sessionId))
  // A workspace worker has no project; its session's folder shortens paths instead.
  const projectPath = useAppStore(
    (s) => s.projects.find((p) => p.id === worker.projectId)?.path ?? session?.cwd ?? ''
  )
  const { stopWorker, removeWorker, showPanel, startForward } = useRouterStore()
  // Folders, notes, forwarding, and removing stay with the device that runs the worker.
  const remote = useViewingRemote()
  const openInApps = useRouterStore((s) => s.openInApps)
  const loadOpenInApps = useRouterStore((s) => s.loadOpenInApps)
  useEffect(() => {
    if (openInApps === null && !remote) void loadOpenInApps()
  }, [openInApps, loadOpenInApps, remote])
  const { report } = worker
  const [view, setView] = useState<'conversation' | 'changes'>('conversation')
  const diff = session?.diff ?? ''
  const files = useMemo(() => parseDiff(diff), [diff])
  const stats = diffStats(files)
  const changed = stats.added + stats.removed > 0
  const showChanges = view === 'changes' && changed
  const worktree = worker.workspace.kind === 'worktree' ? worker.workspace.branch : null
  const title = workerTitle(worker)
  const follow = useFollowScroll(!showChanges)
  const browserTab = useWorkerTab(worker.id)
  const workerSource = { kind: 'worker', routerId: worker.routerId, workerId: worker.id } as const
  // In order of importance: whatever the bar has no room for moves into More from the end.
  const actions: OverflowAction[] = []
  const openable = !(worker.workspace.kind === 'worktree' && worker.workspace.state === 'released')
  if (!remote && openable && openInApps?.length)
    actions.push({
      id: 'open-in',
      bar: <OpenInButton worker={worker} />,
      menu: <OpenInMenuItems worker={worker} />
    })
  if (browserTab && !remote)
    actions.push({
      id: 'browser',
      bar: (
        <IconButton
          size="sm"
          className="worker-browser-button"
          data-needs={browserTab.needsYou || undefined}
          label={t('browser.viewInBrowser')}
          tooltip={t('browser.viewInBrowser')}
          icon={<GlobeIcon size={15} />}
          onClick={() => showBrowserTab(browserTab.tabId)}
        />
      ),
      menu: (
        <MenuItem onSelect={() => showBrowserTab(browserTab.tabId)}>
          <GlobeIcon size={15} />
          {t('browser.viewInBrowser')}
        </MenuItem>
      )
    })
  if (canStop(worker))
    actions.push({
      id: 'stop',
      bar: (
        <ActionIconButton
          size="sm"
          label={t('worker.stop')}
          tooltip={t('worker.stop')}
          icon={<StopIcon size={14} />}
          onAction={() => stopWorker(worker.routerId, worker.id)}
        />
      ),
      menu: (
        <MenuItem onSelect={() => void stopWorker(worker.routerId, worker.id)}>
          <StopIcon size={14} />
          {t('worker.stop')}
        </MenuItem>
      )
    })
  else if (!remote)
    actions.push({
      id: 'remove',
      bar: (
        <ActionIconButton
          size="sm"
          label={t('worker.remove')}
          tooltip={t('worker.remove')}
          icon={<TrashIcon size={15} />}
          onAction={() => removeWorker(worker.routerId, worker.id)}
        />
      ),
      menu: (
        <MenuItem onSelect={() => void removeWorker(worker.routerId, worker.id)}>
          <TrashIcon size={15} />
          {t('worker.remove')}
        </MenuItem>
      )
    })
  if (report && !remote) {
    const forward = () =>
      startForward({ source: workerSource, preview: report.summary, projectId: worker.projectId })
    actions.push(
      {
        id: 'forward',
        bar: (
          <IconButton
            size="sm"
            label={t('forward.action')}
            tooltip={t('forward.action')}
            icon={<ForwardIcon size={15} />}
            onClick={forward}
          />
        ),
        menu: (
          <MenuItem onSelect={forward}>
            <ForwardIcon size={15} />
            {t('forward.action')}
          </MenuItem>
        )
      },
      {
        id: 'save-note',
        bar: (
          <SaveCardAction
            source={workerSource}
            text={report.summary}
            title={title}
            projectId={worker.projectId}
          />
        ),
        menu: (
          <SaveCardMenuItem
            source={workerSource}
            text={report.summary}
            title={title}
            projectId={worker.projectId}
          />
        )
      }
    )
  }
  // The app list sits apart from the plain actions after it.
  if (actions[0]?.id === 'open-in' && actions.length > 1)
    actions[0] = {
      ...actions[0],
      menu: (
        <>
          <OpenInMenuItems worker={worker} />
          <MenuSeparator />
        </>
      )
    }
  return (
    <section className="router-right-pane worker-panel" aria-label={title}>
      {/* The sidebar's second bar: back to the list, the worker, and what can be done with it. */}
      <header>
        <IconButton
          size="sm"
          className="worker-back"
          label={t('back')}
          tooltip={t('back')}
          icon={<ArrowLeftIcon size={16} />}
          onClick={() => showPanel(null)}
        />
        <div className="worker-title">
          <h2>
            <WorkerStateIcon worker={worker} />
            <span>{title}</span>
          </h2>
          {changed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="worker-changes-toggle"
                  aria-pressed={showChanges}
                  aria-label={t(showChanges ? 'worker.hideChanges' : 'worker.showChanges', stats)}
                  onClick={() => setView(showChanges ? 'conversation' : 'changes')}
                >
                  <DiffCounts stats={stats} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t(showChanges ? 'worker.hideChanges' : 'worker.showChanges', stats)}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <OverflowBar
          actions={actions}
          reserve={HEADER_RESERVE}
          moreLabel={t('worker.more')}
          className="worker-actions"
        />
      </header>
      {worktree ? (
        <p className="worker-branch">
          <GitBranchIcon size={12} aria-hidden />
          <code>{worktree}</code>
        </p>
      ) : null}
      <WorkerGitHub worker={worker} />
      <div className="worker-body">
        <div
          className="router-panel-body"
          ref={follow.scroller}
          onScroll={follow.onScroll}
          onWheel={follow.onWheel}
        >
          <div ref={follow.content}>
            {showChanges ? (
              <DiffView files={files} projectPath={projectPath} />
            ) : (
              <WorkerConversation
                worker={worker}
                session={session}
                projectPath={projectPath}
                onToggleFold={follow.release}
              />
            )}
          </div>
        </div>
        {follow.away ? (
          <IconButton
            variant="outline"
            className="worker-jump"
            label={t('worker.jumpToLatest')}
            tooltip={t('worker.jumpToLatest')}
            icon={<ArrowDownIcon size={16} />}
            onClick={follow.jumpToBottom}
          />
        ) : null}
      </div>
      <WorkerComposer key={worker.id} worker={worker} />
    </section>
  )
}
