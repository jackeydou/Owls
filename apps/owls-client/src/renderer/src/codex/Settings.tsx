import { Button } from '@renderer/components/ui/button'
import { Select } from '@renderer/components/ui/select'
import { ArrowLeft, type LucideIcon, Palette, Route, SlidersHorizontal } from 'lucide-react'
import { Fragment, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { appLogoSchema, settingsSchema } from '../../../shared/codex'
import { AgentIcon } from '../router/AgentIcon'
import { RouterSettingsSection } from '../router/RouterSettings'
import { appLogoIcons } from './AppLogo'
import { TaskOptions } from './Controls'
import { SettingRow } from './SettingRow'
import { ClaudeSettingsPane, CodexSettingsPane } from './SettingsAgents'
import { type SettingsTab, useCodexStore } from './store'

type TabEntry = { id: SettingsTab; label: string; icon: LucideIcon | null }

const TAB_GROUPS: TabEntry[][] = [
  [
    { id: 'router', label: 'routerSettings.title', icon: Route },
    { id: 'workers', label: 'defaults', icon: SlidersHorizontal }
  ],
  [
    { id: 'claude-code', label: 'agent.claude-code', icon: null },
    { id: 'codex', label: 'agent.codex', icon: null }
  ],
  [{ id: 'appearance', label: 'appearance', icon: Palette }]
]

function TabIcon({ tab }: { tab: TabEntry }) {
  if (tab.id === 'claude-code' || tab.id === 'codex') return <AgentIcon provider={tab.id} />
  return tab.icon ? <tab.icon size={15} /> : null
}

function SettingsNav() {
  const { t } = useTranslation()
  const current = useCodexStore((s) => s.settingsTab)
  const showSettings = useCodexStore((s) => s.showSettings)
  const leaveSettings = useCodexStore((s) => s.leaveSettings)
  return (
    <nav className="router-sidebar codex-settings-nav" aria-label={t('settingsTitle')}>
      <div className="router-sidebar-head">
        <Button
          size="custom"
          variant="ghost"
          className="codex-settings-back"
          onClick={leaveSettings}
        >
          <ArrowLeft size={15} />
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
    </nav>
  )
}

function WorkerDefaultsPane() {
  const { t } = useTranslation()
  return (
    <section className="codex-settings-section">
      <h2>{t('defaults')}</h2>
      <p>{t('defaultsBody')}</p>
      <TaskOptions />
    </section>
  )
}

function AppearancePane() {
  const { t } = useTranslation()
  const settings = useCodexStore((s) => s.settings)
  const saveSettings = useCodexStore((s) => s.saveSettings)
  const logoLabel = useId()
  return (
    <section className="codex-settings-section">
      <h2>{t('appearance')}</h2>
      <SettingRow label={t('theme')} htmlFor="codex-theme">
        <Select
          id="codex-theme"
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
      <SettingRow label={t('language')} htmlFor="codex-language">
        <Select
          id="codex-language"
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
          <div className="codex-logo-options" role="radiogroup" aria-labelledby={logoLabel}>
            {appLogoSchema.options.map((logo) => (
              <label className="codex-logo-option" key={logo}>
                <input
                  type="radio"
                  name="codex-app-logo"
                  className="sr-only"
                  checked={settings.appLogo === logo}
                  onChange={() => void saveSettings({ ...settings, appLogo: logo })}
                />
                <img src={appLogoIcons[logo]} alt="" />
                <span>{t(`appLogo.${logo}`)}</span>
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
  'claude-code': ClaudeSettingsPane,
  codex: CodexSettingsPane,
  appearance: AppearancePane
}

export function CodexSettingsPage() {
  const tab = useCodexStore((s) => s.settingsTab)
  const Pane = PANES[tab]
  return (
    <>
      <SettingsNav />
      <main className="codex-settings-page">
        <div className="codex-settings-drag" />
        {/* Keyed so each tab opens at its top. */}
        <div className="codex-settings-scroll" key={tab}>
          <div className="codex-settings-content">
            <Pane />
          </div>
        </div>
      </main>
    </>
  )
}
