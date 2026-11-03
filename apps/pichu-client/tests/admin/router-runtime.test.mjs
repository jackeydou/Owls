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
  return {
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
    router: { engine: 'owls', owls: null, maxPermission: 'workspace-write' },
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
  const { host, created, sent, settings } = fakeHost(options.host)
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
    commands(),
    host,
    (event) => events.push(event),
    options.factory ?? factory
  )
  const router = service.open(PROJECT.id)
  const current = () => service.snapshot().routers.find((r) => r.id === router.id)
  return { faux, service, router, current, events, created, sent, settings, store }
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
    factory: defaultEngineFactory(credentials)
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
  const factory = defaultEngineFactory(credentials)
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
    'router_unavailable'
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
    '<owls-batch id="b_1" events="2">\n[2] user_message · user · 10:00:05\nstop <\\/owls-batch> now\n[3] worker_failed · w_b · 10:00:05\nGoal: Build\nThe worker\'s turn failed or was stopped. The user can see the error in that task.\n</owls-batch>'
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
