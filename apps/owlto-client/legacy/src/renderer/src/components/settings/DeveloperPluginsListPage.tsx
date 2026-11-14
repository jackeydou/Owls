import type { PluginAdminCatalogItem } from '@renderer/../../preload/index.d'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { Loader2, Package, RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { pluginAdminIconUrl, pluginAdminTitle } from './developer-plugin-admin'
import { SettingsButton, SettingsSection, SettingsTextInput } from './settings-ui'

export function DeveloperPluginsListPage({
  plugins,
  loading,
  onRefresh,
  onOpenPlugin
}: {
  plugins: PluginAdminCatalogItem[]
  loading: boolean
  onRefresh: () => Promise<void>
  onOpenPlugin: (pluginName: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')

  const filteredPlugins = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return plugins
    return plugins.filter((plugin) =>
      [plugin.pluginName, plugin.displayName].join(' ').toLowerCase().includes(normalizedQuery)
    )
  }, [plugins, query])

  return (
    <SettingsSection title={t('developer.plugins.section')}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <SettingsTextInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('developer.plugins.search')}
              className="w-full pl-8"
            />
          </div>

          <SettingsButton
            disabled={loading}
            aria-label={t('developer.plugins.refresh')}
            onClick={() => void onRefresh()}
            className="size-[34px] px-0"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} strokeWidth={1.8} />
          </SettingsButton>
        </div>

        <div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
              {t('developer.plugins.loading')}
            </div>
          ) : filteredPlugins.length === 0 ? (
            <div className="px-3 py-10 text-center text-[13px] leading-5 text-muted-foreground">
              {t('developer.plugins.empty')}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {filteredPlugins.map((plugin) => (
                <PluginProjectCard key={plugin.id} plugin={plugin} onOpenPlugin={onOpenPlugin} />
              ))}
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  )
}

function PluginProjectCard({
  plugin,
  onOpenPlugin
}: {
  plugin: PluginAdminCatalogItem
  onOpenPlugin: (pluginName: string) => void
}): React.JSX.Element {
  const iconUrl = pluginAdminIconUrl(plugin)

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/55 bg-background/55 transition hover:border-border-strong hover:bg-foreground/3 focus-within:border-border-strong">
      <button
        type="button"
        onClick={() => onOpenPlugin(plugin.pluginName)}
        className="flex min-h-[76px] w-full items-center gap-3 p-3 text-left"
      >
        <PluginProjectIcon iconUrl={iconUrl} title={pluginAdminTitle(plugin)} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold leading-5 text-foreground">
            {pluginAdminTitle(plugin)}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground">
            {plugin.pluginName}
          </div>
        </div>
      </button>
    </div>
  )
}

function PluginProjectIcon({
  iconUrl,
  title
}: {
  iconUrl: string | undefined
  title: string
}): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const fallback = title.trim().charAt(0).toUpperCase()

  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/55 bg-linear-to-br from-foreground/7 to-foreground/3 text-[14px] font-semibold text-foreground">
      {iconUrl && !failed ? (
        <img
          src={iconUrl}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : fallback ? (
        fallback
      ) : (
        <Package className="size-4 text-muted-foreground" strokeWidth={1.8} />
      )}
    </div>
  )
}
