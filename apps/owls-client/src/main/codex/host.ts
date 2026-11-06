import { mkdirSync } from 'node:fs'
import type {
  AgentProvider,
  ClaudeConnection,
  CodexConnection,
  CodexProject,
  CodexRouter,
  CodexSettings,
  CodexSnapshot,
  RespondCodexRequest,
  SendCodexMessage,
  ThreadItem
} from '../../shared/codex.js'
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
import type { RouterService, WorkerHost } from '../router/service.js'
import { CodexRuntimeError } from './errors.js'
import type { CodexService } from './service.js'

/**
 * Owns the desktop workspace and routes each worker session to the runtime that
 * created it. Sessions never switch runtimes after creation.
 */
export class OwlsHost {
  private router: RouterService | null = null
  constructor(
    private readonly codex: CodexService,
    private readonly claude: ClaudeService,
    private readonly threadHome: string
  ) {}
  /** Connects the Routers, which start every session of this host. */
  attachRouter(router: RouterService): void {
    this.router = router
    this.codex.setTurnProfiles(router)
    this.claude.setTurnProfiles(router)
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
      interrupt: (sessionId) => this.interrupt(sessionId)
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
    this.router?.close()
    this.claude.close()
    // The Codex service closes the shared store last.
    this.codex.close()
  }
}
