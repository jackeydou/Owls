import assert from 'node:assert/strict'
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const {
  AcpAgentService,
  antigravityAgent,
  antigravityNormalize,
  parseReport
} = require('../../out/main/app/runtime.js')
const fixture = fileURLToPath(new URL('../fixtures/antigravity/mock-agy.cjs', import.meta.url))
chmodSync(fixture, 0o755)

function memoryStore(project, executable = fixture) {
  const sessions = new Map()
  const commands = new Set()
  return {
    settings: () => ({ antigravityExecutablePath: executable }),
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
const methods = (project) =>
  frames(project).flatMap((e) => (e.frame?.method ? [e.frame.method] : []))

function setup(t, { executable = fixture, profile = null } = {}) {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'owlto-agy-')))
  const settled = []
  const usage = []
  const service = new AcpAgentService(memoryStore(project, executable), () => {}, antigravityAgent)
  service.setTurnProfiles({
    profile: () => profile,
    prepare: async () => {},
    settled: (sessionId, outcome) => settled.push({ sessionId, ...outcome })
  })
  service.setUsageRecorder((sessionId, entry) => usage.push({ sessionId, ...entry }))
  t.after(() => {
    service.close()
    rmSync(project, { recursive: true, force: true })
  })
  return { project, service, settled, usage }
}

const session = (service, id) => service.sessionList().find((s) => s.id === id)

test('Antigravity normalization reads models, sign-in failures, and modes', () => {
  const n = antigravityNormalize
  const models = n.parseAntigravityModels(
    'Available models\n\ngemini-3-pro - Gemini 3 Pro (default)\ngemini-3-flash - Gemini 3 Flash\n'
  )
  assert.deepEqual(
    models.map((m) => [m.id, m.name, m.isDefault]),
    [
      ['gemini-3-pro', 'Gemini 3 Pro', true],
      ['gemini-3-flash', 'Gemini 3 Flash', false]
    ]
  )
  assert.deepEqual(models[0].efforts, ['low', 'medium', 'high', 'extra', 'max'])
  assert.deepEqual(
    n
      .parseAntigravityModels('[{"id":"gemini-3-pro","displayName":"Gemini 3 Pro"}]')
      .map((m) => [m.id, m.name]),
    [['gemini-3-pro', 'Gemini 3 Pro']]
  )
  assert.deepEqual(
    n.parseAntigravityModels('gemini-3-pro\nclaude-sonnet-4-5 (current)\n').map((m) => m.id),
    ['gemini-3-pro', 'claude-sonnet-4-5']
  )
  assert.equal(n.signedOut('Error: Authentication required.'), true)
  assert.equal(n.signedOut('spawn agy ENOENT'), false)
  assert.equal(n.antigravityMode('read-only'), 'plan')
  assert.equal(n.antigravityMode('workspace-write'), 'default')
  assert.equal(n.antigravityMode('full-access'), 'accept-edits')
})

test('Antigravity service connects and runs a turn with its model, effort, and mode', async (t) => {
  const { project, service, settled, usage } = setup(t, {
    profile: { instructions: 'You are an Owlto worker.', reportSchema: { type: 'object' } }
  })
  const connection = await service.connect()
  assert.equal(connection.status, 'ready')
  assert.equal(connection.version, 'agy 1.5.3-fixture')
  assert.deepEqual(connection.account, { kind: 'signed-in', email: null })
  assert.deepEqual(
    connection.models.map((m) => m.id),
    ['gemini-3-pro', 'gemini-3-flash']
  )

  const created = service.createSession({
    provider: 'antigravity',
    cwd: project,
    model: 'gemini-3-flash',
    effort: 'high',
    permission: 'full-access'
  })
  assert.equal(created.provider, 'antigravity')
  assert.equal(created.effort, 'high')
  await service.send({ sessionId: created.id, commandId: crypto.randomUUID(), text: 'hello' })
  const outcome = await until(() => settled[0], 'the turn to settle')
  assert.equal(outcome.status, 'completed')
  assert.equal(parseReport(outcome.structured, outcome.text).degraded, false)

  const done = session(service, created.id)
  assert.equal(done.status, 'idle')
  assert.equal(done.threadId, 'agy-session-1')
  assert.deepEqual(
    done.items.map((i) => [i.kind, i.status]),
    [
      ['user', 'completed'],
      ['reasoning', 'completed'],
      ['command', 'completed'],
      ['assistant', 'completed']
    ]
  )
  // Full access answers the command approval without asking the user.
  assert.equal(done.requests.length, 0)

  const log = frames(project)
  assert.deepEqual(log[0].argv, ['acp'])
  // Antigravity offers OAuth and API key auth; Owlto leaves sign-in to the CLI.
  assert.deepEqual(methods(project), [
    'initialize',
    'session/new',
    'session/set_mode',
    'session/set_config_option',
    'session/set_config_option',
    'session/prompt'
  ])
  const params = (method) =>
    log.filter((e) => e.frame?.method === method).map((e) => e.frame.params)
  assert.equal(params('session/set_mode')[0].modeId, 'accept-edits')
  assert.deepEqual(
    params('session/set_config_option').map((p) => [p.configId, p.value]),
    [
      ['model', 'gemini-3-flash'],
      ['thought_level', 'high']
    ]
  )
  assert.match(params('session/prompt')[0].prompt[0].text, /^You are an Owlto worker\./)
  assert.deepEqual(usage, [
    {
      sessionId: created.id,
      model: 'gemini-3-flash',
      input: 100,
      output: 30,
      cacheRead: 20,
      cacheWrite: 0,
      reasoning: 5,
      costUsd: null
    }
  ])

  // The next turn loads the same Antigravity session.
  await service.send({ sessionId: created.id, commandId: crypto.randomUUID(), text: 'again' })
  await until(() => settled[1], 'the second turn')
  assert.deepEqual(methods(project).slice(6, 8), ['initialize', 'session/load'])
})

test('Antigravity read-only work uses plan mode, asks before commands, and stops', async (t) => {
  const { project, service, settled } = setup(t)
  await service.connect()
  const created = service.createSession({
    provider: 'antigravity',
    cwd: project,
    model: null,
    effort: null,
    permission: 'read-only'
  })
  await service.send({ sessionId: created.id, commandId: crypto.randomUUID(), text: 'look' })
  const waiting = await until(() => {
    const s = session(service, created.id)
    return s.status === 'waiting' && s
  }, 'the command approval')
  const request = waiting.requests.find((r) => r.status === 'pending')
  assert.equal(request.kind, 'command')
  service.respond({ sessionId: created.id, requestId: request.id, decision: 'decline' })
  await until(() => settled[0], 'the declined turn')
  const declined = session(service, created.id)
  assert.equal(declined.items.find((i) => i.kind === 'command').status, 'failed')
  // No model or effort was chosen, so only the mode changes.
  assert.deepEqual(methods(project), [
    'initialize',
    'session/new',
    'session/set_mode',
    'session/prompt'
  ])
  const mode = frames(project).find((e) => e.frame?.method === 'session/set_mode')
  assert.equal(mode.frame.params.modeId, 'plan')

  await service.send({ sessionId: created.id, commandId: crypto.randomUUID(), text: 'wait' })
  await until(
    () => session(service, created.id).items.some((i) => i.text === 'Thinking'),
    'the turn to start'
  )
  await service.interrupt(created.id)
  const stopped = await until(() => settled[1], 'the stopped turn')
  assert.equal(stopped.status, 'interrupted')
  assert.equal(methods(project).at(-1), 'session/cancel')
})

test('Antigravity reports a signed-out CLI and a missing one', async (t) => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'owlto-agy-bin-')))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const copy = join(folder, 'agy')
  copyFileSync(fixture, copy)
  chmodSync(copy, 0o755)
  writeFileSync(join(folder, '.mock-agy-signed-out'), '')
  const signedOut = setup(t, { executable: copy })
  const connection = await signedOut.service.connect()
  assert.equal(connection.status, 'ready')
  assert.deepEqual(connection.account, { kind: 'signed-out' })
  assert.deepEqual(signedOut.service.usage(), {
    provider: 'antigravity',
    state: 'unavailable',
    reason: 'signed-out',
    plan: null
  })
  const created = signedOut.service.createSession({
    provider: 'antigravity',
    cwd: signedOut.project,
    model: null,
    effort: null,
    permission: 'full-access'
  })
  await assert.rejects(
    signedOut.service.send({ sessionId: created.id, commandId: crypto.randomUUID(), text: 'hi' }),
    /Connect your local Antigravity CLI/
  )

  const missing = setup(t, { executable: join(folder, 'missing-agy') })
  const failed = await missing.service.connect()
  assert.equal(failed.status, 'error')
  assert.equal(failed.error.code, 'antigravity_not_installed')
})
