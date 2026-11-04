import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall
} from '@earendil-works/pi-ai'
import { cipher, commands, memoryRouterStore } from '../fixtures/router-store.mjs'

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
  GitWorkspaces,
  parseReport,
  renderBatch,
  renderState,
  trimContext
} = require('../../out/main/codex/runtime.js')

const PROJECT = { id: 'p1', name: 'demo', path: '/tmp/owls-router-demo' }

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
      createSession: (input, worker) => {
        const session = { id: crypto.randomUUID(), ...input, worker: worker ?? null }
        created.push(session)
        return session
      },
      // Like the task services, prepare the workspace and ask for the turn profile per turn.
      send: async (input) => {
        await turns.profiles?.prepare(input.sessionId)
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
    options.factory ?? factory,
    options.workspaces
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
      { id: 'w_b', status: 'running', goal: 'B', report: null, workspace: { kind: 'checkout' } },
      {
        id: 'w_a',
        status: 'idle',
        goal: 'A',
        report: { summary: 'done' },
        workspace: { kind: 'worktree', branch: 'owls/w_a' }
      }
    ]),
    '- w_a · idle · branch owls/w_a · A — done\n- w_b · running · B'
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
  const { messages: kept, window } = trimContext(messages, 1200, () => '- w_a · running · A')
  assert.deepEqual(
    kept.map((m) => m.role),
    ['system', 'user', 'assistant', 'toolResult', 'user']
  )
  assert.match(
    kept[1].content,
    /^Earlier Router history was omitted.*\n- w_a · running · A\n\ntwo /s
  )
  assert.deepEqual(window, { cut: 2, note: '- w_a · running · A' })
  const untouched = trimContext(messages, 1_000_000, () => '')
  assert.equal(untouched.messages, messages)
  assert.equal(untouched.window, null)
})

test('trimContext keeps its cut and note until the context outgrows the budget again', () => {
  const big = 'x'.repeat(500)
  const messages = [
    { role: 'system', content: 'rules' },
    { role: 'user', content: `one ${big}` },
    { role: 'user', content: `two ${big}` },
    { role: 'user', content: 'three' }
  ]
  let note = 'first'
  const first = trimContext(messages, 1000, () => note)
  assert.equal(first.window.cut, 1)
  // Later requests share the prefix: same cut, same note, though the workers changed.
  note = 'second'
  messages.push({ role: 'assistant', content: [{ type: 'text', text: 'ok' }] })
  messages.push({ role: 'user', content: 'four' })
  const next = trimContext(messages, 1000, () => note, first.window)
  assert.equal(next.window, first.window)
  assert.deepEqual(next.messages.slice(0, 2), first.messages.slice(0, 2))
  // Past the budget, a new cut trims to 60% of it and takes the current note.
  messages.push({ role: 'user', content: `five ${big}` })
  const recut = trimContext(messages, 1000, () => note, next.window)
  assert.equal(recut.window.note, 'second')
  assert.ok(recut.window.cut > first.window.cut)
  assert.ok(Buffer.byteLength(JSON.stringify(recut.messages)) <= 1000)
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
  assert.equal(first.promptVersion, 3)
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

// Worker worktrees (RFC 11.1): the git layer on real temporary repositories.

function gitIn(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}
/** A temporary directory with a repository at `repo` (one commit) and a worktrees root. */
function tempRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'owls-worktrees-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const repo = join(dir, 'demo')
  mkdirSync(join(repo, 'packages', 'app'), { recursive: true })
  gitIn(dir, 'init', '--quiet', '--initial-branch=main', repo)
  gitIn(repo, 'config', 'user.email', 'test@example.com')
  gitIn(repo, 'config', 'user.name', 'Test')
  gitIn(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  writeFileSync(join(repo, 'packages', 'app', 'index.js'), 'export {}\n')
  gitIn(repo, 'add', '.')
  gitIn(repo, 'commit', '--quiet', '-m', 'init')
  return { dir, repo, workspaces: new GitWorkspaces(join(dir, 'data', 'worktrees')) }
}
const commitIn = (cwd, file, text) => {
  writeFileSync(join(cwd, file), text)
  gitIn(cwd, 'add', file)
  gitIn(cwd, 'commit', '--quiet', '-m', `change ${file}`)
}

test('worktrees are only offered for repositories with a commit', async (t) => {
  const { dir, repo, workspaces } = tempRepo(t)
  const plain = join(dir, 'plain')
  const empty = join(dir, 'empty')
  mkdirSync(plain)
  gitIn(dir, 'init', '--quiet', empty)
  assert.equal(await workspaces.inspect(plain), null, 'not a repository')
  assert.equal(await workspaces.inspect(empty), null, 'no commit to branch from')
  const top = await workspaces.inspect(repo)
  assert.equal(top.subdir, '')
  const nested = await workspaces.inspect(join(repo, 'packages', 'app'))
  assert.equal(nested.repo, top.repo)
  assert.equal(nested.subdir, join('packages', 'app'))
  const plan = workspaces.plan(nested, 'w_1', 'head')
  assert.equal(plan.branch, 'owls/w_1')
  assert.equal(plan.cwd, join(plan.path, 'packages', 'app'))
  assert.match(plan.path, /[/\\]data[/\\]worktrees[/\\]demo-[0-9a-f]{8}[/\\]w_1$/)
  assert.equal(plan.state, 'active')
})

test('a worker worktree starts from HEAD without the checkout uncommitted changes', async (t) => {
  const { repo, workspaces } = tempRepo(t)
  const head = gitIn(repo, 'rev-parse', 'HEAD')
  writeFileSync(join(repo, 'README.md'), 'uncommitted edit\n')
  writeFileSync(join(repo, 'scratch.txt'), 'untracked\n')
  const plan = workspaces.plan(
    await workspaces.inspect(join(repo, 'packages', 'app')),
    'w_2',
    'head'
  )
  const [one, two] = await Promise.all([workspaces.ensure(plan), workspaces.ensure(plan)])
  assert.equal(one, head)
  assert.equal(two, head, 'concurrent calls share one checkout')
  assert.ok(existsSync(plan.cwd))
  assert.equal(readFileSync(join(plan.path, 'README.md'), 'utf8'), 'hello\n')
  assert.equal(existsSync(join(plan.path, 'scratch.txt')), false)
  assert.equal(gitIn(plan.path, 'branch', '--show-current'), 'owls/w_2')
  assert.equal(readFileSync(join(repo, 'README.md'), 'utf8'), 'uncommitted edit\n')
})

test('a deleted worktree directory is checked out again from its branch', async (t) => {
  const { repo, workspaces } = tempRepo(t)
  const plan = workspaces.plan(await workspaces.inspect(repo), 'w_3', 'head')
  plan.baseCommit = await workspaces.ensure(plan)
  commitIn(plan.path, 'work.txt', 'done\n')
  rmSync(plan.path, { recursive: true, force: true })
  assert.equal(await workspaces.ensure(plan), plan.baseCommit)
  assert.equal(readFileSync(join(plan.path, 'work.txt'), 'utf8'), 'done\n')
})

test('releasing a worktree removes clean work, keeps branches with commits and dirty trees', async (t) => {
  const { repo, workspaces } = tempRepo(t)
  const top = await workspaces.inspect(repo)
  const ready = async (id) => {
    const plan = workspaces.plan(top, id, 'head')
    plan.baseCommit = await workspaces.ensure(plan)
    return plan
  }
  const branches = () => gitIn(repo, 'branch', '--list', 'owls/*')

  const clean = await ready('w_clean')
  assert.deepEqual(await workspaces.release(clean, false), {
    worktree: 'removed',
    branch: 'deleted'
  })
  assert.equal(existsSync(clean.path), false)

  const committed = await ready('w_commit')
  commitIn(committed.path, 'feature.txt', 'new\n')
  assert.deepEqual(await workspaces.release(committed, false), {
    worktree: 'removed',
    branch: 'kept'
  })
  assert.match(branches(), /owls\/w_commit/)

  const merged = await ready('w_merged')
  commitIn(merged.path, 'merged.txt', 'in\n')
  gitIn(repo, 'merge', '--quiet', '--ff-only', 'owls/w_merged')
  assert.deepEqual(await workspaces.release(merged, false), {
    worktree: 'removed',
    branch: 'deleted'
  })

  const dirty = await ready('w_dirty')
  writeFileSync(join(dirty.path, 'draft.txt'), 'unsaved\n')
  assert.deepEqual(await workspaces.release(dirty, false), { worktree: 'kept', branch: 'kept' })
  assert.ok(existsSync(join(dirty.path, 'draft.txt')), 'uncommitted work survives')
  assert.deepEqual(await workspaces.release(dirty, true), {
    worktree: 'removed',
    branch: 'deleted'
  })
  assert.equal(existsSync(dirty.path), false)
  assert.doesNotMatch(branches(), /w_clean|w_merged|w_dirty/)
})

test('a default-branch worktree starts from the fetched remote branch', async (t) => {
  const { dir, repo, workspaces } = tempRepo(t)
  const remote = join(dir, 'remote.git')
  gitIn(dir, 'clone', '--quiet', '--bare', repo, remote)
  gitIn(repo, 'remote', 'add', 'origin', remote)
  gitIn(repo, 'fetch', '--quiet', 'origin')
  gitIn(repo, 'remote', 'set-head', 'origin', 'main')
  // The remote moves on, and the user is on a feature branch with local work.
  const upstream = join(dir, 'upstream')
  gitIn(dir, 'clone', '--quiet', remote, upstream)
  gitIn(upstream, 'config', 'user.email', 'test@example.com')
  gitIn(upstream, 'config', 'user.name', 'Test')
  commitIn(upstream, 'remote.txt', 'from remote\n')
  gitIn(upstream, 'push', '--quiet', 'origin', 'main')
  gitIn(repo, 'switch', '--quiet', '-c', 'feature')
  commitIn(repo, 'local.txt', 'local only\n')

  const top = await workspaces.inspect(repo)
  const fromMain = workspaces.plan(top, 'w_main', 'default-branch')
  assert.equal(await workspaces.ensure(fromMain), gitIn(remote, 'rev-parse', 'main'))
  assert.ok(existsSync(join(fromMain.path, 'remote.txt')), 'fetched before branching')
  assert.equal(existsSync(join(fromMain.path, 'local.txt')), false)
  const fromHead = workspaces.plan(top, 'w_head', 'head')
  assert.equal(await workspaces.ensure(fromHead), gitIn(repo, 'rev-parse', 'HEAD'))
  assert.ok(existsSync(join(fromHead.path, 'local.txt')))
})

// Worker worktrees in the WorkerPool, with a recording stand-in for git.

function fakeWorkspaces(options = {}) {
  const calls = []
  return {
    calls,
    inspect: async (path) => {
      calls.push(['inspect', path])
      return options.git === false ? null : { repo: path, subdir: '' }
    },
    plan: (repo, workerId, base) => ({
      kind: 'worktree',
      repo: repo.repo,
      path: `/worktrees/${workerId}`,
      cwd: `/worktrees/${workerId}`,
      branch: `owls/${workerId}`,
      base,
      baseCommit: null,
      state: 'active'
    }),
    ensure: async (workspace) => {
      calls.push(['ensure', workspace.branch])
      if (options.failEnsure) throw new Error('disk full')
      return 'c0ffee'
    },
    release: async (workspace, force) => {
      calls.push(['release', workspace.branch, force])
      return options.release?.(workspace, force) ?? { worktree: 'removed', branch: 'deleted' }
    },
    prune: async (repo) => {
      calls.push(['prune', repo])
    }
  }
}
// Claude Code workers start without the Codex start gap, so these tests stay fast.
const worktreeSettings = {
  provider: 'claude-code',
  router: { ...fakeHost().settings.router, worktrees: true }
}

test('workers that write start together, each in its own worktree', async () => {
  const workspaces = fakeWorkspaces()
  const { engine, factory } = scriptedEngine()
  const { service, router, current, sent, created } = harness([], {
    factory,
    workspaces,
    host: { settings: worktreeSettings }
  })
  const results = []
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length !== 1) return
    for (const goal of ['Write A', 'Write B'])
      results.push(JSON.parse(await tools[0].execute({ goal })))
    results.push(
      JSON.parse(
        await tools[0].execute({ goal: 'Write C', workspace: 'checkout', base: 'default-branch' })
      )
    )
    results.push(JSON.parse(await tools[0].execute({ goal: 'Write D', workspace: 'checkout' })))
    results.push(JSON.parse(await tools[0].execute({ goal: 'Write E', base: 'default-branch' })))
  }
  send(service, router, 'Five changes')
  await waitFor(() => current().status === 'idle' && results.length === 5, 'dispatches')
  assert.deepEqual(
    results.map((r) => [r.status, r.workspace, r.branch === null ? null : 'branch']),
    [
      ['started', 'worktree', 'branch'],
      ['started', 'worktree', 'branch'],
      ['started', 'checkout', null],
      ['queued', 'checkout', null],
      ['started', 'worktree', 'branch']
    ],
    'only writers sharing the checkout wait for each other'
  )
  assert.equal(results[0].branch, `owls/${results[0].workerId}`)
  assert.deepEqual(
    sent.map((s) => s.text),
    ['Write A', 'Write B', 'Write C', 'Write E']
  )
  const a = created.find((c) => c.cwd === `/worktrees/${results[0].workerId}`)
  assert.deepEqual(a.worker, { projectPath: PROJECT.path })
  assert.equal(created.find((c) => c.cwd === PROJECT.path).worker, null)
  const workerA = service.snapshot().workers.find((w) => w.goal === 'Write A')
  assert.equal(workerA.workspace.baseCommit, 'c0ffee', 'prepared before the turn')
  assert.equal(
    service.snapshot().workers.find((w) => w.goal === 'Write E').workspace.base,
    'default-branch'
  )
  const profile = service.profile(workerA.sessionId)
  assert.match(profile.instructions, new RegExp(`branch owls/${workerA.id}`))
  assert.doesNotMatch(
    service.profile(service.snapshot().workers.find((w) => w.goal === 'Write C').sessionId)
      .instructions,
    /worktree/
  )
  service.close()
})

test('without worktrees, writers in one project still take turns', async () => {
  for (const [label, options] of [
    ['setting off', { host: {}, workspaces: fakeWorkspaces() }],
    [
      'not a repository',
      { host: { settings: worktreeSettings }, workspaces: fakeWorkspaces({ git: false }) }
    ]
  ]) {
    const { engine, factory } = scriptedEngine()
    const { service, router, current } = harness([], { factory, ...options })
    const results = []
    engine.onRun = async (_input, tools) => {
      if (engine.runs.length !== 1) return
      for (const goal of ['Write A', 'Write B'])
        results.push(JSON.parse(await tools[0].execute({ goal })))
    }
    send(service, router, 'Two changes')
    await waitFor(() => current().status === 'idle' && results.length === 2, label)
    assert.deepEqual(
      results.map((r) => [r.status, r.workspace]),
      [
        ['started', 'checkout'],
        ['queued', 'checkout']
      ],
      label
    )
    service.close()
  }
})

test('a worktree that cannot be prepared fails the dispatch and the follow-up', async () => {
  const workspaces = fakeWorkspaces({ failEnsure: true })
  const { engine, factory } = scriptedEngine()
  const { service, router, current } = harness([], {
    factory,
    workspaces,
    host: { settings: worktreeSettings }
  })
  let error = null
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length === 1)
      await tools[0].execute({ goal: 'Write A' }).catch((e) => (error = e))
  }
  send(service, router, 'Change it')
  await waitFor(() => current().status === 'idle' && error, 'dispatch')
  assert.equal(error.code, 'dispatch_failed')
  const worker = service.snapshot().workers[0]
  assert.equal(worker.status, 'failed')
  await assert.rejects(service.prepare(worker.sessionId), (e) => e.code === 'worktree_failed')
  service.close()
})

test('removing a worktree worker cleans up, keeps unmerged work, and can discard', async () => {
  const kept = new Set()
  const workspaces = fakeWorkspaces({
    release: (workspace, force) =>
      force
        ? { worktree: 'removed', branch: 'kept' }
        : kept.has(workspace.branch)
          ? { worktree: 'kept', branch: 'kept' }
          : { worktree: 'removed', branch: 'kept' }
  })
  const { engine, factory } = scriptedEngine()
  const { service, router, current } = harness([], {
    factory,
    workspaces,
    host: { settings: worktreeSettings }
  })
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length !== 1) return
    for (const goal of ['Merged later', 'Left dirty']) await tools[0].execute({ goal })
  }
  send(service, router, 'Two changes')
  await waitFor(() => current().status === 'idle' && service.snapshot().workers.length === 2, 'go')
  const byGoal = (goal) => service.snapshot().workers.find((w) => w.goal === goal)
  for (const goal of ['Merged later', 'Left dirty'])
    service.settled(byGoal(goal).sessionId, report('ok'))
  await waitFor(() => engine.runs.length === 2 && current().status === 'idle', 'reports')
  kept.add(byGoal('Left dirty').workspace.branch)

  service.observe({ type: 'removed', sessionId: byGoal('Merged later').sessionId })
  await waitFor(() => engine.runs.length === 3, 'removal batch')
  assert.match(
    engine.runs[2].text,
    new RegExp(`unmerged work stays on branch owls/${byGoal('Merged later').id}`)
  )
  assert.equal(byGoal('Merged later').workspace.state, 'released')

  service.observe({ type: 'removed', sessionId: byGoal('Left dirty').sessionId })
  await waitFor(() => byGoal('Left dirty').workspace.state === 'kept', 'kept worktree')
  await assert.rejects(
    service.discardWorktree({ routerId: router.id, workerId: byGoal('Merged later').id }),
    (e) => e.code === 'request_unavailable'
  )
  await service.discardWorktree({ routerId: router.id, workerId: byGoal('Left dirty').id })
  assert.equal(byGoal('Left dirty').workspace.state, 'released')
  assert.deepEqual(
    workspaces.calls.filter((c) => c[0] === 'release').map((c) => c[2]),
    [false, false, true]
  )
  service.close()
})

test('restart prunes worktrees and finishes a cleanup that did not complete', async () => {
  const store = memoryRouterStore()
  const first = scriptedEngine()
  const failing = fakeWorkspaces({
    release: () => {
      throw new Error('repository locked')
    }
  })
  const one = harness([], {
    store,
    factory: first.factory,
    workspaces: failing,
    host: { settings: worktreeSettings }
  })
  first.engine.onRun = async (_input, tools) => {
    if (first.engine.runs.length === 1) await tools[0].execute({ goal: 'Write A' })
  }
  send(one.service, one.router, 'Change it')
  await waitFor(
    () => one.current().status === 'idle' && one.service.snapshot().workers.length,
    'go'
  )
  const worker = one.service.snapshot().workers[0]
  one.service.settled(worker.sessionId, report('ok'))
  one.service.observe({ type: 'removed', sessionId: worker.sessionId })
  await waitFor(() => failing.calls.some((c) => c[0] === 'release'), 'failed cleanup')
  assert.equal(one.service.snapshot().workers[0].workspace.state, 'active')
  one.service.close()

  const workspaces = fakeWorkspaces()
  const two = harness([], {
    store,
    factory: scriptedEngine().factory,
    workspaces,
    host: { settings: worktreeSettings }
  })
  await two.service.recovered
  assert.deepEqual(workspaces.calls, [
    ['prune', PROJECT.path],
    ['release', `owls/${worker.id}`, false]
  ])
  assert.equal(two.service.snapshot().workers[0].workspace.state, 'released')
  two.service.close()
})
