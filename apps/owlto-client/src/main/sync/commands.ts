import type { CommandReceipt, CommandRejection, DeviceCommand } from '../../shared/device.js'
import { RouterToolError, type RouterToolErrorCode } from '../router/tools.js'
import type { WorkerTarget } from '../router/worker-target.js'

/** How a refused worker action reads in a receipt. */
const REJECTIONS: Partial<Record<RouterToolErrorCode, CommandRejection>> = {
  worker_not_found: 'worker_not_found',
  worker_closed: 'worker_not_found',
  project_required: 'project_not_found',
  provider_unavailable: 'agent_not_connected'
}

/**
 * Carries out one command addressed to this device on `target` and returns its
 * receipt. `routerOf` finds the thread a worker belongs to, since only dispatch
 * commands name it. Errors other than refused worker actions are thrown, so the
 * caller can try the command again later.
 *
 * This is the step that turns a command into worker actions. The checks that
 * guard it (the sender, the device's settings, repeated commands) belong to the
 * executor that receives commands from the sync service (RFC_OWLTO_MULTI_DEVICE 7).
 */
export async function applyCommand(
  target: WorkerTarget,
  routerOf: (workerId: string) => string | null,
  command: DeviceCommand,
  now: Date = new Date()
): Promise<CommandReceipt> {
  const { commandId } = command
  const accepted = (permission: CommandReceipt['permission'] = null): CommandReceipt => ({
    commandId,
    result: 'accepted',
    reason: null,
    permission
  })
  const rejected = (reason: CommandRejection): CommandReceipt => ({
    commandId,
    result: 'rejected',
    reason,
    permission: null
  })
  if (command.expiresAt !== null && Date.parse(command.expiresAt) <= now.getTime())
    return rejected('expired')
  try {
    if (command.kind === 'dispatch') {
      await target.dispatch({
        routerId: command.routerId,
        defaultProjectId: null,
        workerId: command.workerId,
        selection: { model: command.model, effort: command.effort },
        input: {
          goal: command.goal,
          project: command.projectId,
          provider: command.provider,
          permission: command.permission,
          base: command.base,
          ...(command.parent ? { parent: command.parent } : {})
        }
      })
      return accepted(command.permission)
    }
    const routerId = routerOf(command.workerId)
    if (!routerId) return rejected('worker_not_found')
    if (command.kind === 'message') {
      await target.message(
        routerId,
        { workerId: command.workerId, text: command.text },
        command.mode
      )
      return accepted()
    }
    if (command.kind === 'stop') {
      await target.stop(routerId, command.workerId)
      return accepted()
    }
    const result = await target.approve(routerId, {
      workerId: command.workerId,
      requestId: command.requestId,
      decision: command.decision
    })
    return result.status === 'answered' ? accepted() : rejected('already_resolved')
  } catch (error) {
    if (!(error instanceof RouterToolError)) throw error
    return rejected(REJECTIONS[error.code] ?? 'failed')
  }
}
