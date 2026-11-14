import { IconButton } from '@renderer/components/ui/icon-button'
import { ChevronDownIcon, ChevronRightIcon, SettingsIcon } from '@renderer/components/ui/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project } from '../../../shared/app'
import type { RouterWorker } from '../../../shared/router'
import { isInPlay } from '../../../shared/worker-map'
import { useAppStore } from '../app/store'
import { AddProjectMenu } from './AddProjectMenu'
import { byAge, isWaitingOnUser, isWorking, projectHue, workerState, workerTitle } from './activity'
import { ProjectIcon } from './ProjectIcon'
import { useRouterStore } from './store'
import { WorkerAvatar } from './WorkerLink'

function WorkerRow({ worker }: { worker: RouterWorker }) {
  const { t } = useTranslation()
  const inChat = useAppStore((s) => s.view === 'chat')
  const focusProject = useAppStore((s) => s.focusProject)
  const showThread = useAppStore((s) => s.showThread)
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
              else if (worker.projectId) focusProject(worker.projectId)
              showPanel({ kind: 'worker', workerId: worker.id })
            }}
          >
            <WorkerAvatar worker={worker} />
            <span>{title}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{title}</TooltipContent>
      </Tooltip>
    </li>
  )
}
function ProjectRow({ project }: { project: Project }) {
  const { t } = useTranslation()
  const showChat = useAppStore((s) => s.showChat)
  const showProjectSettings = useAppStore((s) => s.showProjectSettings)
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
            style={
              { '--owl-c': projectHue(project.id, project.settings.color) } as React.CSSProperties
            }
            aria-label={label}
            onClick={() => showChat(project.id)}
          >
            <ProjectIcon project={project} />
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
        icon={<SettingsIcon size={15} />}
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
          icon={folded ? <ChevronRightIcon size={15} /> : <ChevronDownIcon size={15} />}
          onClick={() => toggleProjectFold(project.id)}
        />
      ) : null}
      {workers.length && !folded ? (
        <ul
          className="router-sidebar-workers"
          aria-label={t('router.project.workers', { project: project.name })}
        >
          {workers.map((worker) => (
            <WorkerRow key={worker.id} worker={worker} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
/** The right-hand sidebar's projects list, each project with its workers in play. */
export function ProjectsPane() {
  const { t } = useTranslation()
  const projects = useAppStore((s) => s.projects)
  return (
    <section className="router-right-pane" aria-label={t('router.projectsPanel')}>
      <header>
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
    </section>
  )
}
