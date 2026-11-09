/**
 * In-memory stand-ins shared by the Router tests and the M4 benchmark
 * (scripts/bench-router.mjs). better-sqlite3 is built for Electron, so plain
 * Node runs use this store with the same method surface as RouterStore.
 */
/** The device id every in-memory store writes as. */
export const TEST_DEVICE_ID = 'dv_0000000a'

/** In-memory stand-in for RouterStore with the same method surface. */
export function memoryRouterStore() {
  const routers = new Map()
  const threadItems = new Map()
  const workers = new Map()
  const messages = new Map()
  const credentials = new Map()
  const events = []
  const batches = new Map()
  let seq = 0
  let rev = 0
  const publicEvent = (e) => ({ ...structuredClone(e.body), seq: e.seq })
  return {
    deviceId: TEST_DEVICE_ID,
    events: (routerId, status) =>
      events.filter((e) => e.routerId === routerId && e.status === status).map(publicEvent),
    allEvents: () =>
      events.map((e) => ({ ...publicEvent(e), status: e.status, batchId: e.batchId })),
    appendEvent(routerId, id, body, batchId = null) {
      if (events.some((e) => e.id === id)) throw new Error('duplicate event id')
      const row = {
        seq: ++seq,
        id,
        routerId,
        status: batchId ? 'batched' : 'pending',
        batchId,
        body: structuredClone(body)
      }
      events.push(row)
      if (batchId && batches.has(batchId)) batches.get(batchId).eventSeqs.push(row.seq)
      return publicEvent(row)
    },
    setEventStatus(seqs, status) {
      for (const e of events) if (seqs.includes(e.seq)) e.status = status
    },
    openBatch(batch, seqs) {
      batches.set(batch.id, {
        ...batch,
        status: 'sending',
        eventSeqs: [...seqs].sort((a, b) => a - b),
        tokens: null,
        durationMs: null
      })
      for (const e of events)
        if (seqs.includes(e.seq)) Object.assign(e, { status: 'batched', batchId: batch.id })
    },
    finishBatch(id, status, result = null) {
      const batch = batches.get(id)
      if (batch) Object.assign(batch, { status }, result ?? {})
    },
    batches: (status) =>
      [...batches.values()].filter((b) => b.status === status).map((b) => structuredClone(b)),
    batch: (id) => (batches.has(id) ? structuredClone(batches.get(id)) : null),
    requeueBatch(id) {
      batches.get(id).status = 'retried'
      for (const e of events)
        if (e.batchId === id && e.status === 'batched')
          Object.assign(e, { status: 'pending', batchId: null })
    },
    hasMessages: (id) => (messages.get(id) ?? []).length > 0,
    event(n) {
      const row = events.find((e) => e.seq === n)
      return row
        ? {
            event: publicEvent(row),
            routerId: row.routerId,
            status: row.status,
            batchId: row.batchId
          }
        : null
    },
    workerEvents: (routerId, workerId, limit) =>
      events
        .filter((e) => e.routerId === routerId && e.body.workerId === workerId)
        .slice(-limit)
        .map(publicEvent),
    routers: () => [...routers.values()].map((r) => structuredClone(r)),
    saveThread(router, items = []) {
      rev++
      routers.set(router.id, structuredClone({ ...router, rev }))
      const stored = threadItems.get(router.id) ?? new Map()
      for (const { item, position } of items)
        stored.set(item.id, structuredClone({ item, position, rev }))
      threadItems.set(router.id, stored)
      return rev
    },
    items: (id) =>
      [...(threadItems.get(id)?.values() ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((entry) => structuredClone(entry)),
    workers: () => [...workers.values()].map((w) => structuredClone(w)),
    saveWorker: (w) => workers.set(w.id, structuredClone(w)),
    messages: (id) => structuredClone(messages.get(id) ?? []),
    appendMessages: (id, _batch, list) =>
      messages.set(id, [...(messages.get(id) ?? []), ...structuredClone(list)]),
    credential: (id) => credentials.get(id) ?? null,
    credentialIds: () => [...credentials.keys()].sort(),
    saveCredential: (id, type, secret) => credentials.set(id, { type, secret }),
    removeCredential: (id) => credentials.delete(id)
  }
}
export const cipher = {
  unavailable: () => null,
  encrypt: (plain) => Buffer.from(`enc:${plain}`).toString('base64'),
  decrypt: (encoded) => Buffer.from(encoded, 'base64').toString().replace(/^enc:/, '')
}
export function commands() {
  const seen = new Map()
  return {
    acceptCommand(id, scope, text) {
      const key = `${scope}\0${text}`
      if (seen.has(id)) {
        if (seen.get(id) !== key) throw new Error('Command ID reused')
        return false
      }
      seen.set(id, key)
      return true
    }
  }
}
