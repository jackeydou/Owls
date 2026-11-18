import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent, OpenWorkerTarget, OwltoAPI } from '../shared/app.js'
import type { MenuCommand } from '../shared/menu.js'
import type { UpdateSnapshot } from '../shared/updates.js'

const api: OwltoAPI = {
  snapshot: () => ipcRenderer.invoke('owlto:snapshot'),
  connect: () => ipcRenderer.invoke('owlto:connect'),
  selectExecutable: () => ipcRenderer.invoke('owlto:select-executable'),
  connectClaude: () => ipcRenderer.invoke('owlto:connect-claude'),
  selectClaudeExecutable: () => ipcRenderer.invoke('owlto:select-claude-executable'),
  connectCursor: () => ipcRenderer.invoke('owlto:connect-cursor'),
  selectCursorExecutable: () => ipcRenderer.invoke('owlto:select-cursor-executable'),
  disconnectAgent: (provider) => ipcRenderer.invoke('owlto:disconnect-agent', provider),
  detectAgents: () => ipcRenderer.invoke('owlto:detect-agents'),
  signIn: () => ipcRenderer.invoke('owlto:sign-in'),
  cancelSignIn: () => ipcRenderer.invoke('owlto:cancel-sign-in'),
  saveSettings: (settings) => ipcRenderer.invoke('owlto:settings', settings),
  saveProfile: (update) => ipcRenderer.invoke('owlto:profile', update),
  applyGitHubAvatar: () => ipcRenderer.invoke('owlto:profile-github-avatar'),
  pickProject: () => ipcRenderer.invoke('owlto:pick-project'),
  projectsFolder: () => ipcRenderer.invoke('owlto:projects-folder'),
  chooseProjectsFolder: () => ipcRenderer.invoke('owlto:choose-projects-folder'),
  workspaceFolder: () => ipcRenderer.invoke('owlto:workspace-folder'),
  selectWorkspaceFolder: () => ipcRenderer.invoke('owlto:select-workspace-folder'),
  resetWorkspaceFolder: () => ipcRenderer.invoke('owlto:reset-workspace-folder'),
  workspaceListing: () => ipcRenderer.invoke('owlto:workspace-listing'),
  promoteWorkspaceFolder: (path) => ipcRenderer.invoke('owlto:promote-workspace-folder', path),
  dismissWorkspaceFolder: (path) => ipcRenderer.invoke('owlto:dismiss-workspace-folder', path),
  mergeIntoWorkspace: (projectId) => ipcRenderer.invoke('owlto:merge-into-workspace', projectId),
  cloneProject: (input) => ipcRenderer.invoke('owlto:clone-project', input),
  createProject: (input) => ipcRenderer.invoke('owlto:create-project', input),
  saveProject: (input) => ipcRenderer.invoke('owlto:save-project', input),
  projectGitRefs: (projectId) => ipcRenderer.invoke('owlto:project-git-refs', projectId),
  respond: (input) => ipcRenderer.invoke('owlto:respond', input),
  createThread: (input) => ipcRenderer.invoke('owlto:router-create', input),
  threadItems: (input) => ipcRenderer.invoke('owlto:router-items', input),
  sendRouter: (input) => ipcRenderer.invoke('owlto:router-send', input),
  stageAttachment: (input) => ipcRenderer.invoke('owlto:attachment-stage', input),
  attachmentPreview: (attachment) => ipcRenderer.invoke('owlto:attachment-preview', attachment),
  openAttachment: (attachment) => ipcRenderer.invoke('owlto:attachment-open', attachment),
  forward: (input) => ipcRenderer.invoke('owlto:router-forward', input),
  interruptRouter: (id) => ipcRenderer.invoke('owlto:router-interrupt', id),
  deleteThread: (id) => ipcRenderer.invoke('owlto:router-delete', id),
  archiveThread: (input) => ipcRenderer.invoke('owlto:router-archive', input),
  resolveBatch: (input) => ipcRenderer.invoke('owlto:router-resolve-batch', input),
  discardWorktree: (input) => ipcRenderer.invoke('owlto:router-discard-worktree', input),
  stopWorker: (input) => ipcRenderer.invoke('owlto:router-stop-worker', input),
  steerPendingMessage: (input) => ipcRenderer.invoke('owlto:router-steer-pending', input),
  dropPendingMessage: (input) => ipcRenderer.invoke('owlto:router-drop-pending', input),
  removeWorker: (input) => ipcRenderer.invoke('owlto:router-remove-worker', input),
  openInApps: () => ipcRenderer.invoke('owlto:open-in-apps'),
  openWorkerIn: (input) => ipcRenderer.invoke('owlto:open-worker-in', input),
  previewFile: (input) => ipcRenderer.invoke('owlto:file-preview', input),
  openFileIn: (input) => ipcRenderer.invoke('owlto:open-file-in', input),
  routerProviders: () => ipcRenderer.invoke('owlto:router-providers'),
  setRouterKey: (input) => ipcRenderer.invoke('owlto:router-set-key', input),
  removeRouterKey: (providerId) => ipcRenderer.invoke('owlto:router-remove-key', providerId),
  gitHubSignIn: () => ipcRenderer.invoke('owlto:github-sign-in'),
  gitHubConnectCli: () => ipcRenderer.invoke('owlto:github-connect-cli'),
  gitHubConnectToken: (token) => ipcRenderer.invoke('owlto:github-connect-token', token),
  gitHubCancelSignIn: () => ipcRenderer.invoke('owlto:github-cancel-sign-in'),
  gitHubSignOut: () => ipcRenderer.invoke('owlto:github-sign-out'),
  watchWorkerGitHub: (input) => ipcRenderer.invoke('owlto:github-watch-worker', input),
  unwatchWorkerGitHub: (input) => ipcRenderer.invoke('owlto:github-unwatch-worker', input),
  pullRequests: () => ipcRenderer.invoke('owlto:github-pull-requests'),
  feedbackDiagnostics: () => ipcRenderer.invoke('owlto:feedback-diagnostics'),
  sendFeedback: (input) => ipcRenderer.invoke('owlto:feedback-send', input),
  agentUsage: (refresh: boolean) => ipcRenderer.invoke('owlto:agent-usage', refresh),
  usageStats: (request) => ipcRenderer.invoke('owlto:usage-stats', request),
  deviceId: () => ipcRenderer.invoke('owlto:device-id'),
  featureFlag: (key) => ipcRenderer.invoke('owlto:feature-flag', key),
  onEvent: (listener) => {
    const handler = (_: Electron.IpcRendererEvent, event: AppEvent) => listener(event)
    ipcRenderer.on('owlto:event', handler)
    return () => ipcRenderer.removeListener('owlto:event', handler)
  },
  onMenuCommand: (listener) => {
    const handler = (_: Electron.IpcRendererEvent, command: MenuCommand) => listener(command)
    ipcRenderer.on('owlto:menu-command', handler)
    return () => ipcRenderer.removeListener('owlto:menu-command', handler)
  },
  onOpenWorker: (listener) => {
    const handler = (_: Electron.IpcRendererEvent, target: OpenWorkerTarget) => listener(target)
    ipcRenderer.on('owlto:open-worker', handler)
    return () => ipcRenderer.removeListener('owlto:open-worker', handler)
  },
  memory: {
    list: (input) => ipcRenderer.invoke('owlto:memory-list', input),
    overview: () => ipcRenderer.invoke('owlto:memory-overview'),
    save: (input) => ipcRenderer.invoke('owlto:memory-save', input),
    remove: (input) => ipcRenderer.invoke('owlto:memory-remove', input),
    category: (input) => ipcRenderer.invoke('owlto:memory-category', input),
    runNow: () => ipcRenderer.invoke('owlto:memory-run'),
    dreamThread: (threadId) => ipcRenderer.invoke('owlto:memory-dream-thread', threadId),
    runs: () => ipcRenderer.invoke('owlto:memory-runs'),
    export: (format) => ipcRenderer.invoke('owlto:memory-export', format),
    onChanged: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('owlto:memory-changed', handler)
      return () => ipcRenderer.removeListener('owlto:memory-changed', handler)
    }
  },
  cards: {
    library: () => ipcRenderer.invoke('owlto:cards-library'),
    save: (input) => ipcRenderer.invoke('owlto:cards-save', input),
    capture: (input) => ipcRenderer.invoke('owlto:cards-capture', input),
    remove: (cardId) => ipcRenderer.invoke('owlto:cards-remove', cardId),
    saveBoard: (input) => ipcRenderer.invoke('owlto:cards-save-board', input),
    removeBoard: (boardId) => ipcRenderer.invoke('owlto:cards-remove-board', boardId),
    reveal: (cardId) => ipcRenderer.invoke('owlto:cards-reveal', cardId),
    onChanged: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('owlto:cards-changed', handler)
      return () => ipcRenderer.removeListener('owlto:cards-changed', handler)
    }
  },
  automations: {
    list: () => ipcRenderer.invoke('owlto:automations-list'),
    save: (input) => ipcRenderer.invoke('owlto:automations-save', input),
    setEnabled: (input) => ipcRenderer.invoke('owlto:automations-enable', input),
    remove: (id) => ipcRenderer.invoke('owlto:automations-remove', id),
    runNow: (id) => ipcRenderer.invoke('owlto:automations-run', id),
    onChanged: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('owlto:automations-changed', handler)
      return () => ipcRenderer.removeListener('owlto:automations-changed', handler)
    }
  },
  updates: {
    snapshot: () => ipcRenderer.invoke('owlto:updates-snapshot'),
    check: () => ipcRenderer.invoke('owlto:updates-check'),
    install: () => ipcRenderer.invoke('owlto:updates-install'),
    onChanged: (listener) => {
      const handler = (_: Electron.IpcRendererEvent, snapshot: UpdateSnapshot) => listener(snapshot)
      ipcRenderer.on('owlto:updates-changed', handler)
      return () => ipcRenderer.removeListener('owlto:updates-changed', handler)
    }
  }
}
contextBridge.exposeInMainWorld('owlto', api)
contextBridge.exposeInMainWorld(
  'owltoPlatform',
  ['darwin', 'win32', 'linux'].includes(process.platform) ? process.platform : 'other'
)
