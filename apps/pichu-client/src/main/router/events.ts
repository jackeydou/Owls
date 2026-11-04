import { z } from 'zod'
import { routerEngineSchema, workerReportSchema } from '../../shared/router.js'

const workerEvent = { at: z.string(), workerId: z.string(), goal: z.string() }
/** The body of one Router Inbox event, stored as the row's JSON value. */
export const inboxEventBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user_message'), at: z.string(), text: z.string() }),
  z.object({ kind: z.literal('worker_report'), ...workerEvent, report: workerReportSchema }),
  z.object({ kind: z.literal('worker_waiting'), ...workerEvent, detail: z.string() }),
  z.object({ kind: z.literal('worker_failed'), ...workerEvent }),
  z.object({ kind: z.literal('worker_stopped'), ...workerEvent }),
  z.object({ kind: z.literal('worker_removed'), ...workerEvent })
])
export type InboxEventBody = z.infer<typeof inboxEventBodySchema>
/** One Router Inbox event. `seq` orders events across all Routers. */
export type InboxEvent = InboxEventBody & { seq: number }
/** `pending` events wait for a batch; the others are settled. */
export type InboxStatus = 'pending' | 'batched' | 'superseded' | 'dropped'

export const batchValueSchema = z.object({
  engine: routerEngineSchema,
  eventSeqs: z.array(z.number().int()),
  promptVersion: z.number().int(),
  tokens: z.number().nullable(),
  durationMs: z.number().nullable()
})
export type BatchValue = z.infer<typeof batchValueSchema>
/**
 * `sending` until the engine returns; a batch still `sending` after a restart
 * becomes `dispatch_unknown` and waits for the user to retry or ignore it.
 */
export type BatchStatus = 'sending' | 'delivered' | 'dispatch_unknown' | 'retried' | 'ignored'
export type RouterBatch = BatchValue & {
  id: string
  routerId: string
  status: BatchStatus
  createdAt: string
}
