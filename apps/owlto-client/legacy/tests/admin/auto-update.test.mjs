import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeAutoUpdateChannel } from '../../src/shared/auto-update.ts'

test('auto-update channel defaults untrusted values to stable', () => {
  assert.equal(normalizeAutoUpdateChannel('stable'), 'stable')
  assert.equal(normalizeAutoUpdateChannel('beta'), 'beta')
  assert.equal(normalizeAutoUpdateChannel('nightly'), 'stable')
  assert.equal(normalizeAutoUpdateChannel(null), 'stable')
})
