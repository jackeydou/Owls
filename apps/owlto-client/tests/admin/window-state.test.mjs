import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  readWindowState,
  restorableBounds,
  writeWindowState
} = require('../../out/main/app/runtime.js')

const minimum = { width: 820, height: 620 }
const laptop = { x: 0, y: 25, width: 1512, height: 920 }
const external = { x: 1512, y: 0, width: 2560, height: 1415 }

test('window state round-trips through its file and ignores foreign content', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'owlto-window-state-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'nested', 'window-state.json')
  assert.equal(readWindowState(path), null)
  const state = { bounds: { x: 40, y: 60, width: 1400, height: 900 }, maximized: true }
  writeWindowState(path, state)
  assert.deepEqual(readWindowState(path), state)
  writeFileSync(path, '{"bounds":{"x":"left"},"maximized":true}')
  assert.equal(readWindowState(path), null)
  writeFileSync(path, 'not json')
  assert.equal(readWindowState(path), null)
})

test('saved bounds come back on the display they mostly sit on', () => {
  const bounds = { x: 1600, y: 100, width: 1800, height: 1100 }
  assert.deepEqual(restorableBounds(bounds, [laptop, external], minimum), bounds)
})

test('saved bounds are fitted inside their display', () => {
  assert.deepEqual(
    restorableBounds({ x: 900, y: 0, width: 2000, height: 1200 }, [laptop], minimum),
    { x: 0, y: 25, width: 1512, height: 920 }
  )
  assert.deepEqual(
    restorableBounds({ x: 100, y: 100, width: 400, height: 300 }, [laptop], minimum),
    { x: 100, y: 100, width: 820, height: 620 }
  )
})

test('bounds on a display that is gone are not restored', () => {
  const onExternal = { x: 1700, y: 100, width: 1600, height: 1000 }
  assert.equal(restorableBounds(onExternal, [laptop], minimum), null)
})
