import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

async function loadMessageUtilsForTest() {
  const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-message-utils-'))
  const mainDir = join(moduleDir, 'main')
  const agentDir = join(mainDir, 'agent')
  const ipcHandlersDir = join(mainDir, 'ipc-handlers')
  const storesDir = join(mainDir, 'stores')
  const sharedDir = join(moduleDir, 'shared')

  mkdirSync(agentDir, { recursive: true })
  mkdirSync(ipcHandlersDir, { recursive: true })
  mkdirSync(storesDir, { recursive: true })
  mkdirSync(sharedDir, { recursive: true })
  symlinkSync(
    new URL('../../node_modules', import.meta.url),
    join(moduleDir, 'node_modules'),
    'dir'
  )

  const messageUtilsSource = readFileSync(
    new URL('../../src/main/agent/message-utils.ts', import.meta.url),
    'utf8'
  )
    .replaceAll(
      '../../shared/agent-message-visibility.js',
      '../../shared/agent-message-visibility.ts'
    )
    .replaceAll('../../shared/attachments.js', '../../shared/attachments.ts')
    .replaceAll('../../shared/context-compaction.js', '../../shared/context-compaction.ts')
    .replaceAll('../../shared/message-parts.js', '../../shared/message-parts.ts')
    .replaceAll('../attachment-handler.js', '../attachment-handler.ts')
    .replaceAll('../ipc-handlers/context-compaction.js', '../ipc-handlers/context-compaction.ts')
    .replaceAll('../stores/settings-store.js', '../stores/settings-store.ts')

  for (const file of [
    'agent-message-visibility.ts',
    'attachments.ts',
    'context-compaction.ts',
    'message-parts.ts'
  ]) {
    writeFileSync(
      join(sharedDir, file),
      readFileSync(new URL(`../../src/shared/${file}`, import.meta.url), 'utf8'),
      'utf8'
    )
  }
  writeFileSync(join(agentDir, 'message-utils.ts'), messageUtilsSource, 'utf8')
  writeFileSync(
    join(mainDir, 'attachment-handler.ts'),
    `export function toMessageAttachment() { return null }\n`,
    'utf8'
  )
  writeFileSync(
    join(ipcHandlersDir, 'context-compaction.ts'),
    `export function rememberContextCompactionMarker() {}
export function replacementMessagesFromMarker(marker) { return marker.replacementMessages ?? [] }
`,
    'utf8'
  )
  writeFileSync(join(storesDir, 'settings-store.ts'), `export {}\n`, 'utf8')

  try {
    return await import(
      `${pathToFileURL(join(agentDir, 'message-utils.ts')).href}?ts=${Date.now()}`
    )
  } finally {
    rmSync(moduleDir, { recursive: true, force: true })
  }
}

const messageUtils = await loadMessageUtilsForTest()

const model = {
  id: 'gpt-5.1',
  name: 'GPT 5.1',
  provider: 'openai',
  api: 'openai-responses',
  reasoning: true,
  input: ['text'],
  contextWindow: 200000,
  maxTokens: 8192
}

function makeToolRow(overrides = {}) {
  return {
    id: 'message_1',
    sessionId: 'session_1',
    runId: 'run_1',
    role: 'tool',
    kind: 'default',
    content: JSON.stringify({
      name: 'web_search',
      arguments: { query: 'andrej karpathy' }
    }),
    agentContent: '',
    visibility: 'shared',
    sortOrder: 1,
    createdAt: '2026-06-10T21:53:00.000Z',
    toolCallId: 'call_1|fc_1',
    toolName: 'web_search',
    toolCallResult: JSON.stringify({
      content: [{ type: 'text', text: 'search results' }]
    }),
    attachmentsJson: null,
    modelId: model.id,
    modelProvider: model.provider,
    modelApi: model.api,
    modelUsageJson: null,
    parts: [],
    ...overrides
  }
}

test('extractToolCallsFromAssistantMessage preserves replayable reasoning content', () => {
  const thinkingSignature = JSON.stringify({
    id: 'rs_1',
    type: 'reasoning',
    encrypted_content: 'encrypted-reasoning',
    summary: []
  })
  const calls = messageUtils.extractToolCallsFromAssistantMessage({
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '', thinkingSignature },
      {
        type: 'toolCall',
        id: 'call_1|fc_1',
        name: 'web_search',
        arguments: { query: 'andrej karpathy' }
      }
    ]
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].toolCallId, 'call_1|fc_1')
  assert.deepEqual(calls[0].assistantContent, [
    { type: 'thinking', thinking: '', thinkingSignature },
    {
      type: 'toolCall',
      id: 'call_1|fc_1',
      name: 'web_search',
      arguments: { query: 'andrej karpathy' }
    }
  ])
})

test('rowsToAgentMessages replays stored reasoning before Responses tool calls', () => {
  const thinkingSignature = JSON.stringify({
    id: 'rs_1',
    type: 'reasoning',
    encrypted_content: 'encrypted-reasoning',
    summary: []
  })
  const rows = [
    makeToolRow({
      content: JSON.stringify({
        name: 'web_search',
        arguments: { query: 'andrej karpathy' },
        assistantContent: [
          { type: 'thinking', thinking: '', thinkingSignature },
          {
            type: 'toolCall',
            id: 'call_1|fc_1',
            name: 'web_search',
            arguments: { query: 'andrej karpathy' }
          }
        ]
      })
    })
  ]

  const messages = messageUtils.rowsToAgentMessages(rows, model)

  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'assistant')
  assert.equal(messages[0].content[0].type, 'thinking')
  assert.equal(messages[0].content[0].thinkingSignature, thinkingSignature)
  assert.equal(messages[0].content[1].type, 'toolCall')
  assert.equal(messages[0].content[1].id, 'call_1|fc_1')
  assert.equal(messages[1].role, 'toolResult')
  assert.equal(messages[1].toolCallId, 'call_1|fc_1')
})

test('rowsToAgentMessages ignores malformed Responses reasoning signatures', () => {
  const rows = [
    makeToolRow({
      content: JSON.stringify({
        name: 'web_search',
        arguments: { query: 'andrej karpathy' },
        assistantContent: [
          { type: 'thinking', thinking: '', thinkingSignature: 'not json' },
          {
            type: 'toolCall',
            id: 'call_1|fc_1',
            name: 'web_search',
            arguments: { query: 'andrej karpathy' }
          }
        ]
      })
    })
  ]

  const messages = messageUtils.rowsToAgentMessages(rows, model)

  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'assistant')
  assert.deepEqual(
    messages[0].content.map((block) => block.type),
    ['toolCall']
  )
  assert.equal(messages[0].content[0].id, 'call_1')
  assert.equal(messages[1].role, 'toolResult')
  assert.equal(messages[1].toolCallId, 'call_1')
})

test('rowsToAgentMessages sanitizes malformed Responses reasoning without stored model metadata', () => {
  const rows = [
    makeToolRow({
      modelId: null,
      modelProvider: null,
      modelApi: null,
      content: JSON.stringify({
        name: 'web_search',
        arguments: { query: 'andrej karpathy' },
        assistantContent: [
          { type: 'thinking', thinking: '', thinkingSignature: 'not json' },
          {
            type: 'toolCall',
            id: 'call_1|fc_1',
            name: 'web_search',
            arguments: { query: 'andrej karpathy' }
          }
        ]
      })
    })
  ]

  const messages = messageUtils.rowsToAgentMessages(rows, model)

  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'assistant')
  assert.deepEqual(
    messages[0].content.map((block) => block.type),
    ['toolCall']
  )
  assert.equal(messages[0].content[0].id, 'call_1')
  assert.equal(messages[0].api, model.api)
  assert.equal(messages[1].role, 'toolResult')
  assert.equal(messages[1].toolCallId, 'call_1')
})

test('rowsToAgentMessages groups parallel Responses tool calls under one reasoning item', () => {
  const thinkingSignature = JSON.stringify({
    id: 'rs_1',
    type: 'reasoning',
    encrypted_content: 'encrypted-reasoning',
    summary: []
  })
  const rows = [
    makeToolRow({
      id: 'message_1',
      toolCallId: 'call_1|fc_1',
      toolName: 'web_search',
      content: JSON.stringify({
        name: 'web_search',
        arguments: { query: 'andrej karpathy' },
        assistantContent: [
          { type: 'thinking', thinking: '', thinkingSignature },
          {
            type: 'toolCall',
            id: 'call_1|fc_1',
            name: 'web_search',
            arguments: { query: 'andrej karpathy' }
          }
        ]
      })
    }),
    makeToolRow({
      id: 'message_2',
      toolCallId: 'call_2|fc_2',
      toolName: 'exec_command',
      content: JSON.stringify({
        name: 'exec_command',
        arguments: { cmd: 'echo ok' },
        assistantContent: [
          { type: 'thinking', thinking: '', thinkingSignature },
          {
            type: 'toolCall',
            id: 'call_2|fc_2',
            name: 'exec_command',
            arguments: { cmd: 'echo ok' }
          }
        ]
      })
    })
  ]

  const messages = messageUtils.rowsToAgentMessages(rows, model)

  assert.equal(messages.length, 3)
  assert.equal(messages[0].role, 'assistant')
  assert.deepEqual(
    messages[0].content.map((block) => block.type),
    ['thinking', 'toolCall', 'toolCall']
  )
  assert.equal(messages[0].content[0].thinkingSignature, thinkingSignature)
  assert.equal(messages[0].content[1].id, 'call_1|fc_1')
  assert.equal(messages[0].content[2].id, 'call_2|fc_2')
  assert.equal(messages[1].role, 'toolResult')
  assert.equal(messages[1].toolCallId, 'call_1|fc_1')
  assert.equal(messages[2].role, 'toolResult')
  assert.equal(messages[2].toolCallId, 'call_2|fc_2')
})

test('rowsToAgentMessages does not group tool calls that only share text prefix', () => {
  const rows = [
    makeToolRow({
      id: 'message_1',
      toolCallId: 'call_1|fc_1',
      toolName: 'web_search',
      content: JSON.stringify({
        name: 'web_search',
        arguments: { query: 'first' },
        assistantContent: [
          { type: 'text', text: 'I will check that.' },
          {
            type: 'toolCall',
            id: 'call_1|fc_1',
            name: 'web_search',
            arguments: { query: 'first' }
          }
        ]
      })
    }),
    makeToolRow({
      id: 'message_2',
      toolCallId: 'call_2|fc_2',
      toolName: 'web_search',
      content: JSON.stringify({
        name: 'web_search',
        arguments: { query: 'second' },
        assistantContent: [
          { type: 'text', text: 'I will check that.' },
          {
            type: 'toolCall',
            id: 'call_2|fc_2',
            name: 'web_search',
            arguments: { query: 'second' }
          }
        ]
      })
    })
  ]

  const messages = messageUtils.rowsToAgentMessages(rows, model)

  assert.equal(messages.length, 4)
  assert.equal(messages[0].role, 'assistant')
  assert.deepEqual(
    messages[0].content.map((block) => block.type),
    ['text', 'toolCall']
  )
  assert.equal(messages[1].role, 'toolResult')
  assert.equal(messages[2].role, 'assistant')
  assert.deepEqual(
    messages[2].content.map((block) => block.type),
    ['text', 'toolCall']
  )
  assert.equal(messages[3].role, 'toolResult')
})

test('rowsToAgentMessages omits Responses item ids for legacy tool rows without reasoning', () => {
  const messages = messageUtils.rowsToAgentMessages([makeToolRow()], model)

  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'assistant')
  assert.equal(messages[0].content[0].type, 'toolCall')
  assert.equal(messages[0].content[0].id, 'call_1')
  assert.equal(messages[1].role, 'toolResult')
  assert.equal(messages[1].toolCallId, 'call_1')
})
