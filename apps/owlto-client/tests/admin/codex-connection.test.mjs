import assert from 'node:assert/strict'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { openSqlite } from '../fixtures/sqlite.mjs'

const require = createRequire(import.meta.url)
const {
  CodexService,
  OwltoHost,
  OwltoStore,
  ClaudeService,
  CursorService
} = require('../../out/main/app/runtime.js')
const fixture = fileURLToPath(new URL('../fixtures/codex/mock-codex.cjs', import.meta.url))
const migrations = fileURLToPath(new URL('../../migrations', import.meta.url))

async function until(check) {
  const deadline = Date.now() + 5000
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for fixture')
    await sleep(10)
  }
}

function exited(pid) {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    if (error.code === 'ESRCH') return true
    throw error
  }
}

function setup(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'owlto-codex-link-')))
  const exe = join(root, 'codex.cjs')
  copyFileSync(fixture, exe)
  chmodSync(exe, 0o755)
  const control = (actions) => writeFileSync(join(root, 'lifecycle.json'), JSON.stringify(actions))
  control({})
  const log = join(root, 'requests.jsonl')
  const requests = (method) =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .filter((r) => r.method === method)
      : []
  const db = openSqlite(join(root, 'owlto.db'))
  const store = new OwltoStore(db, migrations)
  store.saveSettings({ ...store.settings(), executablePath: exe })
  const transitions = []
  const codex = new CodexService(store, (event) => {
    if (event.type === 'connection') transitions.push(event.connection.status)
  })
  const host = new OwltoHost(
    codex,
    new ClaudeService(store, () => {}),
    new CursorService(store, () => {}),
    join(root, 't'),
    join(root, 'p'),
    root
  )
  const createSession = () =>
    codex.createSession({
      cwd: codex.addProject(root).path,
      model: 'fixture-model',
      effort: 'medium',
      permission: 'workspace-write'
    })
  t.after(() => {
    host.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { codex, host, control, requests, createSession, store, transitions }
}

const usageMethod = 'account/rateLimits/read'

test('A hung or exiting usage process leaves a working turn and its approvals on the original process', async (t) => {
  const { codex, host, control, requests, createSession } = setup(t)
  assert.equal((await host.connect()).status, 'ready')
  const main = requests('initialize')[0].pid
  const session = createSession()
  const send = (text) => codex.send({ sessionId: session.id, commandId: crypto.randomUUID(), text })
  for (const action of ['ignore-stop', 'exit']) {
    await send('approval')
    await until(() => session.status === 'waiting')
    control({ [usageMethod]: action })
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const count = requests(usageMethod).length
    const read = host.usage(true)
    const concurrent = codex.usage()
    await until(() => requests(usageMethod).length > count)
    const probe = requests(usageMethod).at(-1).pid
    assert.notEqual(probe, main)
    if (action === 'ignore-stop') {
      host.respond({
        sessionId: session.id,
        requestId: session.requests.at(-1).id,
        decision: 'accept'
      })
      await until(() => session.status === 'idle')
      await send('approval')
      await until(() => session.status === 'waiting')
      t.mock.timers.tick(30_000)
    }
    const [overview, sameRead] = await Promise.all([read, concurrent])
    assert.equal(overview.agents.find((a) => a.provider === 'codex').reason, 'failed')
    assert.equal(sameRead.reason, 'failed')
    assert.equal(requests(usageMethod).length, count + 1)
    t.mock.timers.tick(2000)
    await until(() => exited(probe))
    t.mock.timers.reset()
    assert.equal(codex.connectionState().status, 'ready')
    assert.equal(session.status, 'waiting')
    host.respond({
      sessionId: session.id,
      requestId: session.requests.at(-1).id,
      decision: 'accept'
    })
    await until(() => session.status === 'idle')
  }
  control({ 'account/read': 'other-account' })
  assert.equal((await codex.usage()).reason, 'failed')
  assert.equal(requests(usageMethod).length, 2)
  control({})
  assert.equal((await codex.usage()).state, 'ready')
  await until(() => exited(requests(usageMethod).at(-1).pid))
  await send('hello')
  await until(() => session.status === 'idle')
  assert.ok(requests('turn/start').every((r) => r.pid === main))
})

test('Unexpected exit retries failed handshakes with backoff, without replaying work', async (t) => {
  const { codex, host, control, requests, createSession, transitions } = setup(t)
  await Promise.all([host.connect(), host.connect()])
  const [main] = requests('initialize')
  assert.equal(requests('initialize').length, 1)
  const session = createSession()
  await codex.send({ sessionId: session.id, commandId: crypto.randomUUID(), text: 'approval' })
  await until(() => session.status === 'waiting')
  t.mock.timers.enable({ apis: ['setTimeout'] })
  control({ initialize: 'exit' })
  process.kill(main.pid, 'SIGTERM')
  await until(() => session.status === 'interrupted')
  assert.equal(session.requests.at(-1).status, 'unavailable')
  const beforeRetry = transitions.length
  t.mock.timers.tick(1000)
  // One event enters the handshake, another enters backoff after it fails.
  await until(() => transitions.length === beforeRetry + 2)
  assert.equal(requests('initialize').length, 2)
  control({})
  t.mock.timers.tick(1999)
  await sleep(30)
  assert.equal(requests('initialize').length, 2)
  t.mock.timers.tick(1)
  await until(() => codex.connectionState().status === 'ready')
  assert.equal(requests('turn/start').length, 1)
  assert.equal(requests('thread/resume').length, 0)
  assert.equal(session.status, 'interrupted')
  await codex.send({ sessionId: session.id, commandId: crypto.randomUUID(), text: 'hello' })
  await until(() => session.status === 'idle')
  assert.equal(requests('thread/resume').length, 1)
  assert.equal(requests('turn/start').length, 2)
})

test('Repeated recovery failures stop after the fifth attempt and manual connect can try again', async (t) => {
  const { host, codex, requests, control, transitions } = setup(t)
  await host.connect()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  control({ initialize: 'exit' })
  process.kill(requests('initialize')[0].pid, 'SIGTERM')
  await until(() => codex.connectionState().status === 'connecting')
  let attempts = 0
  for (const delay of [1000, 2000, 4000, 8000, 16_000]) {
    const previous = transitions.length
    t.mock.timers.tick(delay)
    await until(() => transitions.length >= previous + 2)
    attempts++
    assert.equal(requests('initialize').length, 1 + attempts)
  }
  assert.equal(codex.connectionState().status, 'error')
  t.mock.timers.tick(60_000)
  assert.equal(codex.connectionState().status, 'error')
  control({})
  assert.equal((await host.connect()).status, 'ready')
  assert.equal(requests('initialize').length, 7)
})

test('Disconnect during backoff or a handshake and shutdown cancel recovery and pending probes', async (t) => {
  const { host, codex, control, requests, store } = setup(t)
  await host.connect()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  process.kill(requests('initialize')[0].pid, 'SIGTERM')
  await until(() => codex.connectionState().status === 'connecting')
  host.disconnectAgent('codex')
  assert.ok(!store.settings().connectedAgents.includes('codex'))
  t.mock.timers.tick(60_000)
  await sleep(30)
  assert.equal(requests('initialize').length, 1)
  await host.connect()
  control({ initialize: 'hang' })
  process.kill(requests('initialize')[1].pid, 'SIGTERM')
  await until(() => codex.connectionState().status === 'connecting')
  t.mock.timers.tick(1000)
  await until(() => requests('initialize').length === 3)
  host.disconnectAgent('codex')
  await until(() => exited(requests('initialize')[2].pid))
  t.mock.timers.tick(60_000)
  await sleep(30)
  assert.equal(codex.connectionState().status, 'disconnected')
  assert.equal(requests('initialize').length, 3)

  control({ [usageMethod]: 'ignore-stop' })
  await host.connect()
  const pending = codex.usage()
  await until(() => requests(usageMethod).length === 1)
  const probe = requests(usageMethod)[0].pid
  const main = requests('initialize')[3].pid
  host.disconnectAgent('codex')
  await until(() => exited(main))
  assert.equal((await pending).state, 'unavailable')
  await until(() => exited(probe))
  t.mock.timers.tick(60_000)
  await sleep(30)
  assert.equal(requests('initialize').length, 5)

  await host.connect()
  const shutdownRead = codex.usage()
  await until(() => requests(usageMethod).length === 2)
  host.close()
  assert.equal((await shutdownRead).state, 'unavailable')
  // No further ticks: Electron can exit immediately after host.close().
  await until(() => exited(requests(usageMethod).at(-1).pid))
  t.mock.timers.tick(60_000)
  await sleep(30)
  assert.equal(requests('initialize').length, 7)
})

test('App shutdown during backoff never starts a replacement', async (t) => {
  const { host, codex, requests } = setup(t)
  await host.connect()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  process.kill(requests('initialize')[0].pid, 'SIGTERM')
  await until(() => codex.connectionState().status === 'connecting')
  host.close()
  t.mock.timers.tick(60_000)
  await sleep(30)
  assert.equal(requests('initialize').length, 1)
})
