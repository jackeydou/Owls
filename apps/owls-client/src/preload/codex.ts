import { contextBridge, ipcRenderer } from 'electron'
import type { CodexAPI, CodexEvent } from '../shared/codex.js'

const api: CodexAPI = {
  snapshot: () => ipcRenderer.invoke('codex:snapshot'),
  connect: () => ipcRenderer.invoke('codex:connect'),
  selectExecutable: () => ipcRenderer.invoke('codex:select-executable'),
  connectClaude: () => ipcRenderer.invoke('codex:connect-claude'),
  selectClaudeExecutable: () => ipcRenderer.invoke('codex:select-claude-executable'),
  signIn: () => ipcRenderer.invoke('codex:sign-in'),
  cancelSignIn: () => ipcRenderer.invoke('codex:cancel-sign-in'),
  saveSettings: (settings) => ipcRenderer.invoke('codex:settings', settings),
  pickProject: () => ipcRenderer.invoke('codex:pick-project'),
  projectsFolder: () => ipcRenderer.invoke('codex:projects-folder'),
  chooseProjectsFolder: () => ipcRenderer.invoke('codex:choose-projects-folder'),
  cloneProject: (input) => ipcRenderer.invoke('codex:clone-project', input),
  createProject: (input) => ipcRenderer.invoke('codex:create-project', input),
  saveProject: (input) => ipcRenderer.invoke('codex:save-project', input),
  projectGitRefs: (projectId) => ipcRenderer.invoke('codex:project-git-refs', projectId),
  respond: (input) => ipcRenderer.invoke('codex:respond', input),
  createThread: (input) => ipcRenderer.invoke('codex:router-create', input),
  threadItems: (input) => ipcRenderer.invoke('codex:router-items', input),
  sendRouter: (input) => ipcRenderer.invoke('codex:router-send', input),
  forward: (input) => ipcRenderer.invoke('codex:router-forward', input),
  interruptRouter: (id) => ipcRenderer.invoke('codex:router-interrupt', id),
  resolveBatch: (input) => ipcRenderer.invoke('codex:router-resolve-batch', input),
  discardWorktree: (input) => ipcRenderer.invoke('codex:router-discard-worktree', input),
  stopWorker: (input) => ipcRenderer.invoke('codex:router-stop-worker', input),
  removeWorker: (input) => ipcRenderer.invoke('codex:router-remove-worker', input),
  routerProviders: () => ipcRenderer.invoke('codex:router-providers'),
  setRouterKey: (input) => ipcRenderer.invoke('codex:router-set-key', input),
  removeRouterKey: (providerId) => ipcRenderer.invoke('codex:router-remove-key', providerId),
  gitHubSignIn: () => ipcRenderer.invoke('codex:github-sign-in'),
  gitHubConnectCli: () => ipcRenderer.invoke('codex:github-connect-cli'),
  gitHubConnectToken: (token) => ipcRenderer.invoke('codex:github-connect-token', token),
  gitHubCancelSignIn: () => ipcRenderer.invoke('codex:github-cancel-sign-in'),
  gitHubSignOut: () => ipcRenderer.invoke('codex:github-sign-out'),
  watchWorkerGitHub: (input) => ipcRenderer.invoke('codex:github-watch-worker', input),
  unwatchWorkerGitHub: (input) => ipcRenderer.invoke('codex:github-unwatch-worker', input),
  onEvent: (listener) => {
    const handler = (_: Electron.IpcRendererEvent, event: CodexEvent) => listener(event)
    ipcRenderer.on('codex:event', handler)
    return () => ipcRenderer.removeListener('codex:event', handler)
  },
  memory: {
    list: (input) => ipcRenderer.invoke('codex:memory-list', input),
    overview: () => ipcRenderer.invoke('codex:memory-overview'),
    save: (input) => ipcRenderer.invoke('codex:memory-save', input),
    remove: (input) => ipcRenderer.invoke('codex:memory-remove', input),
    category: (input) => ipcRenderer.invoke('codex:memory-category', input),
    runNow: () => ipcRenderer.invoke('codex:memory-run'),
    runs: () => ipcRenderer.invoke('codex:memory-runs'),
    export: (format) => ipcRenderer.invoke('codex:memory-export', format),
    onChanged: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('codex:memory-changed', handler)
      return () => ipcRenderer.removeListener('codex:memory-changed', handler)
    }
  }
}
contextBridge.exposeInMainWorld('codex', api)
contextBridge.exposeInMainWorld(
  'owlsPlatform',
  ['darwin', 'win32', 'linux'].includes(process.platform) ? process.platform : 'other'
)
