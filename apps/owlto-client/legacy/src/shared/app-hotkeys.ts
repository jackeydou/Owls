export const APP_HOTKEYS = [
  {
    id: 'open-settings',
    keys: '⌘,',
    labelKey: 'hotkeys.openSettings.label',
    descriptionKey: 'hotkeys.openSettings.description'
  },
  {
    id: 'new-session',
    keys: '⌘N',
    labelKey: 'hotkeys.newSession.label',
    descriptionKey: 'hotkeys.newSession.description'
  },
  {
    id: 'open-search',
    keys: '⌘G',
    labelKey: 'hotkeys.openSearch.label',
    descriptionKey: 'hotkeys.openSearch.description'
  },
  {
    id: 'hide-app',
    keys: '⌘H',
    labelKey: 'hotkeys.hideApp.label',
    descriptionKey: 'hotkeys.hideApp.description'
  },
  {
    id: 'toggle-sidebar',
    keys: '⌘B',
    labelKey: 'hotkeys.toggleSidebar.label',
    descriptionKey: 'hotkeys.toggleSidebar.description'
  },
  {
    id: 'open-browser-tab',
    keys: '⌘T',
    labelKey: 'hotkeys.openBrowserTab.label',
    descriptionKey: 'hotkeys.openBrowserTab.description'
  },
  {
    id: 'open-files-tab',
    keys: '⌘P',
    labelKey: 'hotkeys.openFilesTab.label',
    descriptionKey: 'hotkeys.openFilesTab.description'
  },
  {
    id: 'open-side-chat-tab',
    keys: '⌘⌥S',
    labelKey: 'hotkeys.openSideChatTab.label',
    descriptionKey: 'hotkeys.openSideChatTab.description'
  },
  {
    id: 'previous-session',
    keys: '⌘[',
    labelKey: 'hotkeys.previousSession.label',
    descriptionKey: 'hotkeys.previousSession.description'
  },
  {
    id: 'next-session',
    keys: '⌘]',
    labelKey: 'hotkeys.nextSession.label',
    descriptionKey: 'hotkeys.nextSession.description'
  }
] as const

export type AppHotkeyCommand = (typeof APP_HOTKEYS)[number]['id']

export type AppHotkeyPayload = {
  command: AppHotkeyCommand
}

export type AppHotkeyPlatform = 'darwin' | 'other'

export type AppHotkeyInput = {
  key: string
  code?: string
  meta?: boolean
  control?: boolean
  alt?: boolean
  shift?: boolean
  modifiers?: string[]
}

function isBracketNavigationInput(input: AppHotkeyInput): boolean {
  const key = input.key.toLowerCase()
  return input.code === 'BracketLeft' || input.code === 'BracketRight' || key === '[' || key === ']'
}

function usesAppModifier(input: AppHotkeyInput, platform: AppHotkeyPlatform): boolean {
  const modifiers = new Set(input.modifiers ?? [])
  const hasShift = input.shift === true || modifiers.has('shift')
  const hasAlt = input.alt === true || modifiers.has('alt')
  const hasMeta =
    input.meta === true || modifiers.has('meta') || modifiers.has('command') || modifiers.has('cmd')
  const hasControl = input.control === true || modifiers.has('control') || modifiers.has('ctrl')

  const hasAppModifier = platform === 'darwin' ? hasMeta && !hasControl : hasControl && !hasMeta

  if (!hasAppModifier) return false
  if (isBracketNavigationInput(input)) return true

  return !hasAlt && !hasShift
}

function usesAppAltModifier(input: AppHotkeyInput, platform: AppHotkeyPlatform): boolean {
  const modifiers = new Set(input.modifiers ?? [])
  const hasShift = input.shift === true || modifiers.has('shift')
  const hasAlt = input.alt === true || modifiers.has('alt') || modifiers.has('option')
  const hasMeta =
    input.meta === true || modifiers.has('meta') || modifiers.has('command') || modifiers.has('cmd')
  const hasControl = input.control === true || modifiers.has('control') || modifiers.has('ctrl')
  const hasAppModifier = platform === 'darwin' ? hasMeta && !hasControl : hasControl && !hasMeta

  return hasAppModifier && hasAlt && !hasShift
}

export function appHotkeyCommandForInput(
  input: AppHotkeyInput,
  platform: AppHotkeyPlatform
): AppHotkeyCommand | null {
  if (usesAppAltModifier(input, platform)) {
    if (input.code === 'KeyS' || input.key.toLowerCase() === 's') return 'open-side-chat-tab'
  }

  if (!usesAppModifier(input, platform)) return null

  switch (input.code) {
    case 'Comma':
      return 'open-settings'
    case 'KeyN':
      return 'new-session'
    case 'KeyG':
      return 'open-search'
    case 'KeyH':
      return 'hide-app'
    case 'KeyB':
      return 'toggle-sidebar'
    case 'KeyT':
      return 'open-browser-tab'
    case 'KeyP':
      return 'open-files-tab'
    case 'BracketLeft':
      return 'previous-session'
    case 'BracketRight':
      return 'next-session'
  }

  const key = input.key.toLowerCase()
  if (key === ',') return 'open-settings'
  if (key === 'n') return 'new-session'
  if (key === 'g') return 'open-search'
  if (key === 'h') return 'hide-app'
  if (key === 'b') return 'toggle-sidebar'
  if (key === 't') return 'open-browser-tab'
  if (key === 'p') return 'open-files-tab'
  if (key === '[') return 'previous-session'
  if (key === ']') return 'next-session'
  return null
}
