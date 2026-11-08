import { desc, eq } from 'drizzle-orm'
import {
  type Memory,
  type MemoryCategory,
  type MemoryRun,
  memoryCategorySchema,
  memoryRunSchema,
  memorySchema
} from '../../shared/memory.js'
import {
  codexMemories,
  codexMemoryCategories,
  codexMemoryCursors,
  codexMemoryRuns
} from '../codex/schema.js'
import type { CodexStore } from '../codex/store.js'
import { nextRev } from '../codex/sync-state.js'
import type {
  MemoryCommit,
  MemoryCursor,
  MemoryRecords,
  MemoryWrite,
  MemoryWriteResult
} from './records.js'

/** Memory persistence in `owls-codex.db`, sharing the Codex store's connection. */
export class MemoryStore implements MemoryRecords {
  constructor(private readonly store: CodexStore) {}
  private get db() {
    return this.store.db
  }
  memories(): Memory[] {
    return this.db
      .select()
      .from(codexMemories)
      .all()
      .map((row) => memorySchema.parse(row.value))
  }
  categories(): MemoryCategory[] {
    return this.db
      .select()
      .from(codexMemoryCategories)
      .all()
      .map((row) => memoryCategorySchema.parse(row.value))
  }
  commit(commit: MemoryCommit): MemoryWriteResult[] {
    return this.db.transaction((tx) => {
      const fresh = commit.writes.map((write) => {
        const current = this.currentRev(tx, write)
        return write.baseRev === null ? current === null : current === write.baseRev
      })
      const refused = commit.mode === 'all' && fresh.includes(false)
      const results = commit.writes.map((write, index): MemoryWriteResult => {
        if (refused || !fresh[index]) return { ok: false, reason: 'stale' }
        const rev = nextRev(tx)
        if (write.kind === 'memory') {
          const value = memorySchema.parse({ ...write.value, rev })
          const row = {
            rev,
            store: value.store,
            projectId: value.projectId,
            categoryId: value.categoryId,
            kind: value.kind,
            status: value.status,
            updatedAt: value.updatedAt,
            value
          }
          tx.insert(codexMemories)
            .values({ id: value.id, ...row })
            .onConflictDoUpdate({ target: codexMemories.id, set: row })
            .run()
        } else {
          const value = memoryCategorySchema.parse({ ...write.value, rev })
          const row = { rev, updatedAt: value.updatedAt, value }
          tx.insert(codexMemoryCategories)
            .values({ id: value.id, ...row })
            .onConflictDoUpdate({ target: codexMemoryCategories.id, set: row })
            .run()
        }
        return { ok: true, rev }
      })
      if (refused) return results
      if (commit.cursor) {
        const { threadId, itemRev, eventSeq } = commit.cursor
        const row = { itemRev, eventSeq, updatedAt: new Date().toISOString() }
        tx.insert(codexMemoryCursors)
          .values({ threadId, ...row })
          .onConflictDoUpdate({ target: codexMemoryCursors.threadId, set: row })
          .run()
      }
      if (commit.run) this.writeRun(tx, commit.run)
      return results
    })
  }
  cursor(threadId: string): MemoryCursor | null {
    const row = this.db
      .select()
      .from(codexMemoryCursors)
      .where(eq(codexMemoryCursors.threadId, threadId))
      .get()
    return row ? { threadId, itemRev: row.itemRev, eventSeq: row.eventSeq } : null
  }
  saveRun(run: MemoryRun): void {
    this.writeRun(this.db, run)
  }
  runs(limit: number): MemoryRun[] {
    return this.db
      .select()
      .from(codexMemoryRuns)
      .orderBy(desc(codexMemoryRuns.createdAt), desc(codexMemoryRuns.id))
      .limit(limit)
      .all()
      .map((row) => memoryRunSchema.parse(row.value))
  }
  private currentRev(tx: Pick<CodexStore['db'], 'select'>, write: MemoryWrite): number | null {
    const table = write.kind === 'memory' ? codexMemories : codexMemoryCategories
    const row = tx.select({ rev: table.rev }).from(table).where(eq(table.id, write.value.id)).get()
    return row?.rev ?? null
  }
  private writeRun(tx: Pick<CodexStore['db'], 'insert'>, run: MemoryRun): void {
    const value = memoryRunSchema.parse(run)
    const row = { threadId: value.threadId, status: value.status, value }
    tx.insert(codexMemoryRuns)
      .values({ id: value.id, createdAt: value.createdAt, ...row })
      .onConflictDoUpdate({ target: codexMemoryRuns.id, set: row })
      .run()
  }
}
