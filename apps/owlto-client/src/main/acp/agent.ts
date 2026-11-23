import type { AcpProvider, Permission } from '../../shared/agents.js'
import type {
  AcpAccount,
  AcpAgentConnection,
  AgentModel,
  AgentRequest,
  AppEvent,
  AppSettings,
  Failure,
  RespondRequest,
  Session
} from '../../shared/app.js'
import type { ExecutableSearch } from './discovery.js'
import type { TurnView } from './projection.js'

/** Runs the agent CLI once and resolves its stdout; rejects on a non-zero exit. */
export type RunCli = (args: string[], timeoutMs: number) => Promise<string>

/** What a connection check learned about the signed-in account and its models. */
export type AcpProbe = { account: AcpAccount; models: AgentModel[] }

/** Lets an agent's own ACP extensions ask the user something, as approvals do. */
export type AskUser = (
  request: AgentRequest,
  handling: { answer: (reply: RespondRequest) => unknown; cancelled: unknown }
) => Promise<unknown>

/**
 * Methods an agent adds to ACP under its own prefix, such as `cursor/ask_question`.
 * `request` returns null for a method it does not know.
 */
export type AcpExtensions = {
  notification(view: TurnView, session: Session, method: string, params: unknown): boolean
  request(
    method: string,
    params: unknown,
    turnId: string,
    ask: AskUser,
    cancelled: unknown
  ): Promise<unknown> | null
}

/**
 * Everything that differs between the worker-only agents Owlto drives over the
 * Agent Client Protocol. The session runtime itself is shared (`AcpAgentService`).
 */
export type AcpAgent = {
  provider: AcpProvider
  /** The agent's product name, as error messages show it. */
  label: string
  codes: {
    notConnected: Failure['code']
    disconnected: Failure['code']
  }
  search: ExecutableSearch
  executablePath(settings: AppSettings): string | null
  connectionEvent(connection: AcpAgentConnection): AppEvent
  /** Reads the account and model catalog after `--version` answered. */
  probe(run: RunCli): Promise<AcpProbe>
  /** The arguments that start the agent's ACP server for one session's turn. */
  args(session: Pick<Session, 'model'>): string[]
  /** An auth method to call after `initialize` when the agent offers it. */
  authMethod: string | null
  /** The session mode an Owlto permission maps to, or null to keep the agent's default. */
  mode(permission: Permission): string | null
  /** A session's effort as the agent's thinking-level choice, when it offers one. */
  thoughtLevel?(effort: string): string | null
  extensions?: AcpExtensions
}
