import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

async function loadChatRenderItemsForTest() {
  const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-chat-render-items-'))
  const chatDir = join(moduleDir, 'src/renderer/src/components/chat')
  const sharedDir = join(moduleDir, 'src/shared')

  mkdirSync(chatDir, { recursive: true })
  mkdirSync(sharedDir, { recursive: true })

  const source = readFileSync(
    new URL('../../src/renderer/src/components/chat/chat-render-items.ts', import.meta.url),
    'utf8'
  )
    .replace(
      '../../../../shared/agent-message-visibility',
      '../../../../shared/agent-message-visibility.ts'
    )
    .replace('./tool-activity-utils', './tool-activity-utils.ts')

  writeFileSync(join(chatDir, 'chat-render-items.ts'), source, 'utf8')
  writeFileSync(
    join(chatDir, 'tool-activity-utils.ts'),
    `export function isInlineToolWidget(widget) {
  const normalized = widget.toolName.toLowerCase().replace(/[-\\s]+/g, '_')
  return normalized === 'ask_user' || normalized === 'askuserinput' || normalized === 'ask_user_input'
}
`,
    'utf8'
  )
  writeFileSync(
    join(sharedDir, 'agent-message-visibility.ts'),
    readFileSync(new URL('../../src/shared/agent-message-visibility.ts', import.meta.url), 'utf8'),
    'utf8'
  )

  try {
    return await import(
      `${pathToFileURL(join(chatDir, 'chat-render-items.ts')).href}?ts=${Date.now()}`
    )
  } finally {
    rmSync(moduleDir, { recursive: true, force: true })
  }
}

const { buildChatRenderItems } = await loadChatRenderItemsForTest()

function toolMessage(id, toolCallId, overrides = {}) {
  return {
    id,
    role: 'tool',
    content: '',
    runId: 'run_1',
    visibility: 'shared',
    createdAt: '2026-06-16T12:00:00.000Z',
    toolCallId,
    ...overrides
  }
}

function toolWidget(toolCallId, toolName, overrides = {}) {
  return {
    toolCallId,
    toolName,
    title: toolName,
    args: {},
    status: 'complete',
    isError: false,
    ...overrides
  }
}

test('hidden messages do not split visible run activity', () => {
  const widgets = new Map([
    ['call_1', toolWidget('call_1', 'exec_command')],
    ['call_2', toolWidget('call_2', 'exec_command')]
  ])
  const items = buildChatRenderItems({
    messages: [
      toolMessage('tool_1', 'call_1'),
      {
        id: 'hidden_assistant',
        role: 'assistant',
        content: 'model-only note',
        runId: 'run_1',
        visibility: 'model-only',
        createdAt: '2026-06-16T12:00:01.000Z'
      },
      toolMessage('tool_2', 'call_2')
    ],
    widgets,
    debugMode: false,
    activeRunStartedAtsByRunId: new Map([['run_1', '2026-06-16T12:00:00.000Z']])
  })

  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'workedRun')
  assert.equal(items[0].runId, 'run_1')
  assert.equal(items[0].detailItems.length, 1)
  assert.equal(items[0].detailItems[0].kind, 'toolGroup')
  assert.equal(items[0].detailItems[0].items.length, 2)
})

test('streaming UI tools stay inside the run while remaining promoted for display', () => {
  const widgets = new Map([
    ['call_1', toolWidget('call_1', 'exec_command')],
    ['call_ui', toolWidget('call_ui', 'streamingUITool')],
    ['call_2', toolWidget('call_2', 'exec_command')]
  ])
  const items = buildChatRenderItems({
    messages: [
      toolMessage('tool_1', 'call_1'),
      toolMessage('tool_ui', 'call_ui'),
      toolMessage('tool_2', 'call_2')
    ],
    widgets,
    debugMode: false,
    activeRunStartedAtsByRunId: new Map([['run_1', '2026-06-16T12:00:00.000Z']])
  })

  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'workedRun')
  assert.deepEqual(items[0].promotedDetailItemIds, ['tool_ui'])
  assert.deepEqual(
    items[0].detailItems.map((item) => item.kind === 'toolGroup' && item.id),
    ['tool_1', 'tool_ui', 'tool_2']
  )
})

test('lifted final assistant does not strip worked run completion metadata', () => {
  const widgets = new Map([['call_1', toolWidget('call_1', 'exec_command')]])
  const items = buildChatRenderItems({
    messages: [
      toolMessage('tool_1', 'call_1', {
        createdAt: '2026-06-16T12:00:00.000Z',
        runStartedAt: '2026-06-16T12:00:00.000Z'
      }),
      {
        id: 'assistant_final',
        role: 'assistant',
        content: 'Done.',
        runId: 'run_1',
        visibility: 'shared',
        createdAt: '2026-06-16T12:00:03.000Z',
        runStatus: 'completed',
        runCompletedAt: '2026-06-16T12:00:03.000Z',
        runDurationMs: 3000
      }
    ],
    widgets,
    debugMode: false,
    activeRunStartedAtsByRunId: new Map()
  })

  assert.equal(items.length, 2)
  assert.equal(items[0].kind, 'workedRun')
  assert.equal(items[0].status, 'completed')
  assert.equal(items[0].completedAt, '2026-06-16T12:00:03.000Z')
  assert.equal(items[0].durationMs, 3000)
  assert.equal(items[0].detailItems.length, 1)
  assert.equal(items[1].kind, 'message')
  assert.equal(items[1].message.id, 'assistant_final')
})

test('final assistant stays outside worked run when later run details arrive', () => {
  const widgets = new Map([
    ['call_1', toolWidget('call_1', 'exec_command')],
    ['call_2', toolWidget('call_2', 'exec_command')]
  ])
  const items = buildChatRenderItems({
    messages: [
      toolMessage('tool_1', 'call_1'),
      {
        id: 'assistant_final',
        role: 'assistant',
        content: 'Done.',
        runId: 'run_1',
        visibility: 'shared',
        createdAt: '2026-06-16T12:00:03.000Z'
      },
      toolMessage('tool_2', 'call_2', {
        createdAt: '2026-06-16T12:00:04.000Z',
        runStatus: 'completed',
        runCompletedAt: '2026-06-16T12:00:04.000Z',
        runDurationMs: 4000
      })
    ],
    widgets,
    debugMode: false,
    activeRunStartedAtsByRunId: new Map()
  })

  assert.equal(items.length, 2)
  assert.equal(items[0].kind, 'workedRun')
  assert.equal(items[0].detailItems.length, 1)
  assert.equal(items[0].detailItems[0].kind, 'toolGroup')
  assert.equal(items[0].detailItems[0].items.length, 2)
  assert.equal(items[1].kind, 'message')
  assert.equal(items[1].message.id, 'assistant_final')
})
