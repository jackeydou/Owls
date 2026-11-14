import type { BuildInfo } from '@renderer/../../preload/index.d'
import { AdvancedTab } from '@renderer/components/settings/AdvancedTab'
import { AppearanceTab } from '@renderer/components/settings/AppearanceTab'
import { ArchivedChatsTab } from '@renderer/components/settings/ArchivedChatsTab'
import { CustomizeTab } from '@renderer/components/settings/CustomizeTab'
import { DeveloperTab } from '@renderer/components/settings/DeveloperTab'
import { GeneralTab } from '@renderer/components/settings/GeneralTab'
import { HotkeysTab } from '@renderer/components/settings/HotkeysTab'
import { McpIcon } from '@renderer/components/settings/McpIcon'
import { ModelsTab } from '@renderer/components/settings/ModelsTab'
import { UsageTab } from '@renderer/components/settings/UsageTab'
import { SidebarContent, SidebarGroup } from '@renderer/components/ui/sidebar'
import type { I18nKey } from '@renderer/lib/i18n'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { useSettingsStore } from '@renderer/stores/settings-store'
import {
  Archive,
  ArrowLeft,
  ChartNoAxesCombined,
  Code2,
  Cpu,
  Keyboard,
  Palette,
  Settings as SettingsIcon,
  SlidersHorizontal
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isDebugPackage } from '../../../shared/build-mode'

type TabId =
  | 'general'
  | 'models'
  | 'usage'
  | 'customize'
  | 'appearance'
  | 'hotkeys'
  | 'archived'
  | 'developer'
  | 'advanced'

const TABS: { id: TabId; labelKey: I18nKey; icon: React.ElementType }[] = [
  { id: 'general', labelKey: 'settings.tab.general', icon: SettingsIcon },
  { id: 'models', labelKey: 'settings.tab.models', icon: Cpu },
  { id: 'usage', labelKey: 'settings.tab.usage', icon: ChartNoAxesCombined },
  { id: 'customize', labelKey: 'settings.tab.customize', icon: McpIcon },
  { id: 'appearance', labelKey: 'settings.tab.appearance', icon: Palette },
  { id: 'hotkeys', labelKey: 'settings.tab.hotkeys', icon: Keyboard },
  { id: 'archived', labelKey: 'settings.tab.archived', icon: Archive },
  { id: 'developer', labelKey: 'settings.tab.developer', icon: Code2 },
  { id: 'advanced', labelKey: 'settings.tab.advanced', icon: SlidersHorizontal }
]

const TAB_COMPONENTS: Record<TabId, React.ComponentType> = {
  general: GeneralTab,
  models: ModelsTab,
  usage: UsageTab,
  customize: CustomizeTab,
  appearance: AppearanceTab,
  hotkeys: HotkeysTab,
  archived: ArchivedChatsTab,
  developer: DeveloperTab,
  advanced: AdvancedTab
}

function visibleTabs(includeDeveloper: boolean, includeAdvanced: boolean): typeof TABS {
  return TABS.filter((tab) => {
    if (tab.id === 'advanced') return includeAdvanced
    if (tab.id === 'developer') return includeDeveloper
    return true
  })
}

function SettingsNavItem({
  label,
  icon: Icon,
  active,
  muted,
  onClick
}: {
  label: string
  icon: React.ElementType
  active?: boolean
  muted?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-normal transition',
        active
          ? 'bg-sidebar-active text-foreground'
          : muted
            ? 'text-muted-foreground/70 hover:bg-sidebar-hover hover:text-muted-foreground'
            : 'text-foreground/92 hover:bg-sidebar-hover hover:text-foreground'
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.8} />
      <span className="truncate">{label}</span>
    </button>
  )
}

function isTabId(value: unknown): value is TabId {
  return TABS.some((tab) => tab.id === value)
}

function resolveInitialTab(
  value: unknown,
  includeDeveloper: boolean,
  includeAdvanced: boolean
): TabId {
  if (value === 'computer-use') {
    return 'general'
  }

  if (
    isTabId(value) &&
    (value !== 'advanced' || includeAdvanced) &&
    (value !== 'developer' || includeDeveloper)
  ) {
    return value
  }

  return 'general'
}

function settingsTabPath(tabId: TabId): string {
  return tabId === 'general' ? '/settings' : `/settings/${tabId}`
}

function requestedTabFromPath(pathname: string): TabId | null {
  const [, section, tab] = pathname.split('/')
  if (section !== 'settings' || !tab) return null
  return isTabId(tab) ? tab : null
}

export function SettingsPage(): React.JSX.Element {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const { load } = useSettingsStore()
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null)
  const advancedVisible = isDebugPackage || buildInfo?.isBetaPackage === true
  const tabs = visibleTabs(true, advancedVisible)
  const requestedTab =
    requestedTabFromPath(location.pathname) ?? (location.state as { tab?: unknown } | null)?.tab
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    resolveInitialTab(requestedTab, true, advancedVisible)
  )
  const isPluginDevelopmentRoute = location.pathname.startsWith('/settings/developer/plugins/')

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    void window.api.app
      .buildInfo()
      .then((info) => {
        if (!cancelled) setBuildInfo(info)
      })
      .catch(() => {
        if (!cancelled) setBuildInfo(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setActiveTab((current) => {
      if (requestedTab !== undefined) {
        return resolveInitialTab(requestedTab, true, advancedVisible)
      }
      if (current === 'advanced' && !advancedVisible) return 'general'
      return current
    })
  }, [advancedVisible, requestedTab])

  const ActiveComponent = TAB_COMPONENTS[activeTab]
  const renderPageTitle = activeTab !== 'archived'

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-card">
      <h1 className="sr-only">{t('settings.title')}</h1>

      <nav className="flex w-[264px] shrink-0 flex-col border-r border-border/60 bg-sidebar pt-(--titlebar-height)">
        <SidebarContent className="px-2.5 pb-2">
          <SidebarGroup className="gap-0.5 px-0 pt-3">
            <SettingsNavItem
              label={t('settings.back')}
              icon={ArrowLeft}
              muted
              onClick={() => {
                navigate('/')
              }}
            />
          </SidebarGroup>

          <SidebarGroup className="gap-0.5 px-0 pt-1">
            {tabs.map((tab) => (
              <SettingsNavItem
                key={tab.id}
                label={t(tab.labelKey)}
                icon={tab.icon}
                active={activeTab === tab.id}
                onClick={() => {
                  setActiveTab(tab.id)
                  navigate(settingsTabPath(tab.id))
                }}
              />
            ))}
          </SidebarGroup>
        </SidebarContent>
      </nav>

      <div
        className={cn(
          'min-h-0 flex-1 px-8 pt-[calc(var(--titlebar-height)+44px)]',
          activeTab === 'archived' ? 'overflow-hidden pb-8' : 'overflow-y-auto pb-16'
        )}
      >
        <div
          className={cn(
            'mx-auto w-full max-w-[720px]',
            activeTab === 'archived' && 'flex h-full min-h-0 flex-col'
          )}
        >
          {renderPageTitle ? (
            <h2 className="mb-12 text-[20px] font-semibold leading-none text-foreground">
              {isPluginDevelopmentRoute
                ? t('settings.pluginDevelopment.title')
                : t(TABS.find((tab) => tab.id === activeTab)?.labelKey ?? 'settings.tab.general')}
            </h2>
          ) : null}
          <div className={cn(activeTab === 'archived' && 'min-h-0 flex-1')}>
            <ActiveComponent />
          </div>
        </div>
      </div>
    </div>
  )
}
