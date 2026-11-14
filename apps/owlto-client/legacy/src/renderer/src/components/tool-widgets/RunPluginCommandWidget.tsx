import type { InstalledPlugin, PluginMarketplaceEntry } from '@renderer/../../preload/index.d'
import { pluginAssetUrl, pluginIconUrl } from '@renderer/lib/plugin-assets'
import { Plug } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ToolWidgetComponentProps } from './types'

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function findPlugin(
  plugins: InstalledPlugin[],
  pluginName: string | undefined
): InstalledPlugin | undefined {
  if (!pluginName) return undefined
  return plugins.find((plugin) => plugin.name === pluginName || plugin.id === pluginName)
}

function findAvailable(
  plugins: PluginMarketplaceEntry[],
  installedPlugin: InstalledPlugin | undefined,
  pluginName: string | undefined
): PluginMarketplaceEntry | undefined {
  return plugins.find((plugin) => {
    const key = `${plugin.marketplaceName}:${plugin.name}`
    return key === installedPlugin?.id || plugin.name === pluginName || key === pluginName
  })
}

function statusCopy(
  pluginLabel: string,
  scriptName: string | undefined,
  widget: ToolWidgetComponentProps['widget'],
  isStreaming: boolean
): string {
  const scriptCopy = scriptName ? ` (${scriptName})` : ''
  if (widget.status === 'error') return `${pluginLabel}${scriptCopy} failed.`
  if (isStreaming) return `Executing ${pluginLabel} plugin${scriptCopy}...`
  if (widget.result !== undefined) return `Finished running ${pluginLabel} plugin${scriptCopy}.`
  return `Preparing ${pluginLabel} plugin${scriptCopy}...`
}

export function RunPluginCommandWidget({
  widget,
  isStreaming
}: ToolWidgetComponentProps): React.JSX.Element {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([])
  const [available, setAvailable] = useState<PluginMarketplaceEntry[]>([])
  const [failedIconSrc, setFailedIconSrc] = useState<string | null>(null)
  const pluginName = stringArg(widget.args.pluginName)
  const scriptName = stringArg(widget.args.scriptName) ?? stringArg(widget.args.commandName)
  const plugin = useMemo(() => findPlugin(plugins, pluginName), [pluginName, plugins])
  const availablePlugin = useMemo(
    () => findAvailable(available, plugin, pluginName),
    [available, plugin, pluginName]
  )
  const pluginLabel =
    plugin?.manifest.interface?.displayName ??
    availablePlugin?.interface?.displayName ??
    pluginName ??
    'plugin'
  const rawIconSrc =
    (plugin ? pluginIconUrl(plugin) : undefined) ??
    pluginAssetUrl(
      availablePlugin?.resolvedSourcePath,
      availablePlugin?.interface?.icon ??
        availablePlugin?.interface?.composerIcon ??
        availablePlugin?.interface?.logo
    )
  const iconSrc = rawIconSrc && rawIconSrc !== failedIconSrc ? rawIconSrc : undefined

  useEffect(() => {
    let cancelled = false
    Promise.all([window.api.plugins.listInstalled(), window.api.plugins.listAvailable()])
      .then(([installed, nextAvailable]) => {
        if (!cancelled) {
          setPlugins(installed)
          setAvailable(nextAvailable)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlugins([])
          setAvailable([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="inline-flex max-w-full items-center gap-1.5 py-0.5 text-[12px] text-muted-foreground">
      <span className="relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-sm text-muted-foreground">
        <Plug className="size-3" strokeWidth={1.8} />
        {iconSrc ? (
          <img
            key={iconSrc}
            src={iconSrc}
            alt={`${pluginLabel} icon`}
            className="absolute inset-0 size-full object-cover"
            onError={() => setFailedIconSrc(iconSrc)}
          />
        ) : null}
      </span>
      <span className={widget.status === 'error' ? 'truncate text-destructive' : 'truncate'}>
        {statusCopy(pluginLabel, scriptName, widget, isStreaming)}
      </span>
    </div>
  )
}
