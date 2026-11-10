import { IconButton } from '@renderer/components/ui/icon-button'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderKanbanIcon,
  SettingsIcon
} from '@renderer/components/ui/icons'
import { ResizeHandle } from '@renderer/components/ui/resize-handle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { CodexProject } from '../../../shared/codex'
import type { RouterWorker } from '../../../shared/router'
import { isInPlay } from '../../../shared/worker-map'
import { useCodexStore } from '../codex/store'
import { AddProjectMenu } from './AddProjectMenu'
import { byAge, isWaitingOnUser, isWorking, projectHue, workerState, workerTitle } from './activity'
import { usePaneWidth } from './pane-width'
import { useRouterStore } from './store'
import { WorkerDot } from './WorkerLink'

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
        <TooltipContent side="left">{title}</TooltipContent>
      </Tooltip>
    </li>
  )
}
function ProjectRow({ project }: { project: CodexProject }) {
  const { t } = useTranslation()
  const showChat = useCodexStore((s) => s.showChat)
  const showProjectSettings = useCodexStore((s) => s.showProjectSettings)
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
  const settingsLabel = t('projectSettings.open', { project: project.name })
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
        <TooltipContent side="left">{project.path}</TooltipContent>
      </Tooltip>
      <IconButton
        size="custom"
        className={
          workers.length ? 'router-project-settings beside-fold' : 'router-project-settings'
        }
        label={settingsLabel}
        tooltip={settingsLabel}
        tooltipSide="left"
        icon={<SettingsIcon size={13} />}
        onClick={() => showProjectSettings(project.id)}
      />
      {workers.length ? (
        <IconButton
          size="custom"
          className="router-project-fold"
          label={foldLabel}
          tooltip={foldLabel}
          tooltipSide="left"
          aria-expanded={!folded}
          icon={folded ? <ChevronRightIcon size={13} /> : <ChevronDownIcon size={13} />}
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
/** The title bar button that opens and closes the Projects sidebar. */
export function ProjectsToggle() {
  const { t } = useTranslation()
  const open = useCodexStore((s) => s.settings.layout.projectsOpen)
  const toggleProjects = useCodexStore((s) => s.toggleProjects)
  const label = t(open ? 'router.hideProjects' : 'router.showProjects')
  return (
    <IconButton
      className="codex-bar-button router-projects-toggle"
      label={label}
      tooltip={label}
      tooltipSide="bottom"
      aria-pressed={open}
      icon={<FolderKanbanIcon size={16} />}
      onClick={toggleProjects}
    />
  )
}
/** The right-hand sidebar: projects, each with its workers in play. */
export function ProjectsSidebar() {
  const { t } = useTranslation()
  const { width, handle } = usePaneWidth('projects', 'left')
  const projects = useCodexStore((s) => s.projects)
  return (
    <aside className="router-projects" style={{ width }} aria-label={t('router.projectsPanel')}>
      <header className="router-projects-head">
        <h2>{t('router.projectsPanel')}</h2>
        <AddProjectMenu />
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
      <ResizeHandle {...handle} />
    </aside>
  )
}
