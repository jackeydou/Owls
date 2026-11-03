import { and, asc, desc, eq, inArray, max } from 'drizzle-orm'
import { type CodexRouter, routerSchema } from '../../shared/codex.js'
import { type RouterWorker, workerSchema } from '../../shared/router.js'
import {
  codexCredentials,
  codexInboxEvents,
  codexRouterBatches,
  codexRouterMessages,
  codexRouters,
  codexWorkers
} from '../codex/schema.js'
import type { CodexStore } from '../codex/store.js'
import {
  type BatchStatus,
  type BatchValue,
  batchValueSchema,
  type InboxEvent,
  type InboxEventBody,
  type InboxStatus,
  inboxEventBodySchema,
  type RouterBatch
} from './events.js'

type EventRow = typeof codexInboxEvents.$inferSelect
type BatchRow = typeof codexRouterBatches.$inferSelect
const toEvent = (row: EventRow): InboxEvent => ({
  ...inboxEventBodySchema.parse(row.value),
  seq: row.seq
})
const toBatch = (row: BatchRow): RouterBatch => ({
  ...batchValueSchema.parse(row.value),
  id: row.id,
  routerId: row.routerId,
  status: row.status as BatchStatus,
  createdAt: row.createdAt
})

/** Router persistence in `owls-codex.db`, sharing the Codex store's connection. */
export class RouterStore {
  constructor(private readonly store: CodexStore) {}
  private get db() {
    return this.store.db
  }
  routers(): CodexRouter[] {
    return this.db
      .select()
      .from(codexRouters)
      .all()
      .map((row) => routerSchema.parse(row.value))
      .sort((a, b) => a.projectId.localeCompare(b.projectId))
  }
  saveRouter(value: CodexRouter): void {
    const router = routerSchema.parse(value)
    this.db
      .insert(codexRouters)
      .values({ id: router.id, projectId: router.projectId, value: router })
      .onConflictDoUpdate({ target: codexRouters.id, set: { value: router } })
      .run()
  }
  workers(): RouterWorker[] {
    return this.db
      .select()
      .from(codexWorkers)
      .orderBy(desc(codexWorkers.updatedAt), asc(codexWorkers.id))
      .all()
      .map((row) => workerSchema.parse(row.value))
  }
  saveWorker(value: RouterWorker): void {
    const worker = workerSchema.parse(value)
    this.db
      .insert(codexWorkers)
      .values({
        id: worker.id,
        routerId: worker.routerId,
        sessionId: worker.sessionId,
        updatedAt: worker.updatedAt,
        value: worker
      })
      .onConflictDoUpdate({
        target: codexWorkers.id,
        set: { updatedAt: worker.updatedAt, value: worker }
      })
      .run()
  }
  messages(routerId: string): unknown[] {
    return this.db
      .select()
      .from(codexRouterMessages)
      .where(eq(codexRouterMessages.routerId, routerId))
      .orderBy(asc(codexRouterMessages.seq))
      .all()
      .map((row) => row.value)
  }
  appendMessages(routerId: string, batchId: string, messages: unknown[]): void {
    if (!messages.length) return
    this.db.transaction((tx) => {
      const last = tx
        .select({ seq: max(codexRouterMessages.seq) })
        .from(codexRouterMessages)
        .where(eq(codexRouterMessages.routerId, routerId))
        .get()
      let seq = last?.seq ?? -1
      for (const value of messages) {
        seq++
        tx.insert(codexRouterMessages).values({ routerId, seq, batchId, value }).run()
      }
    })
  }
  /** Adds an event; with a batch id it joins that running batch instead of waiting. */
  appendEvent(
    routerId: string,
    id: string,
    body: InboxEventBody,
    batchId: string | null = null
  ): InboxEvent {
    const value = inboxEventBodySchema.parse(body)
    return this.db.transaction((tx) => {
      const row = tx
        .insert(codexInboxEvents)
        .values({ id, routerId, status: batchId ? 'batched' : 'pending', batchId, value })
        .returning()
        .get()
      if (batchId) {
        const batch = tx
          .select()
          .from(codexRouterBatches)
          .where(eq(codexRouterBatches.id, batchId))
          .get()
        if (batch) {
          const current = batchValueSchema.parse(batch.value)
          tx.update(codexRouterBatches)
            .set({ value: { ...current, eventSeqs: [...current.eventSeqs, row.seq] } })
            .where(eq(codexRouterBatches.id, batchId))
            .run()
        }
      }
      return toEvent(row)
    })
  }
  events(routerId: string, status: InboxStatus): InboxEvent[] {
    return this.db
      .select()
      .from(codexInboxEvents)
      .where(and(eq(codexInboxEvents.routerId, routerId), eq(codexInboxEvents.status, status)))
      .orderBy(asc(codexInboxEvents.seq))
      .all()
      .map(toEvent)
  }
  setEventStatus(seqs: number[], status: InboxStatus): void {
    if (!seqs.length) return
    this.db
      .update(codexInboxEvents)
      .set({ status })
      .where(inArray(codexInboxEvents.seq, seqs))
      .run()
  }
  /** Records a batch as `sending` and claims its events in one transaction. */
  openBatch(
    batch: { id: string; routerId: string; createdAt: string } & Pick<
      BatchValue,
      'engine' | 'promptVersion'
    >,
    seqs: number[]
  ): void {
    const value: BatchValue = {
      engine: batch.engine,
      promptVersion: batch.promptVersion,
      eventSeqs: [...seqs].sort((a, b) => a - b),
      tokens: null,
      durationMs: null
    }
    this.db.transaction((tx) => {
      tx.insert(codexRouterBatches)
        .values({
          id: batch.id,
          routerId: batch.routerId,
          status: 'sending',
          createdAt: batch.createdAt,
          value
        })
        .run()
      if (seqs.length)
        tx.update(codexInboxEvents)
          .set({ status: 'batched', batchId: batch.id })
          .where(inArray(codexInboxEvents.seq, seqs))
          .run()
    })
  }
  finishBatch(
    id: string,
    status: BatchStatus,
    result: Pick<BatchValue, 'tokens' | 'durationMs'> | null = null
  ): void {
    this.db.transaction((tx) => {
      const row = tx.select().from(codexRouterBatches).where(eq(codexRouterBatches.id, id)).get()
      if (!row) return
      const value = { ...batchValueSchema.parse(row.value), ...(result ?? {}) }
      tx.update(codexRouterBatches)
        .set({ status, value })
        .where(eq(codexRouterBatches.id, id))
        .run()
    })
  }
  batches(status: BatchStatus): RouterBatch[] {
    return this.db
      .select()
      .from(codexRouterBatches)
      .where(eq(codexRouterBatches.status, status))
      .orderBy(asc(codexRouterBatches.createdAt), asc(codexRouterBatches.id))
      .all()
      .map(toBatch)
  }
  batch(id: string): RouterBatch | null {
    const row = this.db.select().from(codexRouterBatches).where(eq(codexRouterBatches.id, id)).get()
    return row ? toBatch(row) : null
  }
  /** Returns a batch's events to the Inbox so the next batch sends them again. */
  requeueBatch(id: string): void {
    this.db.transaction((tx) => {
      tx.update(codexRouterBatches)
        .set({ status: 'retried' })
        .where(eq(codexRouterBatches.id, id))
        .run()
      tx.update(codexInboxEvents)
        .set({ status: 'pending', batchId: null })
        .where(and(eq(codexInboxEvents.batchId, id), eq(codexInboxEvents.status, 'batched')))
        .run()
    })
  }
  hasMessages(routerId: string): boolean {
    return Boolean(
      this.db
        .select({ seq: codexRouterMessages.seq })
        .from(codexRouterMessages)
        .where(eq(codexRouterMessages.routerId, routerId))
        .limit(1)
        .get()
    )
  }
  credential(providerId: string): { type: string; secret: string } | null {
    const row = this.db
      .select()
      .from(codexCredentials)
      .where(eq(codexCredentials.providerId, providerId))
      .get()
    return row ? { type: row.type, secret: row.secret } : null
  }
  credentialIds(): string[] {
    return this.db
      .select({ id: codexCredentials.providerId })
      .from(codexCredentials)
      .all()
      .map((row) => row.id)
      .sort()
  }
  saveCredential(providerId: string, type: string, secret: string): void {
    this.db
      .insert(codexCredentials)
      .values({ providerId, type, secret })
      .onConflictDoUpdate({ target: codexCredentials.providerId, set: { type, secret } })
      .run()
  }
  removeCredential(providerId: string): void {
    this.db.delete(codexCredentials).where(eq(codexCredentials.providerId, providerId)).run()
  }
}
