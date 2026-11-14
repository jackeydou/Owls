import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { memoryRecords } from '../fixtures/memory-records.mjs'

const require = createRequire(import.meta.url)
const {
  CodexRouterServer,
  DreamingRunner,
  DreamingStage,
  DreamingTriggers,
  MemoryService,
  MemorySweeper,
  dreamingEngineFactory,
  estimateTokens,
  looksSecret,
  renderInjection,
  renderMarkdown
} = require('../../out/main/app/runtime.js')

const PROJECTS = [
  { id: 'p1', name: 'Owlto', path: '/tmp/owlto' },
  { id: 'p2', name: 'Reports', path: '/tmp/reports' }
]
const NOW = new Date('2026-11-08T12:00:00.000Z')

function settingsOf(overrides = {}) {
  return {
    language: 'zh-CN',
    provider: 'codex',
    ...overrides,
    memory: {
      learn: true,
      inject: true,
      provider: null,
      claudeModel: null,
      codexModel: null,
      ...overrides.memory
    }
  }
}

function setup(overrides = {}) {
  const records = overrides.records ?? memoryRecords()
  let settings = settingsOf(overrides.settings)
  let changes = 0
  const service = new MemoryService({
    records,
    projects: () => PROJECTS,
    settings: () => settings,
    threadTitle: (id) => (id === 't1' ? 'Weekly report' : null),
    changed: () => changes++,
    now: () => NOW
  })
  return {
    records,
    service,
    changes: () => changes,
    setSettings: (next) => {
      settings = settingsOf(next)
    }
  }
}

function category(service, name, description = `${name} things`) {
  const id = `mc_${name.toLowerCase().padEnd(8, '0').slice(0, 8)}`
  service.category({ action: 'add', id, name, description })
  return id
}

test('user edits name the version they saw, and a stale one changes nothing', () => {
  const { service, records, changes } = setup()
  const work = category(service, 'work')
  const added = service.save({
    action: 'add',
    id: 'm_aaaaaaaa',
    text: 'Replies in Chinese, conclusion first',
    scope: { store: 'personal', categoryId: work }
  })
  assert.equal(added.origin, 'user')
  assert.equal(added.editedByUser, true)
  const pinned = service.save({ action: 'pin', id: added.id, baseRev: added.rev, pinned: true })
  assert.equal(pinned.pinned, true)
  assert.ok(pinned.rev > added.rev)
  // An edit made against the old version lost the race and is refused.
  assert.throws(
    () => service.save({ action: 'update', id: added.id, baseRev: added.rev, text: 'Other' }),
    (error) => error.code === 'request_unavailable'
  )
  assert.equal(records.memories()[0].text, 'Replies in Chinese, conclusion first')
  // A repeated add with the same id is refused instead of adding twice.
  assert.throws(() =>
    service.save({
      action: 'add',
      id: 'm_aaaaaaaa',
      text: 'Again',
      scope: { store: 'personal', categoryId: work }
    })
  )
  assert.ok(changes() > 0)
})

test('deleting leaves a tombstone without the text, source, or a place in lists', () => {
  const { service, records } = setup()
  const work = category(service, 'work')
  const memory = service.save({
    action: 'add',
    id: 'm_bbbbbbbb',
    text: 'Leads the Owlto team',
    scope: { store: 'personal', categoryId: work }
  })
  service.remove({ id: memory.id, baseRev: memory.rev })
  const [row] = records.memories()
  assert.equal(row.status, 'deleted')
  assert.equal(row.text, '')
  assert.deepEqual(row.source, { threadId: null, itemIds: [], workerIds: [], runId: null })
  assert.ok(row.rev > memory.rev)
  assert.deepEqual(service.list({ store: 'personal', archived: true }), [])
  assert.throws(() => service.remove({ id: memory.id, baseRev: row.rev }))
})

test('merging categories moves memories and leaves a pointer; removing deletes them', () => {
  const { service, records } = setup()
  const money = category(service, 'money', 'Money matters')
  const invest = category(service, 'invest', 'Investing')
  const sport = category(service, 'sport', 'Sports')
  for (const [id, categoryId] of [
    ['m_00000001', money],
    ['m_00000002', invest],
    ['m_00000003', sport]
  ])
    service.save({
      action: 'add',
      id,
      text: `fact ${id}`,
      scope: { store: 'personal', categoryId }
    })
  const rev = (id) => records.categories().find((c) => c.id === id).rev
  service.category({ action: 'merge', id: money, baseRev: rev(money), into: invest })
  const tomb = records.categories().find((c) => c.id === money)
  assert.equal(tomb.status, 'deleted')
  assert.equal(tomb.mergedInto, invest)
  assert.equal(tomb.name, '')
  assert.equal(records.memories().find((m) => m.id === 'm_00000001').categoryId, invest)
  service.category({ action: 'remove', id: sport, baseRev: rev(sport) })
  assert.equal(records.memories().find((m) => m.id === 'm_00000003').status, 'deleted')
  const overview = service.overview(false)
  assert.deepEqual(
    overview.categories.map((c) => [c.name, c.count]),
    [['invest', 2]]
  )
  // A late Dreaming write that still names the merged category follows the pointer.
  const stage = new DreamingStage(records.memories(), records.categories(), {
    runId: 'mr_1',
    threadId: 't1',
    projects: PROJECTS,
    now: NOW
  })
  const [result] = stage.stage([
    { op: 'add', store: 'personal', category: money, text: 'Prefers index funds', sources: [] }
  ])
  assert.equal(result.ok, true)
  assert.equal(stage.writes()[0].value.categoryId, invest)
})

test('the Dreaming stage refuses what the RFC rules out and explains why', () => {
  const { service, records } = setup()
  const work = category(service, 'work')
  const owned = service.save({
    action: 'add',
    id: 'm_cccccccc',
    text: 'Works at a startup',
    scope: { store: 'personal', categoryId: work }
  })
  const stage = new DreamingStage(records.memories(), records.categories(), {
    runId: 'mr_1',
    threadId: 't1',
    projects: PROJECTS,
    now: NOW
  })
  const results = stage.stage([
    { op: 'archive', id: owned.id, reason: 'old' },
    { op: 'create_category', name: 'WORK', description: 'dup' },
    { op: 'add', store: 'personal', project: 'Owlto', text: 'x', sources: [] },
    { op: 'add', store: 'project', project: 'Nope', kind: 'rule', text: 'x', sources: [] },
    {
      op: 'add',
      store: 'personal',
      category: 'work',
      text: 'api_key = sk-abcdefghijklmnopqrstuvwxyz',
      sources: []
    },
    { op: 'add', store: 'personal', category: 'hobby', text: 'Plays chess', sources: [] },
    {
      op: 'add',
      ref: 'new',
      store: 'project',
      project: 'owlto',
      kind: 'status',
      text: 'Memory tab is on branch owlto/w_1',
      sources: ['w_1', 'item-9']
    }
  ])
  assert.deepEqual(
    results.map((r) => (r.ok ? 'ok' : r.error)),
    [
      'user_owned',
      'category_exists',
      'invalid_scope',
      'project_not_found',
      'secret_detected',
      'category_not_found',
      'ok'
    ]
  )
  const [write] = stage.writes()
  assert.equal(write.baseRev, null)
  assert.equal(write.value.projectId, 'p1')
  assert.deepEqual(write.value.source.workerIds, ['w_1'])
  assert.deepEqual(write.value.source.itemIds, ['item-9'])
  // Status without an expiry lasts 14 days.
  assert.equal(write.value.expiresAt, '2026-11-22T12:00:00.000Z')
})

test('the category limit holds, and supersede archives the old fact for the new one', () => {
  const { service, records } = setup()
  for (let i = 0; i < 24; i++) category(service, `c${String(i).padStart(2, '0')}`)
  const job = service.save({
    action: 'add',
    id: 'm_dddddddd',
    text: 'Works at Acme',
    scope: { store: 'personal', categoryId: records.categories()[0].id }
  })
  // The user owns their own adds, so make a Dreaming-owned copy to supersede.
  records.commit({
    mode: 'all',
    writes: [
      {
        kind: 'memory',
        baseRev: job.rev,
        value: { ...job, origin: 'dreaming', editedByUser: false }
      }
    ]
  })
  const stage = new DreamingStage(records.memories(), records.categories(), {
    runId: 'mr_1',
    threadId: 't1',
    projects: PROJECTS,
    now: NOW
  })
  const results = stage.stage([
    { op: 'create_category', name: 'travel', description: 'Trips' },
    {
      op: 'add',
      ref: 'job',
      store: 'personal',
      category: records.categories()[0].name,
      text: 'Works at Globex',
      sources: []
    },
    { op: 'supersede', id: job.id, by: 'job' }
  ])
  assert.deepEqual(
    results.map((r) => (r.ok ? 'ok' : r.error)),
    ['category_limit', 'ok', 'ok']
  )
  // A category created in a run and left empty is not saved.
  const empty = new DreamingStage([], [], {
    runId: 'mr_2',
    threadId: 't1',
    projects: PROJECTS,
    now: NOW
  })
  empty.stage([{ op: 'create_category', name: 'style', description: 'Reply style' }])
  assert.deepEqual(empty.writes(), [])
  const summary = stage.summary()
  assert.equal(summary.added.length, 1)
  assert.deepEqual(summary.archived, [job.id])
  const old = stage.writes().find((w) => w.value.id === job.id)
  assert.equal(old.value.status, 'archived')
  assert.equal(old.value.supersededBy, summary.added[0])
  assert.equal(old.baseRev, records.memories().find((m) => m.id === job.id).rev)
})

test('the injected block is deterministic, within budget, and never cuts a line', () => {
  const { service, records } = setup({ settings: { language: 'zh-CN' } })
  const work = category(service, '工作', '职位、团队和工作习惯')
  for (let i = 0; i < 30; i++)
    service.save({
      action: 'add',
      id: `m_${String(i).padStart(8, '0')}`,
      text: `第 ${i} 条记忆：${'很长的内容'.repeat(20)}`,
      scope: { store: 'personal', categoryId: work },
      pinned: i === 3
    })
  records.commit({
    mode: 'each',
    writes: [
      {
        kind: 'memory',
        baseRev: null,
        value: {
          ...records.memories()[0],
          id: 'm_expired0',
          text: 'Traveling this week',
          rev: 0,
          expiresAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-09T00:00:00.000Z'
        }
      }
    ]
  })
  const text = service.injection('p1')
  assert.equal(text, service.injection('p1'))
  assert.ok(estimateTokens(text) <= 1500)
  assert.match(text, /^Memory \(saved by Owlto/)
  assert.match(text, /- 工作 · mc_\S+ · 30 · 职位、团队和工作习惯/)
  assert.match(text, /Project memory \(Owlto\): rule 规则 0 · decision 决定 0/)
  assert.match(text, /Pinned:\n- m_00000003 · 工作/)
  assert.doesNotMatch(text, /Traveling this week/)
  for (const line of text.split('\n').filter((l) => l.startsWith('- m_')))
    assert.ok(line.endsWith('…') || line.endsWith('内容'), line)
  // A tiny budget keeps whole lines only.
  const small = renderInjection({
    memories: records.memories(),
    categories: records.categories(),
    project: null,
    language: 'en',
    now: NOW,
    budget: 120
  })
  assert.ok(estimateTokens(small) <= 120)
  assert.doesNotMatch(small, /Recent:/)
  // Turning injection off, or having no memories, injects nothing.
  assert.equal(setup().service.injection(null), null)
  const off = setup({ records, settings: { memory: { inject: false } } })
  assert.equal(off.service.injection('p1'), null)
  assert.equal(off.service.categoryLine(), null)
})

test('search filters by store, category, project, and kind, and ranks by keyword hits', () => {
  const { service } = setup({ settings: { language: 'en' } })
  const sport = category(service, 'sport')
  const add = (id, text, scope) => service.save({ action: 'add', id, text, scope })
  add('m_s0000001', 'Plays badminton on Tuesday evenings', { store: 'personal', categoryId: sport })
  add('m_s0000002', 'Runs on Sunday mornings', { store: 'personal', categoryId: sport })
  add('m_p0000001', 'Use pnpm, never npm', { store: 'project', projectId: 'p1', kind: 'rule' })
  add('m_p0000002', 'Weekly report goes to Dana on Friday', {
    store: 'project',
    projectId: 'p2',
    kind: 'rule'
  })
  const ids = (result) => result.memories.map((m) => m.id)
  assert.deepEqual(ids(service.search({ query: 'badminton tuesday' })), ['m_s0000001'])
  assert.deepEqual(ids(service.search({ category: 'Sport' })).sort(), ['m_s0000001', 'm_s0000002'])
  assert.deepEqual(ids(service.search({ project: 'owlto' })), ['m_p0000001'])
  assert.deepEqual(ids(service.search({ kind: 'rule', query: 'friday' })), ['m_p0000002'])
  const [hit] = service.search({ project: 'Reports' }).memories
  assert.equal(hit.kind, 'rule')
  assert.equal(hit.project, 'Reports')
  assert.equal(service.search({ limit: 1 }).more, 3)
  assert.throws(() => service.search({ category: 'nope' }), /No memory category/)
})

test('secrets are refused for the user too, and export lists active memories', () => {
  const { service } = setup({ settings: { language: 'en' } })
  const work = category(service, 'work')
  assert.ok(looksSecret('token: ghp_abcdefghijklmnopqrstuvwxyz0123'))
  assert.ok(looksSecret('我的密码是 hunter2hunter2'))
  assert.equal(
    looksSecret('Results are in /Users/me/Dou/Owlto/apps/owlto-client/src/main/memory'),
    false
  )
  assert.equal(looksSecret('Branch owlto/w_1a2b3c4d holds the memory tab'), false)
  assert.throws(
    () =>
      service.save({
        action: 'add',
        id: 'm_eeeeeeee',
        text: 'password = correct-horse-battery',
        scope: { store: 'personal', categoryId: work }
      }),
    (error) => error.code === 'invalid_request'
  )
  service.save({
    action: 'add',
    id: 'm_ffffffff',
    text: 'Prefers short replies',
    scope: { store: 'personal', categoryId: work },
    pinned: true
  })
  const markdown = service.export('markdown')
  assert.match(markdown, /## Personal memory\n\n### work\n\n- 📌 Prefers short replies/)
  const json = JSON.parse(service.export('json'))
  assert.equal(json.memories.length, 1)
  assert.equal(typeof renderMarkdown, 'function')
})

/** A Dreaming engine that runs `script(tools)` as its turn. */
function scriptedEngine(script, outcome = { status: 'completed', error: null }) {
  const runs = []
  const factory = (request) => ({
    async run(input, sink) {
      runs.push({ request, input })
      sink.usage({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 })
      const byName = Object.fromEntries(request.tools.map((t) => [t.name, t]))
      await script(byName, input)
      return { ...outcome, native: { engine: 'codex', threadId: null, promptVersion: 1 } }
    },
    steer: async () => 'not_running',
    abort() {}
  })
  return { runs, factory }
}

function dreamingSetup({ engine, items, reports = {}, settings, records } = {}) {
  const base = setup({ settings, records })
  let current = settingsOf(settings)
  const threads = [
    { id: 't1', title: 'Weekly report', projectId: 'p2', status: 'idle' },
    { id: 't2', title: 'Busy', projectId: null, status: 'running' }
  ]
  const workers = {
    w_1: {
      id: 'w_1',
      routerId: 't1',
      projectId: 'p2',
      sessionId: 's1',
      workspace: { kind: 'worktree', branch: 'owlto/w_1' },
      status: 'reported'
    }
  }
  const runner = new DreamingRunner({
    memory: base.service,
    threads: () => threads,
    items: (id) => items[id] ?? [],
    reports: (id, after) => (reports[id] ?? []).filter((e) => e.seq > after),
    worker: (id) => workers[id],
    sessionItems: () => [
      { id: 'a1', kind: 'assistant', status: 'completed', text: 'Checked the archive too.' }
    ],
    projects: () => PROJECTS,
    settings: () => current,
    engine,
    changed: () => {},
    now: () => NOW
  })
  const setSettings = (next) => {
    current = settingsOf(next)
    base.setSettings(next)
  }
  return { ...base, runner, threads, setSettings }
}

const item = (id, kind, text, rev, position) => ({
  item: { id, kind, status: 'completed', text, detail: '', turnId: null },
  position,
  rev
})

test('a Dreaming run reads new content, commits staged changes with its cursor, and records itself', async () => {
  const engine = scriptedEngine(async (tools) => {
    await tools.stage_memory_changes.execute({
      changes: [
        { op: 'create_category', name: 'work', description: 'Job and team' },
        {
          op: 'add',
          store: 'personal',
          category: 'work',
          text: 'Sends the weekly report on Fridays',
          sources: ['u1']
        },
        {
          op: 'add',
          store: 'project',
          project: 'Reports',
          kind: 'knowledge',
          text: 'Dana reviews the weekly report',
          sources: ['w_1']
        }
      ]
    })
  })
  const items = {
    t1: [
      item('u1', 'user', 'I send the weekly report on Fridays', 4, 0),
      item('r1', 'assistant', 'Noted, dispatching.', 5, 1),
      item('tool1', 'tool', 'dispatch_task', 5, 2)
    ],
    t2: [item('u2', 'user', 'still running', 6, 0)]
  }
  const reports = {
    t1: [
      {
        seq: 9,
        kind: 'worker_report',
        at: NOW.toISOString(),
        workerId: 'w_1',
        goal: 'Find who reviews the report',
        report: { status: 'done', summary: 'Dana reviews it.', artifacts: [] }
      }
    ]
  }
  const { runner, records, service } = dreamingSetup({ engine: engine.factory, items, reports })
  await runner.runNow()
  // The running thread waits for its next trigger.
  assert.equal(engine.runs.length, 1)
  const [{ input, request }] = engine.runs
  assert.equal(request.provider, 'codex')
  assert.match(input.text, /^<owlto-dreaming-input thread="t1">/)
  assert.match(input.text, /\[u1\] user\nI send the weekly report on Fridays/)
  assert.doesNotMatch(input.text, /dispatch_task/)
  assert.match(input.text, /\[w_1\] worker report · done · project Reports · branch owlto\/w_1/)
  assert.match(input.text, /Worker's last messages:\n- Checked the archive too\./)
  assert.deepEqual(records.cursor('t1'), { threadId: 't1', itemRev: 5, eventSeq: 9 })
  const [run] = service.runs()
  assert.equal(run.status, 'completed')
  assert.equal(run.added.length, 2)
  assert.equal(run.tokens, 15)
  assert.equal(run.toItemRev, 5)
  assert.equal(service.list({ store: 'project', projectId: 'p2' })[0].source.threadId, 't1')
  assert.equal(runner.pending('t1'), false)
  await runner.runNow()
  assert.equal(engine.runs.length, 1)
})

test('a failed or disconnected run keeps the cursor and discards what it staged', async () => {
  const items = { t1: [item('u1', 'user', 'I like tea', 3, 0)] }
  const failing = scriptedEngine(
    async (tools) => {
      await tools.stage_memory_changes.execute({
        changes: [{ op: 'create_category', name: 'food', description: 'Food' }]
      })
    },
    { status: 'failed', error: { code: 'native_error', message: 'boom' } }
  )
  const first = dreamingSetup({ engine: failing.factory, items })
  await first.runner.runNow()
  assert.equal(first.records.cursor('t1'), null)
  assert.deepEqual(first.records.categories(), [])
  assert.equal(first.service.runs()[0].error.code, 'native_error')
  const offline = dreamingSetup({
    engine: () => ({ code: 'claude_not_connected', message: '' }),
    items,
    settings: { memory: { provider: 'claude-code' } }
  })
  await offline.runner.runNow()
  const [run] = offline.service.runs()
  assert.equal(run.provider, 'claude-code')
  assert.equal(run.error.code, 'claude_not_connected')
  assert.equal(offline.records.cursor('t1'), null)
  // Learning off refuses the manual trigger.
  const off = dreamingSetup({
    engine: failing.factory,
    items,
    settings: { memory: { learn: false } }
  })
  assert.throws(
    () => off.runner.runNow(),
    (error) => error.code === 'request_unavailable'
  )
})

test('a long thread is read in slices that never split one save', async () => {
  const engine = scriptedEngine(async () => {})
  const long = 'x'.repeat(3000)
  const items = {
    t1: Array.from({ length: 30 }, (_, i) =>
      item(`u${i}`, i % 2 ? 'assistant' : 'user', long, 10 + Math.floor(i / 2), i)
    )
  }
  const { runner, records } = dreamingSetup({ engine: engine.factory, items })
  await runner.runNow()
  assert.ok(engine.runs.length >= 2)
  for (const { input } of engine.runs) assert.ok(Buffer.byteLength(input.text) < 50_000)
  assert.equal(records.cursor('t1').itemRev, 24)
  // Items with the same rev always travel together.
  const first = engine.runs[0].input.text
  const lastIndex = Math.max(...[...first.matchAll(/\[u(\d+)\]/g)].map((m) => Number(m[1])))
  assert.equal(lastIndex % 2, 1)
})

test('a Run now with nothing to read leaves the queue able to start later runs', async () => {
  const engine = scriptedEngine(async () => {})
  const items = { t1: [] }
  const { runner } = dreamingSetup({ engine: engine.factory, items })
  await runner.runNow()
  items.t1.push(item('u1', 'user', 'I like tea', 3, 0))
  await runner.runNow()
  assert.equal(engine.runs.length, 1)
  items.t1.push(item('u2', 'user', 'And green tea most', 4, 1))
  runner.schedule('t1')
  await runner.runNow()
  assert.equal(engine.runs.length, 2)
})

test('turning learning off stops threads already queued', async () => {
  let setSettings = () => {}
  const engine = scriptedEngine(async () => setSettings({ memory: { learn: false } }))
  const items = {
    t1: [item('u1', 'user', 'I like tea', 3, 0)],
    t2: [item('u2', 'user', 'I like coffee', 4, 0)]
  }
  const setupResult = dreamingSetup({ engine: engine.factory, items })
  setSettings = setupResult.setSettings
  setupResult.threads[1].status = 'idle'
  await setupResult.runner.runNow()
  assert.equal(engine.runs.length, 1)
  assert.equal(setupResult.records.cursor('t2'), null)
})

test('a rejected stage op changes nothing, even after a check it passed', () => {
  const { service, records } = setup()
  const work = category(service, 'work')
  const seed = new DreamingStage([], records.categories(), {
    runId: 'mr_0',
    threadId: 't1',
    projects: PROJECTS,
    now: NOW
  })
  const [{ id }] = seed.stage([
    { op: 'add', store: 'personal', category: work, text: 'Works at Acme', sources: [] }
  ])
  records.commit({ mode: 'each', writes: seed.writes() })
  const stage = new DreamingStage(records.memories(), records.categories(), {
    runId: 'mr_1',
    threadId: 't1',
    projects: PROJECTS,
    now: NOW
  })
  const [rejected] = stage.stage([{ op: 'update', id, text: 'Works at Globex', category: 'nope' }])
  assert.equal(rejected.error, 'category_not_found')
  assert.deepEqual(stage.writes(), [])
  const results = stage.stage([
    { op: 'update', id, text: 'Works at Initech' },
    { op: 'update', id, text: 'Works at Globex', kind: 'rule' }
  ])
  assert.deepEqual(
    results.map((r) => (r.ok ? 'ok' : r.error)),
    ['ok', 'invalid_scope']
  )
  const [write] = stage.writes()
  assert.equal(write.value.text, 'Works at Initech')
  assert.deepEqual(stage.summary().updated, [id])
})

test('a Dreaming commit follows a category merged mid-run and refuses one removed', () => {
  const { service, records } = setup()
  const money = category(service, 'money')
  const invest = category(service, 'invest')
  const sport = category(service, 'sport')
  const stage = new DreamingStage(records.memories(), records.categories(), {
    runId: 'mr_1',
    threadId: 't1',
    projects: PROJECTS,
    now: NOW
  })
  const [merged, removed] = stage.stage([
    { op: 'add', store: 'personal', category: money, text: 'Prefers index funds', sources: [] },
    { op: 'add', store: 'personal', category: sport, text: 'Runs on Sundays', sources: [] }
  ])
  const rev = (id) => records.categories().find((c) => c.id === id).rev
  service.category({ action: 'merge', id: money, baseRev: rev(money), into: invest })
  service.category({ action: 'remove', id: sport, baseRev: rev(sport) })
  const writes = stage.writes()
  const results = records.commit({ mode: 'each', writes })
  const ok = Object.fromEntries(writes.map((w, i) => [w.value.id, results[i].ok]))
  assert.deepEqual(ok, { [merged.id]: true, [removed.id]: false })
  const saved = records.memories()
  assert.equal(saved.find((m) => m.id === merged.id).categoryId, invest)
  assert.equal(
    saved.find((m) => m.id === removed.id),
    undefined
  )
})

test('idle and startup triggers schedule threads without busy workers', () => {
  const timers = []
  const scheduled = []
  const threads = [
    { id: 't1', status: 'idle' },
    { id: 't2', status: 'running' },
    { id: 't3', status: 'idle' }
  ]
  const workers = [{ routerId: 't3', status: 'running' }]
  const triggers = new DreamingTriggers({
    threads: () => threads,
    workers: () => workers,
    schedule: (id) => scheduled.push(id),
    setTimer: (run, ms) => {
      const timer = { run, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer) => {
      timer.cleared = true
    }
  })
  timers[0].run()
  assert.deepEqual(scheduled, ['t1'])
  triggers.observe({ type: 'router', router: { id: 't1' } })
  triggers.observe({ type: 'router', router: { id: 't1' } })
  assert.equal(timers[1].cleared, true)
  assert.equal(timers[2].ms, 10 * 60 * 1000)
  timers[2].run()
  assert.deepEqual(scheduled, ['t1', 't1'])
  triggers.observe({ type: 'worker', worker: { routerId: 't3' } })
  triggers.close()
  assert.equal(timers.at(-1).cleared, true)
})

test('Dreaming engines keep their sessions out of the user history', async () => {
  const calls = []
  const sdk = {
    createSdkMcpServer: (options) => ({ type: 'sdk', name: options.name, options }),
    query({ prompt, options }) {
      calls.push(options)
      const generator = (async function* () {
        await prompt[Symbol.asyncIterator]().next()
        yield { type: 'system', subtype: 'init', session_id: 'dream-1' }
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '',
          usage: {}
        }
      })()
      generator.interrupt = async () => {}
      return generator
    }
  }
  const requests = []
  const server = new CodexRouterServer(async (_executable, _options, frame) => ({
    request: async (method, params) => {
      requests.push({ method, params })
      if (method === 'config/read') return { config: { mcp_servers: {} } }
      if (method === 'thread/start') return { thread: { id: 'th-1' } }
      if (method === 'turn/start') {
        queueMicrotask(() =>
          frame({
            method: 'turn/completed',
            params: { threadId: 'th-1', turn: { id: 'tu-1', status: 'completed' } }
          })
        )
        return { turn: { id: 'tu-1' } }
      }
      return {}
    },
    respond() {},
    reject() {},
    stop() {}
  }))
  const ready = { status: 'ready', executablePath: '/bin/agent', account: { kind: 'external' } }
  const factory = dreamingEngineFactory({
    credentials: null,
    claude: { sdk, connection: () => ready },
    codex: { server, connection: () => ready },
    cwd: () => '/tmp/owlto-memory-dreaming'
  })
  const tools = []
  const claude = factory({ provider: 'claude-code', model: 'sonnet', tools })
  const sink = { item() {}, usage() {} }
  const outcome = await claude.run({ batchId: 'mr_1', text: 'input', native: null }, sink)
  assert.equal(outcome.status, 'completed')
  assert.equal(calls[0].persistSession, false)
  assert.equal(calls[0].model, 'sonnet')
  assert.deepEqual(calls[0].tools, [])
  assert.equal(calls[0].cwd, '/tmp/owlto-memory-dreaming')
  assert.match(calls[0].systemPrompt, /Owlto Dreaming agent/)
  const codex = factory({ provider: 'codex', model: null, tools })
  assert.equal(
    (await codex.run({ batchId: 'mr_2', text: 'input', native: null }, sink)).status,
    'completed'
  )
  const start = requests.find((r) => r.method === 'thread/start')
  assert.equal(start.params.ephemeral, true)
  assert.equal(start.params.sandbox, 'read-only')
  assert.match(start.params.developerInstructions, /Owlto Dreaming agent/)
  server.close()
  const offline = dreamingEngineFactory({
    credentials: null,
    claude: { sdk, connection: () => ({ ...ready, status: 'disconnected' }) },
    codex: { server, connection: () => ({ ...ready, account: { kind: 'signed-out' } }) },
    cwd: () => '/tmp'
  })
  assert.equal(
    offline({ provider: 'claude-code', model: null, tools }).code,
    'claude_not_connected'
  )
  assert.equal(offline({ provider: 'codex', model: null, tools }).code, 'not_connected')
})

/** A stored memory with every field, for tests that need exact dates and owners. */
function memoryOf(overrides) {
  const scope =
    overrides.store === 'project'
      ? { store: 'project', categoryId: null, projectId: 'p1', kind: 'knowledge' }
      : { store: 'personal', categoryId: overrides.categoryId, projectId: null, kind: null }
  return {
    ...scope,
    id: 'm_00000000',
    text: 'A fact',
    status: 'active',
    rev: 0,
    pinned: false,
    expiresAt: null,
    origin: 'dreaming',
    editedByUser: false,
    source: { threadId: 't1', itemIds: [], workerIds: [], runId: null },
    supersededBy: null,
    reviewedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}
const seed = (records, values) =>
  records.commit({
    mode: 'each',
    writes: values.map((value) => ({
      kind: value.name === undefined ? 'memory' : 'category',
      baseRev: null,
      value
    }))
  })

test('the sweep archives expired memories and removes old tombstones', () => {
  const { service, records, changes } = setup()
  const work = category(service, 'work')
  seed(records, [
    memoryOf({ id: 'm_expired1', categoryId: work, expiresAt: '2026-11-01T00:00:00.000Z' }),
    memoryOf({ id: 'm_current1', categoryId: work, expiresAt: '2026-12-01T00:00:00.000Z' }),
    memoryOf({ id: 'm_forever1', categoryId: work }),
    memoryOf({
      id: 'm_oldgone1',
      categoryId: work,
      status: 'deleted',
      text: '',
      updatedAt: '2026-08-01T00:00:00.000Z'
    }),
    memoryOf({
      id: 'm_newgone1',
      categoryId: work,
      status: 'deleted',
      text: '',
      updatedAt: '2026-10-01T00:00:00.000Z'
    }),
    {
      id: 'mc_oldgone1',
      name: '',
      description: '',
      status: 'deleted',
      mergedInto: work,
      createdBy: 'agent',
      rev: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    }
  ])
  const before = changes()
  assert.deepEqual(service.sweep(), { archived: 1, purged: 2 })
  assert.equal(changes(), before + 1)
  const status = Object.fromEntries(records.memories().map((m) => [m.id, m.status]))
  assert.deepEqual(status, {
    m_expired1: 'archived',
    m_current1: 'active',
    m_forever1: 'active',
    m_newgone1: 'deleted'
  })
  assert.equal(records.memories().find((m) => m.id === 'm_expired1').updatedAt, NOW.toISOString())
  assert.equal(
    records.categories().find((c) => c.id === 'mc_oldgone1'),
    undefined
  )
  // Expired memories leave the default list; a second sweep has nothing to do.
  assert.deepEqual(
    service
      .list({ store: 'personal' })
      .map((m) => m.id)
      .sort(),
    ['m_current1', 'm_forever1']
  )
  assert.deepEqual(service.sweep(), { archived: 0, purged: 0 })
  assert.equal(changes(), before + 1)
})

test('the sweeper runs soon after startup, then daily, until closed', () => {
  const timers = []
  let sweeps = 0
  const sweeper = new MemorySweeper({
    sweep: () => {
      sweeps++
      if (sweeps === 1) throw new Error('database closed')
    },
    setTimer: (run, ms) => {
      const timer = { run, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer) => {
      timer.cleared = true
    }
  })
  assert.equal(timers[0].ms, 10 * 1000)
  // A failed sweep still schedules the next one.
  timers[0].run()
  assert.equal(timers[1].ms, 24 * 60 * 60 * 1000)
  timers[1].run()
  assert.equal(sweeps, 2)
  sweeper.close()
  assert.equal(timers[2].cleared, true)
})

test('Dreaming merges an agent category into another and leaves user ones alone', () => {
  const { service, records } = setup()
  const invest = category(service, 'investing')
  const stage0 = new DreamingStage([], records.categories(), {
    runId: 'mr_0',
    threadId: 't1',
    projects: PROJECTS,
    now: NOW
  })
  stage0.stage([
    { op: 'create_category', name: 'stocks', description: 'Stock picks' },
    { op: 'create_category', name: 'notes', description: 'Notes' },
    { op: 'add', store: 'personal', category: 'stocks', text: 'Holds index funds', sources: [] },
    { op: 'add', store: 'personal', category: 'notes', text: 'Writes in Markdown', sources: [] }
  ])
  records.commit({ mode: 'each', writes: stage0.writes() })
  const byName = (name) => records.categories().find((c) => c.name === name)
  const notes = byName('notes')
  // The user edits the memory in notes, so notes can no longer be merged away.
  const edited = records.memories().find((m) => m.categoryId === notes.id)
  service.save({
    action: 'update',
    id: edited.id,
    baseRev: edited.rev,
    text: 'Writes notes in Markdown'
  })
  const stocks = byName('stocks')
  const stage = new DreamingStage(records.memories(), records.categories(), {
    runId: 'mr_1',
    threadId: 't1',
    projects: PROJECTS,
    now: NOW
  })
  const results = stage.stage([
    { op: 'merge_category', from: 'investing', into: 'stocks' },
    { op: 'merge_category', from: 'notes', into: 'investing' },
    { op: 'merge_category', from: 'stocks', into: 'stocks' },
    { op: 'merge_category', from: 'stocks', into: invest },
    { op: 'add', store: 'personal', category: stocks.id, text: 'Avoids options', sources: [] }
  ])
  assert.deepEqual(
    results.map((r) => (r.ok ? 'ok' : r.error)),
    ['user_owned', 'user_owned', 'invalid_scope', 'ok', 'ok']
  )
  assert.deepEqual(stage.summary().merged, [stocks.id])
  records.commit({ mode: 'each', writes: stage.writes() })
  const gone = records.categories().find((c) => c.id === stocks.id)
  assert.equal(gone.status, 'deleted')
  assert.equal(gone.mergedInto, invest)
  // The stored memory and one added after the merge under the old ID both end up in investing.
  assert.deepEqual(
    records
      .memories()
      .filter((m) => m.categoryId === invest)
      .map((m) => m.text)
      .sort(),
    ['Avoids options', 'Holds index funds']
  )
})

test('Dreaming reviews old knowledge and lessons without moving them in recency', async () => {
  const records = memoryRecords()
  seed(records, [
    memoryOf({
      id: 'm_oldknow1',
      store: 'project',
      kind: 'knowledge',
      projectId: 'p2',
      text: 'Dana reviews the report'
    }),
    memoryOf({
      id: 'm_oldless1',
      store: 'project',
      kind: 'lesson',
      projectId: 'p2',
      text: 'The VPN drops exports'
    }),
    memoryOf({
      id: 'm_oldrule1',
      store: 'project',
      kind: 'rule',
      projectId: 'p2',
      text: 'Reports use A4'
    }),
    memoryOf({
      id: 'm_newknow1',
      store: 'project',
      kind: 'knowledge',
      projectId: 'p2',
      updatedAt: '2026-10-01T00:00:00.000Z'
    }),
    memoryOf({
      id: 'm_mineknw1',
      store: 'project',
      kind: 'knowledge',
      projectId: 'p2',
      editedByUser: true
    }),
    memoryOf({
      id: 'm_seenknw1',
      store: 'project',
      kind: 'knowledge',
      projectId: 'p2',
      reviewedAt: '2026-10-01T00:00:00.000Z'
    })
  ])
  let outcomes = []
  const engine = scriptedEngine(async (tools) => {
    const staged = await tools.stage_memory_changes.execute({
      changes: [
        { op: 'confirm', id: 'm_oldknow1' },
        { op: 'archive', id: 'm_oldless1', reason: 'The VPN was replaced' },
        { op: 'confirm', id: 'm_oldrule1' },
        { op: 'confirm', id: 'm_newknow1' }
      ]
    })
    outcomes = JSON.parse(staged).results.map((r) => (r.ok ? 'ok' : r.error))
  })
  const items = { t1: [item('u1', 'user', 'How is the report going?', 3, 0)] }
  const { runner, service } = dreamingSetup({ engine: engine.factory, items, records })
  await runner.runNow()
  const [{ input }] = engine.runs
  const due = input.text.split('Due for review in Reports')[1] ?? ''
  assert.match(due, /m_oldknow1 · knowledge · 2026-01-01 · Dana reviews the report/)
  assert.match(due, /m_oldless1 · lesson/)
  assert.doesNotMatch(due, /m_oldrule1|m_newknow1|m_mineknw1|m_seenknw1/)
  const saved = Object.fromEntries(records.memories().map((m) => [m.id, m]))
  assert.equal(saved.m_oldknow1.reviewedAt, NOW.toISOString())
  assert.equal(saved.m_oldknow1.updatedAt, '2026-01-01T00:00:00.000Z')
  assert.equal(saved.m_oldless1.status, 'archived')
  assert.deepEqual(outcomes, ['ok', 'ok', 'not_due', 'not_due'])
  const [run] = service.runs()
  assert.deepEqual(run.reviewed, ['m_oldknow1'])
  assert.deepEqual(run.archived, ['m_oldless1'])
})
