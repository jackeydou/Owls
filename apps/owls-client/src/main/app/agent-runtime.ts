import type {
  AgentConnection,
  CreateSession,
  RespondRequest,
  SendMessage,
  Session
} from '../../shared/app.js'
import type { TurnProfiles } from '../router/service.js'

/**
 * What the host needs from each worker provider's runtime. A session belongs to
 * the runtime that created it for its whole life.
 */
export interface AgentRuntime {
  owns(sessionId: string): boolean
  connectionState(): AgentConnection
  hasActiveTasks(): boolean
  setTurnProfiles(profiles: TurnProfiles): void
  /** `worker` marks a session in a worker's worktree, which may not exist yet. */
  createSession(input: CreateSession, worker?: { projectPath: string }): Session
  send(input: SendMessage): Promise<void>
  /** Resolves `not_running` when no turn can take the message; the caller queues it. */
  steer(
    sessionId: string,
    text: string
  ): 'steered' | 'not_running' | Promise<'steered' | 'not_running'>
  interrupt(sessionId: string): Promise<void>
  respond(input: RespondRequest): void
  archive(sessionId: string): void
  close(): void
}
