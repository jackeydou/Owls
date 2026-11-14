export const COMPUTER_USE_PLUGIN_NAME = 'computer-use'
export const IN_APP_BROWSER_USE_PLUGIN_NAME = 'in-app-browser-use'
export const SITES_PLUGIN_NAME = 'sites'

const USER_HIDDEN_PLUGIN_NAMES = new Set<string>([COMPUTER_USE_PLUGIN_NAME, SITES_PLUGIN_NAME])

export function matchesPluginName(plugin: { id?: string; name: string }, name: string): boolean {
  return plugin.name === name || plugin.id === name || plugin.id?.endsWith(`:${name}`) === true
}

export function isPluginHiddenFromUsers(plugin: { id?: string; name: string }): boolean {
  for (const name of USER_HIDDEN_PLUGIN_NAMES) {
    if (matchesPluginName(plugin, name)) return true
  }
  return false
}
