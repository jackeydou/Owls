import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import {
  type Memory,
  type MemoryCategory,
  type MemoryRun,
  memoryCategorySchema,
  memoryRunSchema,
  memorySchema
} from '../../shared/memory.js'
import {
  memoriesTable,
  memoryCategoriesTable,
  memoryCursorsTable,
  memoryRunsTable
} from '../app/schema.js'
import type { OwltoStore } from '../app/store.js'
import { nextRev } from '../app/sync-state.js'
import { logChange } from '../sync/sync-log.js'
import {
  liveCategory,
  type MemoryCommit,
  type MemoryCursor,
  type MemoryRecords,
  type MemoryWrite,
  type MemoryWriteResult
} from './records.js'

/** Memory persistence in `owlto.db`, sharing the Codex store's connection. */
export class MemoryStore implements MemoryRecords {
  constructor(private readonly store: OwltoStore) {}
  private get db() {
    return this.store.db
  }
  memories(): Memory[] {
    return this.db
      .select()
      .from(memoriesTable)
      .all()
      .map((row) => memorySchema.parse(row.value))
  }
  categories(): MemoryCategory[] {
    return this.db
      .select()
      .from(memoryCategoriesTable)
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
          tx.insert(memoriesTable)
            .values({ id: value.id, ...row })
            .onConflictDoUpdate({ target: memoriesTable.id, set: row })
            .run()
          logChange(tx, 'memory', value.id)
        } else {
          const value = memoryCategorySchema.parse({ ...write.value, rev })
          const row = { rev, updatedAt: value.updatedAt, value }
          tx.insert(memoryCategoriesTable)
            .values({ id: value.id, ...row })
            .onConflictDoUpdate({ target: memoryCategoriesTable.id, set: row })
            .run()
          logChange(tx, 'memory-category', value.id)
        }
        return { ok: true, rev }
      })
      if (refused) return results
      if (commit.cursor) {
        const { threadId, itemRev, eventSeq } = commit.cursor
        const row = { itemRev, eventSeq, updatedAt: new Date().toISOString() }
        tx.insert(memoryCursorsTable)
          .values({ threadId, ...row })
          .onConflictDoUpdate({ target: memoryCursorsTable.threadId, set: row })
          .run()
      }
      if (commit.run) this.writeRun(tx, commit.run)
      return results
    })
  }
  cursor(threadId: string): MemoryCursor | null {
    const row = this.db
      .select()
      .from(memoryCursorsTable)
      .where(eq(memoryCursorsTable.threadId, threadId))
      .get()
    return row ? { threadId, itemRev: row.itemRev, eventSeq: row.eventSeq } : null
  }
  purge(before: string): number {
    return this.db.transaction((tx) => {
      const memories = tx
        .delete(memoriesTable)
        .where(and(eq(memoriesTable.status, 'deleted'), lt(memoriesTable.updatedAt, before)))
        .run().changes
      // Category status lives only in the JSON value, so pick the ids first.
      const categories = tx
        .select({ id: memoryCategoriesTable.id, value: memoryCategoriesTable.value })
        .from(memoryCategoriesTable)
        .where(lt(memoryCategoriesTable.updatedAt, before))
        .all()
        .filter((row) => memoryCategorySchema.parse(row.value).status === 'deleted')
        .map((row) => row.id)
      if (categories.length)
        tx.delete(memoryCategoriesTable).where(inArray(memoryCategoriesTable.id, categories)).run()
      return memories + categories.length
    })
  }
  saveRun(run: MemoryRun): void {
    this.writeRun(this.db, run)
  }
  runs(limit: number): MemoryRun[] {
    return this.db
      .select()
      .from(memoryRunsTable)
      .orderBy(desc(memoryRunsTable.createdAt), desc(memoryRunsTable.id))
      .limit(limit)
      .all()
      .map((row) => memoryRunSchema.parse(row.value))
  }
  private currentRev(tx: Pick<OwltoStore['db'], 'select'>, write: MemoryWrite): number | null {
    const table = write.kind === 'memory' ? memoriesTable : memoryCategoriesTable
    const row = tx.select({ rev: table.rev }).from(table).where(eq(table.id, write.value.id)).get()
    return row?.rev ?? null
  }
  private category(tx: Pick<OwltoStore['db'], 'select'>, id: string): MemoryCategory | null {
    const row = tx
      .select({ value: memoryCategoriesTable.value })
      .from(memoryCategoriesTable)
      .where(eq(memoryCategoriesTable.id, id))
      .get()
    return row ? memoryCategorySchema.parse(row.value) : null
  }
  private writeRun(tx: Pick<OwltoStore['db'], 'insert'>, run: MemoryRun): void {
    const value = memoryRunSchema.parse(run)
    const row = { threadId: value.threadId, status: value.status, value }
    tx.insert(memoryRunsTable)
      .values({ id: value.id, createdAt: value.createdAt, ...row })
      .onConflictDoUpdate({ target: memoryRunsTable.id, set: row })
      .run()
  }
}
