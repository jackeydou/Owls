import type { SessionStatusView } from '../../agent/session-commands.js'
import type { MessageRow, SessionIndexEntry } from '../../stores/settings-store.js'
import type { LocalRpcCommandRegistry } from '../command-registry.js'
import {
  requireAuthenticatedLocalRpc,
  requireKnownSession,
  rethrowLocalRpcAgentError
} from '../guards.js'
import {
  parseSessionContinueParams,
  parseSessionListParams,
  parseSessionMessagesParams,
  parseSessionNewParams,
  parseSessionOpenParams,
  parseSessionStatusParams,
  type SessionContinueParams,
  type SessionListParams,
  type SessionMessagesParams,
  type SessionNewParams,
  type SessionOpenParams,
  type SessionStatusParams
} from '../schemas.js'
import type { LocalRpcContext } from '../types.js'

export function registerSessionLocalRpcCommands(
  registry: LocalRpcCommandRegistry<LocalRpcContext>
): void {
  registry.register<
    SessionListParams,
    { page: number; pageSize: number; total: number; sessions: SessionIndexEntry[] }
  >({
    method: 'session.list',
    description: 'Return paginated session index entries.',
    parseParams: parseSessionListParams,
    run: (params, context) => {
      requireAuthenticatedLocalRpc(context)
      return context.listSessions(params)
    }
  })

  registry.register<SessionOpenParams, { accepted: true; sessionId: string }>({
    method: 'session.open',
    description: 'Open an existing session in the App UI.',
    parseParams: parseSessionOpenParams,
    run: (params, context) => {
      requireAuthenticatedLocalRpc(context)
      requireKnownSession(params.sessionId)
      context.openSession(params.sessionId)
      return { accepted: true, sessionId: params.sessionId }
    }
  })

  registry.register<SessionNewParams, { accepted: true; sessionId: string }>({
    method: 'session.new',
    description: 'Create a new session and submit an agent prompt asynchronously.',
    parseParams: parseSessionNewParams,
    run: async (params, context) => {
      requireAuthenticatedLocalRpc(context)
      try {
        return await context.createSessionRun(params)
      } catch (error) {
        rethrowLocalRpcAgentError(error)
      }
    }
  })

  registry.register<SessionContinueParams, { accepted: true; sessionId: string }>({
    method: 'session.continue',
    description: 'Continue an existing session with a new prompt asynchronously.',
    parseParams: parseSessionContinueParams,
    run: (params, context) => {
      requireAuthenticatedLocalRpc(context)
      try {
        return context.continueSessionRun(params)
      } catch (error) {
        rethrowLocalRpcAgentError(error)
      }
    }
  })

  registry.register<SessionStatusParams, SessionStatusView>({
    method: 'session.status',
    description: 'Return run status for the current or requested session.',
    parseParams: parseSessionStatusParams,
    run: (params, context) => {
      requireAuthenticatedLocalRpc(context)
      try {
        return context.getSessionStatus(params.sessionId)
      } catch (error) {
        rethrowLocalRpcAgentError(error)
      }
    }
  })

  registry.register<SessionMessagesParams, MessageRow[]>({
    method: 'session.messages',
    description: 'Return all persisted messages for a session.',
    parseParams: parseSessionMessagesParams,
    run: (params, context) => {
      requireAuthenticatedLocalRpc(context)
      requireKnownSession(params.sessionId)
      return context.listSessionMessages(params.sessionId)
    }
  })
}
