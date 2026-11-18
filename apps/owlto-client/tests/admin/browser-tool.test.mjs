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

const { runRestrictedBrowserCode } = require('../../out/main/app/runtime.js')

/** A stand-in for a Playwright Page, made in the host realm like the real one. */
class FakePage {
  constructor() {
    this.saved = []
  }
  async title() {
    return 'Owlto'
  }
  async evaluate(fn) {
    return { source: fn.toString(), items: [1, 2] }
  }
  async screenshot(options = {}) {
    this.saved.push(options)
    return Buffer.from([7, 8])
  }
  frames() {
    return [this, this]
  }
  async fail() {
    throw new Error('page.goto: \u001b[2mnet::ERR\u001b[22m')
  }
  setInputFiles() {
    throw new Error('should be blocked')
  }
  _secret() {
    return 'internal'
  }
}

const restricted = (code, page = new FakePage(), saveImage = noImage) =>
  runRestrictedBrowserCode(code, { page }, 1_000, saveImage)

test('a restricted script drives the page and gets plain data back', async () => {
  const page = new FakePage()
  const outcome = await restricted(
    `const data = await page.evaluate(() => document.title)
    console.log(await page.title(), data.items.length)
    await new Promise((r) => setTimeout(r, 5))
    return { title: await page.title(), source: data.source, frames: page.frames().length }`,
    page
  )
  assert.equal(outcome.ok, true, outcome.text)
  assert.equal(
    outcome.text,
    'Result: {\n  "title": "Owlto",\n  "source": "() => document.title",\n  "frames": 2\n}\n\nConsole:\n[log] Owlto 2'
  )
})

test('a restricted script returns screenshot bytes as a saved image', async () => {
  const outcome = await restricted('return await page.screenshot()', new FakePage(), async (b) => {
    assert.deepEqual([...b], [7, 8])
    return '/tmp/shot.png'
  })
  assert.equal(outcome.text, 'Result: {\n  "image": "/tmp/shot.png"\n}')
})

test('a restricted script cannot reach Node or the host realm', async () => {
  const escapes = {
    globals:
      "return [typeof process, typeof require, typeof Buffer, typeof globalThis.process].join(',')",
    pageConstructor: 'return typeof page.constructor',
    methodConstructor: 'return typeof page.title.constructor',
    proto: 'return Object.getPrototypeOf(page)',
    resultConstructor: 'const d = await page.evaluate(() => 1); return d.constructor === Object',
    promiseConstructor: 'const p = page.title(); return p.constructor === Promise',
    errorConstructor:
      'try { await page.fail() } catch (e) { return e.constructor === Error && e.message }',
    internals: 'return typeof page._secret',
    evalBlocked: "try { return eval('1 + 1') } catch (e) { return e.name }",
    callChain: 'return typeof page.title.call.constructor'
  }
  const results = {}
  for (const [name, code] of Object.entries(escapes)) {
    const outcome = await restricted(code)
    assert.equal(outcome.ok, true, `${name}: ${outcome.text}`)
    results[name] = outcome.text
  }
  assert.deepEqual(results, {
    globals: 'Result: undefined,undefined,undefined,undefined',
    pageConstructor: 'Result: undefined',
    methodConstructor: 'Result: undefined',
    proto: 'Result: null',
    resultConstructor: 'Result: true',
    promiseConstructor: 'Result: true',
    errorConstructor: 'Result: page.goto: net::ERR',
    internals: 'Result: undefined',
    evalBlocked: 'Result: EvalError',
    callChain: 'Result: undefined'
  })
})

test('host callbacks into script functions pass only wrapped values', async () => {
  const page = new FakePage()
  page.on = (_event, handler) => setTimeout(() => handler(new FakePage()), 0)
  const outcome = await restricted(
    `let seen
    page.on('console', (message) => { seen = [typeof message.constructor, Object.getPrototypeOf(message), typeof message.title] })
    await new Promise((r) => setTimeout(r, 20))
    return seen`,
    page
  )
  assert.equal(outcome.ok, true, outcome.text)
  assert.equal(outcome.text, 'Result: [\n  "undefined",\n  null,\n  "function"\n]')
})

test('a restricted script cannot touch local files through Playwright', async () => {
  const page = new FakePage()
  const path = await restricted("await page.screenshot({ path: '/tmp/x.png' })", page)
  assert.equal(path.ok, false)
  assert.match(path.text, /The path option is not available to this worker/)
  assert.deepEqual(page.saved, [], 'the call never reached the page')
  const upload = await restricted("await page.setInputFiles('input', '/etc/passwd')", page)
  assert.match(upload.text, /setInputFiles is not available to this worker/)
  const nested = await restricted(
    "await page.screenshot({ clip: { x: 0, y: 0, width: 1, height: 1 }, path: '/tmp/y.png' })",
    page
  )
  assert.match(nested.text, /The path option/)
})
