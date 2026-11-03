import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall
} from '@earendil-works/pi-ai'

const require = createRequire(import.meta.url)
const {
  ClaudeEngine,
  OwlsEngine,
  RouterCredentials,
  RouterService,
  defaultEngineFactory,
  parseReport,
  renderBatch,
  renderState,
  trimContext
} = require('../../out/main/codex/runtime.js')

const PROJECT = { id: 'p1', name: 'demo', path: '/tmp/owls-router-demo' }

/** In-memory stand-in for RouterStore with the same method surface. */
function memoryRouterStore() {
  const routers = new Map()
  const workers = new Map()
  const messages = new Map()
  const credentials = new Map()
  const events = []
  const batches = new Map()
  let seq = 0
  const publicEvent = (e) => ({ ...structuredClone(e.body), seq: e.seq })
  return {
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
    routers: () => [...routers.values()].map((r) => structuredClone(r)),
    saveRouter: (r) => routers.set(r.id, structuredClone(r)),
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
const cipher = {
  unavailable: () => null,
  encrypt: (plain) => Buffer.from(`enc:${plain}`).toString('base64'),
  decrypt: (encoded) => Buffer.from(encoded, 'base64').toString().replace(/^enc:/, '')
}
function commands() {
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
function fakeHost(overrides = {}) {
  const created = []
  const sent = []
  const settings = {
    permission: 'workspace-write',
    provider: 'codex',
    workerProvider: null,
    model: 'gpt-test',
    effort: null,
    claudeModel: null,
    claudeEffort: null,
    router: { engine: 'owls', owls: null, claudeModel: null, maxPermission: 'workspace-write' },
    ...overrides.settings
  }
  return {
    created,
    sent,
    settings,
    host: {
      projects: () => [PROJECT],
      settings: () => settings,
      providerReady: (provider) => (overrides.ready ?? ['codex', 'claude-code']).includes(provider),
      createSession: (input) => {
        const session = { id: crypto.randomUUID(), ...input }
        created.push(session)
        return session
      },
      send: async (input) => {
        sent.push(input)
      }
    }
  }
}
async function waitFor(check, label) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`Timed out waiting for ${label}`)
}
function lastUserText(context) {
  const user = context.messages.findLast((m) => m.role === 'user')
  return typeof user.content === 'string'
    ? user.content
    : user.content.map((c) => c.text ?? '').join('')
}

/** A Router wired to the faux provider; `replies` script the model. */
function harness(replies, options = {}) {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  faux.setResponses(replies)
  const store = options.store ?? memoryRouterStore()
  const events = []
  const { host, created, sent, settings } = options.fake ?? fakeHost(options.host)
  const factory = (request) =>
    new OwlsEngine({
      routerId: request.router.id,
      model: faux.getModel(),
      thinking: 'off',
      streamFn: models.streamSimple.bind(models),
      getApiKey: () => undefined,
      instructions: 'You are a test Router.',
      tools: request.tools,
      history: request.history,
      state: request.state,
      persist: request.persist,
      version: 'test',
      budget: options.budget
    })
  const service = new RouterService(
    store,
    new RouterCredentials(store, cipher),
    options.commands ?? commands(),
    host,
    (event) => events.push(event),
    options.factory ?? factory
  )
  const router = service.open(PROJECT.id)
  const current = () => service.snapshot().routers.find((r) => r.id === router.id)
  return { faux, service, router, current, events, created, sent, settings, store, host }
}

test('message → dispatch → report → reply runs through the Owls engine', async () => {
  const seen = []
  const { service, router, current, created, sent } = harness([
    (context) => {
      seen.push(lastUserText(context))
      assert.deepEqual(
        context.messages.filter((m) => m.role === 'system').length,
        1,
        'only the Router system message is in context'
      )
      return fauxAssistantMessage([fauxToolCall('dispatch_task', { goal: 'Count the files' })], {
        stopReason: 'toolUse'
      })
    },
    (context) => {
      const result = context.messages.findLast((m) => m.role === 'toolResult')
      assert.equal(result.isError, false)
      assert.match(result.content[0].text, /"status":"started"/)
      return fauxAssistantMessage(fauxText('Started a worker to count the files.'))
    },
    (context) => {
      seen.push(lastUserText(context))
      return fauxAssistantMessage(fauxText('The project has 12 files.'))
    }
  ])
  service.send({ routerId: router.id, commandId: crypto.randomUUID(), text: 'How many files?' })
  await waitFor(() => current().status === 'idle' && current().items.length >= 3, 'first batch')
  assert.equal(seen[0], 'How many files?', 'a lone user message is sent as plain text')
  assert.equal(created.length, 1)
  assert.equal(created[0].cwd, PROJECT.path, 'workers run in the Router project')
  assert.equal(created[0].provider, 'codex')
  assert.equal(sent[0].text, 'Count the files')
  const worker = service.snapshot().workers[0]
  assert.equal(worker.status, 'running')
  assert.equal(service.profile(created[0].id).role, 'worker')
  assert.equal(service.profile('unrelated').role, 'task')
  assert.deepEqual(
    current().items.map((i) => i.kind),
    ['user', 'tool', 'assistant']
  )

  service.settled(created[0].id, {
    status: 'completed',
    structured: { status: 'done', summary: '12 files.', artifacts: [] },
    text: ''
  })
  await waitFor(() => current().items.length >= 4 && current().status === 'idle', 'report batch')
  assert.match(seen[1], /<owls-batch id="b_[0-9a-f]+" events="1">/)
  assert.match(seen[1], /worker_report · w_[0-9a-f]+ · .* · done/)
  assert.match(seen[1], /Goal: Count the files\n12 files\./)
  assert.equal(current().items.at(-1).text, 'The project has 12 files.')
  assert.equal(service.snapshot().workers[0].status, 'idle')
  service.close()
})

test('invalid tool arguments and permission limits come back as tool errors', async () => {
  const results = []
  const { service, router, current, created } = harness([
    () =>
      fauxAssistantMessage(
        [
          // pi coerces scalar types to the schema (F18), so use a shape it cannot fix.
          fauxToolCall('dispatch_task', { goal: '   ', extra: true }),
          fauxToolCall('dispatch_task', { goal: 'Deploy', permission: 'full-access' })
        ],
        { stopReason: 'toolUse' }
      ),
    (context) => {
      for (const m of context.messages.filter((m) => m.role === 'toolResult'))
        results.push({ isError: m.isError, text: m.content[0].text })
      return fauxAssistantMessage(fauxText('I could not start those.'))
    }
  ])
  service.send({ routerId: router.id, commandId: crypto.randomUUID(), text: 'Do things' })
  await waitFor(() => current().status === 'idle' && results.length === 2, 'tool errors')
  assert.equal(created.length, 0)
  // pi rejects this shape with its own validation message before Owls sees it.
  assert.equal(results[0].isError, true)
  assert.deepEqual(
    [results[1].isError, JSON.parse(results[1].text).error.code],
    [true, 'permission_not_allowed']
  )
  service.close()
})

test('a repeated dispatch in one batch reuses the worker', async () => {
  const { service, router, current, created } = harness([
    () =>
      fauxAssistantMessage(
        [
          fauxToolCall('dispatch_task', { goal: 'Lint' }),
          fauxToolCall('dispatch_task', { goal: 'Lint' })
        ],
        { stopReason: 'toolUse' }
      ),
    () => fauxAssistantMessage(fauxText('Linting.'))
  ])
  service.send({ routerId: router.id, commandId: crypto.randomUUID(), text: 'Lint it' })
  await waitFor(() => current().status === 'idle' && current().items.length >= 3, 'dedupe batch')
  assert.equal(created.length, 1)
  service.close()
})

test('a disconnected agent and the worker limit are tool errors', async () => {
  const codes = []
  const { service, router, current } = harness(
    [
      () =>
        fauxAssistantMessage(
          [fauxToolCall('dispatch_task', { goal: 'A', provider: 'claude-code' })],
          {
            stopReason: 'toolUse'
          }
        ),
      (context) => {
        codes.push(
          JSON.parse(context.messages.findLast((m) => m.role === 'toolResult').content[0].text)
            .error.code
        )
        return fauxAssistantMessage(fauxText('Claude Code is not connected.'))
      }
    ],
    { host: { ready: ['codex'] } }
  )
  service.send({ routerId: router.id, commandId: crypto.randomUUID(), text: 'Use Claude' })
  await waitFor(() => current().status === 'idle' && codes.length === 1, 'provider error')
  assert.deepEqual(codes, ['provider_unavailable'])
  service.close()
})

test('an unconfigured engine fails the batch and keeps its events', async () => {
  const store = memoryRouterStore()
  const credentials = new RouterCredentials(store, cipher)
  const { service, router, current } = harness([], {
    store,
    factory: defaultEngineFactory({ credentials, claude: null })
  })
  service.send({ routerId: router.id, commandId: crypto.randomUUID(), text: 'Hello' })
  await waitFor(() => current().status === 'failed', 'unconfigured failure')
  assert.equal(current().error.code, 'router_model_unconfigured')
  assert.equal(current().items.length, 1, 'the user message is kept')
  service.close()
})

test('the engine factory refuses to run without a stored key', () => {
  const store = memoryRouterStore()
  const credentials = new RouterCredentials(store, cipher)
  const factory = defaultEngineFactory({
    credentials,
    claude: { sdk: null, connection: () => ({ status: 'disconnected', executablePath: null }) }
  })
  const router = { id: 'r', projectId: 'p', cwd: '/tmp', status: 'idle', items: [] }
  const base = { router, tools: [], history: [], state: () => '', persist: () => {} }
  const owls = { provider: 'anthropic', model: 'claude-sonnet-4-5', thinking: 'off', baseUrl: null }
  assert.equal(
    factory({ ...base, settings: { engine: 'owls', owls: null, maxPermission: 'read-only' } }).code,
    'router_model_unconfigured'
  )
  assert.equal(
    factory({ ...base, settings: { engine: 'owls', owls, maxPermission: 'read-only' } }).code,
    'router_model_unconfigured'
  )
  assert.equal(
    factory({ ...base, settings: { engine: 'claude-code', owls, maxPermission: 'read-only' } })
      .code,
    'claude_not_connected'
  )
  credentials.setKey('anthropic', 'sk-test')
  const engine = factory({
    ...base,
    settings: { engine: 'owls', owls, maxPermission: 'read-only' }
  })
  assert.equal(typeof engine.run, 'function', 'a stored key and known model build an engine')
  const custom = {
    provider: 'custom',
    model: 'llama',
    thinking: 'off',
    baseUrl: 'http://127.0.0.1:11434/v1'
  }
  const local = factory({
    ...base,
    settings: { engine: 'owls', owls: custom, maxPermission: 'read-only' }
  })
  assert.equal(typeof local.run, 'function', 'a keyless custom endpoint builds an engine')
})

test('credentials are encrypted at rest and refused without secure storage', () => {
  const store = memoryRouterStore()
  const credentials = new RouterCredentials(store, cipher)
  credentials.setKey('openai', 'sk-secret')
  assert.notEqual(store.credential('openai').secret, 'sk-secret')
  assert.equal(credentials.key('openai'), 'sk-secret')
  assert.deepEqual(credentials.configured(), ['openai'])
  credentials.remove('openai')
  assert.equal(credentials.key('openai'), null)
  const locked = new RouterCredentials(store, { ...cipher, unavailable: () => 'No keychain.' })
  assert.throws(
    () => locked.setKey('openai', 'sk'),
    (error) => error.code === 'secure_storage_unavailable'
  )
})

test('the transcript persists and restores without a duplicate system message', async () => {
  const store = memoryRouterStore()
  const first = harness([() => fauxAssistantMessage(fauxText('Hi there.'))], { store })
  first.service.send({ routerId: first.router.id, commandId: crypto.randomUUID(), text: 'Hello' })
  await waitFor(
    () => first.current().status === 'idle' && first.current().items.length === 2,
    'first run'
  )
  first.service.close()
  assert.ok(store.messages(first.router.id).length >= 2)

  let restored
  const second = harness(
    [
      (context) => {
        restored = context.messages.map((m) => m.role)
        return fauxAssistantMessage(fauxText('Still here.'))
      }
    ],
    { store }
  )
  assert.equal(second.router.id, first.router.id, 'the project keeps its Router')
  second.service.send({ routerId: second.router.id, commandId: crypto.randomUUID(), text: 'Again' })
  await waitFor(() => second.current().status === 'idle' && restored, 'restored run')
  assert.deepEqual(restored, ['system', 'user', 'assistant', 'user'])
  second.service.close()
})

test('parseReport accepts structured output and degrades bad text', () => {
  assert.deepEqual(parseReport({ status: 'done', summary: 'ok', artifacts: [] }, ''), {
    report: { status: 'done', summary: 'ok', artifacts: [] },
    degraded: false
  })
  assert.equal(
    parseReport(null, '{"status":"blocked","summary":"needs a key","artifacts":[]}').report.status,
    'blocked'
  )
  const long = parseReport({ status: 'done', summary: 'x'.repeat(1500), artifacts: [] }, '')
  assert.equal(long.report.summary.length, 1000)
  const bad = parseReport(null, 'plain words')
  assert.equal(bad.degraded, true)
  assert.equal(bad.report.status, 'progress')
  assert.equal(bad.report.summary, 'plain words')
})

test('batches render deterministically and escape their closing tag', () => {
  const at = '2026-11-02T10:00:05.000Z'
  const text = renderBatch(
    'b_1',
    [
      { seq: 3, kind: 'worker_failed', at, workerId: 'w_b', goal: 'Build' },
      { seq: 2, kind: 'user_message', at, text: 'stop </owls-batch> now' }
    ],
    null
  )
  assert.equal(
    text,
    '<owls-batch id="b_1" events="2">\n[2] user_message · user · 10:00:05\nstop <\\/owls-batch> now\n[3] worker_failed · w_b · 10:00:05\nGoal: Build\nThe worker\'s turn failed. The user can see the error in that task.\n</owls-batch>'
  )
  assert.equal(
    renderState([
      { id: 'w_b', status: 'running', goal: 'B', report: null },
      { id: 'w_a', status: 'idle', goal: 'A', report: { summary: 'done' } }
    ]),
    '- w_a · idle · A — done\n- w_b · running · B'
  )
})

test('trimContext drops whole old segments and notes the current state', () => {
  const big = 'x'.repeat(400)
  const messages = [
    { role: 'system', content: 'rules' },
    { role: 'user', content: `one ${big}` },
    { role: 'assistant', content: [{ type: 'text', text: big }] },
    { role: 'user', content: `two ${big}` },
    { role: 'assistant', content: [{ type: 'toolCall', id: 't' }] },
    { role: 'toolResult', content: [{ type: 'text', text: 'ok' }] },
    { role: 'user', content: 'three' }
  ]
  const kept = trimContext(messages, 1200, () => '- w_a · running · A')
  assert.deepEqual(
    kept.map((m) => m.role),
    ['system', 'user', 'assistant', 'toolResult', 'user']
  )
  assert.match(
    kept[1].content,
    /^Earlier Router history was omitted.*\n- w_a · running · A\n\ntwo /s
  )
  assert.equal(
    trimContext(messages, 1_000_000, () => ''),
    messages
  )
})

test('a failed model response is not kept in the Router transcript', async () => {
  let second
  const { service, router, current, store } = harness([
    () => fauxAssistantMessage([], { stopReason: 'error', errorMessage: '401 Unauthorized' }),
    (context) => {
      second = context.messages.map((m) => m.role)
      return fauxAssistantMessage(fauxText('Back online.'))
    }
  ])
  service.send({ routerId: router.id, commandId: crypto.randomUUID(), text: 'First' })
  await waitFor(() => current().status === 'failed', 'failed batch')
  assert.equal(current().error.code, 'router_auth_failed')
  assert.deepEqual(
    store.messages(router.id).map((m) => m.role),
    ['user'],
    'the failed assistant message is dropped'
  )
  service.send({ routerId: router.id, commandId: crypto.randomUUID(), text: 'Second' })
  await waitFor(() => current().status === 'idle' && second, 'recovered batch')
  assert.deepEqual(second, ['system', 'user', 'user'])
  service.close()
})

/** A RouterEngine whose batches the test drives. `hold` keeps a batch running until released. */
function scriptedEngine() {
  const engine = {
    runs: [],
    steered: [],
    tools: [],
    hold: false,
    running: false,
    native: { engine: 'owls' },
    onRun: null,
    release: null,
    async run(input, sink) {
      engine.runs.push(input)
      engine.running = true
      if (engine.onRun) await engine.onRun(input, engine.tools)
      if (engine.hold) await new Promise((resolve) => (engine.release = resolve))
      engine.running = false
      sink.item({
        id: `reply-${engine.runs.length}`,
        kind: 'assistant',
        status: 'completed',
        text: 'ok',
        detail: '',
        turnId: input.batchId
      })
      return { status: 'completed', error: null, native: engine.native }
    },
    steer(text) {
      if (!engine.running) return 'not_running'
      engine.steered.push(text)
      return 'steered'
    },
    abort() {}
  }
  const factory = (request) => {
    engine.tools = request.tools
    return engine
  }
  return { engine, factory }
}
const send = (service, router, text) =>
  service.send({ routerId: router.id, commandId: crypto.randomUUID(), text })
const report = (summary) => ({
  status: 'completed',
  structured: { status: 'done', summary, artifacts: [] },
  text: ''
})

test('the Inbox persists events and records each batch', async () => {
  const { engine, factory } = scriptedEngine()
  const { service, router, current, store } = harness([], { factory })
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length === 1) await tools[0].execute({ goal: 'Lint' })
  }
  send(service, router, 'Lint please')
  await waitFor(() => engine.runs.length === 1 && current().status === 'idle', 'first batch')
  const [first] = store.batches('delivered')
  assert.equal(first.engine, 'owls')
  assert.equal(first.promptVersion, 1)
  assert.deepEqual(
    first.eventSeqs,
    store
      .allEvents()
      .filter((e) => e.kind === 'user_message')
      .map((e) => e.seq)
  )
  assert.equal(engine.runs[0].text, 'Lint please')
  const worker = service.snapshot().workers[0]
  service.settled(worker.sessionId, report('Clean.'))
  await waitFor(() => engine.runs.length === 2, 'report batch')
  assert.match(engine.runs[1].text, /worker_report · w_[0-9a-f]+ .* · done\nGoal: Lint\nClean\./)
  assert.deepEqual(
    store.allEvents().map((e) => [e.kind, e.status]),
    [
      ['user_message', 'batched'],
      ['worker_report', 'batched']
    ]
  )
  service.close()
})

test('backlogged reports go out in one batch and newer reports supersede older ones', async () => {
  const { engine, factory } = scriptedEngine()
  const { service, router, current, store } = harness([], { factory })
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length !== 1) return
    await tools[0].execute({ goal: 'A', permission: 'read-only' })
    await tools[0].execute({ goal: 'B', permission: 'read-only' })
  }
  engine.hold = true
  send(service, router, 'Do A and B')
  await waitFor(() => engine.runs.length === 1 && engine.release, 'held batch')
  const [b, a] = service.snapshot().workers
  service.settled(a.sessionId, report('A first try.'))
  service.settled(a.sessionId, report('A done.'))
  service.settled(b.sessionId, report('B done.'))
  engine.hold = false
  engine.release()
  await waitFor(() => engine.runs.length === 2 && current().status === 'idle', 'merged batch')
  const text = engine.runs[1].text
  assert.match(text, /events="2"/)
  assert.match(text, /A done\./)
  assert.doesNotMatch(text, /A first try/)
  assert.match(text, /B done\./)
  assert.deepEqual(
    store
      .allEvents()
      .filter((e) => e.kind === 'worker_report')
      .map((e) => e.status),
    ['superseded', 'batched', 'batched']
  )
  service.close()
})

test('a user message during a batch is steered in and recorded with that batch', async () => {
  const { engine, factory } = scriptedEngine()
  const { service, router, current, store } = harness([], { factory })
  engine.hold = true
  send(service, router, 'First')
  await waitFor(() => engine.release, 'held batch')
  send(service, router, 'Also this')
  assert.deepEqual(engine.steered, ['Also this'])
  engine.hold = false
  engine.release()
  await waitFor(() => current().status === 'idle', 'batch end')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(engine.runs.length, 1, 'a steered message does not start another batch')
  const [batch] = store.batches('delivered')
  assert.equal(batch.eventSeqs.length, 2)
  assert.deepEqual(
    store.allEvents().map((e) => [e.status, e.batchId]),
    [
      ['batched', batch.id],
      ['batched', batch.id]
    ]
  )
  service.close()
})

test('restart marks an unfinished batch dispatch_unknown and recovers stopped workers', async () => {
  const store = memoryRouterStore()
  const first = scriptedEngine()
  const one = harness([], { store, factory: first.factory })
  first.engine.onRun = async (_input, tools) => {
    if (first.engine.runs.length === 1) await tools[0].execute({ goal: 'Long job' })
  }
  first.engine.hold = true
  send(one.service, one.router, 'Start the long job')
  await waitFor(() => first.engine.release, 'held batch')
  // The app dies here: the batch never finishes and the worker is still running.

  const second = scriptedEngine()
  const two = harness([], { store, factory: second.factory })
  const router = two.current()
  assert.equal(router.status, 'interrupted')
  assert.equal(router.unknownBatches.length, 1)
  assert.equal(router.unknownBatches[0].events, 1)
  assert.equal(two.service.snapshot().workers[0].status, 'stopped')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(second.engine.runs.length, 0, 'recovery does not start a batch by itself')

  two.service.resolveBatch({
    routerId: router.id,
    batchId: router.unknownBatches[0].id,
    decision: 'retry'
  })
  await waitFor(() => second.engine.runs.length === 1, 'retried batch')
  const text = second.engine.runs[0].text
  assert.match(text, /user_message · user .*\nStart the long job/)
  assert.match(
    text,
    /worker_stopped · w_[0-9a-f]+ .*\nGoal: Long job\nThe worker was stopped before it reported\./
  )
  assert.equal(two.current().unknownBatches.length, 0)
  assert.equal(store.batches('retried').length, 1)
  assert.throws(
    () =>
      two.service.resolveBatch({ routerId: router.id, batchId: 'b_missing', decision: 'ignore' }),
    (error) => error.code === 'request_unavailable'
  )
  two.service.close()
})

test('workers beyond the limit or a busy writer queue and start in order', async () => {
  const { engine, factory } = scriptedEngine()
  const { service, router, current, sent } = harness([], { factory })
  const results = []
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length !== 1) return
    for (const goal of ['Write A', 'Write B'])
      results.push(JSON.parse(await tools[0].execute({ goal })).status)
    results.push(
      JSON.parse(await tools[0].execute({ goal: 'Read C', permission: 'read-only' })).status
    )
  }
  send(service, router, 'Three things')
  await waitFor(() => current().status === 'idle' && results.length === 3, 'dispatches')
  assert.deepEqual(results, ['started', 'queued', 'started'], 'one writer per checkout')
  assert.deepEqual(
    sent.map((s) => s.text),
    ['Write A', 'Read C']
  )
  const byGoal = (goal) => service.snapshot().workers.find((w) => w.goal === goal)
  assert.equal(byGoal('Write B').status, 'queued')
  service.settled(byGoal('Write A').sessionId, report('A written.'))
  await waitFor(() => sent.length === 3, 'queued start')
  assert.equal(sent[2].text, 'Write B')
  await waitFor(() => byGoal('Write B').status === 'running', 'queued worker runs')
  service.close()
})

test('removing a worker task drops its pending events and tells the Router', async () => {
  const { engine, factory } = scriptedEngine()
  const { service, router, current, store } = harness([], { factory })
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length === 1) await tools[0].execute({ goal: 'Doomed' })
  }
  engine.hold = false
  send(service, router, 'Go')
  await waitFor(() => current().status === 'idle' && service.snapshot().workers.length, 'dispatch')
  const worker = service.snapshot().workers[0]
  engine.hold = true
  send(service, router, 'Hold the Router')
  await waitFor(() => engine.release, 'held batch')
  service.settled(worker.sessionId, report('Half done.'))
  service.observe({ type: 'removed', sessionId: worker.sessionId })
  assert.equal(service.snapshot().workers[0].status, 'removed')
  assert.equal(service.profile(worker.sessionId).role, 'task')
  engine.hold = false
  engine.release()
  await waitFor(() => engine.runs.length === 3, 'removal batch')
  assert.match(engine.runs[2].text, /worker_removed · w_[0-9a-f]+/)
  assert.doesNotMatch(engine.runs[2].text, /Half done/)
  assert.ok(store.allEvents().some((e) => e.kind === 'worker_report' && e.status === 'dropped'))
  service.close()
})

test('switching engines starts the new engine with the worker state', async () => {
  const { engine, factory } = scriptedEngine()
  const { service, router, current, settings } = harness([], { factory })
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length === 1) await tools[0].execute({ goal: 'Index the docs' })
  }
  send(service, router, 'Index the docs')
  await waitFor(() => current().status === 'idle' && engine.runs.length === 1, 'owls batch')
  assert.deepEqual(current().native, { engine: 'owls' })
  settings.router = { ...settings.router, engine: 'claude-code' }
  service.settingsChanged()
  engine.native = { engine: 'claude-code', sessionId: 'claude-1' }
  send(service, router, 'How is it going?')
  await waitFor(() => engine.runs.length === 2 && current().status === 'idle', 'claude batch')
  assert.match(
    engine.runs[1].text,
    /^<owls-batch id="b_[0-9a-f]+" events="1">\nCurrent workers:\n- w_[0-9a-f]+ · running · Index the docs/
  )
  assert.deepEqual(current().native, { engine: 'claude-code', sessionId: 'claude-1' })
  send(service, router, 'And now?')
  await waitFor(() => engine.runs.length === 3, 'resumed claude batch')
  assert.equal(engine.runs[2].text, 'And now?', 'a resumed session gets no state again')
  assert.deepEqual(engine.runs[2].native, { engine: 'claude-code', sessionId: 'claude-1' })
  service.close()
})

/** A scripted Agent SDK for the Claude Code engine. Each script yields messages for one query. */
function fakeClaudeSdk(scripts) {
  const calls = []
  return {
    calls,
    createSdkMcpServer: (options) => ({ type: 'sdk', name: options.name, options }),
    query({ prompt, options }) {
      const script = scripts[calls.length]
      const call = { options, inputs: [] }
      calls.push(call)
      const iterator = prompt[Symbol.asyncIterator]()
      const next = async () => {
        const { value, done } = await iterator.next()
        if (!done) call.inputs.push(value.message.content)
        return done ? null : value.message.content
      }
      const generator = script({ options, next, call })
      generator.interrupt = async () => {}
      return generator
    }
  }
}
const claudeInit = (id) => ({ type: 'system', subtype: 'init', session_id: id })
const claudeResult = (extra = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '',
  usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 5 },
  ...extra
})
const claudeText = (id, text) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id, content: [{ type: 'text', text }] }
})

test('the Claude Code engine runs isolated, calls Owls tools, and resumes its session', async () => {
  const sdk = fakeClaudeSdk([
    async function* ({ options, next }) {
      await next()
      yield claudeInit('router-session-1')
      yield {
        type: 'stream_event',
        parent_tool_use_id: null,
        event: { type: 'message_start', message: { id: 'm1' } }
      }
      yield {
        type: 'stream_event',
        parent_tool_use_id: null,
        event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } }
      }
      yield {
        type: 'stream_event',
        parent_tool_use_id: null,
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'On it' }
        }
      }
      yield {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          id: 'm1',
          content: [
            { type: 'text', text: 'On it.' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'mcp__owls__dispatch_task',
              input: { goal: 'Count files' }
            }
          ]
        }
      }
      const tool = options.mcpServers.owls.options.tools[0]
      const result = await tool.handler({ goal: 'Count files' })
      const bad = await tool.handler({ goal: '' })
      yield {
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: result.content,
              is_error: result.isError === true
            }
          ]
        }
      }
      yield claudeText('m2', `bad:${bad.isError}`)
      yield claudeResult()
    },
    async function* ({ next }) {
      await next()
      yield claudeInit('router-session-1')
      yield claudeText('m3', 'Still counting.')
      yield claudeResult()
    }
  ])
  const factory = defaultEngineFactory({
    credentials: null,
    claude: {
      sdk,
      connection: () => ({ status: 'ready', executablePath: '/usr/local/bin/claude' })
    }
  })
  const { service, router, current, created } = harness([], {
    factory,
    host: {
      settings: {
        router: {
          engine: 'claude-code',
          owls: null,
          claudeModel: 'opus',
          maxPermission: 'workspace-write'
        }
      }
    }
  })
  send(service, router, 'Count the files')
  await waitFor(() => current().status === 'idle' && current().items.length >= 4, 'claude batch')
  const { options } = sdk.calls[0]
  assert.deepEqual(options.tools, [])
  assert.deepEqual(options.settingSources, [])
  assert.equal(options.strictMcpConfig, true)
  assert.deepEqual(options.allowedTools, ['mcp__owls__dispatch_task'])
  assert.deepEqual(Object.keys(options.mcpServers), ['owls'])
  assert.equal(options.mcpServers.owls.options.alwaysLoad, true)
  assert.equal(typeof options.systemPrompt, 'string')
  assert.equal(options.cwd, PROJECT.path, 'the model sees the directory workers run in')
  assert.equal(options.permissionMode, 'dontAsk')
  assert.equal(options.canUseTool, undefined)
  assert.equal(options.model, 'opus')
  assert.equal(options.resume, undefined)
  assert.equal(created.length, 1)
  assert.equal(created[0].cwd, PROJECT.path)
  assert.deepEqual(
    current().items.map((i) => [i.kind, i.text]),
    [
      ['user', 'Count the files'],
      ['assistant', 'On it.'],
      ['tool', 'dispatch_task'],
      ['assistant', 'bad:true']
    ]
  )
  assert.equal(current().items[2].status, 'completed')
  assert.match(current().items[2].detail, /"status":"started"/)
  assert.deepEqual(current().native, { engine: 'claude-code', sessionId: 'router-session-1' })
  assert.equal(current().tokens, 10)

  send(service, router, 'Any news?')
  await waitFor(
    () => sdk.calls.length === 2 && current().status === 'idle' && current().items.length >= 6,
    'resume'
  )
  assert.equal(sdk.calls[1].options.resume, 'router-session-1')
  assert.deepEqual(sdk.calls[1].inputs, ['Any news?'])
  service.close()
})

test('the Claude Code engine folds steered messages in and drops a lost session', async () => {
  let release
  const gate = new Promise((resolve) => (release = resolve))
  const sdk = fakeClaudeSdk([
    async function* ({ next }) {
      await next()
      yield claudeInit('s-1')
      await gate
      const steered = await next()
      yield claudeText('m1', `heard: ${steered}`)
      yield claudeResult()
    },
    async function* ({ next }) {
      await next()
      yield claudeResult({
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['No conversation found with session ID: s-1']
      })
    }
  ])
  const engine = new ClaudeEngine({
    sdk,
    executable: '/bin/claude',
    cwd: '/tmp',
    model: null,
    instructions: 'Route.',
    tools: [],
    version: 'test'
  })
  const items = []
  const sink = { item: (item) => items.push(item), usage: () => {} }
  const running = engine.run({ batchId: 'b_1', text: 'First', native: null }, sink)
  await waitFor(() => sdk.calls.length === 1 && sdk.calls[0].inputs.length === 1, 'first input')
  assert.equal(engine.steer('Second'), 'steered')
  release()
  const outcome = await running
  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.native, { engine: 'claude-code', sessionId: 's-1' })
  assert.equal(items.at(-1).text, 'heard: Second')
  assert.equal(engine.steer('Late'), 'not_running')

  const lost = await engine.run({ batchId: 'b_2', text: 'Again', native: outcome.native }, sink)
  assert.equal(sdk.calls[1].options.resume, 's-1')
  assert.equal(lost.status, 'failed')
  assert.deepEqual(
    lost.native,
    { engine: 'claude-code', sessionId: null },
    'next batch starts fresh'
  )
})
