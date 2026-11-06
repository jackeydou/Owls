import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { ClaudeService, claudeNormalize } = require('../../out/main/codex/runtime.js')
const fixture = fileURLToPath(new URL('../fixtures/claude/mock-claude.cjs', import.meta.url))
chmodSync(fixture, 0o755)

function memoryStore(project) {
  const sessions = new Map()
  const commands = new Map()
  return {
    settings: () => ({
      executablePath: null,
      model: null,
      effort: null,
      permission: 'workspace-write',
      theme: 'system',
      language: 'en',
      provider: 'claude-code',
      claudeExecutablePath: fixture,
      claudeModel: null,
      claudeEffort: null
    }),
    sessions: () => [...sessions.values()].map((s) => structuredClone(s)),
    saveSession: (session) => sessions.set(session.id, structuredClone(session)),
    removeSession: (id) => sessions.delete(id),
    projects: () => [{ id: 'p', name: 'project', path: project }],
    acceptCommand: (id, sessionId, text) => {
      const key = `${sessionId}\0${text}`
      if (commands.has(id)) {
        if (commands.get(id) !== key) throw new Error('Command ID reused')
        return false
      }
      commands.set(id, key)
      return true
    }
  }
}

const init = { type: 'system', subtype: 'init', session_id: 'claude-session-1' }
const success = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'done',
  usage: { input_tokens: 10, output_tokens: 5 }
}
const assistant = (id, content) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id, content }
})
const stream = (event) => ({ type: 'stream_event', parent_tool_use_id: null, event })
const toolResult = (id, content, isError) => ({
  type: 'user',
  parent_tool_use_id: null,
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }]
  }
})

/** A scripted stand-in for the Agent SDK's query(). */
function fakeSdk() {
  const calls = []
  const answers = []
  const scripts = {
    async *hello() {
      const id = `m1-${calls.length}`
      yield init
      yield stream({ type: 'message_start', message: { id } })
      yield stream({ type: 'content_block_start', index: 0, content_block: { type: 'text' } })
      yield stream({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello ' }
      })
      yield stream({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'world' }
      })
      yield assistant(id, [{ type: 'text', text: 'hello world' }])
      yield success
    },
    async *approval(options, signal) {
      yield init
      const input = { command: 'rm -rf build', description: 'Remove build output' }
      yield assistant('m2', [{ type: 'tool_use', id: 't1', name: 'Bash', input }])
      const decision = await options.canUseTool('Bash', input, { signal })
      yield toolResult(
        't1',
        decision.behavior === 'allow' ? 'removed' : decision.message,
        decision.behavior !== 'allow'
      )
      yield success
    },
    async *question(options, signal) {
      yield init
      const input = {
        questions: [
          {
            question: 'Which database?',
            header: 'Database',
            multiSelect: false,
            options: [
              { label: 'SQLite', description: 'Local file' },
              { label: 'Postgres', description: 'Server' }
            ]
          }
        ]
      }
      const decision = await options.canUseTool('AskUserQuestion', input, { signal })
      answers.push(decision)
      yield success
    },
    async *linger() {
      yield init
      yield assistant('m4', [{ type: 'text', text: 'first' }])
      yield success
      // The CLI may emit trailing events and exit after the result.
      await new Promise((resolve) => setTimeout(resolve, 100))
      yield { type: 'rate_limit_event' }
    },
    async *steered(_options, _signal, control) {
      yield init
      const next = await control.next()
      yield assistant('m5', [{ type: 'text', text: `heard: ${next.value.message.content}` }])
      yield success
    },
    async *long(_options, _signal, control) {
      yield init
      yield assistant('m3', [{ type: 'text', text: 'working' }])
      await control.interrupted
      yield {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['aborted'],
        usage: {}
      }
    }
  }
  return {
    calls,
    answers,
    query({ prompt, options }) {
      calls.push(options)
      let interrupt
      const iterator = prompt[Symbol.asyncIterator]()
      const control = {
        interrupted: new Promise((resolve) => (interrupt = resolve)),
        next: () => iterator.next()
      }
      const signal = new AbortController().signal
      const generator = (async function* () {
        const first = await iterator.next()
        if (first.done) return
        yield* scripts[first.value.message.content](options, signal, control)
      })()
      return Object.assign(generator, {
        initializationResult: async () => ({
          models: [
            { value: 'default', displayName: 'Default', description: '', supportsAutoMode: true },
            {
              value: 'opus',
              displayName: 'Opus',
              description: 'Most capable',
              supportedEffortLevels: ['low', 'high', 'max']
            }
          ],
          account: { email: 'fixture@example.com', subscriptionType: 'max' }
        }),
        interrupt: async () => interrupt(),
        close: () => {}
      })
    }
  }
}

async function until(predicate) {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for task state')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('Claude normalization maps native tools, permissions, accounts, and answers', () => {
  const { toolItem, permissionOptions, parseClaudeAccount, permissionRequest, questionAnswers } =
    claudeNormalize
  assert.equal(toolItem('a', 'Bash', { command: 'ls' }, 't').kind, 'command')
  const edit = toolItem('b', 'Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' }, 't')
  assert.equal(edit.kind, 'files')
  assert.match(edit.detail, /^--- a\.ts\n\+\+\+ a\.ts\n-x\n\+y$/)
  assert.equal(
    toolItem('c', 'TodoWrite', { todos: [{ content: 'Ship', status: 'completed' }] }, 't').text,
    '✓ Ship'
  )
  assert.equal(toolItem('d', 'mcp__github__create_issue', {}, 't').text, 'github / create_issue')
  assert.deepEqual(permissionOptions('read-only', true), {
    permissionMode: 'default',
    disallowedTools: ['Edit', 'NotebookEdit', 'Write']
  })
  assert.deepEqual(permissionOptions('workspace-write', true), { permissionMode: 'acceptEdits' })
  assert.deepEqual(permissionOptions('full-access', true), { permissionMode: 'auto' })
  assert.deepEqual(permissionOptions('full-access', false), { permissionMode: 'acceptEdits' })
  assert.deepEqual(parseClaudeAccount({ apiProvider: 'bedrock' }), { kind: 'external' })
  assert.deepEqual(parseClaudeAccount({ apiKeySource: 'ANTHROPIC_API_KEY' }), { kind: 'api-key' })
  assert.deepEqual(parseClaudeAccount({}), { kind: 'unknown' })
  const input = { questions: [{ question: 'Pick one?', header: 'H', options: [] }] }
  const request = permissionRequest('AskUserQuestion', input, {}, 't')
  assert.equal(request.kind, 'question')
  assert.equal(request.questions[0].options, null)
  assert.deepEqual(questionAnswers(input, request, { q0: [' A ', 'B'] }), { 'Pick one?': 'A, B' })
})

test('Claude service runs local turns through the SDK contract', async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'owls-claude-test-')))
  const sdk = fakeSdk()
  const service = new ClaudeService(memoryStore(project), () => {}, sdk)
  try {
    const connection = await service.connect()
    assert.equal(connection.status, 'ready')
    assert.equal(connection.version, '2.1.316 (Claude Code)')
    assert.deepEqual(connection.account, {
      kind: 'claude',
      email: 'fixture@example.com',
      plan: 'max'
    })
    assert.deepEqual(connection.models.find((m) => m.id === 'opus').efforts, ['low', 'high', 'max'])
    assert.equal(sdk.calls[0].pathToClaudeCodeExecutable, fixture)
    assert.equal(sdk.calls[0].persistSession, false)

    const session = service.createSession({
      provider: 'claude-code',
      cwd: project,
      model: null,
      effort: null,
      permission: 'full-access'
    })
    const state = () => service.sessionList().find((s) => s.id === session.id)
    const commandId = crypto.randomUUID()
    await service.send({ sessionId: session.id, commandId, text: 'hello' })
    await until(() => state().status === 'idle')
    assert.deepEqual(
      state()
        .items.filter((i) => i.kind === 'assistant')
        .map((i) => i.text),
      ['hello world']
    )
    assert.equal(state().threadId, 'claude-session-1')
    assert.equal(state().tokens, 15)
    const first = sdk.calls[1]
    assert.equal(first.permissionMode, 'auto')
    assert.deepEqual(first.settingSources, ['user', 'project', 'local'])
    assert.deepEqual(first.systemPrompt, { type: 'preset', preset: 'claude_code' })
    assert.equal(first.resume, undefined)

    await service.send({ sessionId: session.id, commandId, text: 'hello' })
    assert.equal(state().items.filter((i) => i.kind === 'user').length, 1)

    await service.send({ sessionId: session.id, commandId: crypto.randomUUID(), text: 'approval' })
    assert.equal(sdk.calls[2].resume, 'claude-session-1')
    await until(() => state().status === 'waiting')
    const request = state().requests.find((r) => r.status === 'pending')
    assert.equal(request.kind, 'command')
    assert.equal(request.title, 'rm -rf build')
    service.respond({ sessionId: session.id, requestId: request.id, decision: 'decline' })
    await until(() => state().status === 'idle')
    assert.equal(state().items.find((i) => i.id === 't1').status, 'failed')
    assert.throws(
      () => service.respond({ sessionId: session.id, requestId: request.id, decision: 'accept' }),
      (error) => error.code === 'request_unavailable'
    )

    await service.send({ sessionId: session.id, commandId: crypto.randomUUID(), text: 'question' })
    await until(() => state().status === 'waiting')
    const question = state().requests.find((r) => r.status === 'pending')
    assert.throws(
      () =>
        service.respond({
          sessionId: session.id,
          requestId: question.id,
          decision: 'accept',
          answers: {}
        }),
      (error) => error.code === 'answer_required'
    )
    service.respond({
      sessionId: session.id,
      requestId: question.id,
      decision: 'accept',
      answers: { q0: ['SQLite'] }
    })
    await until(() => state().status === 'idle')
    assert.deepEqual(sdk.answers[0].updatedInput.answers, { 'Which database?': 'SQLite' })

    await service.send({ sessionId: session.id, commandId: crypto.randomUUID(), text: 'long' })
    await until(() => state().items.some((i) => i.text === 'working'))
    await service.interrupt(session.id)
    await until(() => state().status === 'interrupted')
    assert.equal(state().error, null)

    // A follow-up sent right after a result must not be failed by the previous turn's cleanup.
    await service.send({ sessionId: session.id, commandId: crypto.randomUUID(), text: 'linger' })
    await until(() => state().status === 'idle')
    await service.send({ sessionId: session.id, commandId: crypto.randomUUID(), text: 'hello' })
    await new Promise((resolve) => setTimeout(resolve, 200))
    await until(() => state().status === 'idle')
    assert.equal(state().error, null)
    assert.equal(state().items.filter((i) => i.text === 'hello world').length, 2)
  } finally {
    service.close()
    rmSync(project, { recursive: true, force: true })
  }
})

test('Claude service reports a missing executable without falling back', async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'owls-claude-test-')))
  const store = memoryStore(project)
  store.settings = () => ({
    ...memoryStore(project).settings(),
    claudeExecutablePath: join(project, 'missing')
  })
  const sdk = fakeSdk()
  const service = new ClaudeService(store, () => {}, sdk)
  try {
    const connection = await service.connect()
    assert.equal(connection.status, 'error')
    assert.equal(connection.error.code, 'claude_not_installed')
    assert.equal(sdk.calls.length, 0)
  } finally {
    service.close()
    rmSync(project, { recursive: true, force: true })
  }
})

test('Claude service steers a message into the running turn', async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'owls-claude-steer-')))
  const service = new ClaudeService(memoryStore(project), () => {}, fakeSdk())
  try {
    await service.connect()
    const session = service.createSession({
      provider: 'claude-code',
      cwd: project,
      model: null,
      effort: null,
      permission: 'workspace-write'
    })
    const state = () => service.sessionList().find((s) => s.id === session.id)
    await service.send({ sessionId: session.id, commandId: crypto.randomUUID(), text: 'steered' })
    assert.equal(service.steer(session.id, 'also this'), 'steered')
    await until(() => state().status === 'idle')
    assert.deepEqual(
      state().items.map((i) => [i.kind, i.text]),
      [
        ['user', 'steered'],
        ['user', 'also this'],
        ['assistant', 'heard: also this']
      ]
    )
    assert.equal(service.steer(session.id, 'too late'), 'not_running')
  } finally {
    service.close()
    rmSync(project, { recursive: true, force: true })
  }
})

test('Claude service lets a worker task stop, not be removed, while its worktree is prepared', async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'owls-claude-prepare-')))
  const sdk = fakeSdk()
  const service = new ClaudeService(memoryStore(project), () => {}, sdk)
  const settled = []
  let release
  let prepareError = null
  service.setTurnProfiles({
    prepare: () =>
      new Promise((resolve, reject) => {
        release = () => (prepareError ? reject(prepareError) : resolve())
      }),
    profile: () => null,
    settled: (sessionId, outcome) => settled.push([sessionId, outcome.status])
  })
  try {
    await service.connect()
    const session = service.createSession({
      provider: 'claude-code',
      cwd: project,
      model: null,
      effort: null,
      permission: 'workspace-write'
    })
    const state = () => service.sessionList().find((s) => s.id === session.id)
    const queries = sdk.calls.length
    const stopped = service.send({
      sessionId: session.id,
      commandId: crypto.randomUUID(),
      text: 'hello'
    })
    assert.equal(state().status, 'starting')
    assert.throws(
      () => service.archive(session.id),
      (error) => error.code === 'busy'
    )
    await service.interrupt(session.id)
    release()
    await stopped
    assert.equal(state().status, 'interrupted')
    assert.deepEqual(state().items, [])
    assert.equal(sdk.calls.length, queries)
    assert.deepEqual(settled, [[session.id, 'interrupted']])

    prepareError = Object.assign(new Error('no worktree'), { code: 'worktree_failed' })
    const failed = service.send({
      sessionId: session.id,
      commandId: crypto.randomUUID(),
      text: 'hello'
    })
    release()
    await assert.rejects(failed, (error) => error.code === 'worktree_failed')
    assert.equal(state().status, 'interrupted')
    assert.equal(sdk.calls.length, queries)

    prepareError = null
    const started = service.send({
      sessionId: session.id,
      commandId: crypto.randomUUID(),
      text: 'hello'
    })
    release()
    await started
    await until(() => state().status === 'idle')
    assert.equal(state().items.at(-1).text, 'hello world')
    service.archive(session.id)
  } finally {
    service.close()
    rmSync(project, { recursive: true, force: true })
  }
})
