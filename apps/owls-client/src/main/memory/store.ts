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
import {
  liveCategory,
  type MemoryCommit,
  type MemoryCursor,
  type MemoryRecords,
  type MemoryWrite,
  type MemoryWriteResult
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
      const current = commit.writes.map((write) => {
        const rev = this.currentRev(tx, write)
        return write.baseRev === null ? rev === null : rev === write.baseRev
      })
      // Categories as this commit leaves them: stored rows, then its own writes.
      const staged = new Map(
        commit.writes.flatMap((write, index) =>
          write.kind === 'category' && current[index] ? [[write.value.id, write.value]] : []
        )
      )
      const category = (id: string) => staged.get(id) ?? this.category(tx, id)
      const writes = commit.writes.map((write, index): MemoryWrite | null => {
        if (!current[index]) return null
        if (write.kind === 'category') return write
        const value = liveCategory(write.value, category)
        return value && { ...write, value }
      })
      const refused = commit.mode === 'all' && writes.includes(null)
      const results = writes.map((write): MemoryWriteResult => {
        if (refused || !write) return { ok: false, reason: 'stale' }
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
  private category(tx: Pick<CodexStore['db'], 'select'>, id: string): MemoryCategory | null {
    const row = tx
      .select({ value: codexMemoryCategories.value })
      .from(codexMemoryCategories)
      .where(eq(codexMemoryCategories.id, id))
      .get()
    return row ? memoryCategorySchema.parse(row.value) : null
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
