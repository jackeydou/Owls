import { realpathSync } from 'node:fs'
import type {
  AgentConnection,
  CreateSession,
  Project,
  RespondRequest,
  SendMessage,
  Session
} from '../../shared/app.js'
import type { AgentUsage } from '../../shared/usage.js'
import type { TurnUsage } from '../../shared/usage-stats.js'
import type { TurnProfiles } from '../router/service.js'
import { OwltoError } from './errors.js'

/**
 * Where a worker session runs when its `cwd` is not a project's own folder: a
 * worker's worktree of a registered project, which may not exist yet, or the
 * workspace folder the host made for tasks that belong to no project.
 */
export type SessionPlace = { kind: 'worktree'; projectPath: string } | { kind: 'workspace' }

/**
 * The working directory a new session gets, after checking that it may run
 * there: a registered project, a worktree of one, or the workspace folder.
 */
export function sessionCwd(
  cwd: string,
  place: SessionPlace | undefined,
  projects: Project[]
): string {
  if (place?.kind === 'workspace') return realpathSync(cwd)
  const resolved = place ? cwd : realpathSync(cwd)
  const projectPath = place?.projectPath ?? resolved
  if (!projects.some((p) => p.path === projectPath))
    throw new OwltoError('project_required', 'Choose a project before starting a task.')
  return resolved
}

/** Receives the token usage a worker session's turn reported, one call per model. */
export type WorkerUsageRecorder = (sessionId: string, usage: TurnUsage) => void

/**
 * What the host needs from each worker provider's runtime. A session belongs to
 * the runtime that created it for its whole life.
 */
export interface AgentRuntime {
  owns(sessionId: string): boolean
  connectionState(): AgentConnection
  hasActiveTasks(): boolean
  setTurnProfiles(profiles: TurnProfiles): void
  /** Where the runtime reports each turn's token usage. */
  setUsageRecorder(recorder: WorkerUsageRecorder): void
  /** The account's plan usage, in the agent's own terms, or why it cannot report any. */
  usage(): AgentUsage | Promise<AgentUsage>
  /** `place` marks a session outside a project's own folder; see `SessionPlace`. */
  createSession(input: CreateSession, place?: SessionPlace): Session
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
