import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { memoryRouterStore } from '../fixtures/router-store.mjs'
import { openSqlite } from '../fixtures/sqlite.mjs'

const require = createRequire(import.meta.url)
const {
  applyCommand,
  checkoutOnly,
  OwlsStore,
  commandReceiptSchema,
  deviceCommandSchema,
  LocalWorkers,
  MemoryStore,
  RouterStore,
  SyncLog,
  WorkerPool
} = require('../../out/main/app/runtime.js')

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations')
const NOW = '2026-11-08T12:00:00.000Z'
const DEVICE_ID = /^dv_[0-9a-f]{8}$/

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'owls-device-sync-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function openStore(t, path, migrations = MIGRATIONS) {
  const client = openSqlite(path)
  const store = new OwlsStore(client, migrations)
  t.after(() => client.close())
  return { store, client }
}
function thread(id, overrides = {}) {
  return {
    id,
    title: null,
    projectId: 'p1',
    cwd: '/tmp/owls-demo',
    status: 'idle',
    rev: 0,
    itemCount: 0,
    preview: null,
    projectsShown: null,
    error: null,
    tokens: null,
    native: null,
    unknownBatches: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}
const item = (id) => ({
  id,
  kind: 'user',
  status: 'completed',
  text: id,
  detail: '',
  turnId: null
})
const worker = (id, routerId) => ({
  id,
  routerId,
  projectId: 'p1',
  sessionId: `s-${id}`,
  provider: 'codex',
  goal: 'Count the files',
  title: null,
  parentId: null,
  context: null,
  pullRequest: null,
  permission: 'read-only',
  next: null,
  status: 'idle',
  workspace: { kind: 'checkout' },
  report: null,
  degraded: false,
  createdAt: NOW,
  updatedAt: NOW
})
const session = (id) => ({
  id,
  provider: 'codex',
  threadId: null,
  title: 'Session',
  cwd: '/tmp/owls-demo',
  model: null,
  effort: null,
  permission: 'read-only',
  status: 'idle',
  turnId: null,
  error: null,
  items: [],
  requests: [],
  diff: '',
  tokens: null,
  createdAt: NOW,
  updatedAt: NOW
})
const category = (id) => ({
  id,
  name: 'Work',
  description: '',
  status: 'active',
  mergedInto: null,
  createdBy: 'user',
  rev: 0,
  createdAt: NOW,
  updatedAt: NOW
})
const entries = (log, after) =>
  log.pending(after).map((e) => `${e.deviceSeq} ${e.kind} ${e.recordId}`)

test('the device id is made once and kept across restarts', (t) => {
  const path = join(tempDir(t), 'owls.db')
  const first = openStore(t, path)
  assert.match(first.store.deviceId, DEVICE_ID)
  first.client.close()
  const again = openStore(t, path)
  assert.equal(again.store.deviceId, first.store.deviceId)
})

test('saves log each record under the next device sequence, apart from the change version', (t) => {
  const { store, client } = openStore(t, join(tempDir(t), 'owls.db'))
  const routers = new RouterStore(store)
  const memory = new MemoryStore(store)
  const log = new SyncLog(store)
  const { deviceId } = store
  assert.deepEqual(log.pending(), [], 'a new database has nothing to push')

  store.saveProject({ id: 'p1', name: 'demo', path: '/tmp/owls-demo' })
  const rev = routers.saveThread(thread('t1', { deviceId }), [
    { item: item('a'), position: 0 },
    { item: item('b'), position: 1 }
  ])
  assert.equal(rev, 1, 'projects do not take a change version')
  routers.saveWorker(worker('w_1', 't1'))
  store.saveSession(session('s1'))
  const [result] = memory.commit({
    mode: 'all',
    writes: [{ kind: 'category', baseRev: null, value: category('c1') }]
  })
  assert.deepEqual(result, { ok: true, rev: 2 }, 'memory shares the change version with threads')
  assert.deepEqual(entries(log), [
    '1 project p1',
    '2 thread t1',
    '3 item t1/a',
    '4 item t1/b',
    '5 worker w_1',
    '6 session s1',
    '7 memory-category c1'
  ])
  for (const table of ['projects', 'threads', 'workers', 'sessions']) {
    const row = client.prepare(`SELECT owner_device_id AS owner FROM ${table}`).get()
    assert.equal(row.owner, deviceId, `${table} rows are written as this device`)
  }

  // A record that changes again moves to the end; the log keeps one entry per record.
  store.saveProject({ id: 'p1', name: 'renamed', path: '/tmp/owls-demo' })
  assert.deepEqual(entries(log).slice(-2), ['7 memory-category c1', '8 project p1'])
  assert.equal(log.pending().length, 7)

  // An acknowledgement settles what it covers; later changes stay pending.
  log.ack(5)
  assert.deepEqual(entries(log), ['6 session s1', '7 memory-category c1', '8 project p1'])
  routers.saveThread(thread('t1', { deviceId, title: 'Renamed' }))
  store.removeSession('s1')
  assert.deepEqual(entries(log), [
    '7 memory-category c1',
    '8 project p1',
    '9 thread t1',
    '10 session s1'
  ])
  assert.deepEqual(entries(log, 8), ['9 thread t1', '10 session s1'])
  log.ack(10)
  assert.deepEqual(log.pending(), [])
})

/** A WorkerPool on a fake host, as the receiving device would run it. */
function receiver(t) {
  const created = []
  const responded = []
  const store = memoryRouterStore()
  const host = {
    projects: () => [{ id: 'p1', name: 'demo', path: '/tmp/owls-demo' }],
    threadHome: () => '/tmp/owls-thread-home',
    settings: () => ({
      permission: 'workspace-write',
      provider: 'codex',
      model: 'gpt-local',
      effort: null,
      claudeModel: null,
      claudeEffort: null,
      router: { maxPermission: 'workspace-write', worktrees: false }
    }),
    providerReady: (provider) => provider === 'codex',
    createSession: (input) => {
      const session = { id: crypto.randomUUID(), ...input }
      created.push(session)
      return session
    },
    remove: () => {},
    send: async () => {},
    steer: async () => 'steered',
    interrupt: async () => {},
    respond: (input) => responded.push(input)
  }
  const inbox = { add: () => {}, settle: () => {} }
  const pool = new WorkerPool(store, host, inbox, () => {}, checkoutOnly)
  t.after(() => pool.close())
  return { pool, workers: new LocalWorkers(pool), created, responded }
}

test('commands round-trip to local workers and come back as receipts', async (t) => {
  const { pool, workers, created, responded } = receiver(t)
  const base = {
    from: 'dv_0000000b',
    to: 'dv_0000000a',
    createdAt: NOW,
    expiresAt: null
  }
  /** Sends a command as the sync service would carry it, and reads the receipt the same way. */
  const send = async (command, now = new Date(NOW)) => {
    const received = deviceCommandSchema.parse(JSON.parse(JSON.stringify(command)))
    const receipt = await applyCommand(
      workers,
      (workerId) => pool.get(workerId)?.routerId ?? null,
      received,
      now
    )
    return commandReceiptSchema.parse(JSON.parse(JSON.stringify(receipt)))
  }
  const dispatch = {
    ...base,
    commandId: 'w_remote1',
    expiresAt: '2026-11-09T12:00:00.000Z',
    kind: 'dispatch',
    workerId: 'w_remote1',
    routerId: 'thread-on-a',
    projectId: 'p1',
    goal: 'Count the files',
    provider: 'codex',
    model: 'gpt-remote',
    effort: 'high',
    permission: 'read-only',
    parent: null,
    base: 'head'
  }

  assert.deepEqual(await send(dispatch), {
    commandId: 'w_remote1',
    result: 'accepted',
    reason: null,
    permission: 'read-only'
  })
  const started = pool.get('w_remote1')
  assert.equal(started.routerId, 'thread-on-a', 'the worker keeps the sender thread')
  assert.equal(created.length, 1)
  assert.equal(created[0].model, 'gpt-remote', "the sender's model choice is used")
  assert.equal(created[0].effort, 'high')

  // The same command again is the same worker.
  assert.equal((await send(dispatch)).result, 'accepted')
  assert.equal(created.length, 1)

  const message = await send({
    ...base,
    commandId: 'cmd-message',
    kind: 'message',
    workerId: 'w_remote1',
    text: 'Also count the folders',
    mode: 'next'
  })
  assert.equal(message.result, 'accepted')
  assert.match(pool.get('w_remote1').next, /Also count the folders/, '`next` waits for a turn')

  const approval = {
    ...base,
    commandId: 'cmd-approve',
    kind: 'approval',
    workerId: 'w_remote1',
    requestId: crypto.randomUUID(),
    decision: 'approve'
  }
  assert.deepEqual(await send(approval), {
    commandId: 'cmd-approve',
    result: 'rejected',
    reason: 'already_resolved',
    permission: null
  })
  pool.get('w_remote1').status = 'waiting'
  assert.equal((await send(approval)).result, 'accepted')
  assert.equal(responded[0].decision, 'accept')

  const stop = await send({ ...base, commandId: 'cmd-stop', kind: 'stop', workerId: 'w_remote1' })
  assert.equal(stop.result, 'accepted')

  assert.equal(
    (await send({ ...base, commandId: 'cmd-gone', kind: 'stop', workerId: 'w_unknown' })).reason,
    'worker_not_found'
  )
  assert.equal(
    (await send({ ...dispatch, commandId: 'w_remote2', workerId: 'w_remote2', projectId: 'p9' }))
      .reason,
    'project_not_found'
  )
  assert.equal(
    (
      await send({
        ...dispatch,
        commandId: 'w_remote3',
        workerId: 'w_remote3',
        provider: 'claude-code'
      })
    ).reason,
    'agent_not_connected'
  )
  assert.equal(
    (
      await send(
        { ...dispatch, commandId: 'w_remote4', workerId: 'w_remote4' },
        new Date('2026-11-10T00:00:00.000Z')
      )
    ).reason,
    'expired'
  )
  assert.equal(created.length, 1, 'refused dispatches start nothing')
  assert.throws(
    () => deviceCommandSchema.parse({ ...dispatch, to: 'macbook' }),
    'device ids are validated'
  )
})
