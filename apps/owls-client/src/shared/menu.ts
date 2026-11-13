/** Commands the native application menu sends to the renderer, which owns the views they open. */
export const menuCommands = [
  'new-thread',
  'new-project',
  'clone-project',
  'open-folder',
  'settings',
  'updates',
  'toggle-sidebar',
  'toggle-projects',
  'toggle-overview',
  'pull-requests'
] as const
export type MenuCommand = (typeof menuCommands)[number]
