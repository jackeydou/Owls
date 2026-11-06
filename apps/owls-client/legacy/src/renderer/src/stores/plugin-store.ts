import type {
  InstalledPlugin,
  PluginMarketplace,
  PluginMarketplaceEntry,
  PluginMarketplaceRefreshResult,
  PluginMarketplaceRefreshSource
} from '@renderer/../../preload/index.d'
import { create } from 'zustand'

type PluginState = {
  installed: InstalledPlugin[]
  installedLoaded: boolean
  installedError: string | null
  available: PluginMarketplaceEntry[]
  marketplaces: PluginMarketplace[]
  marketplaceLoaded: boolean
  marketplaceRefreshing: boolean
  marketplaceError: string | null
  reloadInstalledPlugins: () => Promise<InstalledPlugin[]>
  refreshPluginMarketplaces: (
    source?: PluginMarketplaceRefreshSource
  ) => Promise<PluginMarketplaceRefreshResult>
}

let pluginEventUnsubscribe: (() => void) | null = null

export function isPluginEnabled(plugins: InstalledPlugin[], pluginName: string): boolean {
  const plugin = plugins.find(
    (entry) =>
      entry.name === pluginName || entry.id === pluginName || entry.id.endsWith(`:${pluginName}`)
  )
  return Boolean(plugin?.enabled)
}

export const usePluginStore = create<PluginState>((set) => ({
  installed: [],
  installedLoaded: false,
  installedError: null,
  available: [],
  marketplaces: [],
  marketplaceLoaded: false,
  marketplaceRefreshing: false,
  marketplaceError: null,

  reloadInstalledPlugins: async () => {
    console.log('[plugin-store] reload installed plugins requested')
    set({ installedError: null })
    try {
      const installed = await window.api.plugins.listInstalled()
      console.log('[plugin-store] reload installed plugins completed', {
        count: installed.length,
        plugins: installed.map((plugin) => ({
          id: plugin.id,
          name: plugin.name,
          enabled: plugin.enabled
        }))
      })
      set({ installed, installedLoaded: true })
      return installed
    } catch (error) {
      console.error('[plugin-store] reload installed plugins failed', error)
      set({
        installedLoaded: true,
        installedError: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  },

  refreshPluginMarketplaces: async (source = 'startup') => {
    console.log('[plugin-store] refresh plugin marketplaces requested')
    set({ installedError: null, marketplaceError: null, marketplaceRefreshing: true })
    try {
      const result = await window.api.plugins.refreshMarketplaces({ source })
      console.log('[plugin-store] refresh plugin marketplaces completed', {
        installed: result.installed.length,
        available: result.available.length
      })
      set({
        installed: result.installed,
        installedLoaded: true,
        available: result.available,
        marketplaces: result.marketplaces,
        marketplaceLoaded: true,
        marketplaceRefreshing: false
      })
      return result
    } catch (error) {
      console.error('[plugin-store] refresh plugin marketplaces failed', error)
      set({
        installedLoaded: true,
        installedError: error instanceof Error ? error.message : String(error),
        marketplaceLoaded: true,
        marketplaceRefreshing: false,
        marketplaceError: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }
}))

export function initPluginEvents(): () => void {
  if (pluginEventUnsubscribe) {
    console.log('[plugin-store] plugin event listener already initialized')
    return pluginEventUnsubscribe
  }

  console.log('[plugin-store] initializing plugin event listener')
  pluginEventUnsubscribe = window.api.plugins.onEvent((event) => {
    console.log('[plugin-store] received plugin event', event)
    if (event.type === 'changed') {
      void usePluginStore
        .getState()
        .reloadInstalledPlugins()
        .catch(() => {})
    }
  })
  return pluginEventUnsubscribe
}
