import type { InstalledPlugin, PluginMarketplaceEntry } from '@renderer/../../preload/index.d'

export function pluginAssetUrl(
  pluginRoot: string | undefined,
  assetPath: string | undefined
): string | undefined {
  if (!pluginRoot || !assetPath?.startsWith('./')) return undefined

  const segments = assetPath.slice(2).split('/').filter(Boolean)

  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    return undefined
  }

  const normalizedRoot = pluginRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const assetAbsolutePath = `${normalizedRoot}/${segments.join('/')}`
  return `pichu-plugin-asset://local/asset?path=${encodeURIComponent(assetAbsolutePath)}`
}

function directImageUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined
}

export function pluginLogoUrl(
  plugin: InstalledPlugin | PluginMarketplaceEntry
): string | undefined {
  if ('cachePath' in plugin) {
    return pluginAssetUrl(plugin.cachePath, plugin.manifest.interface?.logo)
  }
  return (
    directImageUrl(plugin.iconUrl) ??
    directImageUrl(plugin.interface?.logo) ??
    pluginAssetUrl(plugin.resolvedSourcePath, plugin.interface?.logo)
  )
}

export function pluginIconUrl(
  plugin: InstalledPlugin | PluginMarketplaceEntry
): string | undefined {
  if ('cachePath' in plugin) {
    const pluginInterface = plugin.manifest.interface
    return pluginAssetUrl(
      plugin.cachePath,
      pluginInterface?.icon ?? pluginInterface?.composerIcon ?? pluginInterface?.logo
    )
  }

  const iconPath =
    plugin.interface?.icon ?? plugin.interface?.composerIcon ?? plugin.interface?.logo
  return (
    directImageUrl(plugin.iconUrl) ??
    directImageUrl(iconPath) ??
    pluginAssetUrl(plugin.resolvedSourcePath, iconPath)
  )
}
