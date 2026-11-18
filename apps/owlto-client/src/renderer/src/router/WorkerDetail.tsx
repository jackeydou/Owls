import { ActionIconButton } from '@renderer/components/ui/action-button'
import { IconButton } from '@renderer/components/ui/icon-button'
import {
  AlertCircleIcon,
  ArrowDownIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CircleXIcon,
  ForwardIcon,
  GitBranchIcon,
  type IconComponent,
  LoaderIcon,
  StopIcon,
  TrashIcon,
  XIcon
} from '@renderer/components/ui/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RouterWorker } from '../../../shared/router'
import { useAppStore } from '../app/store'
import { SaveCardAction } from '../cards/CardActions'
import { canStop, type WorkerState, workerState, workerTitle } from './activity'
import { DiffCounts, DiffView } from './DiffView'
import { diffStats, parseDiff } from './diff'
import { useFollowScroll } from './follow-scroll'
import { OpenInButton } from './OpenInButton'
import { useRouterStore } from './store'
import { WorkerComposer } from './WorkerComposer'
import { WorkerConversation } from './WorkerConversation'
import { WorkerGitHub } from './WorkerGitHub'
import './worker-detail.css'
import { useViewingRemote } from '../remote/viewing'

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
  return (
    <aside className="router-panel worker-panel" aria-label={title}>
      <header>
        <div>
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
        {remote ? null : <OpenInButton worker={worker} />}
        {canStop(worker) ? (
          <ActionIconButton
            size="sm"
            label={t('worker.stop')}
            tooltip={t('worker.stop')}
            icon={<StopIcon size={14} />}
            onAction={() => stopWorker(worker.routerId, worker.id)}
          />
        ) : remote ? null : (
          <ActionIconButton
            size="sm"
            label={t('worker.remove')}
            tooltip={t('worker.remove')}
            icon={<TrashIcon size={15} />}
            onAction={() => removeWorker(worker.routerId, worker.id)}
          />
        )}
        {report && !remote ? (
          <IconButton
            size="sm"
            label={t('forward.action')}
            tooltip={t('forward.action')}
            icon={<ForwardIcon size={15} />}
            onClick={() =>
              startForward({
                source: { kind: 'worker', routerId: worker.routerId, workerId: worker.id },
                preview: report.summary,
                projectId: worker.projectId
              })
            }
          />
        ) : null}
        {report && !remote ? (
          <SaveCardAction
            source={{ kind: 'worker', routerId: worker.routerId, workerId: worker.id }}
            text={report.summary}
            title={title}
            projectId={worker.projectId}
          />
        ) : null}
        <IconButton
          size="sm"
          label={t('worker.close')}
          tooltip={t('worker.close')}
          icon={<XIcon size={17} />}
          onClick={() => showPanel(null)}
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
    </aside>
  )
}
