import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent, OwlsAPI } from '../shared/app.js'
import type { MenuCommand } from '../shared/menu.js'
import type { UpdateSnapshot } from '../shared/updates.js'

const api: OwlsAPI = {
  snapshot: () => ipcRenderer.invoke('owls:snapshot'),
  connect: () => ipcRenderer.invoke('owls:connect'),
  selectExecutable: () => ipcRenderer.invoke('owls:select-executable'),
  connectClaude: () => ipcRenderer.invoke('owls:connect-claude'),
  selectClaudeExecutable: () => ipcRenderer.invoke('owls:select-claude-executable'),
  signIn: () => ipcRenderer.invoke('owls:sign-in'),
  cancelSignIn: () => ipcRenderer.invoke('owls:cancel-sign-in'),
  saveSettings: (settings) => ipcRenderer.invoke('owls:settings', settings),
  pickProject: () => ipcRenderer.invoke('owls:pick-project'),
  projectsFolder: () => ipcRenderer.invoke('owls:projects-folder'),
  chooseProjectsFolder: () => ipcRenderer.invoke('owls:choose-projects-folder'),
  workspaceFolder: () => ipcRenderer.invoke('owls:workspace-folder'),
  selectWorkspaceFolder: () => ipcRenderer.invoke('owls:select-workspace-folder'),
  resetWorkspaceFolder: () => ipcRenderer.invoke('owls:reset-workspace-folder'),
  cloneProject: (input) => ipcRenderer.invoke('owls:clone-project', input),
  createProject: (input) => ipcRenderer.invoke('owls:create-project', input),
  saveProject: (input) => ipcRenderer.invoke('owls:save-project', input),
  projectGitRefs: (projectId) => ipcRenderer.invoke('owls:project-git-refs', projectId),
  respond: (input) => ipcRenderer.invoke('owls:respond', input),
  createThread: (input) => ipcRenderer.invoke('owls:router-create', input),
  threadItems: (input) => ipcRenderer.invoke('owls:router-items', input),
  sendRouter: (input) => ipcRenderer.invoke('owls:router-send', input),
  forward: (input) => ipcRenderer.invoke('owls:router-forward', input),
  interruptRouter: (id) => ipcRenderer.invoke('owls:router-interrupt', id),
  resolveBatch: (input) => ipcRenderer.invoke('owls:router-resolve-batch', input),
  discardWorktree: (input) => ipcRenderer.invoke('owls:router-discard-worktree', input),
  stopWorker: (input) => ipcRenderer.invoke('owls:router-stop-worker', input),
  removeWorker: (input) => ipcRenderer.invoke('owls:router-remove-worker', input),
  openInApps: () => ipcRenderer.invoke('owls:open-in-apps'),
  openWorkerIn: (input) => ipcRenderer.invoke('owls:open-worker-in', input),
  routerProviders: () => ipcRenderer.invoke('owls:router-providers'),
  setRouterKey: (input) => ipcRenderer.invoke('owls:router-set-key', input),
  removeRouterKey: (providerId) => ipcRenderer.invoke('owls:router-remove-key', providerId),
  gitHubSignIn: () => ipcRenderer.invoke('owls:github-sign-in'),
  gitHubConnectCli: () => ipcRenderer.invoke('owls:github-connect-cli'),
  gitHubConnectToken: (token) => ipcRenderer.invoke('owls:github-connect-token', token),
  gitHubCancelSignIn: () => ipcRenderer.invoke('owls:github-cancel-sign-in'),
  gitHubSignOut: () => ipcRenderer.invoke('owls:github-sign-out'),
  watchWorkerGitHub: (input) => ipcRenderer.invoke('owls:github-watch-worker', input),
  unwatchWorkerGitHub: (input) => ipcRenderer.invoke('owls:github-unwatch-worker', input),
  pullRequests: () => ipcRenderer.invoke('owls:github-pull-requests'),
  onEvent: (listener) => {
    const handler = (_: Electron.IpcRendererEvent, event: AppEvent) => listener(event)
    ipcRenderer.on('owls:event', handler)
    return () => ipcRenderer.removeListener('owls:event', handler)
  },
  onMenuCommand: (listener) => {
    const handler = (_: Electron.IpcRendererEvent, command: MenuCommand) => listener(command)
    ipcRenderer.on('owls:menu-command', handler)
    return () => ipcRenderer.removeListener('owls:menu-command', handler)
  },
  memory: {
    list: (input) => ipcRenderer.invoke('owls:memory-list', input),
    overview: () => ipcRenderer.invoke('owls:memory-overview'),
    save: (input) => ipcRenderer.invoke('owls:memory-save', input),
    remove: (input) => ipcRenderer.invoke('owls:memory-remove', input),
    category: (input) => ipcRenderer.invoke('owls:memory-category', input),
    runNow: () => ipcRenderer.invoke('owls:memory-run'),
    runs: () => ipcRenderer.invoke('owls:memory-runs'),
    export: (format) => ipcRenderer.invoke('owls:memory-export', format),
    onChanged: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('owls:memory-changed', handler)
      return () => ipcRenderer.removeListener('owls:memory-changed', handler)
    }
  },
  cards: {
    library: () => ipcRenderer.invoke('owls:cards-library'),
    save: (input) => ipcRenderer.invoke('owls:cards-save', input),
    capture: (input) => ipcRenderer.invoke('owls:cards-capture', input),
    remove: (cardId) => ipcRenderer.invoke('owls:cards-remove', cardId),
    saveBoard: (input) => ipcRenderer.invoke('owls:cards-save-board', input),
    removeBoard: (boardId) => ipcRenderer.invoke('owls:cards-remove-board', boardId),
    onChanged: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('owls:cards-changed', handler)
      return () => ipcRenderer.removeListener('owls:cards-changed', handler)
    }
  },
  updates: {
    snapshot: () => ipcRenderer.invoke('owls:updates-snapshot'),
    check: () => ipcRenderer.invoke('owls:updates-check'),
    install: () => ipcRenderer.invoke('owls:updates-install'),
    onChanged: (listener) => {
      const handler = (_: Electron.IpcRendererEvent, snapshot: UpdateSnapshot) => listener(snapshot)
      ipcRenderer.on('owls:updates-changed', handler)
      return () => ipcRenderer.removeListener('owls:updates-changed', handler)
    }
  }
}
contextBridge.exposeInMainWorld('owls', api)
contextBridge.exposeInMainWorld(
  'owlsPlatform',
  ['darwin', 'win32', 'linux'].includes(process.platform) ? process.platform : 'other'
)
