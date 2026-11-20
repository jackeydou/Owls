import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, verify } from 'node:crypto'
import test, { type TestContext } from 'node:test'
import { ApnsSender, apnsBody } from '../src/apns.ts'
import { type NodeRelay, type NodeRelayOptions, startNodeRelay } from '../src/node.ts'
import {
  MAILBOX_IDLE_MS,
  MAX_ITEMS_PER_TICKET,
  MAX_MAILBOXES_PER_ACCOUNT,
  RELAY_PROTOCOL,
  sha256Hex
} from '../src/protocol.ts'
import type { PushRequest } from '../src/room.ts'
import { Peer } from './peer.ts'

const token = () => randomBytes(24).toString('base64url')

async function relay(t: TestContext, options: NodeRelayOptions = {}): Promise<NodeRelay> {
  const started = await startNodeRelay(options)
  t.after(() => started.close())
  return started
}
function open(t: TestContext, base: string, kind: string, mailbox: string): Peer {
  const peer = new Peer(`${base}/v1/${kind}/${mailbox}`)
  t.after(() => peer.socket.close())
  return peer
}
async function host(
  t: TestContext,
  base: string,
  options: { mailbox?: string; secret?: string; session?: string; tickets?: string[] } = {}
) {
  const mailbox = options.mailbox ?? token()
  const secret = options.secret ?? token()
  const socket = open(t, base, 'host', mailbox)
  await socket.send({ t: 'host', v: RELAY_PROTOCOL, secret, session: options.session })
  const reply = await socket.next()
  if (options.tickets && typeof reply === 'object' && reply.t === 'ready')
    await socket.send({
      t: 'tickets',
      hashes: await Promise.all(options.tickets.map((ticket) => sha256Hex(ticket)))
    })
  return { mailbox, secret, socket, reply }
}
const github = async (provider: string, value: string) =>
  provider === 'github' && value.startsWith('gho_good')
    ? { id: value.length, login: 'yanlin' }
    : null
const GOOD = 'gho_good_0123456789abcdef'

async function account(
  base: string,
  method: string,
  path: string,
  session?: string,
  body?: unknown
) {
  const response = await fetch(`${base.replace(/^ws/, 'http')}/v1/account${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(session ? { authorization: `Bearer ${session}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}
async function signIn(base: string, token = GOOD): Promise<string> {
  const reply = await account(base, 'POST', '/login', undefined, {
    provider: 'github',
    token,
    name: 'Mac mini'
  })
  assert.equal(reply.status, 200)
  assert.equal(reply.body.provider, 'github')
  assert.equal(reply.body.login, 'yanlin')
  return reply.body.session as string
}

test('a host needs a relay session, and an account holds at most five mailboxes', async (t) => {
  const { url } = await relay(t, { verifyIdentity: github })
  assert.deepEqual((await host(t, url)).reply, { t: 'error', code: 'login' })
  const bad = await account(url, 'POST', '/login', undefined, {
    provider: 'github',
    token: 'gho_bad_0123456789abcdef'
  })
  assert.equal(bad.status, 401)
  const unknown = await account(url, 'POST', '/login', undefined, {
    provider: 'myspace',
    token: GOOD
  })
  assert.equal(unknown.status, 400)
  const session = await signIn(url)
  assert.match(session, /^s1\.[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/)
  const forged = `${session.slice(0, -4)}AAAA`
  assert.deepEqual((await host(t, url, { session: forged })).reply, { t: 'error', code: 'login' })
  const owned = []
  for (let i = 0; i < MAX_MAILBOXES_PER_ACCOUNT; i++) {
    const made = await host(t, url, { session })
    assert.deepEqual(made.reply, { t: 'ready' })
    owned.push(made)
  }
  assert.deepEqual((await host(t, url, { session })).reply, { t: 'error', code: 'quota' })
  // Reconnecting takes the session as well as the secret.
  const bare = await host(t, url, { mailbox: owned[0].mailbox, secret: owned[0].secret })
  assert.deepEqual(bare.reply, { t: 'error', code: 'login' })
  const again = await host(t, url, { mailbox: owned[0].mailbox, secret: owned[0].secret, session })
  assert.deepEqual(again.reply, { t: 'ready' })
  // Another account cannot take over a mailbox, even with its secret.
  const other = await signIn(url, 'gho_good_other_0123456789abcdef')
  const stolen = await host(t, url, {
    mailbox: owned[1].mailbox,
    secret: owned[1].secret,
    session: other
  })
  assert.deepEqual(stolen.reply, { t: 'error', code: 'denied' })
})

test('the account lists its Macs, and signing out or removing one cuts it off', async (t) => {
  const relayed = await relay(t, { verifyIdentity: github })
  const { url } = relayed
  const session = await signIn(url)
  const mine = await host(t, url, { session })
  const laptop = await signIn(url)
  const theirs = await host(t, url, { session: laptop })
  const listed = await account(url, 'GET', '', session)
  assert.equal(listed.status, 200)
  assert.equal(listed.body.login, 'yanlin')
  const mailboxes = listed.body.mailboxes as {
    mailbox: string
    thisMac: boolean
    online: boolean
  }[]
  assert.deepEqual(
    mailboxes.map((entry) => [entry.mailbox, entry.thisMac, entry.online]).sort(),
    [
      [mine.mailbox, true, true],
      [theirs.mailbox, false, true]
    ].sort()
  )
  assert.equal((await account(url, 'GET', '')).status, 401)

  // Removing the laptop's Mac closes it and forgets its mailbox.
  assert.equal((await account(url, 'DELETE', `/mailbox/${theirs.mailbox}`, session)).status, 200)
  assert.deepEqual(await theirs.socket.next(), { t: 'error', code: 'denied' })
  assert.ok(!relayed.has(theirs.mailbox))
  // Its session ends with it, so it cannot make the mailbox again.
  const reborn = await host(t, url, {
    mailbox: theirs.mailbox,
    secret: theirs.secret,
    session: laptop
  })
  assert.deepEqual(reborn.reply, { t: 'error', code: 'login' })

  // Signing out disconnects this Mac, and its session stops working.
  assert.equal((await account(url, 'DELETE', '/session', session)).status, 200)
  assert.deepEqual(await mine.socket.next(), { t: 'error', code: 'login' })
  const back = await host(t, url, { mailbox: mine.mailbox, secret: mine.secret, session })
  assert.deepEqual(back.reply, { t: 'error', code: 'login' })
  assert.equal((await account(url, 'GET', '', session)).status, 401)
  // Signing in again gets the same mailbox back.
  const fresh = await signIn(url)
  const returned = await host(t, url, {
    mailbox: mine.mailbox,
    secret: mine.secret,
    session: fresh
  })
  assert.deepEqual(returned.reply, { t: 'ready' })
})

test('a rendezvous code finds the mailbox and its pairing ticket for a while', async (t) => {
  const { url } = await relay(t)
  const ticket = token()
  const { mailbox, socket } = await host(t, url, { tickets: [ticket] })
  await socket.send({ t: 'rendezvous', ticket: token() })
  await socket.send('ping')
  assert.equal(await socket.next(), 'pong', 'an unknown ticket gets no code')
  await socket.send({ t: 'rendezvous', ticket })
  const reply = (await socket.next()) as { t: string; code: string; expiresAt: number }
  assert.equal(reply.t, 'rendezvous')
  assert.match(reply.code, /^[0-9A-HJKMNP-TV-Z]{4}$/)
  const http = url.replace(/^ws/, 'http')
  const found = await fetch(`${http}/v1/rendezvous/${reply.code}`)
  assert.equal(found.status, 200)
  assert.deepEqual(await found.json(), { mailbox, ticket })
  const missing = await fetch(`${http}/v1/rendezvous/${reply.code === 'ZZZZ' ? 'YYYY' : 'ZZZZ'}`)
  assert.equal(missing.status, 404)
  for (let i = 0; i < 10; i++) await fetch(`${http}/v1/rendezvous/0000`)
  assert.equal((await fetch(`${http}/v1/rendezvous/${reply.code}`)).status, 429)
})

test('items left while the host is away reach it when it returns, until it acks them', async (t) => {
  const { url } = await relay(t)
  const ticket = token()
  const first = await host(t, url, { tickets: [ticket] })
  first.socket.socket.close()
  await first.socket.closedWith()
  const drop = async (item: string) => {
    const socket = open(t, url, 'drop', first.mailbox)
    await socket.send({ t: 'drop', v: RELAY_PROTOCOL, ticket, item })
    return socket.next()
  }
  assert.deepEqual(await drop('c2VhbGVk'), { t: 'stored' })
  const stranger = open(t, url, 'drop', first.mailbox)
  await stranger.send({ t: 'drop', v: RELAY_PROTOCOL, ticket: token(), item: 'eA' })
  assert.deepEqual(await stranger.next(), { t: 'error', code: 'denied' })
  const back = await host(t, url, { mailbox: first.mailbox, secret: first.secret })
  const queued = (await back.socket.next()) as {
    t: string
    items: { id: string; from: string; item: string }[]
  }
  assert.equal(queued.t, 'queued')
  assert.equal(queued.items.length, 1)
  assert.equal(queued.items[0].item, 'c2VhbGVk')
  assert.equal(queued.items[0].from, await sha256Hex(ticket))
  // While the host is online, a new item reaches it at once.
  assert.deepEqual(await drop('bGl2ZQ'), { t: 'stored' })
  const live = (await back.socket.next()) as { items: { id: string; item: string }[] }
  assert.equal(live.items[0].item, 'bGl2ZQ')
  await back.socket.send({ t: 'ack', ids: [queued.items[0].id, live.items[0].id] })
  back.socket.socket.close()
  await back.socket.closedWith()
  const third = await host(t, url, { mailbox: first.mailbox, secret: first.secret })
  await third.socket.send('ping')
  assert.equal(await third.socket.next(), 'pong', 'acked items are gone')
  for (let i = 0; i < MAX_ITEMS_PER_TICKET; i++) assert.deepEqual(await drop('eA'), { t: 'stored' })
  third.socket.socket.close()
  assert.deepEqual(await drop('eA'), { t: 'error', code: 'full' })
})

test('a mailbox whose host stays away for 30 days is deleted', async (t) => {
  let now = Date.now()
  const relayed = await relay(t, { verifyIdentity: github, now: () => now })
  const session = await signIn(relayed.url)
  const made = await host(t, relayed.url, { session })
  made.socket.socket.close()
  await made.socket.closedWith()
  // The relay handles the close a moment after the client sees it.
  await new Promise((resolve) => setTimeout(resolve, 50))
  await relayed.expire(made.mailbox)
  assert.ok(relayed.has(made.mailbox), 'not yet')
  now += MAILBOX_IDLE_MS + 1
  await relayed.expire(made.mailbox)
  assert.ok(!relayed.has(made.mailbox))
  // Its place in the account's count is free again.
  for (let i = 0; i < MAX_MAILBOXES_PER_ACCOUNT; i++)
    assert.deepEqual((await host(t, relayed.url, { session })).reply, { t: 'ready' })
})

test('a host sends sealed pushes, and learns when a token is dead', async (t) => {
  const sent: PushRequest[] = []
  const { url } = await relay(t, {
    push: async (request) => {
      sent.push(request)
      return request.token.startsWith('dead') ? 'gone' : 'sent'
    }
  })
  const { socket } = await host(t, url)
  await socket.send({ t: 'push', token: 'ab'.repeat(32), sandbox: true, payload: 'c2VhbGVk' })
  await socket.send({ t: 'push', token: `dead${'0'.repeat(60)}`, sandbox: false, payload: 'eA' })
  assert.deepEqual(await socket.next(), { t: 'push-gone', token: `dead${'0'.repeat(60)}` })
  assert.deepEqual(sent[0], { token: 'ab'.repeat(32), sandbox: true, payload: 'c2VhbGVk' })
  await socket.send({ t: 'push', token: 'nothex', sandbox: false, payload: 'eA' })
  assert.deepEqual(await socket.next(), { t: 'error', code: 'bad_request' })
})

test('APNs gets a JWT signed with the .p8 key and an alert the phone can decrypt', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const calls: { url: string; init: RequestInit }[] = []
  const sender = new ApnsSender(
    { key: pem, keyId: 'KEY123', teamId: 'TEAM45', topic: 'dev.owlto.ios' },
    async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(null, { status: calls.length === 1 ? 200 : 410 })
    }
  )
  const push = { token: 'ab'.repeat(32), sandbox: true, payload: 'c2VhbGVk' }
  assert.equal(await sender.send(push), 'sent')
  assert.equal(await sender.send({ ...push, sandbox: false }), 'gone')
  assert.equal(calls[0].url, `https://api.sandbox.push.apple.com/3/device/${'ab'.repeat(32)}`)
  assert.match(calls[1].url, /^https:\/\/api\.push\.apple\.com\//)
  const headers = calls[0].init.headers as Record<string, string>
  assert.equal(headers['apns-topic'], 'dev.owlto.ios')
  assert.equal(calls[0].init.body, apnsBody('c2VhbGVk'))
  const [header, claims, signature] = headers.authorization.replace('bearer ', '').split('.')
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), {
    alg: 'ES256',
    kid: 'KEY123'
  })
  assert.equal(JSON.parse(Buffer.from(claims, 'base64url').toString()).iss, 'TEAM45')
  assert.ok(
    verify(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url')
    )
  )
})
