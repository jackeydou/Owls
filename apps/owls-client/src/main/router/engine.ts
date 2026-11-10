import type { Failure, SessionItem } from '../../shared/app.js'
import type { RouterNative } from '../../shared/router.js'

export type RouterUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** Where an engine reports what the Router view shows while a batch runs. */
export type RouterSink = {
  /** Inserts or replaces the item with the same id. */
  item(item: SessionItem): void
  usage(usage: RouterUsage): void
}

export type RouterBatchInput = {
  batchId: string
  /** The rendered batch (see render.ts). */
  text: string
  /** The engine session the Router last ran in; engines resume their own kind only. */
  native: RouterNative | null
}

export type RouterBatchOutcome = {
  status: 'completed' | 'failed' | 'interrupted'
  error: Failure | null
  /** The engine session to resume next time. */
  native: RouterNative
}

/**
 * One Router's model session. The service calls `run` only while no other batch
 * of the same Router is running, and `steer` only while one is.
 */
export interface RouterEngine {
  run(input: RouterBatchInput, sink: RouterSink): Promise<RouterBatchOutcome>
  /** Resolves `not_running` when no batch can take the message; the caller queues it. */
  steer(text: string): Promise<'steered' | 'not_running'>
  abort(): void
}
