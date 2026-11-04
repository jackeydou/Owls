import type {
  AgentProvider,
  ClaudeConnection,
  CodexConnection,
  CodexProject,
  CodexRouter,
  CodexSession,
  CodexSettings,
  CodexSnapshot,
  CreateCodexSession,
  RespondCodexRequest,
  SendCodexMessage
} from '../../shared/codex.js'
import type {
  ResolveBatch,
  RouterProviderInfo,
  SendRouterMessage,
  SetRouterKey
} from '../../shared/router.js'
import type { ClaudeService } from '../claude/service.js'
import type { RouterService, WorkerHost } from '../router/service.js'
import { CodexRuntimeError } from './errors.js'
import type { CodexService } from './service.js'

/**
 * Owns the desktop workspace and routes each task to the runtime that created
 * it. Tasks never switch runtimes after creation.
 */
export class OwlsHost {
  private router: RouterService | null = null
  constructor(
    private readonly codex: CodexService,
    private readonly claude: ClaudeService
  ) {}
  /** Connects the project Routers; their workers are ordinary tasks of this host. */
  attachRouter(router: RouterService): void {
    this.router = router
    this.codex.setTurnProfiles(router)
    this.claude.setTurnProfiles(router)
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
      createSession: (input) => this.createSession(input),
      send: (input) => this.send(input),
      steer: (sessionId, text) => this.steer(sessionId, text),
      interrupt: (sessionId) => this.interrupt(sessionId)
    }
  }
  snapshot(): CodexSnapshot {
    const codex = this.codex.snapshot()
    return {
      ...codex,
      sessions: [...codex.sessions, ...this.claude.sessionList()].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      ),
      claude: this.claude.connectionState(),
      ...(this.router?.snapshot() ?? { routers: [], workers: [] })
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
  createSession(input: CreateCodexSession): CodexSession {
    return input.provider === 'claude-code'
      ? this.claude.createSession(input)
      : this.codex.createSession(input)
  }
  send(input: SendCodexMessage): Promise<void> {
    return this.claude.owns(input.sessionId) ? this.claude.send(input) : this.codex.send(input)
  }
  async steer(sessionId: string, text: string): Promise<'steered' | 'not_running'> {
    return this.claude.owns(sessionId)
      ? this.claude.steer(sessionId, text)
      : this.codex.steer(sessionId, text)
  }
  interrupt(sessionId: string): Promise<void> {
    return this.claude.owns(sessionId)
      ? this.claude.interrupt(sessionId)
      : this.codex.interrupt(sessionId)
  }
  respond(input: RespondCodexRequest): void {
    if (this.claude.owns(input.sessionId)) this.claude.respond(input)
    else this.codex.respond(input)
  }
  archive(sessionId: string): void {
    if (this.claude.owns(sessionId)) this.claude.archive(sessionId)
    else this.codex.archive(sessionId)
  }
  provider(sessionId: string): CodexSession['provider'] {
    return this.claude.owns(sessionId) ? 'claude-code' : 'codex'
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
