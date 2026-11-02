import type {
  ClaudeConnection,
  CodexConnection,
  CodexProject,
  CodexSession,
  CodexSettings,
  CodexSnapshot,
  CreateCodexSession,
  RespondCodexRequest,
  SendCodexMessage
} from '../../shared/codex.js'
import type { ClaudeService } from '../claude/service.js'
import { CodexRuntimeError } from './errors.js'
import type { CodexService } from './service.js'

/**
 * Owns the desktop workspace and routes each task to the runtime that created
 * it. Tasks never switch runtimes after creation.
 */
export class OwlsHost {
  constructor(
    private readonly codex: CodexService,
    private readonly claude: ClaudeService
  ) {}
  snapshot(): CodexSnapshot {
    const codex = this.codex.snapshot()
    return {
      ...codex,
      sessions: [...codex.sessions, ...this.claude.sessionList()].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      ),
      claude: this.claude.connectionState()
    }
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
    return this.codex.saveSettings(settings)
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
    return this.codex.hasActiveTasks() || this.claude.hasActiveTasks()
  }
  close(): void {
    this.claude.close()
    // The Codex service closes the shared store last.
    this.codex.close()
  }
}
