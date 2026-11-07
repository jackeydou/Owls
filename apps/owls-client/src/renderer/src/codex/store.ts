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
import type { GitHubAccount } from '../../../shared/github'
import { defaultRouterSettings } from '../../../shared/router'
import { byRecent } from '../router/activity'
import { zoomBetweenViews } from '../router/motion'
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
export type SettingsTab = 'router' | 'workers' | 'claude-code' | 'codex' | 'github' | 'appearance'

type State = {
  loaded: boolean
  error: CodexFailure | null
  /** `chat` and `map` are the same space at two distances; `settings` replaces the whole window. */
  view: 'chat' | 'map' | 'settings'
  /** Where Settings returns to. */
  lastView: 'chat' | 'map'
  /** Survives leaving Settings, so reopening lands where the user was. */
  settingsTab: SettingsTab
  github: GitHubAccount
  /** The thread on screen; null is a new thread that has no message yet. */
  threadId: string | null
  /** The project in focus: a new thread's default, and what the map composer sends to. */
  routerProjectId: string | null
  sessions: CodexSession[]
  projects: CodexProject[]
  settings: CodexSettings
  connection: CodexConnection
  claude: ClaudeConnection
  initialize(): Promise<void>
  event(event: CodexEvent): void
  showSettings(tab?: SettingsTab): void
  gitHubSignIn(): Promise<void>
  gitHubConnectCli(): Promise<void>
  gitHubConnectToken(token: string): Promise<void>
  gitHubCancelSignIn(): Promise<void>
  gitHubSignOut(): Promise<void>
  leaveSettings(): void
  /** Opens the current thread, or a project's latest thread when given one. */
  showChat(projectId?: string): void
  showThread(threadId: string): void
  /** Opens a thread that exists once its first message is sent. */
  newThread(projectId?: string): void
  showMap(): void
  focusProject(projectId: string | null): void
  clearError(): void
  /** Opens the folder picker. Resolves to the project's id, or null when canceled. */
  pickProject(): Promise<string | null>
  toggleSidebar(): void
  connect(): Promise<void>
  selectExecutable(): Promise<void>
  connectClaude(): Promise<void>
  selectClaudeExecutable(): Promise<void>
  saveSettings(settings: CodexSettings): Promise<void>
  respond(input: RespondCodexRequest): Promise<void>
}
/** The most recently active thread in a project, or across all of them. */
function latestThread(routers: CodexRouter[], projectId?: string): CodexRouter | null {
  const threads = projectId ? routers.filter((r) => r.projectId === projectId) : routers
  return [...threads].sort(byRecent)[0] ?? null
}
let connectionEvents = 0
let claudeEvents = 0
let gitHubEvents = 0
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
    settingsTab: 'router',
    threadId: null,
    github: { status: 'signed-out', failure: null },
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
      sidebarCollapsed: false,
      provider: 'codex',
      claudeExecutablePath: null,
      claudeModel: null,
      claudeEffort: null,
      router: defaultRouterSettings
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
      const gitHubVersion = gitHubEvents
      const snapshot = await action(() => window.codex.snapshot())
      if (!snapshot) {
        set({ loaded: true })
        return
      }
      useRouterStore.getState().hydrate(snapshot.routers, snapshot.workers)
      const latest = latestThread(snapshot.routers)
      set((state) => ({
        loaded: true,
        projects: snapshot.projects,
        settings: snapshot.settings,
        // Waits for the first load: a repeated one must not leave a new thread's draft.
        threadId: state.loaded ? state.threadId : (latest?.id ?? null),
        routerProjectId:
          state.routerProjectId ?? latest?.projectId ?? snapshot.projects[0]?.id ?? null,
        sessions: snapshot.sessions.map((s) => {
          const live = state.sessions.find((existing) => existing.id === s.id)
          return live && live.updatedAt >= s.updatedAt ? live : s
        }),
        connection: version === connectionEvents ? snapshot.connection : state.connection,
        claude: claudeVersion === claudeEvents ? snapshot.claude : state.claude,
        github: gitHubVersion === gitHubEvents ? snapshot.github : state.github
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
      if (event.type === 'github-account') {
        gitHubEvents++
        set({ github: event.account })
        return
      }
      if (event.type === 'worker-github') {
        useRouterStore.getState().workerGitHub(event.workerId, event.status)
        return
      }
      if (event.type === 'router') {
        useRouterStore.getState().router(event.router)
        return
      }
      if (event.type === 'thread-items') {
        useRouterStore.getState().threadItems(event.routerId, event.items)
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
    gitHubSignIn: async () => {
      await action(() => window.codex.gitHubSignIn())
    },
    gitHubConnectCli: async () => {
      await action(() => window.codex.gitHubConnectCli())
    },
    gitHubConnectToken: async (token) => {
      await action(() => window.codex.gitHubConnectToken(token))
    },
    gitHubCancelSignIn: async () => {
      await action(() => window.codex.gitHubCancelSignIn())
    },
    gitHubSignOut: async () => {
      await action(() => window.codex.gitHubSignOut())
    },
    showSettings: (tab) =>
      set((state) => ({
        view: 'settings',
        lastView: state.view === 'settings' ? state.lastView : state.view,
        settingsTab: tab ?? state.settingsTab,
        error: null
      })),
    leaveSettings: () => set((state) => ({ view: state.lastView, error: null })),
    showChat: (projectId) => {
      const { view, routerProjectId, threadId } = get()
      const target = projectId ?? routerProjectId
      const thread = projectId
        ? (latestThread(useRouterStore.getState().routers, projectId)?.id ?? null)
        : threadId
      const show = () =>
        set({ view: 'chat', threadId: thread, routerProjectId: target, error: null })
      if (view === 'map') zoomBetweenViews('chat', target, show)
      else show()
    },
    showThread: (threadId) => {
      const router = useRouterStore.getState().routers.find((r) => r.id === threadId)
      set((state) => ({
        view: 'chat',
        threadId,
        routerProjectId: router?.projectId ?? state.routerProjectId,
        error: null
      }))
    },
    newThread: (projectId) =>
      set((state) => ({
        view: 'chat',
        threadId: null,
        routerProjectId: projectId ?? state.routerProjectId,
        error: null
      })),
    showMap: () => {
      const { view, routerProjectId } = get()
      const show = () => set({ view: 'map', error: null })
      if (view === 'chat') zoomBetweenViews('map', routerProjectId, show)
      else show()
    },
    focusProject: (projectId) => set({ routerProjectId: projectId }),
    clearError: () => set({ error: null }),
    pickProject: async () => {
      const project = await action(() => window.codex.pickProject())
      if (!project) return null
      set((state) => ({
        projects: [...state.projects.filter((p) => p.id !== project.id), project].sort((a, b) =>
          a.name.localeCompare(b.name)
        ),
        routerProjectId: project.id,
        threadId: null,
        view: 'chat'
      }))
      return project.id
    },
    toggleSidebar: () => {
      const { settings, saveSettings } = get()
      void saveSettings({ ...settings, sidebarCollapsed: !settings.sidebarCollapsed })
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
          sidebarCollapsed: settings.sidebarCollapsed,
          provider: settings.provider,
          claudeModel: settings.claudeModel,
          claudeEffort: settings.claudeEffort,
          router: settings.router
        })
      )
      if (saved) set({ settings: saved })
    },
    respond: async (input) => {
      await action(() => window.codex.respond(input))
    }
  }
})
