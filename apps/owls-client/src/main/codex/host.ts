import { mkdirSync } from 'node:fs'
import type {
  AgentProvider,
  ClaudeConnection,
  CodexConnection,
  CodexProject,
  CodexRouter,
  CodexSession,
  CodexSettings,
  CodexSnapshot,
  RespondCodexRequest,
  SendCodexMessage,
  ThreadItem
} from '../../shared/codex.js'
import type { GitHubAccount } from '../../shared/github.js'
import type {
  MemoryCategoryAction,
  MemoryExportFormat,
  MemoryListRequest,
  MemoryOverview,
  MemoryRemove,
  MemoryRun,
  MemorySave,
  MemoryView
} from '../../shared/memory.js'
import type { CloneProject, CreateProject } from '../../shared/projects.js'
import type {
  CreateThread,
  ForwardMessage,
  ResolveBatch,
  RouterProviderInfo,
  SendRouterMessage,
  SetRouterKey,
  ThreadItemsRequest,
  WorkerAction
} from '../../shared/router.js'
import type { ClaudeService } from '../claude/service.js'
import type { GitHubAuth } from '../github/auth.js'
import type { DreamingRunner } from '../memory/dreaming.js'
import type { MemoryService } from '../memory/service.js'
import type { MemorySweeper } from '../memory/sweep.js'
import type { DreamingTriggers } from '../memory/triggers.js'
import type { RouterService, WorkerHost } from '../router/service.js'
import type { WorkerGitHub } from '../router/worker-github.js'
import { CodexRuntimeError } from './errors.js'
import { cloneGitHubProject, createQuickProject } from './project-sources.js'
import type { CodexService } from './service.js'

/**
 * Owns the desktop workspace and routes each worker session to the runtime that
 * created it. Sessions never switch runtimes after creation.
 */
export class OwlsHost {
  private router: RouterService | null = null
  private github: { auth: GitHubAuth; workers: WorkerGitHub } | null = null
  private memory: {
    service: MemoryService
    dreaming: DreamingRunner
    triggers: DreamingTriggers
    sweeper: MemorySweeper
  } | null = null
  constructor(
    private readonly codex: CodexService,
    private readonly claude: ClaudeService,
    private readonly threadHome: string,
    private readonly projectsHome: string
  ) {}
  /** Connects the Routers, which start every session of this host. */
  attachRouter(router: RouterService): void {
    this.router = router
    this.codex.setTurnProfiles(router)
    this.claude.setTurnProfiles(router)
  }
  attachGitHub(github: { auth: GitHubAuth; workers: WorkerGitHub }): void {
    this.github = github
  }
  attachMemory(memory: NonNullable<OwlsHost['memory']>): void {
    this.memory = memory
  }
  /** A worker session's items, from whichever runtime owns it. */
  sessionItems(sessionId: string): CodexSession['items'] {
    return this.snapshot().sessions.find((s) => s.id === sessionId)?.items ?? []
  }
  /** The narrow view of this host that Routers use to start workers. */
  workerHost(): WorkerHost {
    return {
      projects: () => this.codex.snapshot().projects,
      threadHome: () => {
        mkdirSync(this.threadHome, { recursive: true })
        return this.threadHome
      },
      settings: () => this.codex.snapshot().settings,
      providerReady: (provider: AgentProvider) => {
        const connection =
          provider === 'claude-code'
            ? this.claude.connectionState()
            : this.codex.snapshot().connection
        return connection.status === 'ready' && connection.account.kind !== 'signed-out'
      },
      createSession: (input, worker) =>
        input.provider === 'claude-code'
          ? this.claude.createSession(input, worker)
          : this.codex.createSession(input, worker),
      remove: (sessionId) => this.archive(sessionId),
      send: (input) => this.send(input),
      steer: (sessionId, text) => this.steer(sessionId, text),
      interrupt: (sessionId) => this.interrupt(sessionId),
      respond: (input) => this.respond(input)
    }
  }
  snapshot(): CodexSnapshot {
    const codex = this.codex.snapshot()
    const router = this.router?.snapshot() ?? { routers: [], workers: [] }
    return {
      ...codex,
      sessions: [...codex.sessions, ...this.claude.sessionList()].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      ),
      claude: this.claude.connectionState(),
      github: this.github?.auth.account() ?? { status: 'signed-out', failure: null },
      ...router
    }
  }
  codexConnection(): CodexConnection {
    return this.codex.connectionState()
  }
  claudeConnection(): ClaudeConnection {
    return this.claude.connectionState()
  }
  connect(): Promise<CodexConnection> {
    return this.codex.connect()
  }
  connectClaude(): Promise<ClaudeConnection> {
    return this.claude.connect()
  }
  saveSettings(settings: CodexSettings): CodexSettings {
    if (
      settings.claudeExecutablePath !== this.codex.snapshot().settings.claudeExecutablePath &&
      this.claude.hasActiveTasks()
    ) {
      throw new CodexRuntimeError(
        'busy',
        'Stop active tasks before changing the Claude Code executable.'
      )
    }
    const routerChanged =
      JSON.stringify(settings.router) !== JSON.stringify(this.codex.snapshot().settings.router)
    if (routerChanged && this.router?.isRunning())
      throw new CodexRuntimeError('busy', 'Wait for the Router to finish before changing it.')
    const saved = this.codex.saveSettings(settings)
    if (routerChanged) this.router?.settingsChanged()
    return saved
  }
  createThread(input: CreateThread): CodexRouter {
    return this.requireRouter().createThread(input)
  }
  threadItems(input: ThreadItemsRequest): ThreadItem[] {
    return this.requireRouter().items(input.routerId, input.after)
  }
  sendRouter(input: SendRouterMessage): Promise<void> {
    return this.requireRouter().send(input)
  }
  forward(input: ForwardMessage): CodexRouter {
    return this.requireRouter().forward(input)
  }
  interruptRouter(routerId: string): void {
    this.requireRouter().interrupt(routerId)
  }
  resolveBatch(input: ResolveBatch): void {
    this.requireRouter().resolveBatch(input)
  }
  discardWorktree(input: WorkerAction): Promise<void> {
    return this.requireRouter().discardWorktree(input)
  }
  stopWorker(input: WorkerAction): Promise<void> {
    return this.requireRouter().stopWorker(input)
  }
  removeWorker(input: WorkerAction): void {
    this.requireRouter().removeWorker(input)
  }
  routerProviders(): RouterProviderInfo[] {
    return this.requireRouter().providers()
  }
  setRouterKey(input: SetRouterKey): void {
    this.requireRouter().setKey(input)
  }
  removeRouterKey(providerId: SetRouterKey['providerId']): void {
    this.requireRouter().removeKey(providerId)
  }
  gitHubSignIn(): Promise<GitHubAccount> {
    return this.requireGitHub().auth.signIn()
  }
  gitHubConnectCli(): Promise<GitHubAccount> {
    return this.requireGitHub().auth.connectGhCli()
  }
  gitHubConnectToken(token: string): Promise<GitHubAccount> {
    return this.requireGitHub().auth.connectToken(token)
  }
  gitHubCancelSignIn(): void {
    this.requireGitHub().auth.cancelSignIn()
  }
  gitHubSignOut(): void {
    this.requireGitHub().auth.signOut()
  }
  watchWorkerGitHub(input: WorkerAction): void {
    this.requireGitHub().workers.watch(input)
  }
  unwatchWorkerGitHub(input: WorkerAction): void {
    this.requireGitHub().workers.unwatch(input)
  }
  memoryList(input: MemoryListRequest): MemoryView[] {
    return this.requireMemory().service.list(input)
  }
  memoryOverview(): MemoryOverview {
    const { service, dreaming } = this.requireMemory()
    return service.overview(dreaming.running)
  }
  memorySave(input: MemorySave): MemoryView {
    return this.requireMemory().service.save(input)
  }
  memoryRemove(input: MemoryRemove): void {
    this.requireMemory().service.remove(input)
  }
  memoryCategory(input: MemoryCategoryAction): void {
    this.requireMemory().service.category(input)
  }
  /** Queues Dreaming for every thread with new content without waiting for it. */
  memoryRunNow(): void {
    void this.requireMemory()
      .dreaming.runNow()
      .catch(() => {})
  }
  memoryRuns(): MemoryRun[] {
    return this.requireMemory().service.runs()
  }
  memoryExport(format: MemoryExportFormat): string {
    return this.requireMemory().service.export(format)
  }
  private requireMemory(): NonNullable<OwlsHost['memory']> {
    if (!this.memory) throw new CodexRuntimeError('router_unavailable', 'Memory is not available.')
    return this.memory
  }
  private requireGitHub(): NonNullable<OwlsHost['github']> {
    if (!this.github) throw new CodexRuntimeError('github_unavailable', 'GitHub is not available.')
    return this.github
  }
  private requireRouter(): RouterService {
    if (!this.router)
      throw new CodexRuntimeError('router_unavailable', 'The Router is not available.')
    return this.router
  }
  addProject(path: string): CodexProject {
    return this.codex.addProject(path)
  }
  projectsFolder(): string {
    return this.projectsHome
  }
  async cloneProject(input: CloneProject): Promise<CodexProject> {
    return this.addProject(await cloneGitHubProject(input, this.projectsHome))
  }
  async createProject(input: CreateProject): Promise<CodexProject> {
    return this.addProject(await createQuickProject(input, this.projectsHome))
  }
  private send(input: SendCodexMessage): Promise<void> {
    return this.claude.owns(input.sessionId) ? this.claude.send(input) : this.codex.send(input)
  }
  private async steer(sessionId: string, text: string): Promise<'steered' | 'not_running'> {
    return this.claude.owns(sessionId)
      ? this.claude.steer(sessionId, text)
      : this.codex.steer(sessionId, text)
  }
  private interrupt(sessionId: string): Promise<void> {
    return this.claude.owns(sessionId)
      ? this.claude.interrupt(sessionId)
      : this.codex.interrupt(sessionId)
  }
  respond(input: RespondCodexRequest): void {
    if (this.claude.owns(input.sessionId)) this.claude.respond(input)
    else this.codex.respond(input)
  }
  private archive(sessionId: string): void {
    if (this.claude.owns(sessionId)) this.claude.archive(sessionId)
    else this.codex.archive(sessionId)
  }
  signIn(): Promise<string> {
    return this.codex.signIn()
  }
  cancelSignIn(): Promise<void> {
    return this.codex.cancelSignIn()
  }
  hasActiveTasks(): boolean {
    return (
      this.codex.hasActiveTasks() ||
      this.claude.hasActiveTasks() ||
      Boolean(this.router?.isRunning())
    )
  }
  close(): void {
    this.memory?.sweeper.close()
    this.memory?.triggers.close()
    this.memory?.dreaming.close()
    this.github?.workers.close()
    this.github?.auth.close()
    this.router?.close()
    this.claude.close()
    // The Codex service closes the shared store last.
    this.codex.close()
  }
}
