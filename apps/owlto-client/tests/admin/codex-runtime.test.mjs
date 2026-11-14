import assert from 'node:assert/strict'
import { chmodSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const {
  CodexClient,
  normalizeItem,
  parseModels,
  safeText
} = require('../../out/main/app/runtime.js')
const fixture = fileURLToPath(new URL('../fixtures/codex/mock-codex.cjs', import.meta.url))
chmodSync(fixture, 0o755)

test('Codex transport initializes, correlates responses, and redacts errors', async () => {
  const client = new CodexClient(
    () => {},
    () => {}
  )
  try {
    assert.equal(await client.start(fixture), 'codex-fixture')
    const [a, b] = await Promise.all([
      client.request('fixture/echo', { value: 'a' }),
      client.request('fixture/echo', { value: 'b' })
    ])
    assert.deepEqual(a, { value: 'a' })
    assert.deepEqual(b, { value: 'b' })
    await assert.rejects(
      client.request('fixture/error'),
      (error) =>
        error.message.includes('[redacted]') && !error.message.includes('secret-token-value')
    )
    await assert.rejects(client.request('fixture/close'), /disconnected/)
  } finally {
    client.stop()
  }
})

test('Codex projection keeps command and patch output without raw wire payloads', () => {
  const command = normalizeItem(
    {
      id: 'cmd',
      type: 'commandExecution',
      command: 'pnpm test',
      status: 'completed',
      aggregatedOutput: 'passed',
      secret: 'do not project'
    },
    'turn',
    true
  )
  assert.equal(command.kind, 'command')
  assert.equal(command.detail, 'passed')
  assert.equal(command.turnId, 'turn')
  assert.equal('secret' in command, false)
  const files = normalizeItem(
    {
      id: 'files',
      type: 'fileChange',
      changes: [{ path: 'app.ts', diff: '+fixed', kind: { type: 'update' } }]
    },
    'turn',
    true
  )
  assert.equal(files.text, 'app.ts')
  assert.equal(files.detail, '+fixed')
  assert.throws(() => normalizeItem({ type: 'agentMessage', text: 'no id' }, null, false))
})

test('Model options come from the native catalog and credentials are redacted', () => {
  const models = parseModels({
    data: [
      {
        model: 'visible',
        displayName: 'Visible',
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'ultra' }]
      },
      {
        model: 'hidden',
        displayName: 'Hidden',
        hidden: true,
        isDefault: false,
        defaultReasoningEffort: 'low',
        supportedReasoningEfforts: []
      }
    ]
  })
  assert.deepEqual(
    models.map((m) => m.id),
    ['visible']
  )
  assert.deepEqual(models[0].efforts, ['medium', 'ultra'])
  assert.equal(safeText('Authorization: Bearer abc123'), 'Authorization: Bearer [redacted]')
})
