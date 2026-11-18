import { Button } from '@renderer/components/ui/button'
import {
  ArchiveIcon,
  ArrowLeftIcon,
  BrainIcon,
  ChartIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FlaskIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  type IconComponent,
  InfoIcon,
  LaptopIcon,
  PaletteIcon,
  RefreshIcon,
  RouteIcon,
  ScrollTextIcon,
  TerminalIcon,
  UserIcon
} from '@renderer/components/ui/icons'
import { ResizeHandle } from '@renderer/components/ui/resize-handle'
import { Select } from '@renderer/components/ui/select'
import { Fragment, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { settingsSchema, skinSchema } from '../../../shared/app'
import { SettingsMemoryPane } from '../memory/SettingsMemory'
import { DevicesSettingsPane } from '../remote/SettingsDevices'
import { projectHue } from '../router/activity'
import { ProjectIcon } from '../router/ProjectIcon'
import { usePaneWidth } from '../router/pane-width'
import { WorkspaceIcon } from '../router/WorkspaceIcon'
import { SettingsUpdatesPane } from '../updates/SettingsUpdates'
import { UsageStatsPane } from '../usage/UsageStatsPane'
import { AppLogoSetting } from './AppLogoSetting'
import { SettingRow } from './SettingRow'
import { AgentsSettingsPane } from './SettingsAgents'
import { ArchivesSettingsPane } from './SettingsArchives'
import { ExperimentsSettingsPane } from './SettingsExperiments'
import { GitHubSettingsPane } from './SettingsGitHub'
import { ProfileSettingsPane } from './SettingsProfile'
import { ProjectSettingsPane } from './SettingsProject'
import { RouterWorkersSettingsPane } from './SettingsRouterWorkers'
import { WorkspaceSettingsPane } from './SettingsWorkspace'
import {
  type ProjectSettingsPage,
  projectSettingsPages,
  type SettingsTab,
  useAppStore
} from './store'

type TabEntry = {
  id: Exclude<SettingsTab, 'project' | 'workspace'>
  label: string
  icon: IconComponent
}

const TAB_GROUPS: TabEntry[][] = [
  [
    { id: 'agents', label: 'agents.title', icon: TerminalIcon },
    { id: 'router', label: 'routerWorkers.title', icon: RouteIcon },
    { id: 'memory', label: 'memory.title', icon: BrainIcon },
    { id: 'usage', label: 'usageStats.title', icon: ChartIcon },
    { id: 'archives', label: 'archives.title', icon: ArchiveIcon }
  ],
  [
    { id: 'github', label: 'github.title', icon: GitPullRequestIcon },
    { id: 'devices', label: 'remote.title', icon: LaptopIcon },
    { id: 'profile', label: 'profile.title', icon: UserIcon },
    { id: 'appearance', label: 'appearance', icon: PaletteIcon },
    { id: 'updates', label: 'updates.title', icon: RefreshIcon },
    { id: 'experiments', label: 'experiments.title', icon: FlaskIcon }
  ]
]

const PROJECT_PAGE_ICONS: Record<ProjectSettingsPage, IconComponent> = {
  general: InfoIcon,
  agents: TerminalIcon,
  git: GitBranchIcon,
  instructions: ScrollTextIcon
}

/**
 * Every project, with the pages of the open one listed under it. Clicking the open project
 * folds its pages away; clicking another opens it on its general page.
 */
function ProjectsNav() {
  const { t } = useTranslation()
  const projects = useAppStore((s) => s.projects)
  const current = useAppStore((s) => (s.settingsTab === 'project' ? s.settingsProject : null))
  const showProjectSettings = useAppStore((s) => s.showProjectSettings)
  const showSettings = useAppStore((s) => s.showSettings)
  const workspaceOpen = useAppStore((s) => s.settingsTab === 'workspace')
  const [folded, setFolded] = useState(false)
  // Opening any project page, from here or the Projects sidebar, unfolds it again.
  useEffect(() => {
    if (current) setFolded(false)
  }, [current])
  return (
    <>
      <hr />
      <h2 className="owlto-settings-group">{t('projectSettings.group')}</h2>
      <button
        type="button"
        className="router-sidebar-item owlto-settings-project"
        style={{ '--owl-c': 'var(--color-muted-foreground)' } as React.CSSProperties}
        aria-current={workspaceOpen || undefined}
        onClick={() => showSettings('workspace')}
      >
        <WorkspaceIcon />
        <span>{t('workspace.name')}</span>
      </button>
      {projects.map((project) => {
        const selected = current?.projectId === project.id
        const open = selected && !folded
        const Chevron = open ? ChevronDownIcon : ChevronRightIcon
        return (
          <Fragment key={project.id}>
            <button
              type="button"
              className="router-sidebar-item owlto-settings-project"
              style={
                { '--owl-c': projectHue(project.id, project.settings.color) } as React.CSSProperties
              }
              aria-expanded={open}
              onClick={() => {
                if (selected) setFolded(!folded)
                else showProjectSettings(project.id)
              }}
            >
              <ProjectIcon project={project} />
              <span>{project.name}</span>
              <Chevron size={16} className="owlto-settings-chevron" aria-hidden="true" />
            </button>
            {open ? (
              <ul
                className="owlto-settings-subnav"
                aria-label={t('projectSettings.pages', { project: project.name })}
              >
                {projectSettingsPages.map((page) => {
                  const Icon = PROJECT_PAGE_ICONS[page]
                  return (
                    <li key={page}>
                      <button
                        type="button"
                        className="router-sidebar-item"
                        aria-current={current?.page === page || undefined}
                        onClick={() => showProjectSettings(project.id, page)}
                      >
                        <Icon size={17} />
                        <span>{t(`projectSettings.page.${page}`)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </Fragment>
        )
      })}
    </>
  )
}

function SettingsNav() {
  const { t } = useTranslation()
  const current = useAppStore((s) => s.settingsTab)
  const showSettings = useAppStore((s) => s.showSettings)
  const leaveSettings = useAppStore((s) => s.leaveSettings)
  // Shares the main sidebar's width, so switching to Settings keeps the same edge.
  const { width, handle } = usePaneWidth('sidebar', 'right')
  return (
    <nav
      className="router-sidebar owlto-settings-nav"
      style={{ width }}
      aria-label={t('settingsTitle')}
    >
      <div className="router-sidebar-head">
        <Button
          size="custom"
          variant="ghost"
          className="owlto-settings-back"
          onClick={leaveSettings}
        >
          <ArrowLeftIcon size={17} />
          {t('back')}
        </Button>
      </div>
      <h1>{t('settingsTitle')}</h1>
      {TAB_GROUPS.map((group, index) => (
        <Fragment key={group[0].id}>
          {index ? <hr /> : null}
          {group.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className="router-sidebar-item"
              aria-current={tab.id === current || undefined}
              onClick={() => showSettings(tab.id)}
            >
              <tab.icon size={17} />
              <span>{t(tab.label)}</span>
            </button>
          ))}
        </Fragment>
      ))}
      <ProjectsNav />
      <ResizeHandle {...handle} />
    </nav>
  )
}

function AppearancePane() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  return (
    <section className="owlto-settings-section">
      <h2>{t('appearance')}</h2>
      <SettingRow label={t('theme')} htmlFor="owlto-theme">
        <Select
          id="owlto-theme"
          value={settings.theme}
          onChange={(event) =>
            void saveSettings({
              ...settings,
              theme: settingsSchema.shape.theme.parse(event.target.value)
            })
          }
        >
          {settingsSchema.shape.theme.options.map((theme) => (
            <option value={theme} key={theme}>
              {t(`theme.${theme}`)}
            </option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow label={t('skin')} htmlFor="owlto-skin" description={t('skinHelp')}>
        <Select
          id="owlto-skin"
          value={settings.skin}
          onChange={(event) =>
            void saveSettings({
              ...settings,
              skin: skinSchema.parse(event.target.value)
            })
          }
        >
          {skinSchema.options.map((skin) => (
            <option value={skin} key={skin}>
              {t(`skin.${skin}`)}
            </option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow label={t('language')} htmlFor="owlto-language">
        <Select
          id="owlto-language"
          value={settings.language}
          onChange={(event) =>
            void saveSettings({
              ...settings,
              language: settingsSchema.shape.language.parse(event.target.value)
            })
          }
        >
          <option value="en">English</option>
          <option value="zh-CN">简体中文</option>
        </Select>
      </SettingRow>
      <AppLogoSetting />
    </section>
  )
}

const PANES: Record<SettingsTab, () => React.JSX.Element> = {
  agents: AgentsSettingsPane,
  router: RouterWorkersSettingsPane,
  memory: SettingsMemoryPane,
  usage: UsageStatsPane,
  archives: ArchivesSettingsPane,
  experiments: ExperimentsSettingsPane,
  github: GitHubSettingsPane,
  profile: ProfileSettingsPane,
  appearance: AppearancePane,
  updates: SettingsUpdatesPane,
  project: ProjectSettingsPane,
  workspace: WorkspaceSettingsPane,
  devices: DevicesSettingsPane
}

export function SettingsPage() {
  const tab = useAppStore((s) => s.settingsTab)
  const project = useAppStore((s) => s.settingsProject)
  const Pane = PANES[tab]
  const key = tab === 'project' && project ? `project:${project.projectId}:${project.page}` : tab
  return (
    <>
      <SettingsNav />
      <main className="owlto-settings-page">
        <div className="owlto-settings-drag" />
        {/* Keyed so each tab opens at its top. */}
        <div className="owlto-settings-scroll" key={key}>
          <div className="owlto-settings-content">
            <Pane />
          </div>
        </div>
      </main>
    </>
  )
}
