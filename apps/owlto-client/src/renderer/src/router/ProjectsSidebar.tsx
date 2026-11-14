import { ActionButton, ActionIconButton } from '@renderer/components/ui/action-button'
import { IconButton } from '@renderer/components/ui/icon-button'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  GitBranchIcon,
  SettingsIcon,
  XIcon
} from '@renderer/components/ui/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project } from '../../../shared/app'
import type { RouterWorker } from '../../../shared/router'
import { isInPlay } from '../../../shared/worker-map'
import { promotableFolders, WORKSPACE_ID } from '../../../shared/workspace'
import { useAppStore } from '../app/store'
import { useWorkspaceStore } from '../app/workspace'
import { AddProjectMenu } from './AddProjectMenu'
import { byAge, isWaitingOnUser, isWorking, projectHue, workerState, workerTitle } from './activity'
import { useWorkerHomes } from './homes'
import { ProjectIcon } from './ProjectIcon'
import { useRouterStore } from './store'
import { WorkerAvatar } from './WorkerLink'
import { WorkspaceIcon } from './WorkspaceIcon'

function WorkerRow({ worker, home }: { worker: RouterWorker; home: string }) {
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
              else focusProject(home)
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
type HomeEntry = {
  /** The project id, or the Workspace's. */
  id: string
  name: string
  tooltip: string
  icon: React.ReactNode
  hue: string
  settingsLabel: string
  onSettings(): void
}
function HomeRow({ entry, children }: { entry: HomeEntry; children?: React.ReactNode }) {
  const { t } = useTranslation()
  const showChat = useAppStore((s) => s.showChat)
  const allWorkers = useRouterStore((s) => s.workers)
  const homes = useWorkerHomes()
  const folded = useRouterStore((s) => s.foldedProjects.has(entry.id))
  const toggleProjectFold = useRouterStore((s) => s.toggleProjectFold)
  // Oldest first, so a row stays put while its neighbors change state.
  const workers = useMemo(
    () => allWorkers.filter((w) => homes.get(w.id) === entry.id && isInPlay(w)).sort(byAge),
    [allWorkers, homes, entry.id]
  )
  const state = workers.some(isWaitingOnUser) ? 'wait' : workers.some(isWorking) ? 'run' : null
  const label = state ? t(`router.project.${state}`, { project: entry.name }) : entry.name
  const foldLabel = t(folded ? 'router.project.showWorkers' : 'router.project.hideWorkers', {
    project: entry.name
  })
  return (
    <div className="router-sidebar-project">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={workers.length ? 'router-project foldable' : 'router-project'}
            style={{ '--owl-c': entry.hue } as React.CSSProperties}
            aria-label={label}
            onClick={() => showChat(entry.id)}
          >
            {entry.icon}
            <span>{entry.name}</span>
            {state ? <i className={state} aria-hidden /> : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{entry.tooltip}</TooltipContent>
      </Tooltip>
      <IconButton
        size="custom"
        className={
          workers.length ? 'router-project-settings beside-fold' : 'router-project-settings'
        }
        label={entry.settingsLabel}
        tooltip={entry.settingsLabel}
        tooltipSide="left"
        icon={<SettingsIcon size={15} />}
        onClick={entry.onSettings}
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
          onClick={() => toggleProjectFold(entry.id)}
        />
      ) : null}
      {children}
      {workers.length && !folded ? (
        <ul
          className="router-sidebar-workers"
          aria-label={t('router.project.workers', { project: entry.name })}
        >
          {workers.map((worker) => (
            <WorkerRow key={worker.id} worker={worker} home={entry.id} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
function ProjectRow({ project }: { project: Project }) {
  const { t } = useTranslation()
  const showProjectSettings = useAppStore((s) => s.showProjectSettings)
  return (
    <HomeRow
      entry={{
        id: project.id,
        name: project.name,
        tooltip: project.path,
        icon: <ProjectIcon project={project} />,
        hue: projectHue(project.id, project.settings.color),
        settingsLabel: t('projectSettings.open', { project: project.name }),
        onSettings: () => showProjectSettings(project.id)
      }}
    />
  )
}
/**
 * A light offer to make a git repository the workers made in the workspace its
 * own project. One repository at a time; the user can wave each one off.
 */
function PromotePrompt() {
  const { t } = useTranslation()
  const folders = useWorkspaceStore((s) => s.listing?.folders)
  const promote = useWorkspaceStore((s) => s.promote)
  const dismiss = useWorkspaceStore((s) => s.dismiss)
  const folder = folders ? promotableFolders(folders)[0] : undefined
  if (!folder) return null
  const dismissLabel = t('workspace.promptDismiss', { name: folder.name })
  return (
    <div className="router-workspace-prompt" role="status">
      <GitBranchIcon size={13} aria-hidden />
      <span>{t('workspace.prompt', { name: folder.name })}</span>
      <ActionButton
        size="sm"
        variant="ghost"
        className="router-workspace-promote"
        doneLabel={t('workspace.promoted')}
        onAction={async () => ((await promote(folder.path)) ? 'done' : 'quiet')}
      >
        {t('workspace.promote')}
      </ActionButton>
      <ActionIconButton
        size="custom"
        className="router-workspace-dismiss"
        label={dismissLabel}
        tooltip={dismissLabel}
        tooltipSide="left"
        icon={<XIcon size={13} />}
        onAction={async () => {
          await dismiss(folder.path)
          return 'quiet'
        }}
      />
    </div>
  )
}
/** The Workspace's row: tasks outside any project, always listed first. */
function WorkspaceRow() {
  const { t } = useTranslation()
  const showSettings = useAppStore((s) => s.showSettings)
  const root = useWorkspaceStore((s) => s.listing?.root ?? '')
  return (
    <HomeRow
      entry={{
        id: WORKSPACE_ID,
        name: t('workspace.name'),
        tooltip: t('workspace.tooltip', { path: root }),
        icon: <WorkspaceIcon />,
        hue: 'var(--color-muted-foreground)',
        settingsLabel: t('workspace.settings'),
        onSettings: () => showSettings('workspace')
      }}
    >
      <PromotePrompt />
    </HomeRow>
  )
}
/**
 * Reads the workspace folders when the list opens, when the window comes back
 * into focus, and when a Workspace worker settles, since that is when a new
 * repository can appear.
 */
function useWorkspaceRefresh() {
  const refresh = useWorkspaceStore((s) => s.refresh)
  const settled = useRouterStore((s) =>
    s.workers
      .filter((w) => w.projectId === null && !isInPlay(w))
      .map((w) => w.id)
      .join(' ')
  )
  const custom = useAppStore((s) => s.settings.workspacePath)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `settled` and `custom` are triggers.
  useEffect(() => {
    void refresh()
  }, [refresh, settled, custom])
  useEffect(() => {
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])
}
/** The right-hand sidebar's projects list: the Workspace, then each project, with workers in play. */
export function ProjectsPane() {
  const { t } = useTranslation()
  const projects = useAppStore((s) => s.projects)
  useWorkspaceRefresh()
  return (
    <section className="router-right-pane" aria-label={t('router.projectsPanel')}>
      <header>
        <h2>{t('router.projectsPanel')}</h2>
        <AddProjectMenu />
      </header>
      <div className="router-sidebar-list">
        <WorkspaceRow />
        {projects.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}
      </div>
    </section>
  )
}
