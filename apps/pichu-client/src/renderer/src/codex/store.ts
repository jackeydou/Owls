import { create } from 'zustand'
import type {
  AgentProvider,
  ClaudeConnection,
  CodexConnection,
  CodexEvent,
  CodexFailure,
  CodexProject,
  CodexReply,
  CodexRouter,
  CodexSession,
  CodexSettings,
  RespondCodexRequest
} from '../../../shared/codex'
import { defaultRouterSettings } from '../../../shared/router'
import { useRouterStore } from '../router/store'
import { CodexUIError, uiFailure } from './failures'

export function agentConnection(
  state: { connection: CodexConnection; claude: ClaudeConnection },
  provider: AgentProvider
): CodexConnection | ClaudeConnection {
  return provider === 'claude-code' ? state.claude : state.connection
}
export function agentSelection(settings: CodexSettings, provider: AgentProvider) {
  return provider === 'claude-code'
    ? { model: settings.claudeModel, effort: settings.claudeEffort }
    : { model: settings.model, effort: settings.effort }
}
export function isAgentReady(connection: CodexConnection | ClaudeConnection): boolean {
  return connection.status === 'ready' && connection.account.kind !== 'signed-out'
}
function unwrap<T>(reply: CodexReply<T>): T {
  if (!reply.ok) throw new CodexUIError(reply.error)
  return reply.value
}
type State = {
  loaded: boolean
  error: CodexFailure | null
  /** `chat` and `map` are the same space at two distances; `settings` sits on top of either. */
  view: 'chat' | 'map' | 'settings'
  /** Where Settings returns to. */
  lastView: 'chat' | 'map'
  /** The project in focus: its conversation, or the one the map composer sends to. */
  routerProjectId: string | null
  sessions: CodexSession[]
  projects: CodexProject[]
  settings: CodexSettings
  connection: CodexConnection
  claude: ClaudeConnection
  initialize(): Promise<void>
  event(event: CodexEvent): void
  showSettings(): void
  leaveSettings(): void
  showChat(projectId?: string): void
  showMap(): void
  focusProject(projectId: string): void
  clearError(): void
  pickProject(): Promise<void>
  connect(): Promise<void>
  selectExecutable(): Promise<void>
  connectClaude(): Promise<void>
  selectClaudeExecutable(): Promise<void>
  saveSettings(settings: CodexSettings): Promise<void>
  respond(input: RespondCodexRequest): Promise<void>
}
/** The most recently active Router's project, or the first project on a fresh install. */
function startProject(projects: CodexProject[], routers: CodexRouter[]): string | null {
  const known = (id: string) => projects.some((p) => p.id === id)
  const [latest] = routers
    .filter((r) => known(r.projectId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return latest?.projectId ?? projects[0]?.id ?? null
}
let connectionEvents = 0
let claudeEvents = 0
export const useCodexStore = create<State>((set, get) => {
  async function action<T>(fn: () => Promise<CodexReply<T>>): Promise<T | undefined> {
    try {
      set({ error: null })
      return unwrap(await fn())
    } catch (error) {
      set({ error: uiFailure(error) })
      return undefined
    }
  }
  return {
    loaded: false,
    error: null,
    view: 'chat',
    lastView: 'chat',
    routerProjectId: null,
    sessions: [],
    projects: [],
    settings: {
      executablePath: null,
      model: null,
      effort: null,
      permission: 'workspace-write',
      theme: 'system',
      language: 'en',
      appLogo: 'solid',
      provider: 'codex',
      claudeExecutablePath: null,
      claudeModel: null,
      claudeEffort: null,
      router: defaultRouterSettings,
      workerProvider: null
    },
    connection: {
      status: 'disconnected',
      executablePath: null,
      version: null,
      account: { kind: 'signed-out' },
      models: [],
      error: null
    },
    claude: {
      status: 'disconnected',
      executablePath: null,
      version: null,
      account: { kind: 'unknown' },
      models: [],
      error: null
    },
    initialize: async () => {
      const version = connectionEvents
      const claudeVersion = claudeEvents
      const snapshot = await action(() => window.codex.snapshot())
      if (!snapshot) {
        set({ loaded: true })
        return
      }
      useRouterStore.getState().hydrate(snapshot.routers, snapshot.workers)
      set((state) => ({
        loaded: true,
        projects: snapshot.projects,
        settings: snapshot.settings,
        routerProjectId: state.routerProjectId ?? startProject(snapshot.projects, snapshot.routers),
        sessions: snapshot.sessions.map((s) => {
          const live = state.sessions.find((existing) => existing.id === s.id)
          return live && live.updatedAt >= s.updatedAt ? live : s
        }),
        connection: version === connectionEvents ? snapshot.connection : state.connection,
        claude: claudeVersion === claudeEvents ? snapshot.claude : state.claude
      }))
    },
    event: (event) => {
      if (event.type === 'connection') {
        connectionEvents++
        set({ connection: event.connection })
        return
      }
      if (event.type === 'claude-connection') {
        claudeEvents++
        set({ claude: event.connection })
        return
      }
      if (event.type === 'router') {
        useRouterStore.getState().router(event.router)
        return
      }
      if (event.type === 'worker') {
        useRouterStore.getState().worker(event.worker)
        return
      }
      if (event.type === 'removed') {
        set((state) => ({ sessions: state.sessions.filter((s) => s.id !== event.sessionId) }))
        return
      }
      set((state) => ({
        sessions: [event.session, ...state.sessions.filter((s) => s.id !== event.session.id)].sort(
          (a, b) => b.updatedAt.localeCompare(a.updatedAt)
        )
      }))
    },
    showSettings: () =>
      set((state) => ({
        view: 'settings',
        lastView: state.view === 'settings' ? state.lastView : state.view,
        error: null
      })),
    leaveSettings: () => set((state) => ({ view: state.lastView, error: null })),
    showChat: (projectId) =>
      set((state) => ({
        view: 'chat',
        routerProjectId: projectId ?? state.routerProjectId,
        error: null
      })),
    showMap: () => set({ view: 'map', error: null }),
    focusProject: (projectId) => set({ routerProjectId: projectId }),
    clearError: () => set({ error: null }),
    pickProject: async () => {
      const project = await action(() => window.codex.pickProject())
      if (project)
        set((state) => ({
          projects: [...state.projects.filter((p) => p.id !== project.id), project].sort((a, b) =>
            a.name.localeCompare(b.name)
          ),
          routerProjectId: project.id,
          view: 'chat'
        }))
    },
    connect: async () => {
      const connection = await action(() => window.codex.connect())
      if (connection) set({ connection })
    },
    selectExecutable: async () => {
      const connection = await action(() => window.codex.selectExecutable())
      if (connection) {
        set({ connection })
        await get().initialize()
      }
    },
    connectClaude: async () => {
      const claude = await action(() => window.codex.connectClaude())
      if (claude) set({ claude })
    },
    selectClaudeExecutable: async () => {
      const claude = await action(() => window.codex.selectClaudeExecutable())
      if (claude) {
        set({ claude })
        await get().initialize()
      }
    },
    saveSettings: async (settings) => {
      const saved = await action(() =>
        window.codex.saveSettings({
          model: settings.model,
          effort: settings.effort,
          permission: settings.permission,
          theme: settings.theme,
          language: settings.language,
          appLogo: settings.appLogo,
          provider: settings.provider,
          claudeModel: settings.claudeModel,
          claudeEffort: settings.claudeEffort,
          router: settings.router,
          workerProvider: settings.workerProvider
        })
      )
      if (saved) set({ settings: saved })
    },
    respond: async (input) => {
      await action(() => window.codex.respond(input))
    }
  }
})
