import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { BROWSER_RESULT_LIMIT, runBrowserCode } = require('../../out/main/app/runtime.js')

const noImage = async () => assert.fail('no image expected')

test('a script sees its scope, logs to the agent, and returns a JSON value', async () => {
  const page = { title: async () => 'Owlto' }
  const outcome = await runBrowserCode(
    "console.log('opened', { n: 1 }); return { title: await page.title() }",
    { page },
    1_000,
    noImage
  )
  assert.equal(outcome.ok, true)
  assert.equal(
    outcome.text,
    'Result: {\n  "title": "Owlto"\n}\n\nConsole:\n[log] opened {\n  "n": 1\n}'
  )
})

test('a thrown error or a timeout fails the call and keeps the logs', async () => {
  const thrown = await runBrowserCode(
    "console.warn('before'); throw new TypeError('bad')",
    {},
    1_000,
    noImage
  )
  assert.deepEqual(thrown, { ok: false, text: 'Error: TypeError: bad\n\nConsole:\n[warn] before' })
  const plain = await runBrowserCode(
    "throw new Error('page.goto: \\u001b[2mfailed\\u001b[22m')",
    {},
    1_000,
    noImage
  )
  assert.equal(plain.text, 'Error: page.goto: failed', 'plain errors drop the name and ANSI colors')
  const slow = await runBrowserCode(
    'await new Promise((r) => setTimeout(r, 1_000))',
    {},
    20,
    noImage
  )
  assert.deepEqual(slow, { ok: false, text: 'Error: The script did not finish within 20 ms.' })
  const syntax = await runBrowserCode('return (', {}, 1_000, noImage)
  assert.equal(syntax.ok, false)
  assert.match(syntax.text, /^Error: SyntaxError: /)
})

test('returned screenshot bytes are saved and come back as a path', async () => {
  const saved = []
  const outcome = await runBrowserCode(
    'return new Uint8Array([1, 2, 3])',
    {},
    1_000,
    async (bytes) => {
      saved.push([...bytes])
      return '/tmp/shot.png'
    }
  )
  assert.deepEqual(saved, [[1, 2, 3]])
  assert.equal(outcome.text, 'Result: {\n  "image": "/tmp/shot.png"\n}')
})

test('a long result is cut with a hint', async () => {
  const outcome = await runBrowserCode("return 'x'.repeat(50_000)", {}, 1_000, noImage)
  assert.equal(outcome.ok, true)
  assert.ok(outcome.text.length < BROWSER_RESULT_LIMIT + 200)
  assert.match(outcome.text, /cut at 20000 characters/)
})
