import { sql } from 'drizzle-orm'
import { codexSyncState } from './schema.js'
import type { CodexStore } from './store.js'

/** The row in `codex_sync_state` holding the change version. */
const SYNC_ROW = 'account'

/**
 * Takes the next change version. Threads, items, memories, and categories all
 * share it, so one cursor reads every kind of change in commit order. Call it
 * inside the transaction that writes the change.
 */
export function nextRev(tx: Pick<CodexStore['db'], 'insert'>): number {
  return tx
    .insert(codexSyncState)
    .values({ id: SYNC_ROW, rev: 1 })
    .onConflictDoUpdate({
      target: codexSyncState.id,
      set: { rev: sql`${codexSyncState.rev} + 1` }
    })
    .returning()
    .get().rev
}
