import type { CodexFailure, CodexItem } from '../../shared/codex.js'

export type RouterUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** Where an engine reports what the Router view shows while a batch runs. */
export type RouterSink = {
  /** Inserts or replaces the item with the same id. */
  item(item: CodexItem): void
  usage(usage: RouterUsage): void
}

export type RouterBatchOutcome = {
  status: 'completed' | 'failed' | 'interrupted'
  error: CodexFailure | null
}

/**
 * One Router's model session. The service calls `run` only while no other batch
 * of the same Router is running, and `steer` only while one is.
 */
export interface RouterEngine {
  run(batchId: string, text: string, sink: RouterSink): Promise<RouterBatchOutcome>
  steer(text: string): 'steered' | 'not_running'
  abort(): void
}
