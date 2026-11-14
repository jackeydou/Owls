import type { InstalledPlugin } from '@renderer/../../preload/index.d'
import { pluginIconUrl } from '@renderer/lib/plugin-assets'
import { usePluginStore } from '@renderer/stores/plugin-store'
import { Monitor, Plug } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ToolWidgetComponentProps } from './types'

type UsePluginKind = 'browser' | 'computer'

function pluginKindForTool(toolName: string): UsePluginKind {
  return toolName.startsWith('embeddedBrowser') || toolName.startsWith('browser')
    ? 'browser'
    : 'computer'
}

function pluginNameForKind(kind: UsePluginKind): string {
  return kind === 'browser' ? 'in-app-browser-use' : 'computer-use'
}

function labelForKind(kind: UsePluginKind): string {
  return kind === 'browser' ? 'Browser Use' : 'Computer Use'
}

function findPlugin(plugins: InstalledPlugin[], pluginName: string): InstalledPlugin | undefined {
  return plugins.find(
    (plugin) =>
      plugin.name === pluginName || plugin.id === pluginName || plugin.id.endsWith(`:${pluginName}`)
  )
}

function statusCopy(
  label: string,
  widget: ToolWidgetComponentProps['widget'],
  isStreaming: boolean
): string {
  if (widget.status === 'error') return `${label} failed.`
  if (isStreaming) return `Using ${label}...`
  if (widget.result !== undefined) return `Finished ${label}.`
  return `Preparing ${label}...`
}

export function PluginUseToolWidget({
  widget,
  isStreaming
}: ToolWidgetComponentProps): React.JSX.Element {
  const installed = usePluginStore((state) => state.installed)
  const installedLoaded = usePluginStore((state) => state.installedLoaded)
  const reloadInstalledPlugins = usePluginStore((state) => state.reloadInstalledPlugins)
  const kind = pluginKindForTool(widget.toolName)
  const label = labelForKind(kind)
  const plugin = findPlugin(installed, pluginNameForKind(kind))
  const [failedIconSrc, setFailedIconSrc] = useState<string | null>(null)
  const rawIconSrc = plugin ? pluginIconUrl(plugin) : undefined
  const iconSrc = rawIconSrc && rawIconSrc !== failedIconSrc ? rawIconSrc : undefined

  useEffect(() => {
    if (!installedLoaded) {
      void reloadInstalledPlugins().catch(() => {})
    }
  }, [installedLoaded, reloadInstalledPlugins])

  return (
    <div className="inline-flex max-w-full items-center gap-1.5 py-0.5 text-[12px] text-muted-foreground">
      <span className="relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-sm text-muted-foreground">
        {kind === 'browser' ? (
          <Plug className="size-3" strokeWidth={1.8} />
        ) : (
          <Monitor className="size-3" strokeWidth={1.8} />
        )}
        {iconSrc ? (
          <img
            key={iconSrc}
            src={iconSrc}
            alt={`${label} icon`}
            className="absolute inset-0 size-full object-cover"
            onError={() => setFailedIconSrc(iconSrc)}
          />
        ) : null}
      </span>
      <span className={widget.status === 'error' ? 'truncate text-destructive' : 'truncate'}>
        {statusCopy(label, widget, isStreaming)}
      </span>
    </div>
  )
}
