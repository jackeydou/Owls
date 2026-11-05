import { IconButton } from '@renderer/components/ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { Network, Plus, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CodexProject } from '../../../shared/codex'
import { AppLogoMark } from '../codex/AppLogo'
import { agentConnection, useCodexStore } from '../codex/store'
import { isWaitingOnUser, isWorking, projectHue } from './activity'
import { useRouterStore } from './store'

function ProjectTile({ project }: { project: CodexProject }) {
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
          className="router-rail-project"
          style={{ '--owl-c': projectHue(project.id) } as React.CSSProperties}
          aria-label={label}
          aria-current={current || undefined}
          onClick={() => showChat(project.id)}
        >
          {project.name.slice(0, 1).toUpperCase()}
          {state ? <i className={state} aria-hidden /> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{project.name}</TooltipContent>
    </Tooltip>
  )
}
export function ProjectRail() {
  const { t } = useTranslation()
  const projects = useCodexStore((s) => s.projects)
  const onMap = useCodexStore((s) => s.view === 'map')
  const inSettings = useCodexStore((s) => s.view === 'settings')
  const { showMap, showSettings, pickProject } = useCodexStore()
  const provider = useCodexStore((s) => s.settings.provider)
  const connection = useCodexStore((s) => agentConnection(s, provider))
  return (
    <nav className="router-rail" aria-label={t('projects')}>
      <div className="router-rail-logo">
        <AppLogoMark />
      </div>
      <IconButton
        className="router-rail-button"
        label={t('map.title')}
        tooltip={t('map.title')}
        tooltipSide="right"
        aria-current={onMap || undefined}
        icon={<Network size={16} />}
        onClick={showMap}
      />
      <i className="router-rail-rule" />
      <div className="router-rail-projects">
        {projects.map((project) => (
          <ProjectTile key={project.id} project={project} />
        ))}
      </div>
      <IconButton
        className="router-rail-button"
        label={t('addProject')}
        tooltip={t('addProject')}
        tooltipSide="right"
        icon={<Plus size={16} />}
        onClick={() => void pickProject()}
      />
      <IconButton
        className={`router-rail-button router-rail-settings ${connection.status}`}
        label={t('settings')}
        tooltip={t('settings')}
        tooltipSide="right"
        aria-current={inSettings || undefined}
        icon={<Settings2 size={16} />}
        onClick={showSettings}
      />
    </nav>
  )
}
