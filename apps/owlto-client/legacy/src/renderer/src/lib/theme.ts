import type { SettingsPayload } from '@renderer/stores/settings-store'

export type ThemeMode = SettingsPayload['themeMode']
export type ResolvedTheme = 'light' | 'dark'

const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)'

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light'
}

export function resolveThemeMode(themeMode: ThemeMode): ResolvedTheme {
  return themeMode === 'system' ? getSystemTheme() : themeMode
}

export function applyThemeMode(themeMode: ThemeMode = 'system'): void {
  const resolvedTheme = resolveThemeMode(themeMode)
  document.documentElement.dataset.theme = resolvedTheme
  document.documentElement.dataset.themeMode = themeMode
  document.documentElement.style.colorScheme = resolvedTheme
}

export function getSystemThemeMedia(): MediaQueryList {
  return window.matchMedia(SYSTEM_THEME_QUERY)
}
