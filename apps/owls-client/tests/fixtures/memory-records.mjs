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
      const fresh = writes.map((write) => {
        const current = table(write.kind).get(write.value.id)?.rev ?? null
        return write.baseRev === null ? current === null : current === write.baseRev
      })
      const refused = mode === 'all' && fresh.includes(false)
      const results = writes.map((write, index) => {
        if (refused || !fresh[index]) return { ok: false, reason: 'stale' }
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
