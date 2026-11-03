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
  createSession: (input) => ipcRenderer.invoke('codex:create-session', input),
  send: (input) => ipcRenderer.invoke('codex:send', input),
  interrupt: (id) => ipcRenderer.invoke('codex:interrupt', id),
  respond: (input) => ipcRenderer.invoke('codex:respond', input),
  archive: (id) => ipcRenderer.invoke('codex:archive', id),
  openRouter: (projectId) => ipcRenderer.invoke('codex:router-open', projectId),
  sendRouter: (input) => ipcRenderer.invoke('codex:router-send', input),
  interruptRouter: (id) => ipcRenderer.invoke('codex:router-interrupt', id),
  routerProviders: () => ipcRenderer.invoke('codex:router-providers'),
  setRouterKey: (input) => ipcRenderer.invoke('codex:router-set-key', input),
  removeRouterKey: (providerId) => ipcRenderer.invoke('codex:router-remove-key', providerId),
  onEvent: (listener) => {
    const handler = (_: Electron.IpcRendererEvent, event: CodexEvent) => listener(event)
    ipcRenderer.on('codex:event', handler)
    return () => ipcRenderer.removeListener('codex:event', handler)
  }
}
contextBridge.exposeInMainWorld('codex', api)
contextBridge.exposeInMainWorld(
  'owlsPlatform',
  ['darwin', 'win32', 'linux'].includes(process.platform) ? process.platform : 'other'
)
