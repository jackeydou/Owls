import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  SitePolicy,
  browserSettingsSchema,
  siteHost,
  siteRuleFor
} = require('../../out/main/app/runtime.js')

test('a site rule covers its subdomains, and the most specific rule wins', () => {
  const sites = [
    { host: 'example.com', rule: 'ask' },
    { host: 'pay.example.com', rule: 'block' },
    { host: 'localhost:3000', rule: 'allow' }
  ]
  assert.equal(siteRuleFor(sites, 'example.com'), 'ask')
  assert.equal(siteRuleFor(sites, 'www.example.com'), 'ask')
  assert.equal(siteRuleFor(sites, 'PAY.example.com'), 'block')
  assert.equal(siteRuleFor(sites, 'a.pay.example.com'), 'block')
  assert.equal(siteRuleFor(sites, 'badexample.com'), null, 'a suffix is not a subdomain')
  assert.equal(siteRuleFor(sites, 'localhost:3000'), 'allow')
  assert.equal(siteRuleFor(sites, 'other.org'), null)
})

test('what the user types for a site becomes a host, or nothing', () => {
  assert.equal(siteHost(' https://GitHub.com/login '), 'github.com')
  assert.equal(siteHost('docs.example.com/path'), 'docs.example.com')
  assert.equal(siteHost('localhost:5173'), 'localhost:5173')
  assert.equal(siteHost(''), null)
  assert.equal(siteHost('not a host'), null)
})

test('older settings without browser rules get the defaults', () => {
  assert.deepEqual(browserSettingsSchema.parse({}), { sites: [], askBeforeSubmit: true })
  assert.deepEqual(
    browserSettingsSchema.parse({ sites: [{ host: 'Bad Host', rule: 'allow' }] }),
    { sites: [], askBeforeSubmit: true },
    'a malformed list falls back instead of failing the whole settings file'
  )
})

/** A policy over fakes; `decide` sends one main-frame request through it. */
function policy({ sites = [], askBeforeSubmit = true, signedIn = true, answer = 'allow' } = {}) {
  const asks = []
  let listener = null
  const instance = new SitePolicy({
    settings: () => ({ sites, askBeforeSubmit }),
    workerTab: (id) => (id === 7 ? { tabId: 'tab-1', key: 'w1' } : null),
    ask: async (tabId, ask) => {
      asks.push({ tabId, ...ask })
      return answer
    },
    signedIn: async () => signedIn
  })
  instance.install({
    webRequest: {
      onBeforeRequest: (filter, fn) => {
        assert.deepEqual(filter.types, ['mainFrame'])
        listener = fn
      }
    }
  })
  const decide = (url, { method = 'GET', webContentsId = 7 } = {}) =>
    new Promise((resolve) =>
      listener({ url, method, webContentsId }, (result) => resolve(!result.cancel))
    )
  return { instance, asks, decide }
}

test('blocked sites never load, and the user’s own tabs are never held up', async () => {
  const { asks, decide } = policy({ sites: [{ host: 'bank.com', rule: 'block' }] })
  assert.equal(await decide('https://www.bank.com/'), false)
  assert.equal(await decide('https://www.bank.com/', { webContentsId: 9 }), true)
  assert.equal(await decide('https://news.com/'), true)
  assert.deepEqual(asks, [])
})

test('an "ask" site asks once per worker, and a block keeps it closed', async () => {
  const allowed = policy({ sites: [{ host: 'github.com', rule: 'ask' }] })
  assert.equal(await allowed.decide('https://github.com/a'), true)
  assert.equal(await allowed.decide('https://github.com/b'), true)
  assert.deepEqual(allowed.asks, [{ tabId: 'tab-1', kind: 'open', host: 'github.com' }])
  allowed.instance.forgetWorker('w1')
  await allowed.decide('https://github.com/c')
  assert.equal(allowed.asks.length, 2, 'a forgotten worker asks again')

  const blocked = policy({ sites: [{ host: 'github.com', rule: 'ask' }], answer: 'block' })
  assert.equal(await blocked.decide('https://github.com/'), false)
})

test('a form post on a signed-in site asks first, unless the site is allowed or the switch is off', async () => {
  const signed = policy({ answer: 'block' })
  assert.equal(await signed.decide('https://shop.com/buy', { method: 'POST' }), false)
  assert.deepEqual(signed.asks, [{ tabId: 'tab-1', kind: 'submit', host: 'shop.com' }])
  assert.equal(await signed.decide('https://shop.com/item'), true, 'reading does not ask')

  const signedOut = policy({ signedIn: false })
  assert.equal(await signedOut.decide('https://shop.com/buy', { method: 'POST' }), true)
  assert.deepEqual(signedOut.asks, [])

  const listed = policy({ sites: [{ host: 'shop.com', rule: 'allow' }] })
  assert.equal(await listed.decide('https://shop.com/buy', { method: 'POST' }), true)
  assert.deepEqual(listed.asks, [])

  const off = policy({ askBeforeSubmit: false })
  assert.equal(await off.decide('https://shop.com/buy', { method: 'POST' }), true)
  assert.deepEqual(off.asks, [])
})
