import type {
  CleanBackgroundTerminalsRequest,
  CleanBackgroundTerminalsResult,
  ListBackgroundTerminalsRequest,
  ListBackgroundTerminalsResult,
  TerminateBackgroundTerminalRequest,
  TerminateBackgroundTerminalResult
} from '../../../shared/background-terminals.js'
import type { LocalRpcCommandRegistry } from '../command-registry.js'
import { JSON_RPC_INVALID_PARAMS, LocalRpcError, toLocalRpcError } from '../errors.js'
import { requireAuthenticatedLocalRpc } from '../guards.js'
import { isRecord } from '../schemas.js'
import type { LocalRpcContext } from '../types.js'

function invalidParams(message: string): never {
  throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, message)
}

function readOptionalString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') invalidParams(`${field} must be a string`)
  return value
}

function readOptionalPositiveInteger(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    invalidParams(`${field} must be a positive integer`)
  }
  return value
}

function parseListParams(value: unknown): ListBackgroundTerminalsRequest {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) invalidParams('Expected params object')
  return {
    sessionId: readOptionalString(value.sessionId, 'sessionId'),
    cursor: readOptionalString(value.cursor, 'cursor'),
    limit: readOptionalPositiveInteger(value.limit, 'limit')
  }
}

function parseTerminateParams(value: unknown): TerminateBackgroundTerminalRequest {
  if (!isRecord(value)) invalidParams('Expected params object')
  if (typeof value.id !== 'string' || !value.id) {
    invalidParams('id is required')
  }
  return {
    id: value.id,
    sessionId: readOptionalString(value.sessionId, 'sessionId')
  }
}

function parseCleanParams(value: unknown): CleanBackgroundTerminalsRequest {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) invalidParams('Expected params object')
  return {
    sessionId: readOptionalString(value.sessionId, 'sessionId')
  }
}

function runBackgroundTerminalCommand<TResult>(
  operation: () => Promise<TResult> | TResult
): Promise<TResult> | TResult {
  try {
    const result = operation()
    if (result instanceof Promise) {
      return result.catch((error) => {
        throw toLocalRpcError(error)
      })
    }
    return result
  } catch (error) {
    throw toLocalRpcError(error)
  }
}

export function registerBackgroundTerminalLocalRpcCommands(
  registry: LocalRpcCommandRegistry<LocalRpcContext>
): void {
  registry.register<ListBackgroundTerminalsRequest, ListBackgroundTerminalsResult>({
    method: 'backgroundTerminals.list',
    description: 'List running background terminals Owls started, optionally scoped to a session.',
    parseParams: parseListParams,
    run: (params, context) => {
      requireAuthenticatedLocalRpc(context)
      return runBackgroundTerminalCommand(() => context.listBackgroundTerminals(params))
    }
  })

  registry.register<TerminateBackgroundTerminalRequest, TerminateBackgroundTerminalResult>({
    method: 'backgroundTerminals.terminate',
    description: 'Terminate one background terminal by Owls registry id.',
    parseParams: parseTerminateParams,
    run: (params, context) => {
      requireAuthenticatedLocalRpc(context)
      return runBackgroundTerminalCommand(() => context.terminateBackgroundTerminal(params))
    }
  })

  registry.register<CleanBackgroundTerminalsRequest, CleanBackgroundTerminalsResult>({
    method: 'backgroundTerminals.clean',
    description:
      'Terminate all running background terminals Owls started, optionally scoped to a session.',
    parseParams: parseCleanParams,
    run: (params, context) => {
      requireAuthenticatedLocalRpc(context)
      return runBackgroundTerminalCommand(() => context.cleanBackgroundTerminals(params))
    }
  })
}
