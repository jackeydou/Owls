import { and, asc, eq, gt, lte } from 'drizzle-orm'
import { z } from 'zod'
import { codexSyncLog } from '../codex/schema.js'
import type { CodexStore } from '../codex/store.js'
import { nextDeviceSeq } from '../codex/sync-state.js'

/** The local records this device writes and will push (RFC_OWLS_MULTI_DEVICE 4, 8.1). */
export const syncRecordKindSchema = z.enum([
  'project',
  'thread',
  'item',
  'worker',
  'session',
  'memory-category',
  'memory'
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
  tx: Pick<CodexStore['db'], 'insert'>,
  kind: SyncRecordKind,
  recordId: string
): number {
  const deviceSeq = nextDeviceSeq(tx)
  tx.insert(codexSyncLog)
    .values({ kind, recordId, deviceSeq, acked: false })
    .onConflictDoUpdate({
      target: [codexSyncLog.kind, codexSyncLog.recordId],
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
  constructor(private readonly store: Pick<CodexStore, 'db'>) {}
  /** Changes not yet acknowledged, after `after`, oldest first. */
  pending(after = 0, limit = 500): SyncLogEntry[] {
    return this.store.db
      .select()
      .from(codexSyncLog)
      .where(and(eq(codexSyncLog.acked, false), gt(codexSyncLog.deviceSeq, after)))
      .orderBy(asc(codexSyncLog.deviceSeq))
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
      .update(codexSyncLog)
      .set({ acked: true })
      .where(and(eq(codexSyncLog.acked, false), lte(codexSyncLog.deviceSeq, deviceSeq)))
      .run()
  }
}
