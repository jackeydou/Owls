import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { request } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk/core'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall
} from '@earendil-works/pi-ai'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { cipher, commands } from '../fixtures/router-store.mjs'
import { openSqlite } from '../fixtures/sqlite.mjs'

const require = createRequire(import.meta.url)
const {
  ClaudeService,
  CodexService,
  CursorService,
  OwlsEngine,
  OwlsHost,
  OwlsStore,
  parseToolReport,
  RouterCredentials,
  RouterStore,
  RouterService,
  WorkerReportServer
} = require('../../out/main/app/runtime.js')

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = resolve(here, '../../migrations')
const fixture = (name) => {
  const path = resolve(here, '../fixtures', name)
  chmodSync(path, 0o755)
  return path
}
const CODEX = fixture('codex/mock-codex.cjs')
const CURSOR = fixture('cursor/mock-cursor-agent.cjs')
const CLAUDE = fixture('claude/mock-claude.cjs')

async function until(check, label, ms = 10_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const value = check()
    if (value) return value
    await new Promise((done) => setTimeout(done, 10))
  }
  assert.fail(`Timed out waiting for ${label}`)
}

/**
 * A stand-in for the Agent SDK's query() that behaves like Claude Code calling
 * the worker's in-process MCP tool: it connects an MCP client to the SDK
 * server Owls passed in `mcpServers` and calls `report` through it.
 */
function claudeSdk() {
  const calls = []
  return {
    calls,
    createSdkMcpServer,
    query({ prompt, options }) {
      calls.push(options)
      const iterator = prompt[Symbol.asyncIterator]()
      const generator = (async function* () {
        const first = await iterator.next()
        if (first.done) return
        yield { type: 'system', subtype: 'init', session_id: 'claude-worker-1' }
        const server = options.mcpServers?.owls
        const client = new Client({ name: 'fake-claude', version: '1' })
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
        await server.instance.connect(serverSide)
        await client.connect(clientSide)
        const { tools } = await client.listTools()
        const bad = await client.callTool({ name: 'report', arguments: { status: 'finished' } })
        const done = await client.callTool({
          name: 'report',
          arguments: { status: 'done', summary: 'Claude finished.' }
        })
        await client.close()
        calls.push({ tools: tools.map((t) => t.name), bad, done })
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Finished the task.',
          usage: { input_tokens: 1, output_tokens: 1 }
        }
      })()
      return Object.assign(generator, {
        initializationResult: async () => ({
          models: [{ value: 'default', displayName: 'Default', description: '' }],
          account: { email: 'fixture@example.com', subscriptionType: 'max' }
        }),
        interrupt: async () => {},
        close: () => {}
      })
    }
  }
}

/**
 * The real app wiring: one OwlsStore, the three task services, OwlsHost, and a
 * RouterService whose engine is scripted. The Router dispatches one worker on
 * `provider`, and the batch after that is captured.
 */
async function app(t, provider, goal = 'report through mcp') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'owls-report-tool-')))
  const workspace = join(root, 'workspace')
  const client = openSqlite(join(root, 'owls.db'))
  const store = new OwlsStore(client, MIGRATIONS)
  store.saveSettings({
    ...store.settings(),
    executablePath: CODEX,
    cursorExecutablePath: CURSOR,
    claudeExecutablePath: CLAUDE,
    provider,
    model: null,
    effort: null,
    cursorModel: null,
    claudeModel: null,
    claudeEffort: null,
    workspacePath: workspace
  })
  const sdk = claudeSdk()
  const emit = () => {}
  const codex = new CodexService(store, emit)
  const claude = new ClaudeService(store, emit, sdk)
  const cursor = new CursorService(store, emit)
  const host = new OwlsHost(codex, claude, cursor, join(root, 'thread'), join(root, 'p'), workspace)
  const batches = []
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const last = (context) => {
    const user = context.messages.findLast((m) => m.role === 'user')
    return typeof user.content === 'string'
      ? user.content
      : user.content.map((c) => c.text ?? '').join('')
  }
  faux.setResponses([
    () =>
      fauxAssistantMessage([fauxToolCall('dispatch_task', { goal })], {
        stopReason: 'toolUse'
      }),
    () => fauxAssistantMessage(fauxText('Started.')),
    (context) => {
      batches.push(last(context))
      return fauxAssistantMessage(fauxText('Reported.'))
    }
  ])
  const routerStore = new RouterStore(store)
  const router = new RouterService(
    routerStore,
    new RouterCredentials(routerStore, cipher),
    commands(),
    host.workerHost(),
    emit,
    (input) =>
      new OwlsEngine({
        routerId: input.router.id,
        model: faux.getModel(),
        thinking: 'off',
        streamFn: models.streamSimple.bind(models),
        getApiKey: () => undefined,
        instructions: 'You are a test Router.',
        tools: input.tools,
        history: input.history,
        state: input.state,
        persist: input.persist,
        version: 'test'
      })
  )
  host.attachRouter(router)
  t.after(() => {
    router.close()
    codex.close()
    claude.close()
    cursor.close()
    client.close()
    rmSync(root, { recursive: true, force: true })
  })
  if (provider === 'codex') await codex.connect()
  if (provider === 'cursor') await cursor.connect()
  if (provider === 'claude-code') await claude.connect()
  const thread = router.createThread({ projectId: null })
  return { root, workspace, router, routerStore, thread, batches, sdk, host, codex, cursor }
}

test('report tool input is validated before it reaches the Router', () => {
  assert.deepEqual(parseToolReport({ status: 'done', summary: 'Ok.' }), {
    ok: true,
    report: { status: 'done', summary: 'Ok.', artifacts: [] }
  })
  const bad = parseToolReport({ status: 'finished', summary: 1, extra: true })
  assert.equal(bad.ok, false)
  assert.match(bad.text, /^Invalid report\. /)
  assert.match(bad.text, /status/)
  assert.equal(parseToolReport({ status: 'done', summary: 'x'.repeat(20_001) }).ok, false)
})

test('a Codex worker reports through its dynamic tool instead of its final message', async (t) => {
  // The fixture's "report <json>" turn calls the thread's first dynamic tool with that JSON.
  const done = { status: 'done', summary: 'Counted 3 files.', artifacts: [] }
  const { router, thread, batches, codex } = await app(t, 'codex', `report ${JSON.stringify(done)}`)
  router.send({ routerId: thread.id, commandId: crypto.randomUUID(), text: 'Go' })
  const batch = await until(() => batches[0], 'the report batch')
  assert.match(batch, /worker_report · w_[0-9a-f]+ · .* · done\nGoal: report .*\nCounted 3 files\./)
  const worker = router.snapshot().workers[0]
  assert.equal(worker.degraded, false)
  const items = codex.snapshot().sessions.find((s) => s.id === worker.sessionId).items
  const answer = items.find((i) => i.kind === 'assistant').text
  assert.match(answer, /tool result: \{"success":true/, 'Codex got the tool result back')
  assert.match(answer, /Report received/)
})

test('a Cursor worker reports through the local HTTP MCP server', async (t) => {
  const { router, routerStore, thread, batches, workspace } = await app(t, 'cursor')
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(workspace, '.mock-acp-http'), '')
  router.send({ routerId: thread.id, commandId: crypto.randomUUID(), text: 'Go' })
  const batch = await until(() => batches[0], 'the report batch')
  assert.match(batch, /worker_report · w_[0-9a-f]+ · .* · done\nGoal: report through mcp\nWrote/)
  assert.match(batch, /Artifacts: file:notes\.md/)
  const worker = router.snapshot().workers[0]
  assert.equal(worker.degraded, false)
  const log = readFileSync(join(workspace, '.mock-acp-log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const created = log.find((e) => e.frame?.method === 'session/new').frame.params
  assert.equal(created.mcpServers.length, 1)
  assert.equal(created.mcpServers[0].type, 'http')
  assert.match(created.mcpServers[0].url, /^http:\/\/127\.0\.0\.1:\d+\/workers\/[0-9a-f]{48}\/mcp$/)
  const prompt = log.find((e) => e.frame?.method === 'session/prompt').frame.params.prompt[0].text
  assert.match(prompt, /Owls report tool/)
  assert.doesNotMatch(prompt, /JSON Schema/, 'the schema prompt is only for agents without MCP')
  const { mcp } = log.find((e) => e.mcp)
  assert.equal(mcp.name, 'owls')
  assert.deepEqual(mcp.tools, ['report'])
  assert.match(mcp.results[0].content[0].text, /Progress noted/)
  assert.equal(mcp.results[1].isError, false)
  const progress = routerStore
    .events(thread.id, 'superseded')
    .find((e) => e.kind === 'worker_progress')
  assert.equal(
    progress.summary,
    'Halfway there.',
    'progress waited quietly, then the report replaced it'
  )
  assert.equal(batches.length, 1, 'progress did not start a batch of its own')
  const late = router.profile(worker.sessionId).report.call({ status: 'done', summary: 'Again.' })
  assert.deepEqual(late, { ok: false, text: 'Owls takes reports only while your turn is running.' })
})

test('a Cursor worker without HTTP MCP support falls back to the JSON prompt', async (t) => {
  const { router, thread, workspace } = await app(t, 'cursor')
  router.send({ routerId: thread.id, commandId: crypto.randomUUID(), text: 'Go' })
  const report = await until(() => router.snapshot().workers[0]?.report, 'the fallback report')
  assert.equal(report.summary, 'Fixed it.')
  assert.equal(router.snapshot().workers[0].degraded, false)
  const log = readFileSync(join(workspace, '.mock-acp-log.jsonl'), 'utf8')
  const created = log
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .find((e) => e.frame?.method === 'session/new').frame.params
  assert.deepEqual(created.mcpServers, [])
  assert.match(log, /JSON Schema/)
})

test('a Claude Code worker reports through its in-process MCP server', async (t) => {
  const { router, thread, batches, sdk } = await app(t, 'claude-code')
  router.send({ routerId: thread.id, commandId: crypto.randomUUID(), text: 'Go' })
  const batch = await until(() => batches[0], 'the report batch')
  assert.match(
    batch,
    /worker_report · w_[0-9a-f]+ · .* · done\nGoal: report through mcp\nClaude finished\./
  )
  const options = sdk.calls.find((c) => c.mcpServers)
  assert.deepEqual(
    await options.canUseTool('mcp__owls__report', { status: 'done' }, {}),
    { behavior: 'allow', updatedInput: { status: 'done' } },
    'the report tool never asks the user'
  )
  assert.equal(options.outputFormat, undefined, 'the tool replaces the output schema')
  assert.match(options.systemPrompt.append, /Owls report tool/)
  const result = sdk.calls.find((c) => c.tools)
  assert.deepEqual(result.tools, ['report'])
  assert.equal(result.bad.isError, true, 'a bad status is refused')
  assert.equal(result.done.isError ?? false, false)
  assert.equal(router.snapshot().workers[0].degraded, false)
})

test('the report server only answers known paths on its own host', async (t) => {
  const calls = []
  const server = new WorkerReportServer((sessionId, input) => {
    calls.push({ sessionId, input })
    return { ok: true, text: 'noted' }
  })
  t.after(() => server.close())
  const url = new URL(await server.endpoint('s1'))
  assert.equal(await server.endpoint('s1'), url.href, 'a session keeps its URL')
  assert.notEqual(await server.endpoint('s2'), url.href)
  const status = (path, host) =>
    new Promise((done, fail) => {
      const req = request(
        { host: '127.0.0.1', port: url.port, path, method: 'POST', headers: { host } },
        (res) => {
          res.resume()
          done(res.statusCode)
        }
      )
      req.on('error', fail)
      req.end('{}')
    })
  assert.equal(await status(`/workers/${'0'.repeat(48)}/mcp`, url.host), 404)
  assert.equal(await status(url.pathname, `evil.example:${url.port}`), 404)
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(url))
  const result = await client.callTool({ name: 'report', arguments: { status: 'done' } })
  await client.close()
  assert.deepEqual(calls, [{ sessionId: 's1', input: { status: 'done' } }])
  assert.equal(result.content[0].text, 'noted')
})
