import { z } from 'zod'
import { routerEngineSchema, workerReportSchema } from '../../shared/router.js'

const workerEvent = {
  at: z.string(),
  workerId: z.string(),
  goal: z.string(),
  /** From a turn the user started in the worker's own task view, not from the Router. */
  followUp: z.boolean().default(false)
}
/** The body of one Router Inbox event, stored as the row's JSON value. */
export const inboxEventBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user_message'),
    at: z.string(),
    text: z.string(),
    /** Set when Owls already delivered this message to a worker; the Router only reads it. */
    workerId: z.string().optional()
  }),
  z.object({ kind: z.literal('worker_report'), ...workerEvent, report: workerReportSchema }),
  z.object({ kind: z.literal('worker_waiting'), ...workerEvent, detail: z.string() }),
  z.object({ kind: z.literal('worker_failed'), ...workerEvent }),
  z.object({ kind: z.literal('worker_stopped'), ...workerEvent }),
  z.object({
    kind: z.literal('worker_removed'),
    ...workerEvent,
    /** The worker's branch when it still holds work the user's checkout does not have. */
    branch: z.string().nullable().default(null)
  })
])
export type InboxEventBody = z.infer<typeof inboxEventBodySchema>
/** One Router Inbox event. `seq` orders events across all Routers. */
export type InboxEvent = InboxEventBody & { seq: number }
/** An event the Router only needs to know about, so it never starts a batch by itself. */
export const isQuietEvent = (event: InboxEventBody) =>
  event.kind === 'user_message' && Boolean(event.workerId)
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
