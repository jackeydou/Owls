import { Button } from '@renderer/components/ui/button'
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LoaderIcon
} from '@renderer/components/ui/icons'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { MapNode } from '../../../../shared/worker-map'
import { AppLogoMark } from '../../codex/AppLogo'
import { useCodexStore } from '../../codex/store'
import {
  elapsed,
  isWaitingOnUser,
  isWorking,
  liveLine,
  openRequests,
  plainLine,
  workerState,
  workerTitle,
  workerTone
} from '../activity'
import { useRouterStore } from '../store'
import { WorkerDot } from '../WorkerLink'
import type { WorkerProject } from './projects'

type WorkerNode = Extract<MapNode, { kind: 'worker' }>
type ProjectNode = Extract<MapNode, { kind: 'project' }>

function routerLine(project: WorkerProject | undefined): string | null {
  const preview = project?.router?.preview
  return preview ? plainLine(preview) : null
}
function ProjectBody({ node, project }: { node: ProjectNode; project?: WorkerProject }) {
  const { t } = useTranslation()
  const showChat = useCodexStore((s) => s.showChat)
  const enter = (
    <button
      type="button"
      className="map-enter"
      tabIndex={-1}
      onClick={() => showChat(node.projectId)}
    >
      {t('map.enter')}
      <ArrowRightIcon size={11} aria-hidden />
    </button>
  )
  if (!project || node.quiet)
    return (
      <>
        <span className="map-project-head">
          <strong>{project?.name}</strong>
        </span>
        {enter}
      </>
    )
  const live = project.workers.filter((w) => w.status !== 'removed')
  const waiting = live.filter(isWaitingOnUser).length
  const working = live.filter(isWorking).length
  const busy = project.router?.status === 'running'
  return (
    <>
      <span className="map-project-head">
        <strong>{project.name}</strong>
        {waiting ? (
          <em className="wait">{t('router.statusWaiting', { count: waiting })}</em>
        ) : working ? (
          <em>{t('router.statusWorking', { count: working })}</em>
        ) : null}
      </span>
      <span className={busy ? 'map-project-line busy' : 'map-project-line'}>
        {busy ? <LoaderIcon size={11} className="animate-spin" aria-hidden /> : null}
        {busy ? t('router.working') : (routerLine(project) ?? t('map.notStarted'))}
      </span>
      {enter}
    </>
  )
}
function Approval({ node }: { node: WorkerNode }) {
  const { t } = useTranslation()
  const respond = useCodexStore((s) => s.respond)
  const { sessionId } = node.worker
  const request = useCodexStore((s) =>
    openRequests(s.sessions.find((x) => x.id === sessionId)).find((r) => r.kind !== 'question')
  )
  if (!request) return null
  const answer = (decision: 'accept' | 'decline') =>
    void respond({ sessionId, requestId: request.id, decision })
  const pending = request.status === 'answering'
  return (
    <>
      <pre>{request.title || request.detail}</pre>
      <span className="map-actions">
        <Button
          size="sm"
          tabIndex={-1}
          disabled={pending}
          onClick={(event) => {
            event.stopPropagation()
            answer('accept')
          }}
        >
          {t('approve')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          tabIndex={-1}
          disabled={pending}
          onClick={(event) => {
            event.stopPropagation()
            answer('decline')
          }}
        >
          {t('decline')}
        </Button>
      </span>
    </>
  )
}
function WorkerBody({ node, now }: { node: WorkerNode; now: number }) {
  const { t } = useTranslation()
  const { worker } = node
  const toggleCollapsed = useRouterStore((s) => s.toggleCollapsed)
  // A primitive, so a node re-renders when its line changes and not on every streamed delta.
  const line = useCodexStore((s) => {
    if (worker.status !== 'running' && worker.status !== 'waiting' && worker.status !== 'starting')
      return ''
    const live = liveLine(s.sessions.find((x) => x.id === worker.sessionId))
    return live ? `${live.mono ? 'm' : 't'}${live.text}` : ''
  })
  const hasQuestion = useCodexStore((s) =>
    openRequests(s.sessions.find((x) => x.id === worker.sessionId)).some(
      (r) => r.kind === 'question'
    )
  )
  const state = workerState(worker)
  const age = elapsed(worker.createdAt, now)
  const tone = workerTone(worker)
  return (
    <>
      <span className="map-worker-head">
        <WorkerDot worker={worker} />
        <span className="map-worker-title">{workerTitle(worker)}</span>
        <span className="map-time">{t(`map.age.${age.unit}`, { count: age.value })}</span>
      </span>
      <span className="sr-only">{t(`workerState.${state}`)}</span>
      {node.height > 100 ? (
        <Approval node={node} />
      ) : hasQuestion ? (
        <span className="map-worker-line wait">{t('map.needsAnswer')}</span>
      ) : line ? (
        <span className={line[0] === 'm' ? 'map-worker-line mono' : 'map-worker-line'}>
          {line.slice(1)}
        </span>
      ) : node.height > 40 ? (
        <span className={`map-worker-line ${tone}`}>{t(`workerState.${state}`)}</span>
      ) : null}
      {node.childCount ? (
        <button
          type="button"
          className="map-toggle"
          tabIndex={-1}
          aria-label={t(node.collapsed ? 'map.expand' : 'map.collapse')}
          onClick={(event) => {
            event.stopPropagation()
            toggleCollapsed(worker.id)
          }}
        >
          {node.collapsed ? node.childCount : '−'}
        </button>
      ) : null}
    </>
  )
}
export const MapNodeView = memo(function MapNodeView({
  node,
  project,
  hue,
  selected,
  dim,
  inPlay,
  now
}: {
  node: MapNode
  project?: WorkerProject
  hue: string
  selected: boolean
  dim: boolean
  inPlay: number
  now: number
}) {
  const { t } = useTranslation()
  const tone = node.kind === 'worker' ? workerTone(node.worker) : null
  const state =
    tone === 'wait' || tone === 'bad'
      ? tone
      : tone === 'run' || tone === 'queue'
        ? 'live'
        : tone
          ? 'ended'
          : ''
  const quiet = node.kind === 'project' && node.quiet ? 'quiet' : ''
  return (
    <div
      role="treeitem"
      tabIndex={-1}
      data-node={node.id}
      aria-selected={selected}
      className={`map-node ${node.kind} ${state} ${quiet} ${node.side < 0 ? 'left' : ''} ${dim ? 'dim' : ''}`}
      style={
        {
          '--owl-c': hue,
          width: node.width,
          height: node.height,
          transform: `translate(${node.x}px, ${node.y}px)`
        } as React.CSSProperties
      }
    >
      {node.kind === 'root' ? (
        <>
          <AppLogoMark />
          <strong>{t('map.you')}</strong>
          <small>{t('map.inPlay', { count: inPlay })}</small>
        </>
      ) : node.kind === 'project' ? (
        <ProjectBody node={node} project={project} />
      ) : node.kind === 'worker' ? (
        <WorkerBody node={node} now={now} />
      ) : node.kind === 'done' ? (
        <>
          {node.open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          <span>{t('map.done', { count: node.count })}</span>
        </>
      ) : (
        <>
          <i className="router-dot hollow" aria-hidden />
          <span>{t('router.keptWorktrees')}</span>
        </>
      )}
    </div>
  )
})
