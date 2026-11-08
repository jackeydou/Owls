import type { Memory, MemoryCategory, MemoryRun } from '../../shared/memory.js'

/**
 * One record write. `baseRev` is the version the change was made against; null
 * means the record must not exist yet. Writes are compared one by one, so a
 * later sync service can take the same shape (RFC_OWLS_MEMORY 11.5).
 */
export type MemoryWrite =
  | { kind: 'memory'; baseRev: number | null; value: Memory }
  | { kind: 'category'; baseRev: number | null; value: MemoryCategory }
export type MemoryWriteResult = { ok: true; rev: number } | { ok: false; reason: 'stale' }
export type MemoryCursor = { threadId: string; itemRev: number; eventSeq: number }
/** Applied in one transaction: the writes, how far Dreaming read, and its run record. */
export type MemoryCommit = {
  writes: MemoryWrite[]
  /**
   * `each` applies every write that is not stale, as Dreaming does; `all` applies
   * none when any is stale, as a user's edit expects.
   */
  mode: 'each' | 'all'
  cursor?: MemoryCursor
  run?: MemoryRun
}

/** Where memories persist. The SQLite store implements it; tests use an in-memory one. */
export interface MemoryRecords {
  /** Every memory, tombstones included. */
  memories(): Memory[]
  /** Every category, tombstones included. */
  categories(): MemoryCategory[]
  /** Each write takes the next shared change version unless its `baseRev` is stale. */
  commit(commit: MemoryCommit): MemoryWriteResult[]
  cursor(threadId: string): MemoryCursor | null
  saveRun(run: MemoryRun): void
  /** The newest runs first. */
  runs(limit: number): MemoryRun[]
}
