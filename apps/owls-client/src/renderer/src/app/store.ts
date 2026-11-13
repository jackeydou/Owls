import { create } from 'zustand'
import type {
  AgentConnection,
  AgentProvider,
  AppEvent,
  AppSettings,
  ClaudeConnection,
  CodexConnection,
  CursorConnection,
  Failure,
  Project,
  Reply,
  ResizablePane,
  RespondRequest,
  Router,
  Session
} from '../../../shared/app'
import { defaultAppLogo, defaultLayoutSettings, paneWidthBounds } from '../../../shared/app'
import type { GitHubAccount } from '../../../shared/github'
import { defaultMemorySettings } from '../../../shared/memory'
import type {
  CloneProject,
  CreateProject,
  ProjectGitRefs,
  SaveProject
} from '../../../shared/projects'
import { defaultRouterSettings } from '../../../shared/router'
import { byRecent } from '../router/activity'
import { zoomBetweenViews } from '../router/motion'
import { useRouterStore } from '../router/store'
import { UIError, uiFailure } from './failures'

export function agentConnection(
  state: { connection: CodexConnection; claude: ClaudeConnection; cursor: CursorConnection },
  provider: AgentProvider
): AgentConnection {
  if (provider === 'claude-code') return state.claude
  return provider === 'cursor' ? state.cursor : state.connection
}
/** A provider's default model and effort for new workers. Cursor has no effort setting. */
export function agentSelection(settings: AppSettings, provider: AgentProvider) {
  if (provider === 'claude-code')
    return { model: settings.claudeModel, effort: settings.claudeEffort }
  if (provider === 'cursor') return { model: settings.cursorModel, effort: null }
  return { model: settings.model, effort: settings.effort }
}
/** Saves a provider's default model and effort for new workers. */
export function withAgentSelection(
  settings: AppSettings,
  provider: AgentProvider,
  next: { model: string | null; effort: string | null }
): AppSettings {
  if (provider === 'claude-code')
    return { ...settings, claudeModel: next.model, claudeEffort: next.effort }
  if (provider === 'cursor') return { ...settings, cursorModel: next.model }
  return { ...settings, model: next.model, effort: next.effort }
}
export function isAgentReady(connection: AgentConnection): boolean {
  return connection.status === 'ready' && connection.account.kind !== 'signed-out'
}
function unwrap<T>(reply: Reply<T>): T {
  if (!reply.ok) throw new UIError(reply.error)
  return reply.value
}
export type SettingsTab =
  | 'router'
  | 'workers'
  | 'memory'
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'github'
  | 'appearance'
  | 'updates'
  /** One project's settings; `settingsProject` says which project and page. */
  | 'project'
export const projectSettingsPages = ['general', 'git', 'instructions'] as const
export type ProjectSettingsPage = (typeof projectSettingsPages)[number]

type State = {
  loaded: boolean
  error: Failure | null
  /**
   * `chat` and `map` are the same space at two distances; `cards` is the user's
   * knowledge library and boards; `pulls` lists agents' pull requests; `settings`
   * replaces the whole window.
   */
  view: 'chat' | 'map' | 'cards' | 'pulls' | 'settings'
  /** Where Settings returns to. */
  lastView: 'chat' | 'map' | 'cards' | 'pulls'
  /** Survives leaving Settings, so reopening lands where the user was. */
  settingsTab: SettingsTab
  /** The project and page shown while `settingsTab` is `project`. */
  settingsProject: { projectId: string; page: ProjectSettingsPage } | null
  github: GitHubAccount
  /** The thread on screen; null is a new thread that has no message yet. */
  threadId: string | null
  /** The project in focus: a new thread's default, and what the map composer sends to. */
  routerProjectId: string | null
  sessions: Session[]
  projects: Project[]
  settings: AppSettings
  connection: CodexConnection
  claude: ClaudeConnection
  cursor: CursorConnection
  initialize(): Promise<void>
  event(event: AppEvent): void
  showSettings(tab?: SettingsTab): void
  /** Opens Settings on one project's page, its general page by default. */
  showProjectSettings(projectId: string, page?: ProjectSettingsPage): void
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
  showCards(): void
  showPullRequests(): void
  focusProject(projectId: string | null): void
  clearError(): void
  /** Opens the folder picker. Resolves to the project's id, or null when canceled. */
  pickProject(): Promise<string | null>
  /** The folder new projects go into by default; null when it cannot be read. */
  projectsFolder(): Promise<string | null>
  /** Opens the folder picker for where a new project goes; null when canceled. */
  chooseProjectsFolder(): Promise<string | null>
  /** Where workers run tasks that belong to no project; null when it could not be read. */
  workspaceFolder(): Promise<string | null>
  /** Picks and saves another workspace folder; resolves to whether one was saved. */
  selectWorkspaceFolder(): Promise<boolean>
  resetWorkspaceFolder(): Promise<void>
  /**
   * Clones or creates a project and opens a new thread in it. Resolves to the
   * failure, for the form to show, or null once the project is open.
   */
  cloneProject(input: CloneProject): Promise<Failure | null>
  createProject(input: CreateProject): Promise<Failure | null>
  /** Saves a project's name and settings; resolves to whether the save went through. */
  saveProject(input: SaveProject): Promise<boolean>
  /** The project repository's branches and remotes; null when it has none or cannot be read. */
  projectGitRefs(projectId: string): Promise<ProjectGitRefs | null>
  toggleSidebar(): void
  toggleProjects(): void
  /** Clamps and persists one pane's width, typically once a drag ends. */
  setPaneWidth(pane: ResizablePane, width: number): void
  connect(): Promise<void>
  selectExecutable(): Promise<void>
  connectClaude(): Promise<void>
  selectClaudeExecutable(): Promise<void>
  connectCursor(): Promise<void>
  selectCursorExecutable(): Promise<void>
  saveSettings(settings: AppSettings): Promise<void>
  respond(input: RespondRequest): Promise<void>
}
export const paneWidthKey = {
  sidebar: 'sidebarWidth',
  projects: 'projectsWidth',
  panel: 'panelWidth'
} as const satisfies Record<ResizablePane, keyof typeof defaultLayoutSettings>
export function clampPaneWidth(pane: ResizablePane, width: number): number {
  const { min, max } = paneWidthBounds[pane]
  return Math.round(Math.min(max, Math.max(min, width)))
}
/** The most recently active thread in a project, or across all of them. */
function latestThread(routers: Router[], projectId?: string): Router | null {
  const threads = projectId ? routers.filter((r) => r.projectId === projectId) : routers
  return [...threads].sort(byRecent)[0] ?? null
}
let connectionEvents = 0
let claudeEvents = 0
let cursorEvents = 0
let gitHubEvents = 0
export const useAppStore = create<State>((set, get) => {
  async function action<T>(fn: () => Promise<Reply<T>>): Promise<T | undefined> {
    try {
      set({ error: null })
      return unwrap(await fn())
    } catch (error) {
      set({ error: uiFailure(error) })
      return undefined
    }
  }
  /** Lists a new or existing project and opens a new thread in it. */
  function openProject(project: Project) {
    set((state) => ({
      projects: [...state.projects.filter((p) => p.id !== project.id), project].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
      routerProjectId: project.id,
      threadId: null,
      view: 'chat',
      error: null
    }))
  }
  async function addProject(fn: () => Promise<Reply<Project>>): Promise<Failure | null> {
    try {
      openProject(unwrap(await fn()))
      return null
    } catch (error) {
      return uiFailure(error)
    }
  }
  return {
    loaded: false,
    error: null,
    view: 'chat',
    lastView: 'chat',
    settingsTab: 'router',
    settingsProject: null,
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
      appLogo: defaultAppLogo,
      sidebarCollapsed: false,
      provider: 'codex',
      claudeExecutablePath: null,
      claudeModel: null,
      claudeEffort: null,
      cursorExecutablePath: null,
      cursorModel: null,
      router: defaultRouterSettings,
      memory: defaultMemorySettings,
      layout: defaultLayoutSettings,
      updateChannel: null,
      pullRequestsVisible: true,
      workspacePath: null
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
    cursor: {
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
      const cursorVersion = cursorEvents
      const gitHubVersion = gitHubEvents
      const snapshot = await action(() => window.owls.snapshot())
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
        cursor: cursorVersion === cursorEvents ? snapshot.cursor : state.cursor,
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
      if (event.type === 'cursor-connection') {
        cursorEvents++
        set({ cursor: event.connection })
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
      await action(() => window.owls.gitHubSignIn())
    },
    gitHubConnectCli: async () => {
      await action(() => window.owls.gitHubConnectCli())
    },
    gitHubConnectToken: async (token) => {
      await action(() => window.owls.gitHubConnectToken(token))
    },
    gitHubCancelSignIn: async () => {
      await action(() => window.owls.gitHubCancelSignIn())
    },
    gitHubSignOut: async () => {
      await action(() => window.owls.gitHubSignOut())
    },
    showSettings: (tab) =>
      set((state) => ({
        view: 'settings',
        lastView: state.view === 'settings' ? state.lastView : state.view,
        settingsTab: tab ?? state.settingsTab,
        error: null
      })),
    showProjectSettings: (projectId, page = 'general') =>
      set((state) => ({
        view: 'settings',
        lastView: state.view === 'settings' ? state.lastView : state.view,
        settingsTab: 'project',
        settingsProject: { projectId, page },
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
    showCards: () => set({ view: 'cards', error: null }),
    showPullRequests: () => set({ view: 'pulls', error: null }),
    focusProject: (projectId) => set({ routerProjectId: projectId }),
    clearError: () => set({ error: null }),
    pickProject: async () => {
      const project = await action(() => window.owls.pickProject())
      if (!project) return null
      openProject(project)
      return project.id
    },
    projectsFolder: async () => (await action(() => window.owls.projectsFolder())) ?? null,
    chooseProjectsFolder: async () =>
      (await action(() => window.owls.chooseProjectsFolder())) ?? null,
    workspaceFolder: async () => (await action(() => window.owls.workspaceFolder())) ?? null,
    selectWorkspaceFolder: async () => {
      const settings = await action(() => window.owls.selectWorkspaceFolder())
      if (settings) set({ settings })
      return Boolean(settings)
    },
    resetWorkspaceFolder: async () => {
      const settings = await action(() => window.owls.resetWorkspaceFolder())
      if (settings) set({ settings })
    },
    cloneProject: (input) => addProject(() => window.owls.cloneProject(input)),
    createProject: (input) => addProject(() => window.owls.createProject(input)),
    saveProject: async (input) => {
      const project = await action(() => window.owls.saveProject(input))
      if (!project) return false
      set((state) => ({
        projects: state.projects
          .map((p) => (p.id === project.id ? project : p))
          .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
      }))
      return true
    },
    projectGitRefs: async (projectId) =>
      (await action(() => window.owls.projectGitRefs(projectId))) ?? null,
    toggleSidebar: () => {
      const { settings, saveSettings } = get()
      void saveSettings({ ...settings, sidebarCollapsed: !settings.sidebarCollapsed })
    },
    toggleProjects: () => {
      const { settings, saveSettings } = get()
      const layout = { ...settings.layout, projectsOpen: !settings.layout.projectsOpen }
      // Applied before the save resolves, so the title bar button answers at once.
      set({ settings: { ...settings, layout } })
      void saveSettings({ ...settings, layout })
    },
    setPaneWidth: (pane, width) => {
      const { settings, saveSettings } = get()
      const clamped = clampPaneWidth(pane, width)
      // The default is saved as null, so a pane left at it follows later default changes.
      const next = clamped === paneWidthBounds[pane].initial ? null : clamped
      const key = paneWidthKey[pane]
      if (settings.layout[key] === next) return
      const layout = { ...settings.layout, [key]: next }
      // Held locally first, so a released pane doesn't jump back while the save is in flight.
      set({ settings: { ...settings, layout } })
      void saveSettings({ ...settings, layout })
    },
    connect: async () => {
      const connection = await action(() => window.owls.connect())
      if (connection) set({ connection })
    },
    selectExecutable: async () => {
      const connection = await action(() => window.owls.selectExecutable())
      if (connection) {
        set({ connection })
        await get().initialize()
      }
    },
    connectClaude: async () => {
      const claude = await action(() => window.owls.connectClaude())
      if (claude) set({ claude })
    },
    selectClaudeExecutable: async () => {
      const claude = await action(() => window.owls.selectClaudeExecutable())
      if (claude) {
        set({ claude })
        await get().initialize()
      }
    },
    connectCursor: async () => {
      const cursor = await action(() => window.owls.connectCursor())
      if (cursor) set({ cursor })
    },
    selectCursorExecutable: async () => {
      const cursor = await action(() => window.owls.selectCursorExecutable())
      if (cursor) {
        set({ cursor })
        await get().initialize()
      }
    },
    saveSettings: async (settings) => {
      const saved = await action(() =>
        window.owls.saveSettings({
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
          cursorModel: settings.cursorModel,
          router: settings.router,
          memory: settings.memory,
          layout: settings.layout,
          updateChannel: settings.updateChannel,
          pullRequestsVisible: settings.pullRequestsVisible
        })
      )
      if (saved) set({ settings: saved })
    },
    respond: async (input) => {
      await action(() => window.owls.respond(input))
    }
  }
})
