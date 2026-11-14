import { getSessionById } from '../stores/settings-store.js'
import { LOCAL_RPC_CONFLICT, LOCAL_RPC_UNAUTHORIZED, LocalRpcError } from './errors.js'
import type { LocalRpcContext } from './types.js'

export function requireAuthenticatedLocalRpc(context: LocalRpcContext): void {
  if (!context.getAppStatus().authenticated) {
    throw new LocalRpcError(LOCAL_RPC_UNAUTHORIZED, 'Authentication required')
  }
}

export function requireKnownSession(sessionId: string): void {
  if (!getSessionById(sessionId)) {
    throw new LocalRpcError(LOCAL_RPC_CONFLICT, `Unknown session: ${sessionId}`)
  }
}

export function rethrowLocalRpcAgentError(error: unknown): never {
  if (error instanceof LocalRpcError) {
    throw error
  }
  if (error instanceof Error) {
    const message = error.message
    if (
      message.startsWith('Unknown session:') ||
      message.includes('already running') ||
      message.includes('already starting') ||
      message.includes('pending input') ||
      message.includes('Resolve the pending input request')
    ) {
      throw new LocalRpcError(LOCAL_RPC_CONFLICT, message)
    }
    throw error
  }
  throw error
}
