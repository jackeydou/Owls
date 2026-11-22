import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

// The preload runs sandboxed, where `require` only resolves `electron` and a few Node
// built-ins. Any bundled package import fails, `window.owlto` is never exposed, and the
// window stays blank.
const SANDBOX_MODULES = new Set(['electron', 'events', 'timers', 'url'])

test('the preload bundle requires only modules a sandboxed preload can load', () => {
  const source = readFileSync(join(import.meta.dirname, '../../out/preload/index.js'), 'utf8')
  const required = [...source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)]
    .map((match) => match[1])
    .sort()
  assert.ok(required.includes('electron'))
  assert.deepEqual(
    required.filter((name) => !SANDBOX_MODULES.has(name)),
    []
  )
})
