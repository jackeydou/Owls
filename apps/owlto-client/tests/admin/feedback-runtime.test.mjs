import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { FeedbackSender, feedback } = require('../../out/main/app/runtime.js')

const diagnostics = {
  appVersion: '2026.11.1400',
  os: 'macOS 15.1',
  arch: 'arm64',
  electron: '39.0.0'
}
const input = {
  title: '',
  body: 'The sidebar flickers\nwhen I resize it.',
  includeDiagnostics: true
}

function sender({ token = 'tok', reply } = {}) {
  const opened = []
  const calls = []
  let invalidated = 0
  const http = async (url, init) => {
    calls.push({ url, init })
    if (reply instanceof Error) throw reply
    return new Response(JSON.stringify(reply?.body ?? {}), { status: reply?.status ?? 201 })
  }
  const instance = new FeedbackSender(
    {
      token: async () => token,
      invalidate: () => {
        invalidated++
      },
      diagnostics: () => diagnostics,
      openUrl: async (url) => {
        opened.push(url)
      }
    },
    http
  )
  return { instance, opened, calls, invalidated: () => invalidated }
}

test('feedback posts an issue as the connected user', async () => {
  const { instance, opened, calls } = sender({
    reply: {
      status: 201,
      body: { number: 42, html_url: 'https://github.com/jackeydou/Owls/issues/42' }
    }
  })
  const result = await instance.send(input)
  assert.deepEqual(result, {
    kind: 'created',
    number: 42,
    url: 'https://github.com/jackeydou/Owls/issues/42'
  })
  assert.equal(opened.length, 0)
  assert.equal(calls[0].url, 'https://api.github.com/repos/jackeydou/Owls/issues')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.title, 'The sidebar flickers')
  assert.deepEqual(body.labels, ['feedback'])
  assert.match(body.body, /when I resize it\./)
  assert.match(body.body, /Owlto 2026\.11\.1400 · macOS 15\.1 · arm64 · Electron 39\.0\.0/)
})

test('feedback leaves the environment out when the user opts out', async () => {
  const { instance, calls } = sender({
    reply: {
      status: 201,
      body: { number: 1, html_url: 'https://github.com/jackeydou/Owls/issues/1' }
    }
  })
  await instance.send({ ...input, title: 'Flicker', includeDiagnostics: false })
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.title, 'Flicker')
  assert.doesNotMatch(body.body, /Environment/)
})

test('feedback without a GitHub connection opens a prefilled issue page', async () => {
  const { instance, opened, calls } = sender({ token: null })
  assert.deepEqual(await instance.send(input), { kind: 'browser', reason: 'signed-out' })
  assert.equal(calls.length, 0)
  const url = new URL(opened[0])
  assert.equal(url.origin + url.pathname, 'https://github.com/jackeydou/Owls/issues/new')
  assert.equal(url.searchParams.get('title'), 'The sidebar flickers')
  assert.equal(url.searchParams.get('labels'), 'feedback')
  assert.match(url.searchParams.get('body'), /when I resize it\./)
})

test('feedback falls back to the browser when the connection cannot file issues', async () => {
  for (const status of [403, 404, 422]) {
    const { instance, opened } = sender({ reply: { status, body: { message: 'no' } } })
    assert.deepEqual(await instance.send(input), { kind: 'browser', reason: 'no-access' })
    assert.equal(opened.length, 1)
  }
})

test('a rejected token signs the user out and opens the browser', async () => {
  const { instance, opened, invalidated } = sender({ reply: { status: 401 } })
  assert.deepEqual(await instance.send(input), { kind: 'browser', reason: 'signed-out' })
  assert.equal(invalidated(), 1)
  assert.equal(opened.length, 1)
})

test('feedback reports a failure when GitHub cannot be reached', async () => {
  const offline = sender({ reply: new TypeError('fetch failed') })
  assert.deepEqual(await offline.instance.send(input), { kind: 'failed' })
  assert.equal(offline.opened.length, 0)
  const down = sender({ reply: { status: 502 } })
  assert.deepEqual(await down.instance.send(input), { kind: 'failed' })
})

test('feedback titles and long prefilled bodies stay within limits', () => {
  assert.equal(feedback.feedbackTitle({ title: '  Mine ', body: 'x' }), 'Mine')
  const long = feedback.feedbackTitle({ title: '', body: 'a'.repeat(200) })
  assert.equal(long.length, 80)
  assert.ok(long.endsWith('…'))
  const url = feedback.feedbackIssueUrl('Title', '中文反馈'.repeat(2000))
  assert.ok(url.length <= 7000, `url is ${url.length} chars`)
  assert.ok(new URL(url).searchParams.get('body').endsWith('…'))
})
