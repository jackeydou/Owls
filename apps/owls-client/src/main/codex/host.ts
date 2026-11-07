import type {
  AgentProvider,
  ClaudeConnection,
  CodexConnection,
  CodexProject,
  CodexRouter,
  CodexSettings,
  CodexSnapshot,
  RespondCodexRequest,
  SendCodexMessage
} from '../../shared/codex.js'
import type { GitHubAccount } from '../../shared/github.js'
import type {
  ResolveBatch,
  RouterProviderInfo,
  SendRouterMessage,
  SetRouterKey,
  WorkerAction
} from '../../shared/router.js'
import type { ClaudeService } from '../claude/service.js'
import type { GitHubAuth } from '../github/auth.js'
import type { RouterService, WorkerHost } from '../router/service.js'
import type { WorkerGitHub } from '../router/worker-github.js'
import { CodexRuntimeError } from './errors.js'
import type { CodexService } from './service.js'

/**
 * Owns the desktop workspace and routes each worker session to the runtime that
 * created it. Sessions never switch runtimes after creation.
 */
export class OwlsHost {
  private router: RouterService | null = null
  private github: { auth: GitHubAuth; workers: WorkerGitHub } | null = null
  constructor(
    private readonly codex: CodexService,
    private readonly claude: ClaudeService
  ) {}
  /** Connects the project Routers, which start every session of this host. */
  attachRouter(router: RouterService): void {
    this.router = router
    this.codex.setTurnProfiles(router)
    this.claude.setTurnProfiles(router)
  }
  attachGitHub(github: { auth: GitHubAuth; workers: WorkerGitHub }): void {
    this.github = github
  }
  /** The narrow view of this host that Routers use to start workers. */
  workerHost(): WorkerHost {
    return {
      projects: () => this.codex.snapshot().projects,
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
      interrupt: (sessionId) => this.interrupt(sessionId)
    }
  }
  snapshot(): CodexSnapshot {
    const codex = this.codex.snapshot()
    const router = this.router?.snapshot() ?? { routers: [], workers: [] }
    const workers = new Set(router.workers.map((worker) => worker.sessionId))
    return {
      ...codex,
      // Tasks from before the Router stay stored, without a way to reach them (RFC 8).
      sessions: [...codex.sessions, ...this.claude.sessionList()]
        .filter((session) => workers.has(session.id))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
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
  openRouter(projectId: string): CodexRouter {
    return this.requireRouter().open(projectId)
  }
  sendRouter(input: SendRouterMessage): Promise<void> {
    return this.requireRouter().send(input)
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
    this.github?.workers.close()
    this.github?.auth.close()
    this.router?.close()
    this.claude.close()
    // The Codex service closes the shared store last.
    this.codex.close()
  }
}
