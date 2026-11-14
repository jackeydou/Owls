import type { Effort } from '../../shared/app.js'
import type {
  DispatchTaskInput,
  DispatchTaskResult,
  MessageWorkerInput,
  MessageWorkerResult,
  StopWorkerResult
} from './tools.js'
import type { WorkerPool } from './workers.js'

/** A request to start a worker, from a Router tool call or from another device's command. */
export type WorkerDispatch = {
  routerId: string
  /** The thread's default project, used when neither the input nor the parent names one. */
  defaultProjectId: string | null
  input: DispatchTaskInput
  /** Set by a sender that chose the id, as a command from another device does. */
  workerId?: string
  /** Model and effort chosen by the sender; omitted, they come from this device's settings. */
  selection?: { model: string | null; effort: Effort | null }
  /** Goal hashes of workers dispatched in the current batch, so a retried call reuses them. */
  seen?: Map<string, string>
}
/** `steer` tries the running turn first; `next` always waits for the next turn. */
export type WorkerMessageMode = 'steer' | 'next'
export type ApproveWorkerInput = {
  workerId: string
  requestId: string
  decision: 'approve' | 'deny'
}
export type ApproveWorkerResult = { status: 'answered' | 'already_resolved' }

/**
 * Where a Router's worker actions go (RFC_OWLTO_MULTI_DEVICE 9). Workers on this
 * device go to `LocalWorkers`; workers on another device will go through
 * commands. Errors are `RouterToolError`s, as the Router tools report them.
 */
export interface WorkerTarget {
  dispatch(request: WorkerDispatch): Promise<DispatchTaskResult>
  message(
    routerId: string,
    input: MessageWorkerInput,
    mode?: WorkerMessageMode
  ): Promise<MessageWorkerResult>
  stop(routerId: string, workerId: string, by?: 'router' | 'user'): Promise<StopWorkerResult>
  approve(routerId: string, input: ApproveWorkerInput): Promise<ApproveWorkerResult>
}

/** Workers that run on this device, in its `WorkerPool`. */
export class LocalWorkers implements WorkerTarget {
  constructor(private readonly pool: WorkerPool) {}
  dispatch(request: WorkerDispatch): Promise<DispatchTaskResult> {
    return this.pool.dispatch(request)
  }
  message(
    routerId: string,
    input: MessageWorkerInput,
    mode: WorkerMessageMode = 'steer'
  ): Promise<MessageWorkerResult> {
    return this.pool.message(routerId, input, mode)
  }
  stop(routerId: string, workerId: string, by: 'router' | 'user' = 'router') {
    return this.pool.stop(routerId, workerId, by)
  }
  approve(routerId: string, input: ApproveWorkerInput): Promise<ApproveWorkerResult> {
    return this.pool.approve(routerId, input)
  }
}
