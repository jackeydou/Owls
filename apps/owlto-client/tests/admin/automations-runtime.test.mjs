import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { cipher, commands, memoryRouterStore } from '../fixtures/router-store.mjs'

const require = createRequire(import.meta.url)
const {
  AutomationService,
  nextAutomationRun,
  OwltoError,
  renderBatch,
  RouterCredentials,
  RouterService,
  scheduleFromInput
} = require('../../out/main/app/runtime.js')

const local = (...parts) => new Date(...parts)

test('next runs follow the schedule in local time', () => {
  // 2026-11-13 is a Friday.
  const friday = local(2026, 10, 13, 10, 30)
  assert.deepEqual(
    nextAutomationRun({ frequency: 'hourly', minute: 15 }, friday),
    local(2026, 10, 13, 11, 15)
  )
  assert.deepEqual(
    nextAutomationRun({ frequency: 'daily', hour: 9, minute: 0 }, friday),
    local(2026, 10, 14, 9, 0),
    'a time already past today runs tomorrow'
  )
  assert.deepEqual(
    nextAutomationRun({ frequency: 'daily', hour: 11, minute: 0 }, friday),
    local(2026, 10, 13, 11, 0)
  )
  assert.deepEqual(
    nextAutomationRun({ frequency: 'weekdays', hour: 9, minute: 0 }, friday),
    local(2026, 10, 16, 9, 0),
    'weekdays skip the weekend'
  )
  assert.deepEqual(
    nextAutomationRun({ frequency: 'weekly', weekday: 5, hour: 10, minute: 0 }, friday),
    local(2026, 10, 20, 10, 0),
    'this week’s slot has passed, so next Friday'
  )
  assert.deepEqual(
    nextAutomationRun({ frequency: 'monthly', day: 31, hour: 9, minute: 0 }, local(2027, 1, 1)),
    local(2027, 1, 28, 9, 0),
    'a short month runs on its last day'
  )
  assert.deepEqual(scheduleFromInput({ frequency: 'weekly', time: '07:05' }), {
    frequency: 'weekly',
    weekday: 1,
    hour: 7,
    minute: 5
  })
  assert.deepEqual(scheduleFromInput({ frequency: 'hourly', time: '00:45' }), {
    frequency: 'hourly',
    minute: 45
  })
})

function memoryRecords() {
  const rows = new Map()
  return {
    rows,
    list: () => [...rows.values()].map((a) => structuredClone(a)),
    put: (a) => {
      rows.set(a.id, structuredClone(a))
      return structuredClone(a)
    },
    remove: (id) => rows.delete(id)
  }
}

function scheduler(deliver) {
  const clock = { now: local(2026, 10, 13, 8, 0) }
  const records = memoryRecords()
  const deliveries = []
  const service = new AutomationService({
    records,
    deliver: async (automation) => {
      deliveries.push(automation.id)
      return deliver(automation)
    },
    changed: () => {},
    now: () => new Date(clock.now)
  })
  return { service, records, deliveries, clock }
}
const daily = { frequency: 'daily', hour: 9, minute: 0 }
const userInput = (overrides = {}) => ({
  name: 'Briefing',
  instructions: 'Summarize yesterday.',
  schedule: daily,
  projectId: null,
  enabled: true,
  ...overrides
})

test('a due automation runs once per slot and keeps its new thread', async () => {
  const { service, deliveries, clock } = scheduler(async () => ({
    threadId: 'thread-1',
    fellBack: false
  }))
  const created = service.save(userInput())
  assert.equal(created.nextRunAt, local(2026, 10, 13, 9, 0).toISOString())
  await service.tick()
  assert.deepEqual(deliveries, [], 'not due yet')
  clock.now = local(2026, 10, 13, 9, 0, 30)
  await Promise.all([service.tick(), service.tick()])
  assert.deepEqual(deliveries, [created.id], 'two ticks for one slot deliver once')
  const after = service.get(created.id)
  assert.equal(after.nextRunAt, local(2026, 10, 14, 9, 0).toISOString())
  assert.deepEqual(after.target, { kind: 'router', threadId: 'thread-1' })
  assert.equal(after.lastRun.status, 'started')
  await service.runNow(created.id)
  assert.equal(deliveries.length, 2)
  assert.equal(
    service.get(created.id).nextRunAt,
    after.nextRunAt,
    'running now leaves the schedule alone'
  )
  service.close()
})

test('a failed delivery is recorded and paused automations never run', async () => {
  const { service, deliveries, clock } = scheduler(async () => {
    throw new Error('Threads are not available.')
  })
  const failing = service.save(userInput())
  const paused = service.save(userInput({ name: 'Paused', enabled: false }))
  assert.equal(paused.nextRunAt, null)
  clock.now = local(2026, 10, 13, 9, 5)
  await service.tick()
  assert.deepEqual(deliveries, [failing.id])
  const after = service.get(failing.id)
  assert.equal(after.lastRun.status, 'failed')
  assert.equal(after.lastRun.error, 'Threads are not available.')
  assert.equal(after.nextRunAt, local(2026, 10, 14, 9, 0).toISOString(), 'the next slot stays')
  service.close()
})

test('deleting a thread drops agent automations and frees user ones', () => {
  const { service } = scheduler(async () => ({ threadId: 'x', fellBack: false }))
  const agent = service.create({
    name: 'Watch CI',
    instructions: 'Check CI.',
    schedule: { frequency: 'hourly', minute: 0 },
    target: { kind: 'router', threadId: 't1' },
    projectId: null,
    createdBy: 'router'
  })
  const mine = service.save(userInput())
  service.threadRemoved('t1')
  assert.equal(service.get(agent.id), undefined)
  assert.ok(service.get(mine.id))
  service.close()
})

function fakeHost() {
  const sent = []
  const turns = { profiles: null }
  const settings = {
    agents: {
      codex: { model: 'gpt-test', effort: null, permission: 'workspace-write', browser: true },
      'claude-code': {
        model: null,
        effort: null,
        permission: 'workspace-write',
        browser: true,
        chrome: false
      },
      cursor: { model: null, effort: null, permission: 'workspace-write', browser: true }
    },
    router: {
      engine: 'owlto',
      owlto: null,
      claudeModel: null,
      codexModel: null,
      maxPermission: 'workspace-write'
    }
  }
  return {
    sent,
    turns,
    host: {
      projects: () => [],
      threadHome: () => '/tmp/owlto-thread-home',
      workspace: () => '/tmp/owlto-workspace',
      settings: () => settings,
      providerReady: () => true,
      agentModels: () => [],
      createSession: (input, worker) => ({ id: crypto.randomUUID(), ...input, worker }),
      remove: () => {},
      send: async (input) => {
        await turns.profiles?.prepare(input.sessionId)
        sent.push(input)
      },
      steer: async () => 'not_running',
      interrupt: async () => {}
    }
  }
}

/** A Router with a scripted engine and automations, as the app wires them. */
function app() {
  const store = memoryRouterStore()
  const fake = fakeHost()
  const runs = []
  let tools = []
  const engine = {
    async run(input, sink) {
      runs.push(input)
      sink.item({
        id: `reply-${runs.length}`,
        kind: 'assistant',
        status: 'completed',
        text: 'ok',
        detail: '',
        turnId: input.batchId
      })
      return { status: 'completed', error: null, native: { engine: 'owlto' } }
    },
    steer: async () => 'not_running',
    abort() {}
  }
  let router = null
  const automations = new AutomationService({
    records: memoryRecords(),
    deliver: (automation) => router.runAutomation(automation),
    changed: () => {}
  })
  router = new RouterService(
    store,
    new RouterCredentials(store, cipher),
    commands(),
    fake.host,
    () => {},
    (request) => {
      tools = request.tools
      return engine
    },
    undefined,
    undefined,
    undefined,
    automations,
    0
  )
  fake.turns.profiles = router
  const notes = []
  router.attachNotes({
    addFromAgent: (input) => {
      if (input.title === 'Broken') throw new Error('EACCES: /Users/me/Owlto/Notes/Broken.md')
      const note = { id: `c_${notes.length}`, ...input, tags: [...input.tags].sort() }
      notes.push(note)
      return note
    },
    editFromAgent: (input) => {
      const note = notes.find((n) => n.id === input.id)
      if (!note) throw new OwltoError('request_unavailable', 'This note no longer exists.')
      if (input.title === 'Broken') throw new Error('EACCES: /Users/me/Owlto/Notes/Broken.md')
      Object.assign(note, {
        ...(input.title ? { title: input.title } : {}),
        ...(input.body ? { body: input.body } : {}),
        ...(input.tags ? { tags: [...input.tags].sort() } : {})
      })
      note.lastEdit = input
      return note
    },
    folder: () => '/Users/me/Owlto/Notes'
  })
  return { router, store, automations, runs, fake, notes, tools: () => tools }
}

async function waitFor(check, label) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`Timed out waiting for ${label}`)
}

test('the Router creates an automation whose run comes back to its thread', async () => {
  const { router, store, automations, runs, tools } = app()
  const thread = router.createThread({ projectId: null })
  router.send({ routerId: thread.id, commandId: crypto.randomUUID(), text: 'hi' })
  await waitFor(() => runs.length === 1, 'the first batch')
  const names = tools().map((t) => t.name)
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
    'tools stay sorted by name'
  )
  const create = tools().find((t) => t.name === 'create_automation')
  const result = JSON.parse(
    await create.execute({
      name: 'PR check',
      instructions: 'Check open pull requests.',
      schedule: { frequency: 'weekdays', time: '09:00' }
    })
  )
  assert.equal(result.automation.schedule, 'weekdays at 09:00')
  assert.equal(result.automation.wakes, 'router')
  const list = JSON.parse(
    await tools()
      .find((t) => t.name === 'list_automations')
      .execute({})
  )
  assert.equal(list.automations.length, 1)
  const update = tools().find((t) => t.name === 'update_automation')
  const paused = JSON.parse(
    await update.execute({
      automationId: result.automation.automationId,
      schedule: { frequency: 'daily', time: '18:30' },
      enabled: false
    })
  )
  assert.equal(paused.automation.schedule, 'daily at 18:30')
  assert.equal(paused.automation.enabled, false)
  assert.equal(paused.automation.nextRunAt, null)
  assert.equal(paused.automation.name, 'PR check', 'fields left out stay as they were')
  const resumed = JSON.parse(
    await update.execute({ automationId: result.automation.automationId, enabled: true })
  )
  assert.ok(resumed.automation.nextRunAt, 'a resumed automation is scheduled again')
  await assert.rejects(
    update.execute({ automationId: result.automation.automationId }),
    /arguments are invalid/
  )
  await assert.rejects(
    update.execute({ automationId: 'au_missing', enabled: false }),
    /No automation/
  )
  const [automation] = automations.list()
  assert.deepEqual(automation.target, { kind: 'router', threadId: thread.id })
  assert.equal(automation.createdBy, 'router')

  await automations.runNow(automation.id)
  await waitFor(() => runs.length === 2, 'the automation batch')
  assert.match(runs[1].text, /automation_run · au_[0-9a-f]+ · .* · PR check/)
  assert.match(runs[1].text, /written by a router[\s\S]*Check open pull requests\./)
  const item = router.items(thread.id).find((e) => e.item.automation)
  assert.equal(item.item.text, 'Check open pull requests.')
  assert.deepEqual(item.item.automation, { id: automation.id, name: 'PR check' })
  assert.equal(store.events(thread.id, 'pending').length, 0)

  await assert.rejects(
    tools()
      .find((t) => t.name === 'delete_automation')
      .execute({ automationId: 'au_missing' }),
    /No automation/
  )
  router.close()
  automations.close()
})

test('workers get the browser tools when their agent allows it, read-only included', async () => {
  const { router, automations, runs, fake, tools } = app()
  const calls = []
  router.attachBrowser({
    run: async (key, code, timeoutMs, mode) => {
      calls.push({ key, code, timeoutMs, mode })
      return { ok: true, text: 'Result: done' }
    },
    handoff: async (key, reason, timeoutMs) => {
      calls.push({ key, reason, timeoutMs })
      return { ok: true, text: 'The user handed the tab back.' }
    }
  })
  const thread = router.createThread({ projectId: null })
  router.send({ routerId: thread.id, commandId: crypto.randomUUID(), text: 'hi' })
  await waitFor(() => runs.length === 1, 'the first batch')
  const dispatch = async (input) =>
    router.worker(
      JSON.parse(
        await tools()
          .find((t) => t.name === 'dispatch_task')
          .execute(input)
      ).workerId
    )
  const writer = await dispatch({ goal: 'Check the page' })
  await waitFor(() => fake.sent.length === 1, 'the writing worker turn')
  const tool = router.profile(writer.sessionId).tools.find((t) => t.name === 'browser')
  assert.ok(tool, 'a workspace-write worker gets the browser tool')
  const result = await tool.call({ code: 'return 1' })
  assert.deepEqual(result, { ok: true, text: 'Result: done' })
  assert.deepEqual(calls, [
    { key: writer.id, code: 'return 1', timeoutMs: 60_000, mode: 'restricted' }
  ])
  const bad = await tool.call({ code: '' })
  assert.equal(bad.ok, false)
  assert.match(bad.text, /^Invalid browser input\./)
  const handoff = router.profile(writer.sessionId).tools.find((t) => t.name === 'browser_handoff')
  assert.ok(handoff, 'the hand-off tool comes with the browser tool')
  await handoff.call({ reason: '  Sign in\n to GitHub ' })
  assert.deepEqual(calls.at(-1), {
    key: writer.id,
    reason: 'Sign in to GitHub',
    timeoutMs: 900_000
  })
  assert.equal((await handoff.call({ reason: '' })).ok, false, 'a hand-off needs a reason')

  fake.host.settings().agents.codex.permission = 'read-only'
  const reader = await dispatch({ goal: 'Read the docs' })
  await waitFor(() => fake.sent.length === 2, 'the read-only worker turn')
  assert.equal(reader.permission, 'read-only')
  const readerTool = router.profile(reader.sessionId).tools.find((t) => t.name === 'browser')
  assert.ok(readerTool, 'a read-only worker gets the browser tool too')
  await readerTool.call({ code: 'return 2' })
  assert.equal(calls.at(-1).mode, 'restricted', 'a read-only worker runs scripts restricted')
  fake.host.settings().agents.codex.permission = 'workspace-write'

  fake.host.settings().agents.codex.browser = false
  const off = await dispatch({ goal: 'Check another page' })
  await waitFor(() => fake.sent.length === 3, 'the worker turn with the browser off')
  assert.equal(
    router.profile(off.sessionId).tools.some((t) => t.name.startsWith('browser')),
    false,
    'the Codex browser switch turns the tools off'
  )
  const claude = await dispatch({ goal: 'Check with Claude', provider: 'claude-code' })
  await waitFor(() => fake.sent.length === 4, 'the Claude worker turn')
  assert.equal(claude.provider, 'claude-code')
  assert.ok(
    router.profile(claude.sessionId).tools.some((t) => t.name === 'browser'),
    'Claude Code workers get the browser tool too'
  )
  router.close()
  automations.close()
})

test('a worker schedules its own follow-up, and a user automation opens its own thread', async () => {
  const { router, store, automations, runs, fake, tools } = app()
  const thread = router.createThread({ projectId: null })
  router.send({ routerId: thread.id, commandId: crypto.randomUUID(), text: 'hi' })
  await waitFor(() => runs.length === 1, 'the first batch')
  const dispatched = JSON.parse(
    await tools()
      .find((t) => t.name === 'dispatch_task')
      .execute({ goal: 'Open a PR' })
  )
  await waitFor(() => fake.sent.length === 1, 'the worker turn')
  const worker = router.worker(dispatched.workerId)
  const profile = router.profile(worker.sessionId)
  assert.deepEqual(
    profile.tools.map((t) => t.name),
    [
      'create_automation',
      'delete_automation',
      'edit_note',
      'list_automations',
      'save_note',
      'update_automation'
    ]
  )
  const tool = (name) => profile.tools.find((t) => t.name === name)
  const created = tool('create_automation').call({
    name: 'Watch CI',
    instructions: 'Check CI on the PR.',
    schedule: { frequency: 'hourly', time: '00:10' }
  })
  assert.equal(created.ok, true, created.text)
  assert.equal(JSON.parse(created.text).automation.wakes, `worker ${worker.id}`)
  const renamed = tool('update_automation').call({
    automationId: JSON.parse(created.text).automation.automationId,
    name: 'Watch CI on #12'
  })
  assert.equal(renamed.ok, true, renamed.text)
  assert.equal(JSON.parse(renamed.text).automation.wakes, `worker ${worker.id}`)
  const bad = tool('create_automation').call({ name: 'x' })
  assert.equal(bad.ok, false)
  assert.match(bad.text, /^Invalid create_automation input\./)

  // Let the worker's turn end so the follow-up can start a new one.
  router.settled(worker.sessionId, { status: 'completed', structured: null, text: '' })
  const [automation] = automations.list()
  await automations.runNow(automation.id)
  await waitFor(() => fake.sent.length === 2, 'the follow-up turn')
  assert.match(
    fake.sent[1].text,
    /Scheduled automation "Watch CI on #12"[\s\S]*Check CI on the PR\./
  )
  const quiet = store.allEvents().find((e) => e.kind === 'automation_run')
  assert.equal(quiet.workerId, worker.id, 'the Router only reads a run sent to a worker')

  const mine = automations.save({
    name: 'Daily briefing',
    instructions: 'Summarize yesterday.',
    schedule: { frequency: 'daily', hour: 9, minute: 0 },
    projectId: null,
    enabled: true
  })
  await automations.runNow(mine.id)
  const threadId = automations.get(mine.id).target.threadId
  assert.ok(threadId && threadId !== thread.id, 'the first run opened a thread')
  assert.equal(router.title(threadId), 'Daily briefing')
  router.close()
  automations.close()
})

test('pull request changes go to the worker that opened it, or the Router once it is gone', async () => {
  const { router, store, automations, runs, fake, tools } = app()
  const thread = router.createThread({ projectId: null })
  router.send({ routerId: thread.id, commandId: crypto.randomUUID(), text: 'hi' })
  await waitFor(() => runs.length === 1, 'the first batch')
  const { workerId } = JSON.parse(
    await tools()
      .find((t) => t.name === 'dispatch_task')
      .execute({ goal: 'Open a PR' })
  )
  await waitFor(() => fake.sent.length === 1, 'the worker turn')
  const worker = router.worker(workerId)
  router.settled(worker.sessionId, { status: 'completed', structured: null, text: '' })
  await waitFor(() => runs.length === 2, 'the batch for the worker report')
  const pr = {
    owner: 'acme',
    name: 'app',
    number: 7,
    title: 'Fix login',
    url: 'https://github.com/acme/app/pull/7',
    workerId
  }
  const failed = [{ kind: 'checks_failed', detail: 'Failing checks: lint.', url: 'https://ci/1' }]

  await router.pullRequestEvents(pr, failed, true)
  await waitFor(() => fake.sent.length === 2, 'the follow-up turn')
  assert.match(
    fake.sent[1].text,
    /GitHub activity on your pull request acme\/app#7[\s\S]*Failing checks: lint\. \(https:\/\/ci\/1\)/
  )
  const item = router.items(thread.id).find((e) => e.item.github)
  assert.deepEqual(item.item.github, { url: pr.url, label: 'acme/app#7' })
  assert.equal(item.item.workerId, workerId)
  const quiet = store.allEvents().filter((e) => e.kind === 'github_event')
  assert.equal(quiet.at(-1).delivered, 'worker')
  assert.equal(runs.length, 2, 'the Router does not wake for a change its worker handles')

  await router.pullRequestEvents(pr, [{ kind: 'merged', detail: 'Merged.', url: pr.url }], false)
  assert.equal(
    store
      .allEvents()
      .filter((e) => e.kind === 'github_event')
      .at(-1).delivered,
    'none'
  )
  assert.equal(fake.sent.length, 2)

  router.settled(worker.sessionId, { status: 'completed', structured: null, text: '' })
  router.observe({ type: 'removed', sessionId: worker.sessionId })
  await router.pullRequestEvents(pr, failed, true)
  const handed =
    /github_event · w_[0-9a-f]+ · .* · acme\/app#7[\s\S]*was removed, so this comes to you/
  await waitFor(() => runs.some((r) => handed.test(r.text)), 'the Router batch')
  assert.equal(fake.sent.length, 2, 'a removed worker gets nothing')
  router.close()
  automations.close()
})

test('a batch renders an automation run for the Router', () => {
  const text = renderBatch('b_1', [
    {
      seq: 3,
      kind: 'automation_run',
      at: '2026-11-13T09:00:00.000Z',
      automationId: 'au_1',
      name: 'Briefing',
      instructions: 'Summarize yesterday.',
      createdBy: 'user'
    }
  ])
  assert.match(text, /\[3\] automation_run · au_1 · 09:00:00 · Briefing/)
  assert.match(text, /written by the user when it was created:\nSummarize yesterday\./)
})

test('the Router and workers save notes with save_note', async () => {
  const { router, runs, fake, notes, tools } = app()
  const thread = router.createThread({ projectId: null })
  router.send({ routerId: thread.id, commandId: crypto.randomUUID(), text: 'hi' })
  await waitFor(() => runs.length === 1, 'the first batch')
  const save = tools().find((t) => t.name === 'save_note')
  const saved = JSON.parse(
    await save.execute({ title: 'Summary', body: 'Three points.', tags: ['b', 'a'] })
  )
  assert.deepEqual(saved, { saved: { noteId: 'c_0', title: 'Summary', tags: ['a', 'b'] } })
  assert.deepEqual(notes[0].source, {
    kind: 'message',
    threadId: thread.id,
    threadTitle: thread.title,
    itemId: null,
    workerId: null
  })
  await assert.rejects(save.execute({ title: '', body: 'x' }), { code: 'invalid_request' })
  await assert.rejects(save.execute({ title: 'Broken', body: 'x' }), (error) => {
    assert.equal(error.code, 'tool_failed')
    assert.equal(error.message, 'The note could not be saved.', 'no local path reaches the model')
    return true
  })

  const dispatched = JSON.parse(
    await tools()
      .find((t) => t.name === 'dispatch_task')
      .execute({ goal: 'Research' })
  )
  await waitFor(() => fake.sent.length === 1, 'the worker turn')
  const worker = router.worker(dispatched.workerId)
  const profile = router.profile(worker.sessionId)
  // Workers are told where the note files are, so they can search and read them.
  assert.match(profile.instructions, /Notes are Markdown files in \/Users\/me\/Owlto\/Notes/)
  const workerSave = profile.tools.find((t) => t.name === 'save_note')
  const result = workerSave.call({ title: 'Findings', body: 'Done.' })
  assert.equal(result.ok, true, result.text)
  assert.equal(notes[1].source.kind, 'worker')
  assert.equal(notes[1].source.workerId, worker.id)
  assert.deepEqual(notes[1].tags, [])
})

test('the Router and workers edit notes with edit_note', async () => {
  const { router, runs, fake, notes, tools } = app()
  const thread = router.createThread({ projectId: null })
  router.send({ routerId: thread.id, commandId: crypto.randomUUID(), text: 'hi' })
  await waitFor(() => runs.length === 1, 'the first batch')
  const save = tools().find((t) => t.name === 'save_note')
  await save.execute({ title: 'Summary', body: 'Three points.' })
  const edit = tools().find((t) => t.name === 'edit_note')
  const edited = JSON.parse(
    await edit.execute({
      noteId: 'c_0',
      edits: [{ oldText: 'Three', newText: 'Four' }],
      tags: ['x']
    })
  )
  assert.deepEqual(edited, { edited: { noteId: 'c_0', title: 'Summary', tags: ['x'] } })
  assert.deepEqual(notes[0].lastEdit, {
    id: 'c_0',
    title: undefined,
    body: undefined,
    edits: [{ oldText: 'Three', newText: 'Four' }],
    tags: ['x']
  })
  await assert.rejects(edit.execute({ noteId: 'c_0', edits: [] }), { code: 'invalid_request' })
  await assert.rejects(edit.execute({ noteId: 'c_9', body: 'x' }), (error) => {
    assert.equal(error.code, 'tool_failed')
    assert.equal(error.message, 'This note no longer exists.')
    return true
  })
  await assert.rejects(edit.execute({ noteId: 'c_0', title: 'Broken' }), (error) => {
    assert.equal(error.message, 'The note could not be edited.', 'no local path reaches the model')
    return true
  })

  const dispatched = JSON.parse(
    await tools()
      .find((t) => t.name === 'dispatch_task')
      .execute({ goal: 'Research' })
  )
  await waitFor(() => fake.sent.length === 1, 'the worker turn')
  const worker = router.worker(dispatched.workerId)
  const profile = router.profile(worker.sessionId)
  assert.match(profile.instructions, /change an existing one only with edit_note/)
  const workerEdit = profile.tools.find((t) => t.name === 'edit_note')
  const result = workerEdit.call({ noteId: 'c_0', body: 'Rewritten.' })
  assert.equal(result.ok, true, result.text)
  assert.equal(notes[0].body, 'Rewritten.')
  const missing = workerEdit.call({ noteId: 'c_9', body: 'x' })
  assert.equal(missing.ok, false)
  assert.equal(missing.text, 'This note no longer exists.')
})
