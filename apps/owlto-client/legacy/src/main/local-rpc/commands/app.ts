import type { LocalRpcCommandRegistry } from '../command-registry.js'
import { type EmptyParams, parseEmptyParams } from '../schemas.js'
import type { LocalRpcAppStatus, LocalRpcContext } from '../types.js'

export function registerAppLocalRpcCommands(
  registry: LocalRpcCommandRegistry<LocalRpcContext>
): void {
  registry.register<EmptyParams, LocalRpcAppStatus>({
    method: 'app.status',
    description: 'Return coarse App readiness and window state.',
    parseParams: parseEmptyParams,
    run: (_, context) => context.getAppStatus()
  })

  registry.register<EmptyParams, { focused: true }>({
    method: 'app.focus',
    description: 'Focus the primary App window or auth window.',
    parseParams: parseEmptyParams,
    run: (_, context) => {
      context.focusApp()
      return { focused: true }
    }
  })
}
