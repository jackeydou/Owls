import { sql } from 'drizzle-orm'
import { codexSyncState } from './schema.js'
import type { CodexStore } from './store.js'

/** The row in `codex_sync_state` holding the change version. */
const SYNC_ROW = 'account'
/** The row holding the last `device_seq` handed to the sync log. */
const DEVICE_SEQ_ROW = 'device-seq'

type Writer = Pick<CodexStore['db'], 'insert'>

function bump(tx: Writer, id: string): number {
  return tx
    .insert(codexSyncState)
    .values({ id, rev: 1 })
    .onConflictDoUpdate({
      target: codexSyncState.id,
      set: { rev: sql`${codexSyncState.rev} + 1` }
    })
    .returning()
    .get().rev
}

/**
 * Takes the next change version. Threads, items, memories, and categories all
 * share it, so one cursor reads every kind of change in commit order. Call it
 * inside the transaction that writes the change.
 */
export function nextRev(tx: Writer): number {
  return bump(tx, SYNC_ROW)
}

/**
 * Takes the next sync log sequence number. It is separate from `nextRev`:
 * the version serves local readers, the sequence orders what this device
 * pushes to the sync service (RFC_OWLS_MULTI_DEVICE 8.1).
 */
export function nextDeviceSeq(tx: Writer): number {
  return bump(tx, DEVICE_SEQ_ROW)
}
