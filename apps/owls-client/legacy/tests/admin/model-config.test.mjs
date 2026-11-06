import assert from 'node:assert/strict'
import test from 'node:test'
import {
  configuredModelIdsFromStoredSettings,
  resolveConfiguredModelId
} from '../../src/shared/model-config.ts'

test('includes enabled subscription models in configured chat model IDs', () => {
  const ids = configuredModelIdsFromStoredSettings(
    JSON.stringify([{ id: 'custom-model' }]),
    JSON.stringify(['gpt-5.5', 'gpt-image-2', 'gpt-5.6-terra']),
    ['gpt-image-2']
  )

  assert.deepEqual(ids, ['custom-model', 'gpt-5.5', 'gpt-5.6-terra'])
})

test('selects the first configured model when no default has been saved', () => {
  assert.equal(resolveConfiguredModelId(undefined, ['gpt-5.5', 'gpt-5.6-terra']), 'gpt-5.5')
})

test('preserves a valid saved model and replaces an unavailable one', () => {
  const ids = ['gpt-5.5', 'gpt-5.6-terra']

  assert.equal(resolveConfiguredModelId('gpt-5.6-terra', ids), 'gpt-5.6-terra')
  assert.equal(resolveConfiguredModelId('removed-model', ids), 'gpt-5.5')
})
