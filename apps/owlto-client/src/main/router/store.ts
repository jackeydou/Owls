import { and, asc, desc, eq, gt, inArray, max, sql } from 'drizzle-orm'
import {
  itemSchema,
  type Router,
  routerSchema,
  type SessionItem,
  type ThreadItem
} from '../../shared/app.js'
import { type RouterWorker, workerSchema } from '../../shared/router.js'
import {
  credentialsTable,
  inboxEventsTable,
  routerBatchesTable,
  routerMessagesTable,
  threadItemsTable,
  threadsTable,
  workersTable
} from '../app/schema.js'
import type { OwltoStore } from '../app/store.js'
import { nextRev } from '../app/sync-state.js'
import { itemRecordId, logChange } from '../sync/sync-log.js'
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

type EventRow = typeof inboxEventsTable.$inferSelect
type BatchRow = typeof routerBatchesTable.$inferSelect
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

/** Router persistence in `owlto.db`, sharing the Codex store's connection. */
export class RouterStore {
  constructor(private readonly store: OwltoStore) {}
  private get db() {
    return this.store.db
  }
  /** This device: it runs only the threads whose `deviceId` matches. */
  get deviceId(): string {
    return this.store.deviceId
  }
  routers(): Router[] {
    return this.db
      .select()
      .from(threadsTable)
      .orderBy(desc(threadsTable.updatedAt), asc(threadsTable.id))
      .all()
      .map((row) => routerSchema.parse(row.value))
  }
  /**
   * Saves a thread and the given items under one new change version, which it
   * returns. Writes go through this one connection, so versions commit in order
   * and a reader that asks for what came after its last version misses nothing.
   */
  saveThread(value: Router, items: { item: SessionItem; position: number }[] = []): number {
    return this.db.transaction((tx) => {
      const rev = nextRev(tx)
      const router = routerSchema.parse({ ...value, rev })
      const row = {
        rev,
        ownerDeviceId: router.deviceId,
        updatedAt: router.updatedAt,
        value: router
      }
      tx.insert(threadsTable)
        .values({ id: router.id, ...row })
        .onConflictDoUpdate({ target: threadsTable.id, set: row })
        .run()
      logChange(tx, 'thread', router.id)
      for (const { item, position } of items) {
        const parsed = itemSchema.parse(item)
        tx.insert(threadItemsTable)
          .values({ threadId: router.id, itemId: parsed.id, position, rev, value: parsed })
          .onConflictDoUpdate({
            target: [threadItemsTable.threadId, threadItemsTable.itemId],
            set: { rev, value: parsed }
          })
          .run()
        logChange(tx, 'item', itemRecordId(router.id, parsed.id))
      }
      return rev
    })
  }
  items(routerId: string): ThreadItem[] {
    return this.db
      .select()
      .from(threadItemsTable)
      .where(eq(threadItemsTable.threadId, routerId))
      .orderBy(asc(threadItemsTable.position))
      .all()
      .map((row) => ({
        item: itemSchema.parse(row.value),
        position: row.position,
        rev: row.rev
      }))
  }
  workers(): RouterWorker[] {
    return this.db
      .select()
      .from(workersTable)
      .orderBy(desc(workersTable.updatedAt), asc(workersTable.id))
      .all()
      .map((row) => workerSchema.parse(row.value))
  }
  saveWorker(value: RouterWorker): void {
    const worker = workerSchema.parse(value)
    this.db.transaction((tx) => {
      tx.insert(workersTable)
        .values({
          id: worker.id,
          routerId: worker.routerId,
          sessionId: worker.sessionId,
          ownerDeviceId: this.deviceId,
          updatedAt: worker.updatedAt,
          value: worker
        })
        .onConflictDoUpdate({
          target: workersTable.id,
          set: { updatedAt: worker.updatedAt, value: worker }
        })
        .run()
      logChange(tx, 'worker', worker.id)
    })
  }
  messages(routerId: string): unknown[] {
    return this.db
      .select()
      .from(routerMessagesTable)
      .where(eq(routerMessagesTable.routerId, routerId))
      .orderBy(asc(routerMessagesTable.seq))
      .all()
      .map((row) => row.value)
  }
  appendMessages(routerId: string, batchId: string, messages: unknown[]): void {
    if (!messages.length) return
    this.db.transaction((tx) => {
      const last = tx
        .select({ seq: max(routerMessagesTable.seq) })
        .from(routerMessagesTable)
        .where(eq(routerMessagesTable.routerId, routerId))
        .get()
      let seq = last?.seq ?? -1
      for (const value of messages) {
        seq++
        tx.insert(routerMessagesTable).values({ routerId, seq, batchId, value }).run()
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
        .insert(inboxEventsTable)
        .values({ id, routerId, status: batchId ? 'batched' : 'pending', batchId, value })
        .returning()
        .get()
      if (batchId) {
        const batch = tx
          .select()
          .from(routerBatchesTable)
          .where(eq(routerBatchesTable.id, batchId))
          .get()
        if (batch) {
          const current = batchValueSchema.parse(batch.value)
          tx.update(routerBatchesTable)
            .set({ value: { ...current, eventSeqs: [...current.eventSeqs, row.seq] } })
            .where(eq(routerBatchesTable.id, batchId))
            .run()
        }
      }
      return toEvent(row)
    })
  }
  events(routerId: string, status: InboxStatus): InboxEvent[] {
    return this.db
      .select()
      .from(inboxEventsTable)
      .where(and(eq(inboxEventsTable.routerId, routerId), eq(inboxEventsTable.status, status)))
      .orderBy(asc(inboxEventsTable.seq))
      .all()
      .map(toEvent)
  }
  /** One event with its delivery state, for recall. */
  event(
    seq: number
  ): { event: InboxEvent; routerId: string; status: InboxStatus; batchId: string | null } | null {
    const row = this.db.select().from(inboxEventsTable).where(eq(inboxEventsTable.seq, seq)).get()
    return row
      ? {
          event: toEvent(row),
          routerId: row.routerId,
          status: row.status as InboxStatus,
          batchId: row.batchId
        }
      : null
  }
  /** The newest events about one worker, oldest first. */
  workerEvents(routerId: string, workerId: string, limit: number): InboxEvent[] {
    return this.db
      .select()
      .from(inboxEventsTable)
      .where(
        and(
          eq(inboxEventsTable.routerId, routerId),
          sql`json_extract(${inboxEventsTable.value}, '$.workerId') = ${workerId}`
        )
      )
      .orderBy(desc(inboxEventsTable.seq))
      .limit(limit)
      .all()
      .map(toEvent)
      .reverse()
  }
  /** A thread's events of one kind after `seq`, oldest first, for Dreaming. */
  eventsAfter(routerId: string, after: number, kind: InboxEventBody['kind']): InboxEvent[] {
    return this.db
      .select()
      .from(inboxEventsTable)
      .where(
        and(
          eq(inboxEventsTable.routerId, routerId),
          gt(inboxEventsTable.seq, after),
          sql`json_extract(${inboxEventsTable.value}, '$.kind') = ${kind}`
        )
      )
      .orderBy(asc(inboxEventsTable.seq))
      .all()
      .map(toEvent)
  }
  setEventStatus(seqs: number[], status: InboxStatus): void {
    if (!seqs.length) return
    this.db
      .update(inboxEventsTable)
      .set({ status })
      .where(inArray(inboxEventsTable.seq, seqs))
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
      tx.insert(routerBatchesTable)
        .values({
          id: batch.id,
          routerId: batch.routerId,
          status: 'sending',
          createdAt: batch.createdAt,
          value
        })
        .run()
      if (seqs.length)
        tx.update(inboxEventsTable)
          .set({ status: 'batched', batchId: batch.id })
          .where(inArray(inboxEventsTable.seq, seqs))
          .run()
    })
  }
  finishBatch(
    id: string,
    status: BatchStatus,
    result: Pick<BatchValue, 'tokens' | 'durationMs'> | null = null
  ): void {
    this.db.transaction((tx) => {
      const row = tx.select().from(routerBatchesTable).where(eq(routerBatchesTable.id, id)).get()
      if (!row) return
      const value = { ...batchValueSchema.parse(row.value), ...(result ?? {}) }
      tx.update(routerBatchesTable)
        .set({ status, value })
        .where(eq(routerBatchesTable.id, id))
        .run()
    })
  }
  batches(status: BatchStatus): RouterBatch[] {
    return this.db
      .select()
      .from(routerBatchesTable)
      .where(eq(routerBatchesTable.status, status))
      .orderBy(asc(routerBatchesTable.createdAt), asc(routerBatchesTable.id))
      .all()
      .map(toBatch)
  }
  batch(id: string): RouterBatch | null {
    const row = this.db.select().from(routerBatchesTable).where(eq(routerBatchesTable.id, id)).get()
    return row ? toBatch(row) : null
  }
  /** Returns a batch's events to the Inbox so the next batch sends them again. */
  requeueBatch(id: string): void {
    this.db.transaction((tx) => {
      tx.update(routerBatchesTable)
        .set({ status: 'retried' })
        .where(eq(routerBatchesTable.id, id))
        .run()
      tx.update(inboxEventsTable)
        .set({ status: 'pending', batchId: null })
        .where(and(eq(inboxEventsTable.batchId, id), eq(inboxEventsTable.status, 'batched')))
        .run()
    })
  }
  hasMessages(routerId: string): boolean {
    return Boolean(
      this.db
        .select({ seq: routerMessagesTable.seq })
        .from(routerMessagesTable)
        .where(eq(routerMessagesTable.routerId, routerId))
        .limit(1)
        .get()
    )
  }
  credential(providerId: string): { type: string; secret: string } | null {
    const row = this.db
      .select()
      .from(credentialsTable)
      .where(eq(credentialsTable.providerId, providerId))
      .get()
    return row ? { type: row.type, secret: row.secret } : null
  }
  credentialIds(): string[] {
    return this.db
      .select({ id: credentialsTable.providerId })
      .from(credentialsTable)
      .all()
      .map((row) => row.id)
      .sort()
  }
  saveCredential(providerId: string, type: string, secret: string): void {
    this.db
      .insert(credentialsTable)
      .values({ providerId, type, secret })
      .onConflictDoUpdate({ target: credentialsTable.providerId, set: { type, secret } })
      .run()
  }
  removeCredential(providerId: string): void {
    this.db.delete(credentialsTable).where(eq(credentialsTable.providerId, providerId)).run()
  }
}
