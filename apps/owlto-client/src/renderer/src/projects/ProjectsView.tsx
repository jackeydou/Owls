import { IconButton } from '@renderer/components/ui/icon-button'
import { FolderPlusIcon, PencilIcon } from '@renderer/components/ui/icons'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project } from '../../../shared/app'
import { isInPlay } from '../../../shared/worker-map'
import { WORKSPACE_ID } from '../../../shared/workspace'
import { useAppStore } from '../app/store'
import { useWorkspaceStore } from '../app/workspace'
import { AddProjectMenu } from '../router/AddProjectMenu'
import { isWaitingOnUser, isWorking, projectHue } from '../router/activity'
import { threadHome, useWorkerHomes } from '../router/homes'
import { ProjectIcon } from '../router/ProjectIcon'
import { useWorkspaceRefresh } from '../router/ProjectsSidebar'
import { useRouterStore } from '../router/store'
import { WorkspaceIcon } from '../router/WorkspaceIcon'
import './projects.css'

type CardEntry = {
  /** The project id, or the Workspace's. */
  id: string
  name: string
  path: string
  description: string | null
  icon: React.ReactNode
  hue: string
  isDefault: boolean
  onEdit(): void
}

/** Thread and worker counts for one card, from the same homes the map and sidebar use. */
function useCardStats(id: string) {
  const routers = useRouterStore((s) => s.routers)
  const workers = useRouterStore((s) => s.workers)
  const homes = useWorkerHomes()
  return useMemo(() => {
    const threads = routers.filter(
      (r) => r.itemCount && !r.archivedAt && threadHome(r.projectId) === id
    ).length
    const mine = workers.filter((w) => homes.get(w.id) === id && isInPlay(w))
    return {
      threads,
      working: mine.filter(isWorking).length,
      waiting: mine.filter(isWaitingOnUser).length
    }
  }, [routers, workers, homes, id])
}

function ProjectCard({ entry }: { entry: CardEntry }) {
  const { t } = useTranslation()
  const showChat = useAppStore((s) => s.showChat)
  const { threads, working, waiting } = useCardStats(entry.id)
  const editLabel = t('projectsPage.edit', { project: entry.name })
  return (
    <li
      className={entry.isDefault ? 'projects-card default' : 'projects-card'}
      style={{ '--owl-c': entry.hue } as React.CSSProperties}
    >
      <button
        type="button"
        className="projects-card-main"
        aria-label={t('projectsPage.open', { project: entry.name })}
        onClick={() => showChat(entry.id)}
      >
        <span className="projects-card-head">
          {entry.icon}
          <strong>{entry.name}</strong>
          {entry.isDefault ? (
            <span className="projects-card-badge">{t('projectsPage.default')}</span>
          ) : null}
        </span>
        <code className="projects-card-path">{entry.path}</code>
        <span className={entry.description ? 'projects-card-body' : 'projects-card-body muted'}>
          {entry.description ?? t('projectsPage.noDescription')}
        </span>
        <span className="projects-card-stats">
          <span>
            {threads ? t('projectsPage.threads', { count: threads }) : t('projectsPage.noThreads')}
          </span>
          {working ? (
            <span className="run">{t('projectsPage.working', { count: working })}</span>
          ) : null}
          {waiting ? (
            <span className="wait">{t('projectsPage.waiting', { count: waiting })}</span>
          ) : null}
        </span>
      </button>
      <IconButton
        size="sm"
        className="projects-card-edit"
        label={editLabel}
        tooltip={editLabel}
        icon={<PencilIcon size={15} />}
        onClick={entry.onEdit}
      />
    </li>
  )
}

/** The Projects page: the Workspace first as the default, then each project, as cards. */
export function ProjectsView() {
  const { t } = useTranslation()
  const projects = useAppStore((s) => s.projects)
  const showSettings = useAppStore((s) => s.showSettings)
  const showProjectSettings = useAppStore((s) => s.showProjectSettings)
  const root = useWorkspaceStore((s) => s.listing?.root ?? '')
  useWorkspaceRefresh()
  const workspace: CardEntry = {
    id: WORKSPACE_ID,
    name: t('workspace.name'),
    path: root,
    description: t('projectsPage.workspaceHint'),
    icon: <WorkspaceIcon />,
    hue: 'var(--color-muted-foreground)',
    isDefault: true,
    onEdit: () => showSettings('workspace')
  }
  const entry = (project: Project): CardEntry => ({
    id: project.id,
    name: project.name,
    path: project.path,
    description: project.settings.description.trim() || null,
    icon: <ProjectIcon project={project} />,
    hue: projectHue(project.id, project.settings.color),
    isDefault: false,
    onEdit: () => showProjectSettings(project.id)
  })
  return (
    <main className="owlto-chat projects-view">
      <header className="owlto-topbar router-topbar">
        <div className="router-thread-heading">
          <strong>{t('projectsPage.title')}</strong>
          <span>{t('projectsPage.subtitle')}</span>
        </div>
        <div className="owlto-topbar-actions">
          <AddProjectMenu labeled />
        </div>
      </header>
      <div className="projects-body">
        <ul className="projects-grid" aria-label={t('projectsPage.list')}>
          <ProjectCard entry={workspace} />
          {projects.map((project) => (
            <ProjectCard key={project.id} entry={entry(project)} />
          ))}
          {projects.length ? null : (
            <li className="projects-empty">
              <FolderPlusIcon size={22} aria-hidden />
              <strong>{t('projectsPage.emptyTitle')}</strong>
              <p>{t('projectsPage.emptyBody')}</p>
              <AddProjectMenu labeled />
            </li>
          )}
        </ul>
      </div>
    </main>
  )
}
