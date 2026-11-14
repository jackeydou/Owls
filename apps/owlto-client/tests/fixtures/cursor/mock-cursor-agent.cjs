#!/usr/bin/env node
// A scripted stand-in for the Cursor CLI. `acp` speaks the Agent Client Protocol
// over stdio; the prompt text picks a scenario. Every frame it receives, and its
// arguments, are logged to `.mock-acp-log.jsonl` in the working directory.
// A `.mock-acp-http` file there makes it advertise HTTP MCP servers, and a
// "report" prompt then calls the report tool of the HTTP MCP server it was given.
const { appendFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const readline = require('node:readline')

const args = process.argv.slice(2)
if (args.includes('--version')) {
  process.stdout.write('2026.11.10-fixture\n')
  process.exit(0)
}
if (args[0] === 'status') {
  process.stdout.write(
    `${JSON.stringify({ status: 'authenticated', isAuthenticated: true, email: 'owl@example.com' })}\n`
  )
  process.exit(0)
}
if (args[0] === 'models') {
  process.stdout.write(
    'Available models\n\nauto - Auto (default)\ngpt-5 - GPT-5\nsonnet-4.5 - Claude Sonnet 4.5 (current)\n'
  )
  process.exit(0)
}
if (!args.includes('acp')) process.exit(64)

const log = (entry) =>
  appendFileSync(join(process.cwd(), '.mock-acp-log.jsonl'), `${JSON.stringify(entry)}\n`)
log({ argv: args })
const send = (frame) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`)
let nextId = 1000
const waiting = new Map()
let cancel = null
/** MCP servers the client gave each session. */
const sessionServers = new Map()
function ask(method, params) {
  const id = nextId++
  send({ id, method, params })
  return new Promise((resolve) => waiting.set(id, resolve))
}
const update = (sessionId, value) =>
  send({ method: 'session/update', params: { sessionId, update: value } })
const text = (sessionUpdate, value) => ({ sessionUpdate, content: { type: 'text', text: value } })
const report = JSON.stringify({ status: 'done', summary: 'Fixed it.', artifacts: [] })

async function prompt(params) {
  const sessionId = params.sessionId
  const input = params.prompt.map((block) => block.text).join('\n')
  if (input.includes('wait')) {
    update(sessionId, text('agent_message_chunk', 'Working'))
    await new Promise((resolve) => {
      cancel = resolve
    })
    return { stopReason: 'cancelled' }
  }
  if (input.includes('report through mcp')) {
    const server = (sessionServers.get(sessionId) ?? []).find((s) => s.type === 'http')
    if (!server) {
      // Without the tool, follow the JSON report prompt instead.
      update(sessionId, text('agent_message_chunk', report))
      return { stopReason: 'end_turn' }
    }
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
    const {
      StreamableHTTPClientTransport
    } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
    const client = new Client({ name: 'mock-cursor', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)))
    const { tools } = await client.listTools()
    const results = []
    for (const args of [
      { status: 'progress', summary: 'Halfway there.' },
      {
        status: 'done',
        summary: 'Wrote the notes.',
        artifacts: [{ kind: 'file', ref: 'notes.md' }]
      }
    ])
      results.push(await client.callTool({ name: 'report', arguments: args }))
    await client.close()
    log({ mcp: { name: server.name, tools: tools.map((t) => t.name), results } })
    update(sessionId, text('agent_message_chunk', 'All set.'))
    return { stopReason: 'end_turn' }
  }
  if (input.includes('question')) {
    const answer = await ask('cursor/ask_question', {
      toolCallId: 'call_q',
      title: 'Need input',
      questions: [
        {
          id: 'q1',
          prompt: 'Which mode?',
          options: [
            { id: 'agent', label: 'Agent' },
            { id: 'plan', label: 'Plan' }
          ],
          allowMultiple: false
        }
      ]
    })
    update(sessionId, text('agent_message_chunk', JSON.stringify(answer)))
    return { stopReason: 'end_turn' }
  }
  update(sessionId, text('agent_thought_chunk', 'Thinking'))
  update(sessionId, text('agent_message_chunk', 'Hel'))
  update(sessionId, text('agent_message_chunk', 'lo'))
  update(sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId: 'call_cmd',
    title: '`pnpm test`',
    kind: 'execute',
    status: 'pending',
    rawInput: { command: 'pnpm test' }
  })
  const decision = await ask('session/request_permission', {
    sessionId,
    toolCall: { toolCallId: 'call_cmd' },
    options: [
      { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
      { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }
    ]
  })
  const allowed = decision.outcome?.optionId === 'allow-once'
  update(sessionId, {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'call_cmd',
    status: allowed ? 'completed' : 'failed',
    content: [
      { type: 'content', content: { type: 'text', text: allowed ? 'tests passed' : 'rejected' } }
    ]
  })
  update(sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId: 'call_edit',
    title: 'Edit app.ts',
    kind: 'edit',
    status: 'pending',
    locations: [{ path: join(process.cwd(), 'app.ts') }]
  })
  const edit = await ask('session/request_permission', {
    sessionId,
    toolCall: {
      toolCallId: 'call_edit',
      content: [{ type: 'diff', path: 'app.ts', oldText: 'broken', newText: 'fixed' }]
    },
    options: [
      { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }
    ]
  })
  update(sessionId, {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'call_edit',
    status: edit.outcome?.optionId === 'allow-once' ? 'completed' : 'failed'
  })
  update(sessionId, {
    sessionUpdate: 'plan',
    entries: [
      { content: 'Run tests', status: 'completed', priority: 'high' },
      { content: 'Fix app', status: 'in_progress', priority: 'high' }
    ]
  })
  update(sessionId, text('agent_message_chunk', `Done.\n\n\`\`\`json\n${report}\n\`\`\``))
  return { stopReason: 'end_turn' }
}

async function handle(frame) {
  const { id, method, params } = frame
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          ...(existsSync(join(process.cwd(), '.mock-acp-http'))
            ? { mcpCapabilities: { http: true } }
            : {})
        },
        authMethods: [{ id: 'cursor_login', name: 'Cursor login' }]
      }
    case 'authenticate':
    case 'session/set_mode':
      return {}
    case 'session/new':
      sessionServers.set('cursor-session-1', params.mcpServers)
      return {
        sessionId: 'cursor-session-1',
        modes: {
          currentModeId: 'agent',
          availableModes: [{ id: 'agent' }, { id: 'plan' }, { id: 'ask' }]
        }
      }
    case 'session/load':
      if (params.sessionId === 'missing') throw new Error('Session not found')
      sessionServers.set(params.sessionId, params.mcpServers)
      // Loading replays the conversation the client already shows.
      update(params.sessionId, text('agent_message_chunk', 'replayed'))
      return { modes: { currentModeId: 'agent', availableModes: [{ id: 'agent' }, { id: 'ask' }] } }
    case 'session/prompt':
      return prompt(params)
    default:
      throw Object.assign(new Error(`Unknown method ${method}`), { code: -32601, id })
  }
}

const lines = readline.createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const frame = JSON.parse(line)
  log({ frame })
  if (frame.method === 'session/cancel') {
    cancel?.()
    return
  }
  if (frame.method === undefined && waiting.has(frame.id)) {
    const resolve = waiting.get(frame.id)
    waiting.delete(frame.id)
    resolve(frame.result ?? { error: frame.error })
    return
  }
  if (frame.id === undefined) return
  handle(frame).then(
    (result) => send({ id: frame.id, result }),
    (error) => send({ id: frame.id, error: { code: error.code ?? -32603, message: error.message } })
  )
})
lines.on('close', () => process.exit(0))
