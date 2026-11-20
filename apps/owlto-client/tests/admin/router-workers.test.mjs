import assert from 'node:assert/strict'
import test from 'node:test'
import {
  firstBatch,
  harness,
  message,
  renderBatch,
  report,
  scriptedEngine,
  send,
  waitFor,
  withTools
} from '../fixtures/router-harness.mjs'

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
    h.settings.agents.codex.permission = 'read-only'
    const { workerId } = await call('dispatch_task', {
      goal: 'Summarize',
      context: 'c'.repeat(5000)
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

test('a message the user sends to a worker reports back to the Router like any turn', async () => {
  const { service, router, engine, current, sent } = await withTools(async (call) => [
    await call('dispatch_task', { goal: 'Draft the README' })
  ])
  const worker = service.snapshot().workers[0]
  service.settled(worker.sessionId, report('Drafted.'))
  await waitFor(() => engine.runs.length === 2 && current().status === 'idle', 'report batch')
  await service.send({
    routerId: router.id,
    commandId: crypto.randomUUID(),
    text: 'Add a badge',
    workerId: worker.id
  })
  assert.equal(sent.at(-1).text, 'Add a badge')
  assert.equal(engine.runs.length, 2, 'the message itself starts no batch')
  service.settled(worker.sessionId, report('Added a badge.'))
  await waitFor(() => engine.runs.length === 3, 'report batch')
  assert.match(engine.runs[2].text, /· to w_[0-9a-f]+\nAdd a badge/)
  assert.match(
    engine.runs[2].text,
    /worker_report · w_[0-9a-f]+ · .* · done\nGoal: Draft the README\nAdded a badge\./
  )
  service.close()
})

test('dispatch_task records the title, the parent, and one conversation item', async () => {
  const { service, current, results } = await withTools(async (call, h) => {
    const parent = await call('dispatch_task', { goal: 'Fix the login page', title: 'Fix login' })
    h.settings.agents.codex.permission = 'read-only'
    const child = await call('dispatch_task', {
      goal: 'Test the login flow',
      title: 'x'.repeat(100),
      parent: parent.workerId
    })
    // A retried call reuses the worker, so it must not add a second item.
    await call('dispatch_task', { goal: 'Fix the login page' })
    const listed = await call('list_workers', {})
    const recalled = await call('recall', { id: child.workerId })
    h.state = { parent, child }
    return [parent, child, listed, recalled]
  })
  await waitFor(() => current().status === 'idle', 'batch end')
  const [parent, child, listed, recalled] = results
  const workers = service.snapshot().workers
  const byId = (id) => workers.find((w) => w.id === id)
  assert.equal(byId(parent.workerId).title, 'Fix login')
  assert.equal(byId(parent.workerId).parentId, null)
  assert.equal(byId(child.workerId).title.length, 60)
  assert.equal(byId(child.workerId).parentId, parent.workerId)
  assert.equal(listed.workers.find((w) => w.workerId === child.workerId).parent, parent.workerId)
  assert.equal(recalled.parent, parent.workerId)
  assert.deepEqual(
    current()
      .items.filter((i) => i.kind === 'worker')
      .map((i) => i.workerId),
    [parent.workerId, child.workerId]
  )
  service.close()
})

test('dispatch_task refuses a parent that is unknown or removed', async () => {
  const { service, results } = await withTools(async (call, h) => {
    const unknown = await call('dispatch_task', { goal: 'A', parent: 'w_missing' })
    h.settings.agents.codex.permission = 'read-only'
    const parent = await call('dispatch_task', { goal: 'B' })
    const worker = h.service.snapshot().workers.find((w) => w.id === parent.workerId)
    h.service.observe({ type: 'removed', sessionId: worker.sessionId })
    const removed = await call('dispatch_task', { goal: 'C', parent: parent.workerId })
    return [unknown, removed]
  })
  assert.equal(results[0].error.code, 'worker_not_found')
  assert.equal(results[1].error.code, 'worker_closed')
  assert.equal(service.snapshot().workers.length, 1)
  service.close()
})

test('a message to a running worker waits in its queue and reaches the Router later', async () => {
  const { service, router, engine, current, fake, sent } = await withTools(async (call) => [
    await call('dispatch_task', { goal: 'Run the suite' })
  ])
  await waitFor(() => current().status === 'idle', 'dispatch batch')
  const worker = service.snapshot().workers[0]
  const commandId = crypto.randomUUID()
  await service.send({
    routerId: router.id,
    commandId,
    text: 'Add a token expiry case.',
    workerId: worker.id
  })
  assert.deepEqual(fake.steered, [], 'the running turn is left alone')
  const queued = service.snapshot().workers[0].pending
  assert.deepEqual(
    queued.map((m) => m.text),
    ['Add a token expiry case.']
  )
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(engine.runs.length, 1, 'no batch for a queued message')
  const item = current().items.find((i) => i.id === commandId)
  assert.equal(item.workerId, worker.id)
  const turns = sent.length
  service.settled(worker.sessionId, report('Passed.'))
  // The queue goes out as the next turn, as the user's own message.
  await waitFor(() => sent.length === turns + 1, 'queued turn')
  assert.deepEqual(
    { text: sent.at(-1).text, author: sent.at(-1).author },
    { text: 'Add a token expiry case.', author: 'user' }
  )
  assert.equal(service.snapshot().workers[0].pending, undefined)
  await waitFor(() => engine.runs.length === 2, 'report batch')
  assert.match(engine.runs[1].text, new RegExp(`user_message · user · .* · to ${worker.id}\\n`))
  assert.match(engine.runs[1].text, /worker_report · .* · done\nGoal: Run the suite\nPassed\./)
  service.close()
})

test('steering a queued message injects it, and dropping one removes it', async () => {
  const { service, router, current, fake } = await withTools(async (call) => [
    await call('dispatch_task', { goal: 'Run the suite' })
  ])
  await waitFor(() => current().status === 'idle', 'dispatch batch')
  const worker = service.snapshot().workers[0]
  for (const text of ['First', 'Second'])
    await service.send({
      routerId: router.id,
      commandId: crypto.randomUUID(),
      text,
      workerId: worker.id
    })
  const [first, second] = service.snapshot().workers[0].pending
  await service.steerPending({ routerId: router.id, workerId: worker.id, messageId: first.id })
  assert.deepEqual(fake.steered, [{ sessionId: worker.sessionId, text: 'First' }])
  assert.deepEqual(
    service.snapshot().workers[0].pending.map((m) => m.id),
    [second.id]
  )
  service.dropPending({ routerId: router.id, workerId: worker.id, messageId: second.id })
  assert.equal(service.snapshot().workers[0].pending, undefined)
  service.close()
})

test('steering a Cursor worker interrupts its turn and sends the message next', async () => {
  const { service, router, current, fake, sent, engine } = await withTools(
    async (call) => [await call('dispatch_task', { goal: 'Run the suite', provider: 'cursor' })],
    { host: { ready: ['codex', 'claude-code', 'cursor'] } }
  )
  await waitFor(() => current().status === 'idle', 'dispatch batch')
  const worker = service.snapshot().workers[0]
  assert.equal(worker.provider, 'cursor')
  for (const text of ['Use the new API', 'Then rerun'])
    await service.send({
      routerId: router.id,
      commandId: crypto.randomUUID(),
      text,
      workerId: worker.id
    })
  const [first] = service.snapshot().workers[0].pending
  await service.steerPending({ routerId: router.id, workerId: worker.id, messageId: first.id })
  assert.deepEqual(fake.interrupted, [worker.sessionId])
  const turns = sent.length
  const runs = engine.runs.length
  service.settled(worker.sessionId, { status: 'interrupted', structured: null, text: '' })
  await waitFor(() => sent.length === turns + 1, 'restarted turn')
  assert.equal(sent.at(-1).text, 'Use the new API\n\nThen rerun')
  assert.equal(service.snapshot().workers[0].status, 'running')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(engine.runs.length, runs, 'a restart for a steer does not wake the Router')
  service.close()
})

test('a message to a finished worker starts its next turn, and the report wakes the Router', async () => {
  const { service, router, engine, current, sent } = await withTools(async (call) => [
    await call('dispatch_task', { goal: 'Draft the README' })
  ])
  const worker = service.snapshot().workers[0]
  service.settled(worker.sessionId, report('Drafted.'))
  await waitFor(() => engine.runs.length === 2 && current().status === 'idle', 'report batch')
  await service.send({
    routerId: router.id,
    commandId: crypto.randomUUID(),
    text: 'Add a badge.',
    workerId: worker.id
  })
  assert.equal(sent.at(-1).text, 'Add a badge.')
  service.settled(worker.sessionId, report('Badge added.'))
  await waitFor(() => engine.runs.length === 3, 'next report batch')
  assert.match(engine.runs[2].text, /Badge added\./)
  service.close()
})

test('files sent to a worker reach its turn, the thread, and the Router', async () => {
  const { service, router, engine, current, sent, fake } = await withTools(async (call) => [
    await call('dispatch_task', { goal: 'Fix the layout' })
  ])
  const worker = service.snapshot().workers[0]
  service.settled(worker.sessionId, report('Fixed.'))
  await waitFor(() => engine.runs.length === 2 && current().status === 'idle', 'report batch')
  const shot = { id: crypto.randomUUID(), name: 'shot.png', mimeType: 'image/png', size: 4 }
  const commandId = crypto.randomUUID()
  await service.send({
    routerId: router.id,
    commandId,
    text: '',
    workerId: worker.id,
    cardIds: [],
    attachments: [shot]
  })
  // Files alone start a turn with no text, never the goal again.
  assert.deepEqual(
    { text: sent.at(-1).text, attachments: sent.at(-1).attachments, author: sent.at(-1).author },
    { text: '', attachments: [shot], author: 'user' }
  )
  assert.deepEqual(current().items.find((i) => i.id === commandId).attachments, [shot])
  assert.equal(fake.steered.length, 0)
  service.settled(worker.sessionId, report('Looked.'))
  await waitFor(() => engine.runs.length === 3, 'next report batch')
  assert.match(engine.runs[2].text, /Attached files: shot\.png/)
  service.close()
})

test('files sent to the Router reach its batch as files, and wait while a batch runs', async () => {
  const { engine, factory } = scriptedEngine()
  const { service, router, current } = harness([], {
    factory,
    projectId: null,
    host: { missing: ['gone.txt'] }
  })
  const shot = { id: crypto.randomUUID(), name: 'shot.png', mimeType: 'image/png', size: 4 }
  const gone = { id: crypto.randomUUID(), name: 'gone.txt', mimeType: 'text/plain', size: 1 }
  const commandId = crypto.randomUUID()
  engine.hold = true
  await service.send({
    routerId: router.id,
    commandId,
    text: '',
    cardIds: [],
    attachments: [shot, gone]
  })
  await waitFor(() => engine.release, 'held batch')
  // Files alone name the thread; the thread shows every file the message carried.
  assert.equal(current().title, 'shot.png, gone.txt')
  assert.deepEqual(current().items.find((i) => i.id === commandId).attachments, [shot, gone])
  // A file deleted since it was sent is left out instead of failing the batch.
  assert.deepEqual(
    engine.runs[0].attachments.map((a) => a.path),
    [`/tmp/owlto-attachments/${shot.id}/shot.png`]
  )
  const doc = { id: crypto.randomUUID(), name: 'spec.md', mimeType: 'text/markdown', size: 9 }
  await service.send({
    routerId: router.id,
    commandId: crypto.randomUUID(),
    text: 'And this one',
    cardIds: [],
    attachments: [doc]
  })
  // A steered message cannot carry files, so it waits for the next batch.
  assert.deepEqual(engine.steered, [])
  engine.hold = false
  engine.release()
  await waitFor(() => engine.runs.length === 2 && current().status === 'idle', 'second batch')
  assert.match(engine.runs[1].text, /And this one/)
  assert.deepEqual(
    engine.runs[1].attachments.map((a) => a.name),
    ['spec.md']
  )
  service.close()
})

test('a directed message arriving during a batch does not start another one', async () => {
  const { engine, factory } = scriptedEngine()
  const { service, router, current } = harness([], { factory })
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length === 1)
      await tools.find((t) => t.name === 'dispatch_task').execute({ goal: 'Long job' })
  }
  engine.hold = true
  send(service, router, 'Start the job')
  await waitFor(() => engine.release, 'held batch')
  const [worker] = service.snapshot().workers
  await service.send({
    routerId: router.id,
    commandId: crypto.randomUUID(),
    text: 'Also check logs.',
    workerId: worker.id
  })
  engine.hold = false
  engine.release()
  await waitFor(() => current().status === 'idle', 'batch end')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(engine.runs.length, 1)
  service.close()
})

test('a message to a removed worker fails without touching the conversation', async () => {
  const { service, router, current, engine } = await withTools(async (call) => [
    await call('dispatch_task', { goal: 'Short job' })
  ])
  await waitFor(() => current().status === 'idle', 'dispatch batch')
  const worker = service.snapshot().workers[0]
  service.observe({ type: 'removed', sessionId: worker.sessionId })
  await waitFor(() => engine.runs.length === 2 && current().status === 'idle', 'removal batch')
  const commandId = crypto.randomUUID()
  await assert.rejects(
    service.send({ routerId: router.id, commandId, text: 'Hello?', workerId: worker.id }),
    /cannot take this action/
  )
  assert.equal(
    current().items.find((i) => i.id === commandId),
    undefined
  )
  service.close()
})

test('stopping a worker from the UI tells the Router without starting a batch', async () => {
  const { service, router, engine, current, store } = await withTools(async (call) => [
    await call('dispatch_task', { goal: 'Write A' }),
    await call('dispatch_task', { goal: 'Write B' })
  ])
  await waitFor(() => current().status === 'idle', 'dispatch batch')
  const queued = service.snapshot().workers.find((w) => w.status === 'queued')
  await service.stopWorker({ routerId: router.id, workerId: queued.id })
  assert.equal(service.snapshot().workers.find((w) => w.id === queued.id).status, 'stopped')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(engine.runs.length, 1)
  assert.ok(store.allEvents().some((e) => e.kind === 'worker_stopped' && e.workerId === queued.id))
  service.close()
})

test('resolving a blocked worker holds until it runs again', async () => {
  const blocked = (summary) => ({
    status: 'completed',
    structured: { status: 'blocked', summary, artifacts: [] },
    text: ''
  })
  const { service, router, engine, current } = await withTools(async (call) => [
    await call('dispatch_task', { goal: 'Open the page' })
  ])
  const worker = service.snapshot().workers[0]
  const latest = () => service.snapshot().workers.find((w) => w.id === worker.id)
  // A finished worker has nothing to resolve.
  service.settled(worker.sessionId, report('Opened.'))
  await waitFor(() => engine.runs.length === 2 && current().status === 'idle', 'report batch')
  service.resolveWorker({ routerId: router.id, workerId: worker.id })
  assert.equal(latest().resolved, undefined)
  await service.send({
    routerId: router.id,
    commandId: crypto.randomUUID(),
    text: 'Open it again.',
    workerId: worker.id
  })
  service.settled(worker.sessionId, blocked('The fetch was denied.'))
  await waitFor(() => engine.runs.length === 3 && current().status === 'idle', 'blocked batch')
  service.resolveWorker({ routerId: router.id, workerId: worker.id })
  assert.equal(latest().resolved, true)
  // Running again clears it, so a new blocked report waits on the user once more.
  await service.send({
    routerId: router.id,
    commandId: crypto.randomUUID(),
    text: 'Try the browser.',
    workerId: worker.id
  })
  assert.equal(latest().resolved, undefined)
  service.settled(worker.sessionId, blocked('Still denied.'))
  await waitFor(() => latest().status === 'reported' || latest().status === 'idle', 'report')
  assert.equal(latest().resolved, undefined)
  assert.throws(
    () => service.resolveWorker({ routerId: router.id, workerId: 'w_missing' }),
    /no longer exists/
  )
  service.close()
})

test('removing a worker goes through the host and rejects unknown workers', async () => {
  const { service, router, current, fake } = await withTools(async (call) => [
    await call('dispatch_task', { goal: 'Short job' })
  ])
  await waitFor(() => current().status === 'idle', 'dispatch batch')
  const worker = service.snapshot().workers[0]
  service.removeWorker({ routerId: router.id, workerId: worker.id })
  assert.deepEqual(fake.removed, [worker.sessionId])
  assert.throws(
    () => service.removeWorker({ routerId: router.id, workerId: 'w_missing' }),
    /no longer exists/
  )
  service.close()
})

test('a worker waiting for approval reaches the Router on its next batch without starting one', async () => {
  const { engine, factory } = scriptedEngine()
  const { service, router, current, store } = harness([], { factory })
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length === 1) await tools[0].execute({ goal: 'Deploy' })
  }
  await send(service, router, 'Deploy it')
  await waitFor(() => engine.runs.length === 1 && current().status === 'idle', 'first batch')
  const [worker] = service.snapshot().workers
  service.observe({
    type: 'session',
    session: {
      id: worker.sessionId,
      status: 'waiting',
      requests: [{ id: 'r1', kind: 'command', title: 'rm -rf build', status: 'pending' }]
    }
  })
  assert.equal(service.snapshot().workers[0].status, 'waiting')
  const waiting = store.allEvents().find((e) => e.kind === 'worker_waiting')
  assert.equal(waiting.status, 'pending')
  assert.equal(waiting.detail, 'rm -rf build')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(engine.runs.length, 1)
  await send(service, router, 'How is it going?')
  await waitFor(() => engine.runs.length === 2, 'next batch')
  assert.match(
    engine.runs[1].text,
    /worker_waiting .*\n.*\nWaiting for the user to approve: rm -rf/
  )
  service.close()
})

test('a waiting worker does not make the Router run again after a batch', async () => {
  const { engine, factory } = scriptedEngine()
  const { service, router, current } = harness([], { factory })
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length !== 1) return
    await tools[0].execute({ goal: 'Deploy' })
    const [worker] = service.snapshot().workers
    service.observe({
      type: 'session',
      session: { id: worker.sessionId, status: 'waiting', requests: [] }
    })
  }
  await send(service, router, 'Deploy it')
  await waitFor(() => engine.runs.length === 1 && current().status === 'idle', 'first batch')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(engine.runs.length, 1)
  service.close()
})

test('fixing the settings clears the failure and sends the waiting message', async () => {
  const { engine, factory } = scriptedEngine()
  let configured = false
  const { service, router, current } = harness([], {
    factory: (request) =>
      configured ? factory(request) : { code: 'router_model_unconfigured', message: '' }
  })
  await send(service, router, 'Hello')
  await waitFor(() => current().status === 'failed', 'setup failure')
  assert.equal(current().error.code, 'router_model_unconfigured')
  configured = true
  service.settingsChanged()
  await waitFor(() => engine.runs.length === 1, 'waiting message sent')
  assert.match(engine.runs[0].text, firstBatch('Hello'))
  assert.equal(current().error, null)
  service.close()
})

test('batches label directed messages even when they are alone', () => {
  const event = {
    seq: 7,
    kind: 'user_message',
    at: '2026-11-04T10:00:01.000Z',
    text: 'Use tabs.',
    workerId: 'w_1'
  }
  assert.match(renderBatch('b_1', [event], null), /\[7\] user_message · user · 10:00:01 · to w_1\n/)
  const { workerId: _workerId, ...plain } = event
  assert.equal(renderBatch('b_1', [plain], null), 'Use tabs.')
})
