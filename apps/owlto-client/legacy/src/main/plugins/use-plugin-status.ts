import {
  COMPUTER_USE_PLUGIN_NAME,
  IN_APP_BROWSER_USE_PLUGIN_NAME,
  isPluginHiddenFromUsers,
  matchesPluginName
} from './plugin-exposure.js'
import { listInstalledPluginsAsync } from './plugin-registry.js'

export type UsePluginStatus = {
  name: string
  id: string | null
  installed: boolean
  enabled: boolean
}

export type UsePluginStatuses = {
  computerUse: UsePluginStatus
  inAppBrowserUse: UsePluginStatus
}

function emptyStatus(name: string): UsePluginStatus {
  return {
    name,
    id: null,
    installed: false,
    enabled: false
  }
}

export async function getUsePluginStatusesAsync(): Promise<UsePluginStatuses> {
  const installed = await listInstalledPluginsAsync()
  const computerUse = isPluginHiddenFromUsers({ name: COMPUTER_USE_PLUGIN_NAME })
    ? undefined
    : installed.find((plugin) => matchesPluginName(plugin, COMPUTER_USE_PLUGIN_NAME))
  const inAppBrowserUse = installed.find((plugin) =>
    matchesPluginName(plugin, IN_APP_BROWSER_USE_PLUGIN_NAME)
  )

  return {
    computerUse: computerUse
      ? {
          name: COMPUTER_USE_PLUGIN_NAME,
          id: computerUse.id,
          installed: true,
          enabled: computerUse.enabled
        }
      : emptyStatus(COMPUTER_USE_PLUGIN_NAME),
    inAppBrowserUse: inAppBrowserUse
      ? {
          name: IN_APP_BROWSER_USE_PLUGIN_NAME,
          id: inAppBrowserUse.id,
          installed: true,
          enabled: inAppBrowserUse.enabled
        }
      : emptyStatus(IN_APP_BROWSER_USE_PLUGIN_NAME)
  }
}
