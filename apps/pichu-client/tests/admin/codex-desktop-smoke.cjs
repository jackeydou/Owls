const assert = require('node:assert/strict')
const { chmodSync, mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { app } = require('electron')
const { CodexService, CodexStore } = require('../../out/main/codex/runtime.js')

app
  .whenReady()
  .then(async () => {
    const temp = mkdtempSync(join(tmpdir(), 'owls-codex-smoke-'))
    const fixture = resolve(__dirname, '../fixtures/codex/mock-codex.cjs')
    chmodSync(fixture, 0o755)
    let host
    let reopened
    try {
      const database = join(temp, 'test.db')
      const migrations = resolve(__dirname, '../../drizzle-codex')
      const store = new CodexStore(database, migrations)
      store.saveSettings({ ...store.settings(), executablePath: fixture })
      let wake = () => {}
      host = new CodexService(store, () => wake())
      assert.equal((await host.connect()).status, 'ready')
      assert.equal(host.snapshot().connection.account.kind, 'chatgpt')
      const project = host.addProject(temp)
      const session = host.createSession({
        cwd: project.path,
        model: 'fixture-model',
        effort: 'medium',
        permission: 'workspace-write'
      })
      const until = async (predicate) => {
        const deadline = Date.now() + 5000
        while (!predicate()) {
          assert.ok(Date.now() < deadline, 'Timed out waiting for a persisted state')
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 20)
            wake = () => {
              clearTimeout(timer)
              resolve()
            }
          })
        }
      }
      const state = () => host.snapshot().sessions.find((s) => s.id === session.id)
      const commandId = crypto.randomUUID()
      await host.send({ sessionId: session.id, commandId, text: 'hello' })
      await until(() => state().status === 'idle')
      assert.equal(state().items.filter((i) => i.kind === 'user').length, 1)
      assert.equal(state().items.find((i) => i.kind === 'assistant').text, 'hello world')
      await host.send({ sessionId: session.id, commandId, text: 'hello' })
      assert.equal(state().items.filter((i) => i.kind === 'user').length, 1)
      await host.send({ sessionId: session.id, commandId: crypto.randomUUID(), text: 'approval' })
      await until(() => state().status === 'waiting')
      const request = state().requests.find((r) => r.status === 'pending')
      assert.ok(request)
      host.respond({ sessionId: session.id, requestId: request.id, decision: 'decline' })
      await until(() => state().status === 'idle')
      assert.throws(
        () => host.respond({ sessionId: session.id, requestId: request.id, decision: 'accept' }),
        /no longer available/
      )
      await host.send({ sessionId: session.id, commandId: crypto.randomUUID(), text: 'long' })
      await until(() => state().status === 'running')
      await host.interrupt(session.id)
      await until(() => state().status === 'interrupted')
      await host.send({ sessionId: session.id, commandId: crypto.randomUUID(), text: 'approval' })
      await until(() => state().status === 'waiting')
      const staleRequest = state().requests.find((r) => r.status === 'pending')
      const nativeThreadId = state().threadId
      host.close()
      host = null
      reopened = new CodexService(new CodexStore(database, migrations), () => {})
      assert.equal(reopened.snapshot().sessions[0].items.filter((i) => i.kind === 'user').length, 4)
      assert.equal(reopened.snapshot().sessions[0].status, 'interrupted')
      assert.equal(reopened.snapshot().sessions[0].error.code, 'disconnected')
      assert.equal(reopened.snapshot().sessions[0].requests.at(-1).status, 'unavailable')
      assert.equal(reopened.snapshot().connection.status, 'disconnected')
      assert.throws(
        () =>
          reopened.respond({
            sessionId: session.id,
            requestId: staleRequest.id,
            decision: 'accept'
          }),
        (error) => error.code === 'request_unavailable'
      )
      await reopened.connect()
      await reopened.send({ sessionId: session.id, commandId: crypto.randomUUID(), text: 'hello' })
      await until(() => reopened.snapshot().sessions[0].status === 'idle')
      assert.equal(reopened.snapshot().sessions[0].threadId, nativeThreadId)
      console.log(
        'PASS: account reuse, fresh SQLite schema, streaming, deduplication, approval, interruption, persistence'
      )
    } finally {
      host?.close()
      reopened?.close()
      rmSync(temp, { recursive: true, force: true })
    }
    app.exit(0)
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
