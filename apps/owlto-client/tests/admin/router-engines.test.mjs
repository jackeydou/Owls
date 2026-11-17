import assert from 'node:assert/strict'
import test from 'node:test'
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk/core'
import { z } from 'zod'
import {
  ClaudeEngine,
  CodexEngine,
  CodexRouterServer,
  claudeInit,
  claudeResult,
  claudeText,
  codexRouterArgs,
  defaultEngineFactory,
  fakeClaudeSdk,
  fakeCodex,
  harness,
  message,
  PROJECT,
  routerTools,
  send,
  waitFor
} from '../fixtures/router-harness.mjs'

test('the Claude Code engine runs isolated, calls Owlto tools, and resumes its session', async () => {
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
              name: 'mcp__owlto__dispatch_task',
              input: { goal: 'Count files' }
            }
          ]
        }
      }
      const tool = options.mcpServers.owlto.options.tools[0]
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
          owlto: null,
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
    'mcp__owlto__dispatch_task',
    'mcp__owlto__list_workers',
    'mcp__owlto__message_worker',
    'mcp__owlto__recall',
    'mcp__owlto__stop_worker'
  ])
  assert.deepEqual(Object.keys(options.mcpServers), ['owlto'])
  assert.equal(options.mcpServers.owlto.options.alwaysLoad, true)
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
      ['worker', ''],
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

test('the real Agent SDK lets the Router leave optional tool arguments out', async () => {
  const dispatched = []
  const tools = routerTools({
    dispatchTask: async (input) => {
      dispatched.push(input)
      return { workerId: 'w_1', status: 'started', workspace: 'checkout', branch: null }
    }
  })
  let listed
  let called
  const sdk = {
    ...fakeClaudeSdk([
      async function* ({ options, next }) {
        await next()
        // The SDK's MCP server validates arguments before Owlto sees them.
        const handlers = options.mcpServers.owlto.instance.server._requestHandlers
        listed = await handlers.get('tools/list')({ method: 'tools/list', params: {} }, {})
        called = await handlers.get('tools/call')(
          {
            method: 'tools/call',
            params: { name: 'dispatch_task', arguments: { goal: 'Count the files' } }
          },
          {}
        )
        yield claudeInit('s-1')
        yield claudeResult()
      }
    ]),
    createSdkMcpServer
  }
  const engine = new ClaudeEngine({
    sdk,
    executable: '/bin/claude',
    cwd: '/tmp',
    model: null,
    instructions: 'Route.',
    tools,
    version: 'test'
  })
  const sink = { item: () => {}, usage: () => {} }
  await engine.run({ batchId: 'b_1', text: 'Go', native: null }, sink)
  assert.deepEqual(dispatched, [{ goal: 'Count the files' }])
  assert.equal(called.isError, undefined, called.content[0].text)
  const dispatch = listed.tools.find((tool) => tool.name === 'dispatch_task')
  assert.deepEqual(dispatch.inputSchema.required, ['goal'])
  assert.ok(dispatch.inputSchema.properties.parent.description)
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
  const make = (promptVersion = 2, customInstructions = null) =>
    new CodexEngine({
      server,
      executable: '/bin/codex',
      cwd: PROJECT.path,
      model: 'gpt-test',
      instructions: customInstructions ? 'Route my way.' : 'Route.',
      promptVersion,
      customInstructions,
      tools: tools.map((t) => ({
        ...t,
        schema: z.object({ goal: z.string() })
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
  assert.deepEqual(usage, [
    {
      model: 'gpt-test',
      input: 40,
      output: 5,
      cacheRead: 60,
      cacheWrite: 0,
      reasoning: 0,
      costUsd: null
    }
  ])

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
  // So do the user's own instructions, and going back to the defaults.
  const custom = await make(3, 'abc').run(
    { batchId: 'b_6', text: 'Hi', native: bumped.native },
    sink
  )
  assert.deepEqual(custom.native, {
    engine: 'codex',
    threadId: 'thread-4',
    promptVersion: 3,
    custom: 'abc'
  })
  const customStart = codex.requests.filter((r) => r.method === 'thread/start').at(-1).params
  assert.equal(customStart.developerInstructions, 'Route my way.')
  const kept = await make(3, 'abc').run({ batchId: 'b_7', text: 'Hi', native: custom.native }, sink)
  assert.equal(kept.native.threadId, 'thread-4')
  const restored = await make(3).run({ batchId: 'b_8', text: 'Hi', native: custom.native }, sink)
  assert.deepEqual(restored.native, { engine: 'codex', threadId: 'thread-5', promptVersion: 3 })
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
