import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  detectAgents,
  migrateConnectedAgents,
  settingsSchema
} = require('../../out/main/app/runtime.js')

test('rows from before connectedAgents keep every agent the user had not disconnected', () => {
  const migrated = migrateConnectedAgents({ theme: 'dark', disconnectedAgents: ['cursor'] })
  assert.deepEqual(migrated, { theme: 'dark', connectedAgents: ['claude-code', 'codex'] })
  assert.deepEqual(migrateConnectedAgents({ theme: 'dark' }).connectedAgents, [
    'claude-code',
    'codex',
    'cursor'
  ])
})

test('rows that already say which agents are connected are left alone', () => {
  const row = { theme: 'dark', connectedAgents: [] }
  assert.equal(migrateConnectedAgents(row), row)
})

test('new settings connect no agent', () => {
  assert.deepEqual(settingsSchema.shape.connectedAgents.parse(undefined), [])
})

test('detection reports a picked executable and a missing one without connecting', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'owlto-detect-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const claude = join(dir, 'claude')
  writeFileSync(claude, '#!/bin/sh\nexit 1\n')
  chmodSync(claude, 0o755)
  const detection = detectAgents({
    claudeExecutablePath: claude,
    executablePath: join(dir, 'missing-codex'),
    cursorExecutablePath: join(dir, 'missing-cursor')
  })
  assert.equal(detection['claude-code'].path, claude)
  assert.equal(detection.codex.path, null)
  assert.equal(detection.cursor.path, null)
})
