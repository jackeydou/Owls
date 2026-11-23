#!/usr/bin/env node
// A scripted stand-in for the Antigravity CLI (`agy`). `acp` speaks the Agent
// Client Protocol over stdio; the prompt text picks a scenario. Every frame it
// receives, and its arguments, are logged to `.mock-acp-log.jsonl` in the working
// directory. A `.mock-agy-signed-out` file next to this script makes `models`
// fail the way a CLI with no signed-in account does.
const { appendFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const readline = require('node:readline')

const args = process.argv.slice(2)
if (args.includes('--version')) {
  process.stdout.write('agy 1.5.3-fixture\n')
  process.exit(0)
}
if (args[0] === 'models') {
  if (existsSync(join(__dirname, '.mock-agy-signed-out'))) {
    process.stderr.write('Error: Authentication required. Run agy to sign in.\n')
    process.exit(1)
  }
  process.stdout.write(
    'Available models\n\ngemini-3-pro - Gemini 3 Pro (default)\ngemini-3-flash - Gemini 3 Flash\n'
  )
  process.exit(0)
}
if (args[0] !== 'acp') process.exit(64)

const log = (entry) =>
  appendFileSync(join(process.cwd(), '.mock-acp-log.jsonl'), `${JSON.stringify(entry)}\n`)
log({ argv: args })
const send = (frame) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`)
let nextId = 1000
const waiting = new Map()
let cancel = null
function ask(method, params) {
  const id = nextId++
  send({ id, method, params })
  return new Promise((resolve) => waiting.set(id, resolve))
}
const update = (sessionId, value) =>
  send({ method: 'session/update', params: { sessionId, update: value } })
const text = (sessionUpdate, value) => ({ sessionUpdate, content: { type: 'text', text: value } })
const report = JSON.stringify({ status: 'done', summary: 'Done in Antigravity.', artifacts: [] })
const select = (id, currentValue, values) => ({
  id,
  name: id,
  category: id,
  type: 'select',
  currentValue,
  options: values.map((value) => ({ value, name: value }))
})

function opened(sessionId) {
  return {
    sessionId,
    modes: {
      currentModeId: 'default',
      availableModes: [{ id: 'default' }, { id: 'accept-edits' }, { id: 'plan' }]
    },
    configOptions: [
      select('model', 'gemini-3-pro', ['gemini-3-pro', 'gemini-3-flash']),
      select('thought_level', 'medium', ['low', 'medium', 'high', 'extra', 'max'])
    ]
  }
}

async function prompt(params) {
  const sessionId = params.sessionId
  const input = params.prompt.map((block) => block.text).join('\n')
  if (input.includes('wait')) {
    update(sessionId, text('agent_message_chunk', 'Thinking'))
    await new Promise((resolve) => {
      cancel = resolve
    })
    return { stopReason: 'cancelled' }
  }
  update(sessionId, text('agent_thought_chunk', 'Planning'))
  update(sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId: 'run',
    title: 'npm test',
    kind: 'execute',
    status: 'pending',
    rawInput: { command: 'npm test' }
  })
  const decision = await ask('session/request_permission', {
    sessionId,
    toolCall: { toolCallId: 'run' },
    options: [
      { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
      { optionId: 'no', name: 'Deny', kind: 'reject_once' }
    ]
  })
  const allowed = decision.outcome?.optionId === 'yes'
  update(sessionId, {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'run',
    status: allowed ? 'completed' : 'failed',
    content: [{ type: 'content', content: { type: 'text', text: allowed ? 'ok' : 'denied' } }]
  })
  update(sessionId, text('agent_message_chunk', report))
  return {
    stopReason: 'end_turn',
    usage: { inputTokens: 120, outputTokens: 30, thoughtTokens: 5, cachedReadTokens: 20 }
  }
}

const lines = readline.createInterface({ input: process.stdin })
let sessions = 0
lines.on('line', async (line) => {
  const frame = JSON.parse(line)
  log({ frame })
  if (frame.id !== undefined && !frame.method) {
    waiting.get(frame.id)?.(frame.result ?? {})
    waiting.delete(frame.id)
    return
  }
  const reply = (result) => send({ id: frame.id, result })
  switch (frame.method) {
    case 'initialize':
      return reply({
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          mcpCapabilities: { http: false },
          promptCapabilities: { image: true }
        },
        authMethods: [{ id: 'oauth-personal' }, { id: 'gemini-api-key' }],
        agentInfo: { name: 'Antigravity ACP Server' }
      })
    case 'session/new':
      sessions++
      return reply(opened(`agy-session-${sessions}`))
    case 'session/load':
      return reply(opened(frame.params.sessionId))
    case 'session/set_mode':
    case 'session/set_config_option':
      return reply({})
    case 'session/prompt':
      return reply(await prompt(frame.params))
    case 'session/cancel':
      cancel?.()
      return
    default:
      send({ id: frame.id, error: { code: -32601, message: 'Method not found' } })
  }
})
