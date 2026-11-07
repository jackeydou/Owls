import { IconButton } from '@renderer/components/ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { ChevronDown, ChevronRight, Network, Plus, Settings2, SquarePen } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { CodexProject, CodexRouter } from '../../../shared/codex'
import type { RouterWorker } from '../../../shared/router'
import { isInPlay } from '../../../shared/worker-map'
import { AppLogoMark } from '../codex/AppLogo'
import { agentConnection, useCodexStore } from '../codex/store'
import {
  byAge,
  byRecent,
  isWaitingOnUser,
  isWorking,
  projectHue,
  threadTitle,
  useThreadTitle,
  workerState,
  workerTitle
} from './activity'
import { useRouterStore } from './store'
import { WorkerDot } from './WorkerLink'

function ThreadEntry({ thread }: { thread: CodexRouter }) {
  const { t } = useTranslation()
  const current = useCodexStore((s) => s.view === 'chat' && s.threadId === thread.id)
  const showThread = useCodexStore((s) => s.showThread)
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
function WorkerRow({ worker, projectId }: { worker: RouterWorker; projectId: string }) {
  const { t } = useTranslation()
  const inChat = useCodexStore((s) => s.view === 'chat')
  const focusProject = useCodexStore((s) => s.focusProject)
  const showThread = useCodexStore((s) => s.showThread)
  const showPanel = useRouterStore((s) => s.showPanel)
  const current = useRouterStore(
    (s) => s.panel?.kind === 'worker' && s.panel.workerId === worker.id
  )
  const title = workerTitle(worker)
  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="router-sidebar-worker"
            aria-label={t('router.project.worker', {
              worker: title,
              state: t(`workerState.${workerState(worker)}`)
            })}
            aria-current={current || undefined}
            onClick={() => {
              // The conversation follows the worker; the map stays where it is.
              if (inChat) showThread(worker.routerId)
              else focusProject(projectId)
              showPanel({ kind: 'worker', workerId: worker.id })
            }}
          >
            <WorkerDot worker={worker} />
            <span>{title}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{title}</TooltipContent>
      </Tooltip>
    </li>
  )
}
function ProjectRow({ project }: { project: CodexProject }) {
  const { t } = useTranslation()
  const showChat = useCodexStore((s) => s.showChat)
  const allWorkers = useRouterStore((s) => s.workers)
  const folded = useRouterStore((s) => s.foldedProjects.has(project.id))
  const toggleProjectFold = useRouterStore((s) => s.toggleProjectFold)
  // Oldest first, so a row stays put while its neighbors change state.
  const workers = useMemo(
    () => allWorkers.filter((w) => w.projectId === project.id && isInPlay(w)).sort(byAge),
    [allWorkers, project.id]
  )
  const state = workers.some(isWaitingOnUser) ? 'wait' : workers.some(isWorking) ? 'run' : null
  const label = state ? t(`router.project.${state}`, { project: project.name }) : project.name
  const foldLabel = t(folded ? 'router.project.showWorkers' : 'router.project.hideWorkers', {
    project: project.name
  })
  return (
    <div className="router-sidebar-project">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={workers.length ? 'router-project foldable' : 'router-project'}
            style={{ '--owl-c': projectHue(project.id) } as React.CSSProperties}
            aria-label={label}
            onClick={() => showChat(project.id)}
          >
            <b aria-hidden="true">{project.name.slice(0, 1).toUpperCase()}</b>
            <span>{project.name}</span>
            {state ? <i className={state} aria-hidden /> : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{project.path}</TooltipContent>
      </Tooltip>
      {workers.length ? (
        <IconButton
          size="custom"
          className="router-project-fold"
          label={foldLabel}
          tooltip={foldLabel}
          tooltipSide="right"
          aria-expanded={!folded}
          icon={folded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          onClick={() => toggleProjectFold(project.id)}
        />
      ) : null}
      {workers.length && !folded ? (
        <ul
          className="router-sidebar-workers"
          aria-label={t('router.project.workers', { project: project.name })}
        >
          {workers.map((worker) => (
            <WorkerRow key={worker.id} worker={worker} projectId={project.id} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
export function Sidebar() {
  const { t } = useTranslation()
  const projects = useCodexStore((s) => s.projects)
  const onMap = useCodexStore((s) => s.view === 'map')
  const drafting = useCodexStore((s) => s.view === 'chat' && s.threadId === null)
  const { showMap, showSettings, pickProject, newThread } = useCodexStore()
  const routers = useRouterStore((s) => s.routers)
  // A thread exists once it has its first message; this hides one whose send failed.
  const threads = useMemo(() => routers.filter((r) => r.itemCount).sort(byRecent), [routers])
  const provider = useCodexStore((s) => s.settings.provider)
  const connection = useCodexStore((s) => agentConnection(s, provider))
  return (
    <nav className="router-sidebar" aria-label={t('router.sidebar')}>
      <div className="router-sidebar-head" />
      <div className="router-sidebar-logo">
        <AppLogoMark />
        <strong>Owls</strong>
      </div>
      <button
        type="button"
        className="router-sidebar-item"
        aria-current={drafting || undefined}
        onClick={() => newThread()}
      >
        <SquarePen size={15} />
        <span>{t('thread.new')}</span>
        <kbd>⌘ N</kbd>
      </button>
      <button
        type="button"
        className="router-sidebar-item"
        aria-current={onMap || undefined}
        onClick={showMap}
      >
        <Network size={15} />
        <span>{t('map.title')}</span>
        <kbd>⌘ J</kbd>
      </button>
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
      <section className="router-sidebar-projects" aria-label={t('projects')}>
        <header>
          <h2>{t('projects')}</h2>
          <IconButton
            size="sm"
            label={t('addProject')}
            tooltip={t('addProject')}
            tooltipSide="right"
            icon={<Plus size={14} />}
            onClick={() => void pickProject()}
          />
        </header>
        {projects.length ? (
          <div className="router-sidebar-list">
            {projects.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <p>{t('router.noProjects')}</p>
        )}
      </section>
      <button
        type="button"
        className={`router-sidebar-item router-sidebar-settings ${connection.status}`}
        onClick={() => showSettings()}
      >
        <Settings2 size={15} />
        <span>{t('settings')}</span>
      </button>
    </nav>
  )
}
