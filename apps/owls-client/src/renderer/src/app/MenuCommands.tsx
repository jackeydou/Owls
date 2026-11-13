import { useEffect, useState } from 'react'
import type { MenuCommand } from '../../../shared/menu'
import { NewProjectDialog, type NewProjectSource } from '../router/AddProjectMenu'
import { useAppStore } from './store'

function run(command: MenuCommand, openProjectForm: (source: NewProjectSource) => void) {
  const app = useAppStore.getState()
  // Settings' navigation is its only way between tabs, so the sidebars stay as they are there.
  const inSettings = app.view === 'settings'
  switch (command) {
    case 'new-thread':
      return app.newThread()
    case 'new-project':
      return openProjectForm('quick')
    case 'clone-project':
      return openProjectForm('github')
    case 'open-folder':
      return void app.pickProject()
    case 'settings':
      return app.showSettings()
    case 'updates':
      return app.showSettings('updates')
    case 'toggle-sidebar':
      return inSettings ? undefined : app.toggleSidebar()
    case 'toggle-projects':
      return inSettings ? undefined : app.toggleProjects()
    case 'toggle-overview':
      return app.view === 'map' ? app.showChat() : app.showMap()
    case 'pull-requests':
      return app.settings.pullRequestsVisible ? app.showPullRequests() : undefined
  }
}

/** Carries out the commands chosen in the native application menu. */
export function MenuCommands() {
  const [source, setSource] = useState<NewProjectSource | null>(null)
  useEffect(() => window.owls.onMenuCommand((command) => run(command, setSource)), [])
  return source ? <NewProjectDialog source={source} onClose={() => setSource(null)} /> : null
}
