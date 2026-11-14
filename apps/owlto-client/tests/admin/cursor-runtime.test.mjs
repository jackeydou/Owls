import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { CursorService, cursorNormalize, parseReport } = require('../../out/main/app/runtime.js')
const fixture = fileURLToPath(new URL('../fixtures/cursor/mock-cursor-agent.cjs', import.meta.url))
chmodSync(fixture, 0o755)

function memoryStore(project, executable = fixture) {
  const sessions = new Map()
  const commands = new Set()
  return {
    settings: () => ({ cursorExecutablePath: executable }),
    sessions: () => [...sessions.values()].map((s) => structuredClone(s)),
    saveSession: (session) => sessions.set(session.id, structuredClone(session)),
    removeSession: (id) => sessions.delete(id),
    projects: () => [{ id: 'p', name: 'project', path: project }],
    acceptCommand: (id) => {
      if (commands.has(id)) return false
      commands.add(id)
      return true
    }
  }
}

/** Records what the service reports to the Router. */
function fakeProfiles(profile = null) {
  const settled = []
  return { settled, profile: () => profile, prepare: async () => {} }
}

function withProfiles(service, profiles) {
  service.setTurnProfiles({
    profile: profiles.profile,
    prepare: profiles.prepare,
    settled: (sessionId, outcome) => profiles.settled.push({ sessionId, ...outcome })
  })
}

async function until(check, label) {
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    const value = check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function frames(project) {
  return readFileSync(join(project, '.mock-acp-log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}

function setup(t, profile = null) {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'owlto-cursor-')))
  const events = []
  const service = new CursorService(memoryStore(project), (event) => events.push(event))
  const profiles = fakeProfiles(profile)
  withProfiles(service, profiles)
  t.after(() => {
    service.close()
    rmSync(project, { recursive: true, force: true })
  })
  return { project, service, profiles, events }
}

const session = (service, id) => service.sessionList().find((s) => s.id === id)

test('Cursor normalization reads accounts, models, tools, and approvals', () => {
  const n = cursorNormalize
  assert.deepEqual(n.parseCursorStatus('{"isAuthenticated":false,"message":"Not logged in"}'), {
    kind: 'signed-out'
  })
  assert.deepEqual(n.parseCursorStatus('{"isAuthenticated":true,"user":{"email":"a@b.co"}}'), {
    kind: 'cursor',
    email: 'a@b.co'
  })
  assert.deepEqual(n.parseCursorStatus('Logged in as owl@example.com'), {
    kind: 'cursor',
    email: 'owl@example.com'
  })
  assert.deepEqual(n.parseCursorStatus('Not logged in'), { kind: 'signed-out' })
  const models = n.parseCursorModels(
    'Available models\n\nauto - Auto (default)\ngpt-5 - GPT-5 (current)\n'
  )
  assert.deepEqual(
    models.map((m) => [m.id, m.name, m.isDefault]),
    [
      ['auto', 'Auto', true],
      ['gpt-5', 'GPT-5', false]
    ]
  )
  assert.deepEqual(n.parseCursorModels('Error: Authentication required.'), [])

  const cwd = '/work/project'
  const command = n.mergeToolCall(undefined, {
    toolCallId: 'c',
    title: 'Run tests',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command: ['pnpm', 'test'] }
  })
  const done = n.mergeToolCall(command, {
    toolCallId: 'c',
    status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: 'ok' } }]
  })
  assert.deepEqual(n.toolCallItem(done, 'turn'), {
    id: 'c',
    turnId: 'turn',
    status: 'completed',
    kind: 'command',
    text: 'pnpm test',
    detail: 'ok'
  })
  const edit = n.mergeToolCall(undefined, {
    toolCallId: 'e',
    kind: 'edit',
    content: [{ type: 'diff', path: 'src/a.ts', oldText: 'a', newText: 'b' }]
  })
  assert.equal(n.toolCallItem(edit, 't').kind, 'files')
  assert.match(n.toolCallItem(edit, 't').detail, /-a\n\+b/)
  assert.equal(n.approvalPolicy('workspace-write', edit, cwd), 'allow')
  assert.equal(n.approvalPolicy('read-only', edit, cwd), 'reject')
  const outside = n.mergeToolCall(undefined, {
    toolCallId: 'o',
    kind: 'edit',
    locations: [{ path: '/etc/hosts' }]
  })
  assert.equal(n.approvalPolicy('workspace-write', outside, cwd), 'ask')
  assert.equal(n.approvalPolicy('workspace-write', command, cwd), 'ask')
  assert.equal(n.approvalPolicy('full-access', outside, cwd), 'allow')
  assert.equal(n.mergeToolCall(undefined, { title: 'no id' }), null)

  const options = [
    { optionId: 'always', name: '', kind: 'allow_always' },
    { optionId: 'once', name: '', kind: 'allow_once' },
    { optionId: 'no', name: '', kind: 'reject_once' }
  ]
  assert.equal(n.chooseOption(options, 'allow'), 'once')
  assert.equal(n.chooseOption(options, 'reject'), 'no')
  assert.equal(n.chooseOption([], 'allow'), null)

  const question = n.askQuestionSchema.parse({
    questions: [{ id: 'q', prompt: 'Pick', options: [{ id: 'x', label: 'X' }] }]
  })
  assert.deepEqual(n.questionResponse(question, { q: ['X'] }), {
    outcome: { outcome: 'answered', answers: [{ questionId: 'q', selectedOptionIds: ['x'] }] }
  })
  assert.deepEqual(n.questionResponse(question, { q: ['something else'] }), {
    outcome: { outcome: 'skipped', reason: 'The user answered: something else' }
  })
  assert.match(
    n.workerPrompt({ instructions: 'Be a worker.', reportSchema: { type: 'object' } }),
    /Be a worker\.[\s\S]*\{"type":"object"\}/
  )
})

test('Worker reports are read from a trailing JSON object when no schema constrains the text', () => {
  const json = '{"status":"done","summary":"Fixed.","artifacts":[{"kind":"file","ref":"a.ts"}]}'
  for (const text of [json, `All set.\n\n${json}`, `All set.\n\n\`\`\`json\n${json}\n\`\`\``]) {
    const { report, degraded } = parseReport(null, text)
    assert.equal(degraded, false, text)
    assert.equal(report.summary, 'Fixed.')
    assert.equal(report.artifacts[0].ref, 'a.ts')
  }
  assert.equal(parseReport(null, 'No report {here}').degraded, true)
})

test('Cursor service connects and runs a turn over ACP with approvals and streaming', async (t) => {
  const { project, service, profiles } = setup(t, {
    instructions: 'You are an Owlto worker.',
    reportSchema: { type: 'object' }
  })
  const connection = await service.connect()
  assert.equal(connection.status, 'ready')
  assert.equal(connection.version, '2026.11.10-fixture')
  assert.deepEqual(connection.account, { kind: 'cursor', email: 'owl@example.com' })
  assert.deepEqual(
    connection.models.map((m) => m.id),
    ['auto', 'gpt-5', 'sonnet-4.5']
  )

  const created = service.createSession({
    provider: 'cursor',
    cwd: project,
    model: 'gpt-5',
    effort: 'high',
    permission: 'workspace-write'
  })
  assert.equal(created.effort, null)
  assert.throws(
    () =>
      service.createSession({
        provider: 'cursor',
        cwd: project,
        model: 'unknown-model',
        effort: null,
        permission: 'workspace-write'
      }),
    /not available/
  )

  await service.send({ sessionId: created.id, commandId: crypto.randomUUID(), text: 'hello' })
  const waiting = await until(() => {
    const s = session(service, created.id)
    return s.status === 'waiting' && s
  }, 'the command approval')
  const request = waiting.requests.find((r) => r.status === 'pending')
  assert.equal(request.kind, 'command')
  assert.equal(request.title, 'pnpm test')
  assert.equal(service.steer(created.id, 'more'), 'not_running')
  service.respond({ sessionId: created.id, requestId: request.id, decision: 'accept' })

  const settled = await until(() => profiles.settled[0], 'the turn to settle')
  assert.equal(settled.status, 'completed')
  assert.match(settled.text, /"summary":"Fixed it\."/)
  assert.equal(parseReport(settled.structured, settled.text).degraded, false)

  const done = session(service, created.id)
  assert.equal(done.status, 'idle')
  assert.equal(done.threadId, 'cursor-session-1')
  assert.deepEqual(
    done.items.map((i) => [i.kind, i.status]),
    [
      ['user', 'completed'],
      ['reasoning', 'completed'],
      ['assistant', 'completed'],
      ['command', 'completed'],
      ['files', 'completed'],
      ['plan', 'completed'],
      ['assistant', 'completed']
    ]
  )
  assert.equal(done.items[2].text, 'Hello')
  assert.equal(done.items[3].detail, 'tests passed')
  assert.equal(done.items[5].text, '✓ Run tests\n• Fix app')
  assert.match(done.diff, /--- app\.ts\n\+\+\+ app\.ts\n-broken\n\+fixed/)

  const log = frames(project)
  assert.deepEqual(log[0].argv, ['--model', 'gpt-5', 'acp'])
  const methods = log.flatMap((e) => (e.frame?.method ? [e.frame.method] : []))
  assert.deepEqual(methods, ['initialize', 'authenticate', 'session/new', 'session/prompt'])
  const promptFrame = log.find((e) => e.frame?.method === 'session/prompt').frame
  assert.match(promptFrame.params.prompt[0].text, /^You are an Owlto worker\.[\s\S]*\n\nhello$/)
  // The edit inside the task folder was approved without asking the user.
  const answers = log.filter((e) => e.frame && !e.frame.method && e.frame.id >= 1000)
  assert.deepEqual(
    answers.map((e) => e.frame.result.outcome.optionId),
    ['allow-once', 'allow-once']
  )

  // The next turn loads the same Cursor session and ignores its replay.
  await service.send({ sessionId: created.id, commandId: crypto.randomUUID(), text: 'question' })
  const asked = await until(() => {
    const s = session(service, created.id)
    return s.requests.find((r) => r.kind === 'question' && r.status === 'pending')
  }, 'the question')
  assert.equal(asked.questions[0].question, 'Which mode?')
  assert.deepEqual(
    asked.questions[0].options.map((o) => o.label),
    ['Agent', 'Plan']
  )
  assert.throws(
    () => service.respond({ sessionId: created.id, requestId: asked.id, decision: 'accept' }),
    /Answer each question/
  )
  service.respond({
    sessionId: created.id,
    requestId: asked.id,
    decision: 'accept',
    answers: { q1: ['Plan'] }
  })
  await until(() => profiles.settled[1], 'the second turn')
  const second = session(service, created.id)
  assert.equal(
    second.items.some((i) => i.text === 'replayed'),
    false
  )
  assert.match(second.items.at(-1).text, /"selectedOptionIds":\["plan"\]/)
  const methods2 = frames(project).flatMap((e) => (e.frame?.method ? [e.frame.method] : []))
  assert.deepEqual(methods2.slice(4), [
    'initialize',
    'authenticate',
    'session/load',
    'session/prompt'
  ])
})

test('Cursor service stops a running turn and uses ask mode for read-only work', async (t) => {
  const { project, service, profiles } = setup(t)
  await service.connect()
  const created = service.createSession({
    provider: 'cursor',
    cwd: project,
    model: null,
    effort: null,
    permission: 'read-only'
  })
  await service.send({ sessionId: created.id, commandId: crypto.randomUUID(), text: 'wait' })
  await until(
    () => session(service, created.id).items.some((i) => i.text === 'Working'),
    'the turn to start'
  )
  await service.interrupt(created.id)
  const settled = await until(() => profiles.settled[0], 'the stopped turn')
  assert.equal(settled.status, 'interrupted')
  const stopped = session(service, created.id)
  assert.equal(stopped.status, 'interrupted')
  assert.equal(stopped.error, null)
  const log = frames(project)
  assert.deepEqual(log[0].argv, ['acp'])
  const methods = log.flatMap((e) => (e.frame?.method ? [e.frame.method] : []))
  assert.deepEqual(methods, [
    'initialize',
    'authenticate',
    'session/new',
    'session/set_mode',
    'session/prompt',
    'session/cancel'
  ])
  assert.equal(log.find((e) => e.frame?.method === 'session/set_mode').frame.params.modeId, 'ask')
})

test('Cursor service reports a missing executable and refuses turns until connected', async (t) => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'owlto-cursor-')))
  const service = new CursorService(memoryStore(project, join(project, 'missing-agent')), () => {})
  t.after(() => {
    service.close()
    rmSync(project, { recursive: true, force: true })
  })
  const connection = await service.connect()
  assert.equal(connection.status, 'error')
  assert.equal(connection.error.code, 'cursor_not_installed')
  const created = service.createSession({
    provider: 'cursor',
    cwd: project,
    model: null,
    effort: null,
    permission: 'workspace-write'
  })
  await assert.rejects(
    service.send({ sessionId: created.id, commandId: crypto.randomUUID(), text: 'hello' }),
    /Connect your local Cursor CLI/
  )
})
