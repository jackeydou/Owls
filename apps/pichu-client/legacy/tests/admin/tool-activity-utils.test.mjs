import assert from 'node:assert/strict'
import test from 'node:test'

const toolActivityUtils = await import(
  `${new URL('../../src/renderer/src/components/chat/tool-activity-utils.ts', import.meta.url).href}?ts=${Date.now()}`
)

function widget(toolName, overrides = {}) {
  return {
    toolCallId: 'call_1',
    toolName,
    title: toolName,
    args: {},
    status: 'complete',
    isError: false,
    ...overrides
  }
}

test('write_stdin is shown as command output instead of raw tool API name', () => {
  assert.equal(toolActivityUtils.displayToolName('write_stdin'), 'Command output')
  assert.equal(toolActivityUtils.activityLine(widget('write_stdin')), 'Read command output')
  assert.equal(
    toolActivityUtils.activityLine(widget('write_stdin', { args: { chars: '' } })),
    'Read command output'
  )
  assert.equal(
    toolActivityUtils.activityLine(widget('write_stdin', { status: 'running' }), 'present'),
    'Waiting for command output'
  )
})

test('write_stdin with input shows only safe stdin previews in activity text', () => {
  assert.equal(
    toolActivityUtils.activityLine(widget('write_stdin', { args: { chars: 'y\n' } })),
    'Sent input y to command'
  )
  assert.equal(
    toolActivityUtils.activityLine(widget('write_stdin', { args: { chars: 'secret-token\n' } })),
    'Sent input to command'
  )
  assert.equal(
    toolActivityUtils.activityLine(
      widget('write_stdin', { args: { chars: '\u0003' }, status: 'running' }),
      'present'
    ),
    'Sending input Ctrl-C to command'
  )
  assert.equal(
    toolActivityUtils.getTerminalStdinInputPreview(
      widget('write_stdin', { args: { chars: '\u0003' } })
    ),
    'Ctrl-C'
  )
  assert.equal(
    toolActivityUtils.getTerminalStdinInputPreview(
      widget('write_stdin', { args: { chars: '\n' } })
    ),
    'Enter'
  )
  assert.equal(
    toolActivityUtils.getTerminalStdinInputPreview(
      widget('write_stdin', { args: { chars: '\u0004' } })
    ),
    'Ctrl-D'
  )
  assert.equal(
    toolActivityUtils.getTerminalStdinInputPreview(
      widget('write_stdin', { args: { chars: 'a'.repeat(120) } })
    ),
    null
  )
})

test('write_stdin is summarized as command output checks', () => {
  assert.equal(
    toolActivityUtils.summarizeFinishedTools([
      widget('write_stdin', { toolCallId: 'call_1' }),
      widget('write_stdin', { toolCallId: 'call_2' })
    ]),
    'Read command output 2 times'
  )
  assert.equal(
    toolActivityUtils.summarizeFinishedTools([
      widget('exec_command', { toolCallId: 'call_1' }),
      widget('write_stdin', { toolCallId: 'call_2' })
    ]),
    'Ran 1 command, checked command output'
  )
})

test('write_stdin terminal detail supports wrapped tool results', () => {
  assert.deepEqual(
    toolActivityUtils.getTerminalTransportDetail(
      widget('write_stdin', {
        result: {
          content: [{ type: 'text', text: 'Process running with session ID 123' }],
          details: {
            sessionId: '123',
            exitCode: null,
            originalTokenCount: 42,
            output: 'ready on http://localhost:3000',
            wallTimeMs: 1500
          }
        }
      })
    ),
    {
      sessionId: '123',
      exitCode: null,
      signalCode: null,
      terminalStatus: null,
      originalTokenCount: 42,
      output: 'ready on http://localhost:3000',
      stdout: null,
      stderr: null,
      wallTimeMs: 1500
    }
  )
})

test('write_stdin terminal detail supports direct managed exec details', () => {
  assert.deepEqual(
    toolActivityUtils.getTerminalTransportDetail(
      widget('write_stdin', {
        result: {
          sessionId: null,
          exitCode: 0,
          originalTokenCount: 0,
          output: '',
          wallTimeMs: 500
        }
      })
    ),
    {
      sessionId: null,
      exitCode: 0,
      signalCode: null,
      terminalStatus: null,
      originalTokenCount: 0,
      output: '',
      stdout: null,
      stderr: null,
      wallTimeMs: 500
    }
  )
})
