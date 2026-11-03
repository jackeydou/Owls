import type { PluginAdminCatalogItem } from '@renderer/../../preload/index.d'
import { pluginAssetUrl } from '@renderer/lib/plugin-assets'

export type PluginAdminPendingAction = 'load' | 'upload' | null

export function pluginAdminTitle(plugin: PluginAdminCatalogItem): string {
  return plugin.displayName || plugin.pluginName
}

export function pluginAdminIconUrl(plugin: PluginAdminCatalogItem): string | undefined {
  const icon = plugin.icon?.trim()
  if (!icon) return undefined
  if (/^(https?:|data:|pichu-plugin-asset:)/i.test(icon)) return icon
  return pluginAssetUrl(plugin.localSourcePath ?? undefined, icon)
}

export function formatPluginAdminDate(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

export function formatPluginAdminBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
