import assert from 'node:assert/strict'
import test from 'node:test'

const agents = await import(
  `${new URL('../../src/shared/agents.ts', import.meta.url).href}?ts=${Date.now()}`
)

function settingsWith(cursor) {
  return { ...agents.defaultProjectAgents, models: { codex: [], 'claude-code': [], cursor } }
}

test('picking one of more offered models than the limit saves a valid project list', () => {
  const offered = Array.from(
    { length: agents.PROJECT_MODEL_LIMIT + 50 },
    (_, i) => `gpt-5.6-terra-${i}`
  )
  const shown = agents.rankAll([], offered)
  const next = [{ ...shown[7], on: true }, ...shown.filter((_, i) => i !== 7)]

  assert.equal(agents.projectAgentsSchema.safeParse(settingsWith(next)).success, false)
  const saved = agents.pickedModels(next)
  assert.deepEqual(saved, [{ id: 'gpt-5.6-terra-7', on: true }])
  assert.equal(agents.projectAgentsSchema.safeParse(settingsWith(saved)).success, true)
})

test('picked models keep the user order and drop unchecked entries', () => {
  const saved = agents.pickedModels([
    { id: 'b', on: true },
    { id: 'x', on: false },
    { id: 'a', on: true }
  ])
  assert.deepEqual(saved, [
    { id: 'b', on: true },
    { id: 'a', on: true }
  ])
  assert.deepEqual(agents.chosenModels(settingsWith(saved), 'cursor'), ['b', 'a'])
})

test('Cursor offers only read only and full access, and old workspace settings load as full access', () => {
  assert.deepEqual(agents.agentPermissions('cursor'), ['read-only', 'full-access'])
  assert.deepEqual(agents.agentPermissions('codex'), [
    'read-only',
    'workspace-write',
    'full-access'
  ])
  assert.equal(agents.defaultAgentConfigs.cursor.permission, 'full-access')
  const saved = {
    ...agents.defaultAgentConfigs,
    cursor: { model: null, effort: null, permission: 'workspace-write' }
  }
  const parsed = agents.agentConfigsSchema.parse(saved)
  assert.equal(parsed.cursor.permission, 'full-access')
  assert.equal(parsed.codex.permission, 'workspace-write')
})
