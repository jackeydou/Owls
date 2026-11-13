import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import {
  ArrowLeftIcon,
  BrainIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  type IconComponent,
  InfoIcon,
  PaletteIcon,
  RefreshIcon,
  RouteIcon,
  ScrollTextIcon,
  SlidersIcon
} from '@renderer/components/ui/icons'
import { ResizeHandle } from '@renderer/components/ui/resize-handle'
import { Select } from '@renderer/components/ui/select'
import { Fragment, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { appLogoSchema, settingsSchema } from '../../../shared/app'
import { SettingsMemoryPane } from '../memory/SettingsMemory'
import { AgentIcon } from '../router/AgentIcon'
import { projectHue } from '../router/activity'
import { ProjectIcon } from '../router/ProjectIcon'
import { usePaneWidth } from '../router/pane-width'
import { RouterSettingsSection } from '../router/RouterSettings'
import { SettingsUpdatesPane } from '../updates/SettingsUpdates'
import { appLogoIcons } from './AppLogo'
import { TaskOptions } from './Controls'
import { SettingRow } from './SettingRow'
import { AgentSettingsPane, ClaudeSettingsPane, CursorSettingsPane } from './SettingsAgents'
import { GitHubSettingsPane } from './SettingsGitHub'
import { ProjectSettingsPane } from './SettingsProject'
import {
  type ProjectSettingsPage,
  projectSettingsPages,
  type SettingsTab,
  useAppStore
} from './store'

type TabEntry = { id: Exclude<SettingsTab, 'project'>; label: string; icon: IconComponent | null }

const TAB_GROUPS: TabEntry[][] = [
  [
    { id: 'router', label: 'routerSettings.title', icon: RouteIcon },
    { id: 'workers', label: 'defaults', icon: SlidersIcon },
    { id: 'memory', label: 'memory.title', icon: BrainIcon }
  ],
  [
    { id: 'claude-code', label: 'agent.claude-code', icon: null },
    { id: 'codex', label: 'agent.codex', icon: null },
    { id: 'cursor', label: 'agent.cursor', icon: null }
  ],
  [
    { id: 'github', label: 'github.title', icon: GitPullRequestIcon },
    { id: 'appearance', label: 'appearance', icon: PaletteIcon },
    { id: 'updates', label: 'updates.title', icon: RefreshIcon }
  ]
]

function TabIcon({ tab }: { tab: TabEntry }) {
  if (tab.id === 'claude-code' || tab.id === 'codex' || tab.id === 'cursor')
    return <AgentIcon provider={tab.id} />
  return tab.icon ? <tab.icon size={17} /> : null
}

const PROJECT_PAGE_ICONS: Record<ProjectSettingsPage, IconComponent> = {
  general: InfoIcon,
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
  const [folded, setFolded] = useState(false)
  // Opening any project page, from here or the Projects sidebar, unfolds it again.
  useEffect(() => {
    if (current) setFolded(false)
  }, [current])
  if (!projects.length) return null
  return (
    <>
      <hr />
      <h2 className="owls-settings-group">{t('projectSettings.group')}</h2>
      {projects.map((project) => {
        const selected = current?.projectId === project.id
        const open = selected && !folded
        const Chevron = open ? ChevronDownIcon : ChevronRightIcon
        return (
          <Fragment key={project.id}>
            <button
              type="button"
              className="router-sidebar-item owls-settings-project"
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
              <Chevron size={16} className="owls-settings-chevron" aria-hidden="true" />
            </button>
            {open ? (
              <ul
                className="owls-settings-subnav"
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
      className="router-sidebar owls-settings-nav"
      style={{ width }}
      aria-label={t('settingsTitle')}
    >
      <div className="router-sidebar-head">
        <Button
          size="custom"
          variant="ghost"
          className="owls-settings-back"
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
              <TabIcon tab={tab} />
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

function WorkerDefaultsPane() {
  const { t } = useTranslation()
  return (
    <section className="owls-settings-section">
      <h2>{t('defaults')}</h2>
      <p>{t('defaultsBody')}</p>
      <TaskOptions />
      <WorkspaceFolderRow />
    </section>
  )
}

/** The folder for tasks outside any project, with the default spelled out until the user picks one. */
function WorkspaceFolderRow() {
  const { t } = useTranslation()
  const custom = useAppStore((s) => s.settings.workspacePath)
  const workspaceFolder = useAppStore((s) => s.workspaceFolder)
  const selectWorkspaceFolder = useAppStore((s) => s.selectWorkspaceFolder)
  const resetWorkspaceFolder = useAppStore((s) => s.resetWorkspaceFolder)
  const [folder, setFolder] = useState<string | null>(null)
  // Reads the folder again whenever the saved choice changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `custom` is the trigger, not an input.
  useEffect(() => {
    let live = true
    void workspaceFolder().then((path) => {
      if (live) setFolder(path)
    })
    return () => {
      live = false
    }
  }, [custom, workspaceFolder])
  return (
    <SettingRow
      label={t('workspaceFolder')}
      description={t('workspaceFolderBody')}
      detail={folder ? <code className="owls-path">{folder}</code> : null}
    >
      <div className="owls-settings-actions">
        {custom ? (
          <ActionButton size="sm" variant="ghost" onAction={resetWorkspaceFolder}>
            {t('workspaceFolderReset')}
          </ActionButton>
        ) : null}
        <ActionButton
          size="sm"
          variant="outline"
          icon={<FolderOpenIcon size={16} />}
          // The chosen path appears in the row, so the button only needs to show it is working.
          onAction={async () => void (await selectWorkspaceFolder())}
        >
          {t('workspaceFolderChoose')}
        </ActionButton>
      </div>
    </SettingRow>
  )
}

function AppearancePane() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const logoLabel = useId()
  return (
    <section className="owls-settings-section">
      <h2>{t('appearance')}</h2>
      <SettingRow label={t('theme')} htmlFor="owls-theme">
        <Select
          id="owls-theme"
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
      <SettingRow label={t('language')} htmlFor="owls-language">
        <Select
          id="owls-language"
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
      <SettingRow
        label={t('appLogo')}
        labelId={logoLabel}
        description={t('appLogoHelp')}
        detail={
          <div className="owls-logo-options" role="radiogroup" aria-labelledby={logoLabel}>
            {appLogoSchema.options.map((logo) => (
              <label className="owls-logo-option" key={logo}>
                <input
                  type="radio"
                  name="owls-app-logo"
                  className="sr-only"
                  aria-label={t(`appLogo.${logo}`)}
                  checked={settings.appLogo === logo}
                  onChange={() => void saveSettings({ ...settings, appLogo: logo })}
                />
                <img src={appLogoIcons[logo]} alt="" />
              </label>
            ))}
          </div>
        }
      />
    </section>
  )
}

const PANES: Record<SettingsTab, () => React.JSX.Element> = {
  router: RouterSettingsSection,
  workers: WorkerDefaultsPane,
  memory: SettingsMemoryPane,
  'claude-code': ClaudeSettingsPane,
  codex: AgentSettingsPane,
  cursor: CursorSettingsPane,
  github: GitHubSettingsPane,
  appearance: AppearancePane,
  updates: SettingsUpdatesPane,
  project: ProjectSettingsPane
}

export function SettingsPage() {
  const tab = useAppStore((s) => s.settingsTab)
  const project = useAppStore((s) => s.settingsProject)
  const Pane = PANES[tab]
  const key = tab === 'project' && project ? `project:${project.projectId}:${project.page}` : tab
  return (
    <>
      <SettingsNav />
      <main className="owls-settings-page">
        <div className="owls-settings-drag" />
        {/* Keyed so each tab opens at its top. */}
        <div className="owls-settings-scroll" key={key}>
          <div className="owls-settings-content">
            <Pane />
          </div>
        </div>
      </main>
    </>
  )
}
