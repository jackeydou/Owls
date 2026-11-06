import { IconButton } from '@renderer/components/ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { Network, PanelLeftClose, Plus, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CodexProject } from '../../../shared/codex'
import { AppLogoMark } from '../codex/AppLogo'
import { agentConnection, useCodexStore } from '../codex/store'
import { isWaitingOnUser, isWorking, projectHue } from './activity'
import { useRouterStore } from './store'

function ProjectRow({ project }: { project: CodexProject }) {
  const { t } = useTranslation()
  const current = useCodexStore((s) => s.view === 'chat' && s.routerProjectId === project.id)
  const showChat = useCodexStore((s) => s.showChat)
  const state = useRouterStore((s) => {
    const router = s.routers.find((r) => r.projectId === project.id)
    const workers = s.workers.filter((w) => w.routerId === router?.id && w.status !== 'removed')
    return workers.some(isWaitingOnUser) ? 'wait' : workers.some(isWorking) ? 'run' : null
  })
  const label = state ? t(`router.project.${state}`, { project: project.name }) : project.name
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="router-project"
          style={{ '--owl-c': projectHue(project.id) } as React.CSSProperties}
          aria-label={label}
          aria-current={current || undefined}
          onClick={() => showChat(project.id)}
        >
          <b aria-hidden="true">{project.name.slice(0, 1).toUpperCase()}</b>
          <span>{project.name}</span>
          {state ? <i className={state} aria-hidden /> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{project.path}</TooltipContent>
    </Tooltip>
  )
}
export function Sidebar() {
  const { t } = useTranslation()
  const projects = useCodexStore((s) => s.projects)
  const onMap = useCodexStore((s) => s.view === 'map')
  const inSettings = useCodexStore((s) => s.view === 'settings')
  const { showMap, showSettings, pickProject, toggleSidebar } = useCodexStore()
  const provider = useCodexStore((s) => s.settings.provider)
  const connection = useCodexStore((s) => agentConnection(s, provider))
  return (
    <nav className="router-sidebar" aria-label={t('router.sidebar')}>
      <div className="router-sidebar-head">
        <IconButton
          className="router-sidebar-toggle"
          label={t('router.hideSidebar')}
          tooltip={t('router.hideSidebar')}
          tooltipSide="right"
          icon={<PanelLeftClose size={16} />}
          onClick={toggleSidebar}
        />
      </div>
      <div className="router-sidebar-logo">
        <AppLogoMark />
        <strong>Owls</strong>
      </div>
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
        aria-current={inSettings || undefined}
        onClick={showSettings}
      >
        <Settings2 size={15} />
        <span>{t('settings')}</span>
      </button>
    </nav>
  )
}
