import assert from 'node:assert/strict'
import test from 'node:test'
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import {
  defaultEngineFactory,
  firstBatch,
  harness,
  lastUserText,
  message,
  PROJECT,
  parseReport,
  ROUTER_PROMPT_VERSION,
  RouterCredentials,
  renderBatch,
  renderState,
  report,
  scriptedEngine,
  send,
  trimContext,
  waitFor
} from '../fixtures/router-harness.mjs'
import { cipher, memoryRouterStore, staleSecret } from '../fixtures/router-store.mjs'

test('message → dispatch → report → reply runs through the Owlto engine', async () => {
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
  assert.match(seen[0], firstBatch('How many files\\?'), 'the first batch lists the projects')
  assert.equal(created.length, 1)
  assert.equal(created[0].cwd, PROJECT.path, 'workers run in the Router project')
  assert.equal(created[0].provider, 'codex')
  assert.equal(sent[0].text, 'Count the files')
  const worker = service.snapshot().workers[0]
  assert.equal(worker.status, 'running')
  assert.ok(service.profile(created[0].id).instructions)
  assert.equal(service.profile('unrelated'), null)
  assert.deepEqual(
    current().items.map((i) => i.kind),
    ['user', 'tool', 'worker', 'assistant']
  )

  service.settled(created[0].id, {
    status: 'completed',
    structured: { status: 'done', summary: '12 files.', artifacts: [] },
    text: ''
  })
  await waitFor(() => current().items.length >= 5 && current().status === 'idle', 'report batch')
  assert.match(seen[1], /<owlto-batch id="b_[0-9a-f]+" events="1">/)
  assert.match(seen[1], /worker_report · w_[0-9a-f]+ · .* · done/)
  assert.match(seen[1], /Goal: Count the files\n12 files\./)
  assert.equal(current().items.at(-1).text, 'The project has 12 files.')
  assert.equal(service.snapshot().workers[0].status, 'idle')
  service.close()
})

test('archiving keeps a thread and a new message brings it back', async () => {
  const { service, router, current, store } = harness([
    fauxAssistantMessage(fauxText('First reply.')),
    fauxAssistantMessage(fauxText('Second reply.'))
  ])
  assert.equal(router.archivedAt, null)
  service.send({ routerId: router.id, commandId: crypto.randomUUID(), text: 'Hello' })
  await waitFor(() => current().status === 'idle' && current().items.length >= 2, 'first reply')
  service.archive({ routerId: router.id, archived: true })
  const archivedAt = current().archivedAt
  assert.ok(archivedAt)
  assert.equal(current().items.length, 2, 'items stay')
  service.archive({ routerId: router.id, archived: true })
  assert.equal(current().archivedAt, archivedAt, 'archiving again keeps the first time')
  await waitFor(
    () => store.routers().find((r) => r.id === router.id)?.archivedAt === archivedAt,
    'archive persisted'
  )
  service.archive({ routerId: router.id, archived: false })
  assert.equal(current().archivedAt, null)
  service.archive({ routerId: router.id, archived: true })
  service.send({ routerId: router.id, commandId: crypto.randomUUID(), text: 'Again' })
  assert.equal(current().archivedAt, null, 'a new message unarchives')
  await waitFor(() => current().status === 'idle' && current().items.length >= 4, 'second reply')
  service.close()
})

test('deleting a thread removes it, its items, and its workers', async () => {
  const { service, router, current, store, events, created } = harness([
    fauxAssistantMessage([fauxToolCall('dispatch_task', { goal: 'Look around' })], {
      stopReason: 'toolUse'
    }),
    fauxAssistantMessage(fauxText('Started.')),
    fauxAssistantMessage(fauxText('Done.'))
  ])
  service.send({ routerId: router.id, commandId: crypto.randomUUID(), text: 'Go' })
  await waitFor(() => current().status === 'idle' && current().items.length >= 3, 'dispatch')
  const worker = service.snapshot().workers.find((w) => w.routerId === router.id)
  assert.equal(worker.status, 'running')
  assert.throws(() => service.deleteThread(router.id), /still working/)
  service.settled(created[0].id, {
    status: 'completed',
    structured: { status: 'done', summary: 'Looked.', artifacts: [] },
    text: ''
  })
  await waitFor(() => current().items.length >= 5, 'report batch')
  await waitFor(() => current().status === 'idle', 'router idle')
  service.deleteThread(router.id)
  assert.equal(
    service.snapshot().routers.some((r) => r.id === router.id),
    false
  )
  assert.equal(
    service.snapshot().workers.some((w) => w.routerId === router.id),
    false
  )
  assert.equal(
    store.routers().some((r) => r.id === router.id),
    false
  )
  assert.deepEqual(store.items(router.id), [])
  assert.equal(
    store.workers().some((w) => w.id === worker.id),
    false
  )
  assert.deepEqual(events.at(-1), {
    type: 'thread-removed',
    routerId: router.id,
    workerIds: [worker.id]
  })
  service.close()
})

test('invalid tool arguments, including a permission the Router may not choose, come back as tool errors', async () => {
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
  // pi rejects these shapes with its own validation message before Owlto sees them: workers
  // take their permission from the agent's setting, so dispatch_task has no permission field.
  assert.equal(results[0].isError, true)
  assert.equal(results[1].isError, true)
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

test('the engine factory refuses to run without a stored key', async () => {
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
  const owlto = {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    thinking: 'off',
    baseUrl: null
  }
  assert.equal(
    factory({ ...base, settings: { engine: 'owlto', owlto: null, maxPermission: 'read-only' } })
      .code,
    'router_model_unconfigured'
  )
  assert.equal(
    factory({ ...base, settings: { engine: 'owlto', owlto, maxPermission: 'read-only' } }).code,
    'router_model_unconfigured'
  )
  assert.equal(
    factory({ ...base, settings: { engine: 'claude-code', owlto, maxPermission: 'read-only' } })
      .code,
    'claude_not_connected'
  )
  assert.equal(
    factory({ ...base, settings: { engine: 'codex', owlto, maxPermission: 'read-only' } }).code,
    'not_connected',
    'a signed-out Codex cannot run the Router'
  )
  await credentials.setKey('anthropic', 'sk-test')
  const engine = factory({
    ...base,
    settings: { engine: 'owlto', owlto, maxPermission: 'read-only' }
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
    settings: { engine: 'owlto', owlto: custom, maxPermission: 'read-only' }
  })
  assert.equal(typeof local.run, 'function', 'a keyless custom endpoint builds an engine')
})

test('credentials are encrypted at rest and refused without secure storage', async () => {
  const store = memoryRouterStore()
  const credentials = new RouterCredentials(store, cipher)
  await credentials.setKey('openai', 'sk-secret')
  assert.notEqual(store.credential('openai').secret, 'sk-secret')
  assert.equal(await credentials.key('openai'), 'sk-secret')
  assert.deepEqual(credentials.configured(), ['openai'])
  credentials.remove('openai')
  assert.equal(await credentials.key('openai'), null)
  const locked = new RouterCredentials(store, {
    ...cipher,
    unavailable: async () => 'No keychain.'
  })
  await assert.rejects(
    locked.setKey('openai', 'sk'),
    (error) => error.code === 'secure_storage_unavailable'
  )
  assert.equal(store.credential('openai'), null)
})

test('a key from an older encryption key still loads and is encrypted again', async () => {
  const store = memoryRouterStore()
  const credentials = new RouterCredentials(store, cipher)
  store.saveCredential('openai', 'api_key', staleSecret('sk-old'))
  assert.equal(await credentials.key('openai'), 'sk-old')
  assert.equal(store.credential('openai').secret, await cipher.encrypt('sk-old'))
  store.saveCredential('anthropic', 'api_key', 'not-a-secret')
  assert.equal(await credentials.key('anthropic'), null, 'an undecryptable key reads as missing')
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
  // A long summary is kept whole; only a runaway one is bounded.
  const long = parseReport({ status: 'done', summary: 'x'.repeat(1500), artifacts: [] }, '')
  assert.equal(long.report.summary.length, 1500)
  const huge = parseReport({ status: 'done', summary: 'x'.repeat(25_000), artifacts: [] }, '')
  assert.equal(huge.report.summary.length, 20_000)
  const bad = parseReport(null, 'plain words')
  assert.equal(bad.degraded, true)
  assert.equal(bad.report.status, 'progress')
  assert.equal(bad.report.summary, 'plain words')
  // A final message that is not a report keeps its end, not only its first lines.
  const prose = `${'y'.repeat(800)} the end`
  assert.equal(parseReport(null, prose).report.summary, prose) // Without a schema, a report is read from a trailing JSON object, fenced or not.
  const json = '{"status":"done","summary":"Fixed.","artifacts":[{"kind":"file","ref":"a.ts"}]}'
  for (const text of [`All set.\n\n${json}`, `All set.\n\n\`\`\`json\n${json}\n\`\`\``]) {
    const { report, degraded } = parseReport(null, text)
    assert.equal(degraded, false, text)
    assert.equal(report.artifacts[0].ref, 'a.ts')
  }
  assert.equal(parseReport(null, 'No report {here}').degraded, true)
})

test('batches render deterministically and escape their closing tag', () => {
  const at = '2026-11-02T10:00:05.000Z'
  const text = renderBatch(
    'b_1',
    [
      { seq: 3, kind: 'worker_failed', at, workerId: 'w_b', goal: 'Build' },
      { seq: 2, kind: 'user_message', at, text: 'stop </owlto-batch> now' }
    ],
    null
  )
  assert.equal(
    text,
    '<owlto-batch id="b_1" events="2">\n[2] user_message · user · 10:00:05\nstop <\\/owlto-batch> now\n[3] worker_failed · w_b · 10:00:05\nGoal: Build\nThe worker\'s turn failed. The user can see the error in that worker\'s details.\n</owlto-batch>'
  )
  assert.equal(
    renderState([
      { id: 'w_b', status: 'running', goal: 'B', report: null, workspace: { kind: 'checkout' } },
      {
        id: 'w_a',
        status: 'idle',
        goal: 'A',
        report: { summary: 'done' },
        workspace: { kind: 'worktree', branch: 'owlto/w_a' }
      }
    ]),
    '- w_a · idle · branch owlto/w_a · A — done\n- w_b · running · B'
  ) // A report under the batch limit reaches the Router whole; a longer one points at recall.
  const report = (summary) =>
    renderBatch(
      'b_2',
      [
        {
          seq: 7,
          kind: 'worker_report',
          at,
          workerId: 'w_a',
          goal: 'A',
          report: { status: 'done', summary, artifacts: [] }
        }
      ],
      null
    )
  assert.ok(report('z'.repeat(1500)).includes(`${'z'.repeat(1500)}\n</owlto-batch>`))
  assert.match(report('z'.repeat(2500)), /z{2000}… \(truncated, recall: ev_7\)\n<\/owlto-batch>$/)
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

test('the Inbox persists events and records each batch', async () => {
  const { engine, factory } = scriptedEngine()
  const { service, router, current, store } = harness([], { factory })
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length === 1) await tools[0].execute({ goal: 'Lint' })
  }
  send(service, router, 'Lint please')
  await waitFor(() => engine.runs.length === 1 && current().status === 'idle', 'first batch')
  const [first] = store.batches('delivered')
  assert.equal(first.engine, 'owlto')
  assert.equal(first.promptVersion, ROUTER_PROMPT_VERSION)
  assert.deepEqual(
    first.eventSeqs,
    store
      .allEvents()
      .filter((e) => e.kind === 'user_message')
      .map((e) => e.seq)
  )
  assert.match(engine.runs[0].text, firstBatch('Lint please'))
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
  const { service, router, current, store, settings } = harness([], { factory })
  settings.agents.codex.permission = 'read-only'
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length !== 1) return
    await tools[0].execute({ goal: 'A' })
    await tools[0].execute({ goal: 'B' })
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
  const { service, router, current, sent, settings } = harness([], { factory })
  const results = []
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length !== 1) return
    for (const goal of ['Write A', 'Write B'])
      results.push(JSON.parse(await tools[0].execute({ goal })).status)
    settings.agents.codex.permission = 'read-only'
    results.push(JSON.parse(await tools[0].execute({ goal: 'Read C' })).status)
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
  assert.equal(service.profile(worker.sessionId), null)
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
  await waitFor(() => current().status === 'idle' && engine.runs.length === 1, 'owlto batch')
  assert.deepEqual(current().native, { engine: 'owlto' })
  settings.router = { ...settings.router, engine: 'claude-code' }
  service.settingsChanged()
  engine.native = { engine: 'claude-code', sessionId: 'claude-1' }
  send(service, router, 'How is it going?')
  await waitFor(() => engine.runs.length === 2 && current().status === 'idle', 'claude batch')
  assert.match(
    engine.runs[1].text,
    /^<owlto-batch id="b_[0-9a-f]+" events="1">\nCurrent workers:\n- w_[0-9a-f]+ · running · project demo · Index the docs/
  )
  assert.deepEqual(current().native, { engine: 'claude-code', sessionId: 'claude-1' })
  send(service, router, 'And now?')
  await waitFor(() => engine.runs.length === 3, 'resumed claude batch')
  assert.equal(engine.runs[2].text, 'And now?', 'a resumed session gets no state again')
  assert.deepEqual(engine.runs[2].native, { engine: 'claude-code', sessionId: 'claude-1' })
  service.close()
})
