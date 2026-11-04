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
  CodexEngine,
  CodexRouterServer,
  codexRouterArgs,
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
  const steered = []
  const interrupted = []
  const turns = { profiles: null, running: new Set() }
  const settings = {
    permission: 'workspace-write',
    provider: 'codex',
    workerProvider: null,
    model: 'gpt-test',
    effort: null,
    claudeModel: null,
    claudeEffort: null,
    router: {
      engine: 'owls',
      owls: null,
      claudeModel: null,
      codexModel: null,
      maxPermission: 'workspace-write'
    },
    ...overrides.settings
  }
  return {
    created,
    sent,
    steered,
    interrupted,
    turns,
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
      // Like the task services, ask for the turn profile as each turn starts.
      send: async (input) => {
        turns.profiles?.profile(input.sessionId)
        turns.running.add(input.sessionId)
        sent.push(input)
      },
      steer: async (sessionId, text) => {
        if (!turns.running.has(sessionId)) return 'not_running'
        steered.push({ sessionId, text })
        return 'steered'
      },
      interrupt: async (sessionId) => {
        interrupted.push(sessionId)
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
  const fake = options.fake ?? fakeHost(options.host)
  const { host, created, sent, settings } = fake
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
  fake.turns.profiles = service
  const router = service.open(PROJECT.id)
  const current = () => service.snapshot().routers.find((r) => r.id === router.id)
  return { faux, service, router, current, events, created, sent, settings, store, host, fake }
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
    claude: { sdk: null, connection: () => ({ status: 'disconnected', executablePath: null }) },
    codex: {
      server: null,
      connection: () => ({ status: 'ready', executablePath: null, account: { kind: 'signed-out' } })
    }
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
  assert.equal(
    factory({ ...base, settings: { engine: 'codex', owls, maxPermission: 'read-only' } }).code,
    'not_connected',
    'a signed-out Codex cannot run the Router'
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
  assert.equal(first.promptVersion, 2)
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
  assert.deepEqual(options.allowedTools, [
    'mcp__owls__dispatch_task',
    'mcp__owls__list_workers',
    'mcp__owls__message_worker',
    'mcp__owls__recall',
    'mcp__owls__stop_worker'
  ])
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
  assert.equal(await engine.steer('Second'), 'steered')
  release()
  const outcome = await running
  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.native, { engine: 'claude-code', sessionId: 's-1' })
  assert.equal(items.at(-1).text, 'heard: Second')
  assert.equal(await engine.steer('Late'), 'not_running')

  const lost = await engine.run({ batchId: 'b_2', text: 'Again', native: outcome.native }, sink)
  assert.equal(sdk.calls[1].options.resume, 's-1')
  assert.equal(lost.status, 'failed')
  assert.deepEqual(
    lost.native,
    { engine: 'claude-code', sessionId: null },
    'next batch starts fresh'
  )
})

/** Runs one batch whose engine calls `script(tools)` and returns the parsed tool results. */
async function withTools(script, options = {}) {
  const { engine, factory } = scriptedEngine()
  const h = harness([], { factory, ...options })
  const results = []
  engine.onRun = async (_input, tools) => {
    const call = async (name, args) => {
      try {
        return JSON.parse(await tools.find((t) => t.name === name).execute(args))
      } catch (error) {
        return JSON.parse(
          error.message.startsWith('{')
            ? error.message
            : JSON.stringify({ error: { code: error.code } })
        )
      }
    }
    if (engine.runs.length === 1) results.push(...(await script(call, h)))
  }
  send(h.service, h.router, 'go')
  await waitFor(() => engine.runs.length >= 1 && h.current().status === 'idle', 'tool batch')
  return { ...h, engine, results }
}

test('the Router sees its tools in a fixed order', async () => {
  const { engine, service } = await withTools(async () => [])
  assert.deepEqual(
    engine.tools.map((t) => t.name),
    ['dispatch_task', 'list_workers', 'message_worker', 'recall', 'stop_worker']
  )
  service.close()
})

test('message_worker steers a running worker and starts a new turn for an idle one', async () => {
  const { service, results, fake, sent } = await withTools(async (call, h) => {
    const { workerId } = await call('dispatch_task', { goal: 'Fix the bug' })
    const running = await call('message_worker', { workerId, text: 'Also add a test.' })
    const worker = h.service.snapshot().workers[0]
    h.fake.turns.running.delete(worker.sessionId)
    h.service.settled(worker.sessionId, report('Fixed.'))
    const idle = await call('message_worker', { workerId, text: 'Now update the docs.' })
    const missing = await call('message_worker', { workerId: 'w_nope', text: 'Hi' })
    return [running, idle, missing]
  })
  assert.deepEqual(results[0], { delivered: 'steered' })
  assert.deepEqual(
    fake.steered.map((s) => s.text),
    ['Also add a test.']
  )
  assert.deepEqual(results[1], { delivered: 'started' })
  assert.equal(sent.at(-1).text, 'Now update the docs.')
  assert.equal(results[2].error.code, 'worker_not_found')
  assert.equal(service.snapshot().workers[0].status, 'running')
  service.close()
})

test('a follow-up for a busy writer waits in the queue and a removed worker is closed', async () => {
  const { service, results, sent } = await withTools(async (call, h) => {
    const a = await call('dispatch_task', { goal: 'Write A' })
    const b = await call('dispatch_task', { goal: 'Write B' })
    const queued = await call('message_worker', { workerId: b.workerId, text: 'Use tabs.' })
    const worker = h.service.snapshot().workers.find((w) => w.id === a.workerId)
    h.service.observe({ type: 'removed', sessionId: worker.sessionId })
    const closed = await call('message_worker', { workerId: a.workerId, text: 'Hello?' })
    return [b, queued, closed]
  })
  assert.equal(results[0].status, 'queued')
  assert.deepEqual(results[1], { delivered: 'queued' })
  assert.equal(results[2].error.code, 'worker_closed')
  // Removing A frees the checkout, so B starts with its goal and the follow-up together.
  await waitFor(() => sent.length === 2, 'queued start')
  assert.equal(sent[1].text, 'Write B\n\nUse tabs.')
  service.close()
})

test('stop_worker interrupts a running worker without a new batch and cancels a queued one', async () => {
  const { service, results, fake, engine, current } = await withTools(async (call) => {
    const a = await call('dispatch_task', { goal: 'Long A' })
    const b = await call('dispatch_task', { goal: 'Long B' })
    return [
      await call('stop_worker', { workerId: a.workerId }),
      await call('stop_worker', { workerId: b.workerId }),
      a,
      b
    ]
  })
  assert.deepEqual(results.slice(0, 2), [{ status: 'stopping' }, { status: 'cancelled' }])
  const a = service.snapshot().workers.find((w) => w.id === results[2].workerId)
  assert.deepEqual(fake.interrupted, [a.sessionId])
  service.settled(a.sessionId, { status: 'interrupted', structured: null, text: '' })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(engine.runs.length, 1, 'a stop the Router asked for does not start a batch')
  assert.equal(
    service.snapshot().workers.find((w) => w.id === results[3].workerId).status,
    'stopped'
  )
  assert.equal(current().status, 'idle')
  service.close()
})

test('list_workers and recall describe workers, events, and batches', async () => {
  const long = `${'x'.repeat(8100)}END`
  const { service, results, store, router } = await withTools(async (call, h) => {
    const { workerId } = await call('dispatch_task', {
      goal: 'Summarize',
      context: 'c'.repeat(5000),
      permission: 'read-only'
    })
    const worker = h.service.snapshot().workers[0]
    h.service.settled(worker.sessionId, report('s'.repeat(900)))
    return [
      await call('list_workers', {}),
      await call('recall', { id: workerId }),
      await call('recall', { id: 'w_other' })
    ]
  })
  const [list, worker, missing] = results
  assert.equal(list.workers.length, 1)
  assert.equal(list.workers[0].report.summary.length, 300)
  assert.equal(worker.context.text.length, 4000)
  assert.equal(worker.context.next, `${worker.id}@4000`)
  assert.equal(missing.error.code, 'not_found')
  // A long user message is cut in the batch and readable through recall.
  const { engine, factory } = scriptedEngine()
  const h = harness([], { factory, store })
  const recalled = []
  engine.onRun = async (input, tools) => {
    const recall = tools.find((t) => t.name === 'recall')
    const id = /recall: (ev_\d+)/.exec(input.text)?.[1]
    if (!id) return
    const first = JSON.parse(await recall.execute({ id }))
    const second = JSON.parse(await recall.execute({ id: first.next }))
    const batch = JSON.parse(await recall.execute({ id: input.batchId }))
    recalled.push(first, second, batch)
  }
  send(h.service, h.router, long)
  await waitFor(() => recalled.length === 3, 'recall batch')
  assert.match(engine.runs[0].text, /x… \(truncated, recall: ev_\d+\)$/)
  assert.equal(recalled[0].kind, 'user_message')
  assert.equal(recalled[0].text.length, 4000)
  assert.ok(recalled[1].text.startsWith('x'))
  assert.equal(recalled[1].next, `${recalled[0].id}@8000`)
  assert.equal(recalled[2].status, 'sending')
  assert.ok(recalled[2].events.includes(recalled[0].id))
  assert.equal(h.router.id, router.id)
  service.close()
  h.service.close()
})

test('a follow-up the user runs in a worker task reaches the Router without a batch', async () => {
  const { service, router, engine, current, sent } = await withTools(async (call) => [
    await call('dispatch_task', { goal: 'Draft the README' })
  ])
  const worker = service.snapshot().workers[0]
  service.settled(worker.sessionId, report('Drafted.'))
  await waitFor(() => engine.runs.length === 2 && current().status === 'idle', 'report batch')
  // The user asks the worker directly: a turn the Router did not start.
  service.observe({
    type: 'session',
    session: { id: worker.sessionId, status: 'running', requests: [] }
  })
  service.settled(worker.sessionId, report('Added a badge.'))
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(engine.runs.length, 2, 'no batch for the follow-up')
  send(service, router, 'Status?')
  await waitFor(() => engine.runs.length === 3, 'next batch')
  assert.match(
    engine.runs[2].text,
    /worker_report · w_[0-9a-f]+ · .* · done · follow-up\nGoal: Draft the README\nAdded a badge\./
  )
  assert.equal(sent.length, 1)
  service.close()
})

/** A scripted Codex app-server pair: the config probe and the Router process. */
function fakeCodex(script) {
  const launches = []
  const requests = []
  const closes = []
  // The MCP servers the config shows; a test can add one later.
  const servers = { pencil: {}, node_repl: {} }
  let onFrame = null
  const launch = async (_executable, options, frame, close) => {
    launches.push(options)
    const index = launches.length
    if (options.args.length) {
      onFrame = frame
      closes.push(close)
    }
    return {
      request: async (method, params) => {
        requests.push({ process: index, method, params })
        if (method === 'config/read') return { config: { mcp_servers: { ...servers } } }
        return script(method, params, (f) => onFrame(f))
      },
      respond: (id, result) =>
        requests.push({ process: index, method: 'respond', id, params: result }),
      reject: (id) => requests.push({ process: index, method: 'reject', id }),
      stop: () => requests.push({ process: index, method: 'stop' })
    }
  }
  return { launch, launches, requests, closes, servers }
}

test('the Codex engine runs a locked-down thread, answers tool calls, and resumes', async () => {
  let threads = 0
  const codex = fakeCodex((method, params, emit) => {
    if (method === 'thread/start') return { thread: { id: `thread-${++threads}` } }
    if (method === 'thread/resume') {
      if (params.threadId === 'thread-gone') throw new Error('no rollout found')
      return {}
    }
    if (method === 'turn/start') {
      const threadId = params.threadId
      const turnId = `turn-${params.input[0].text.length}`
      queueMicrotask(() => {
        emit({ method: 'turn/started', params: { threadId, turn: { id: turnId } } })
        emit({
          id: 7,
          method: 'item/tool/call',
          params: {
            threadId,
            turnId,
            callId: 'c1',
            tool: 'dispatch_task',
            arguments: { goal: 'Ship it' }
          }
        })
        emit({
          method: 'item/completed',
          params: {
            threadId,
            turnId,
            item: {
              type: 'dynamicToolCall',
              id: 'c1',
              tool: 'dispatch_task',
              arguments: { goal: 'Ship it' },
              success: true,
              contentItems: [{ type: 'inputText', text: '{"workerId":"w_1"}' }]
            }
          }
        })
        emit({
          method: 'item/agentMessage/delta',
          params: { threadId, turnId, itemId: 'm1', delta: 'Started.' }
        })
        emit({
          method: 'item/completed',
          params: { threadId, turnId, item: { type: 'agentMessage', id: 'm1', text: 'Started.' } }
        })
        // Codex can repeat the same update; only a new total counts.
        const tokenUsage = {
          total: { totalTokens: 105 * params.input[0].text.length },
          last: { inputTokens: 100, cachedInputTokens: 60, outputTokens: 5 }
        }
        emit({ method: 'thread/tokenUsage/updated', params: { threadId, tokenUsage } })
        emit({ method: 'thread/tokenUsage/updated', params: { threadId, tokenUsage } })
        setTimeout(
          () =>
            emit({
              method: 'turn/completed',
              params: { threadId, turn: { id: turnId, status: 'completed' } }
            }),
          5
        )
      })
      return { turn: { id: turnId } }
    }
    if (method === 'turn/steer') return { turnId: params.expectedTurnId }
    return {}
  })
  const server = new CodexRouterServer(codex.launch)
  const calls = []
  const tools = [
    {
      name: 'dispatch_task',
      description: 'Dispatch.',
      schema: { _zod: true },
      execute: async (args) => {
        calls.push(args)
        return '{"workerId":"w_1","status":"started"}'
      }
    }
  ]
  const make = (promptVersion = 2) =>
    new CodexEngine({
      server,
      executable: '/bin/codex',
      cwd: PROJECT.path,
      model: 'gpt-test',
      instructions: 'Route.',
      promptVersion,
      tools: tools.map((t) => ({
        ...t,
        schema: require('zod').z.object({ goal: require('zod').z.string() })
      })),
      state: () => '- w_1 · running · Ship it'
    })
  const items = []
  const usage = []
  const sink = { item: (i) => items.push(i), usage: (u) => usage.push(u) }
  const engine = make()
  const first = await engine.run({ batchId: 'b_1', text: 'Ship it', native: null }, sink)
  assert.equal(first.status, 'completed')
  assert.deepEqual(first.native, { engine: 'codex', threadId: 'thread-1', promptVersion: 2 })
  assert.deepEqual(
    codex.launches[0],
    { args: [], cwd: PROJECT.path, experimentalApi: true },
    'a plain probe reads the config'
  )
  assert.deepEqual(codex.requests[0].params, { includeLayers: false, cwd: PROJECT.path })
  assert.equal(codex.launches[1].cwd, PROJECT.path, 'project MCP servers can be named')
  assert.deepEqual(codex.launches[1].args, codexRouterArgs(['node_repl', 'pencil']))
  assert.ok(codex.launches[1].args.includes('mcp_servers.node_repl.enabled=false'))
  assert.ok(codex.launches[1].args.includes('features.shell_tool=false'))
  assert.ok(!codex.launches[1].args.some((a) => a.startsWith('features.code_mode_host')))
  const start = codex.requests.find((r) => r.method === 'thread/start').params
  assert.equal(start.sandbox, 'read-only')
  assert.equal(start.approvalPolicy, 'never')
  assert.equal(start.cwd, PROJECT.path)
  assert.equal(start.developerInstructions, 'Route.')
  assert.deepEqual(
    start.dynamicTools.map((t) => t.name),
    ['dispatch_task']
  )
  assert.deepEqual(calls, [{ goal: 'Ship it' }])
  const reply = codex.requests.find((r) => r.method === 'respond')
  assert.deepEqual(reply.params, {
    success: true,
    contentItems: [{ type: 'inputText', text: '{"workerId":"w_1","status":"started"}' }]
  })
  assert.deepEqual(
    items.filter((i) => i.status === 'completed').map((i) => [i.kind, i.text]),
    [
      ['tool', 'dispatch_task'],
      ['assistant', 'Started.']
    ]
  )
  assert.deepEqual(usage, [{ input: 40, output: 5, cacheRead: 60, cacheWrite: 0 }])

  // Same process: the loaded thread is reused without a resume or a config read.
  await engine.run({ batchId: 'b_2', text: 'More', native: first.native }, sink)
  assert.equal(codex.requests.filter((r) => r.method === 'thread/resume').length, 0)
  assert.equal(codex.requests.filter((r) => r.method === 'config/read').length, 1)
  // A restarted process resumes the thread; a lost thread starts over with the state.
  codex.closes[0]('exited')
  await engine.run({ batchId: 'b_3', text: 'Again', native: first.native }, sink)
  assert.equal(codex.launches.length, 4)
  assert.equal(codex.requests.filter((r) => r.method === 'thread/resume').length, 1)
  const lost = await engine.run(
    {
      batchId: 'b_4',
      text: 'Hello',
      native: { engine: 'codex', threadId: 'thread-gone', promptVersion: 2 }
    },
    sink
  )
  assert.equal(lost.native.threadId, 'thread-2')
  const lostTurn = codex.requests.filter((r) => r.method === 'turn/start').at(-1).params
  assert.match(
    lostTurn.input[0].text,
    /^Earlier Router history is not available\. Current workers:\n- w_1 · running · Ship it\n\nHello$/
  )
  // New instructions need a new thread.
  const bumped = await make(3).run({ batchId: 'b_5', text: 'Hi', native: lost.native }, sink)
  assert.deepEqual(bumped.native, { engine: 'codex', threadId: 'thread-3', promptVersion: 3 })
  server.close()
})

test('the Codex Router restarts before a thread loads when the project adds an MCP server', async () => {
  let threads = 0
  const codex = fakeCodex((method, params, emit) => {
    if (method === 'thread/start') return { thread: { id: `thread-${++threads}` } }
    if (method === 'turn/start') {
      const { threadId } = params
      queueMicrotask(() =>
        emit({
          method: 'turn/completed',
          params: { threadId, turn: { id: 't', status: 'completed' } }
        })
      )
      return { turn: { id: 't' } }
    }
    return {}
  })
  const server = new CodexRouterServer(codex.launch)
  const engine = new CodexEngine({
    server,
    executable: '/bin/codex',
    cwd: PROJECT.path,
    model: null,
    instructions: 'Route.',
    promptVersion: 2,
    tools: [],
    state: () => ''
  })
  const sink = { item: () => {}, usage: () => {} }
  const first = await engine.run({ batchId: 'b_1', text: 'Hi', native: null }, sink)
  assert.equal(codex.launches.length, 2)

  codex.servers.from_repo = {}
  // A loaded thread keeps the MCP servers it started with.
  await engine.run({ batchId: 'b_2', text: 'Again', native: first.native }, sink)
  assert.equal(codex.launches.length, 2)
  // A thread that loads again reads the config from the running process first.
  const second = await engine.run({ batchId: 'b_3', text: 'New', native: null }, sink)
  assert.equal(second.status, 'completed')
  assert.equal(codex.launches.length, 3, 'no second probe while a process runs')
  assert.deepEqual(codex.launches[2].args, codexRouterArgs(['from_repo', 'node_repl', 'pencil']))
  assert.ok(codex.requests.some((r) => r.process === 2 && r.method === 'stop'))
  const reads = codex.requests.filter((r) => r.method === 'config/read')
  assert.deepEqual(
    reads.map((r) => r.process),
    [1, 2]
  )
  assert.ok(reads.every((r) => r.params.cwd === PROJECT.path))
  server.close()
})
