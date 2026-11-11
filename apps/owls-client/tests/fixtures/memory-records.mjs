import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { liveCategory } = require('../../out/main/app/runtime.js')

/**
 * In-memory stand-in for MemoryStore with the same method surface, since
 * better-sqlite3 is built for Electron and plain Node tests cannot load it.
 * It shares one change counter so revs behave like the shared sync state.
 */
export function memoryRecords() {
  const memories = new Map()
  const categories = new Map()
  const cursors = new Map()
  const runs = new Map()
  let rev = 0
  const table = (kind) => (kind === 'memory' ? memories : categories)
  return {
    memories: () => [...memories.values()].map((m) => structuredClone(m)),
    categories: () => [...categories.values()].map((c) => structuredClone(c)),
    commit({ writes, mode, cursor, run }) {
      const current = writes.map((write) => {
        const stored = table(write.kind).get(write.value.id)?.rev ?? null
        return write.baseRev === null ? stored === null : stored === write.baseRev
      })
      const staged = new Map(
        writes.flatMap((write, index) =>
          write.kind === 'category' && current[index] ? [[write.value.id, write.value]] : []
        )
      )
      const category = (id) => staged.get(id) ?? categories.get(id) ?? null
      const checked = writes.map((write, index) => {
        if (!current[index]) return null
        if (write.kind === 'category') return write
        const value = liveCategory(write.value, category)
        return value && { ...write, value }
      })
      const refused = mode === 'all' && checked.includes(null)
      const results = checked.map((write) => {
        if (refused || !write) return { ok: false, reason: 'stale' }
        rev++
        table(write.kind).set(write.value.id, structuredClone({ ...write.value, rev }))
        return { ok: true, rev }
      })
      if (refused) return results
      if (cursor) cursors.set(cursor.threadId, structuredClone(cursor))
      if (run) runs.set(run.id, structuredClone(run))
      return results
    },
    cursor: (threadId) => (cursors.has(threadId) ? structuredClone(cursors.get(threadId)) : null),
    purge(before) {
      let removed = 0
      for (const map of [memories, categories])
        for (const [id, value] of map)
          if (value.status === 'deleted' && value.updatedAt < before) {
            map.delete(id)
            removed++
          }
      return removed
    },
    saveRun: (run) => runs.set(run.id, structuredClone(run)),
    runs: (limit) =>
      [...runs.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .slice(0, limit)
        .map((r) => structuredClone(r)),
    /** Test helper: the shared change counter. */
    rev: () => rev
  }
}
