import type { LocalRpcCommandRegistry } from '../command-registry.js'
import { type EmptyParams, parseEmptyParams } from '../schemas.js'
import type { LocalRpcContext } from '../types.js'

export function registerAgentLocalRpcCommands(
  registry: LocalRpcCommandRegistry<LocalRpcContext>
): void {
  registry.register<EmptyParams, ReturnType<LocalRpcContext['getAgentStatus']>>({
    method: 'agent.status',
    description: 'Return current agent runtime status.',
    parseParams: parseEmptyParams,
    run: (_, context) => context.getAgentStatus()
  })
}
