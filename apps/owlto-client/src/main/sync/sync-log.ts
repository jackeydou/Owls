import { and, asc, eq, gt, lte } from 'drizzle-orm'
import { z } from 'zod'
import { syncLogTable } from '../app/schema.js'
import type { OwltoStore } from '../app/store.js'
import { nextDeviceSeq } from '../app/sync-state.js'

/** The local records this device writes and will push (RFC_OWLTO_MULTI_DEVICE 4, 8.1). */
export const syncRecordKindSchema = z.enum([
  'project',
  'thread',
  'item',
  'worker',
  'session',
  'memory-category',
  'memory',
  'card',
  'board'
])
export type SyncRecordKind = z.infer<typeof syncRecordKindSchema>
export type SyncLogEntry = { kind: SyncRecordKind; recordId: string; deviceSeq: number }

/** Item ids are unique only within their thread, so the record id names both. */
export const itemRecordId = (threadId: string, itemId: string): string => `${threadId}/${itemId}`

/**
 * Notes that a local record changed, or was deleted, under the next sync
 * sequence number, and returns that number. The log names the record, not its
 * content: a push reads the record as it is then, and a missing record is a
 * deletion. Call it inside the transaction that writes the change.
 */
export function logChange(
  tx: Pick<OwltoStore['db'], 'insert'>,
  kind: SyncRecordKind,
  recordId: string
): number {
  const deviceSeq = nextDeviceSeq(tx)
  tx.insert(syncLogTable)
    .values({ kind, recordId, deviceSeq, acked: false })
    .onConflictDoUpdate({
      target: [syncLogTable.kind, syncLogTable.recordId],
      set: { deviceSeq, acked: false }
    })
    .run()
  return deviceSeq
}

/**
 * Reads the sync log for pushing. Because a record keeps only its latest
 * sequence number, pending numbers can have gaps; a push names the sequence it
 * continues from rather than relying on consecutive numbers.
 */
export class SyncLog {
  constructor(private readonly store: Pick<OwltoStore, 'db'>) {}
  /** Changes not yet acknowledged, after `after`, oldest first. */
  pending(after = 0, limit = 500): SyncLogEntry[] {
    return this.store.db
      .select()
      .from(syncLogTable)
      .where(and(eq(syncLogTable.acked, false), gt(syncLogTable.deviceSeq, after)))
      .orderBy(asc(syncLogTable.deviceSeq))
      .limit(limit)
      .all()
      .map((row) => ({
        kind: syncRecordKindSchema.parse(row.kind),
        recordId: row.recordId,
        deviceSeq: row.deviceSeq
      }))
  }
  /**
   * The sync service accepted everything up to `deviceSeq`. A record that
   * changed again since has a higher number and stays pending.
   */
  ack(deviceSeq: number): void {
    this.store.db
      .update(syncLogTable)
      .set({ acked: true })
      .where(and(eq(syncLogTable.acked, false), lte(syncLogTable.deviceSeq, deviceSeq)))
      .run()
  }
}
