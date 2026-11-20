import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { startNodeRelay } from '../../../../packages/owlto-relay/src/node.ts'
import { openSqlite } from '../fixtures/sqlite.mjs'

const require = createRequire(import.meta.url)
const {
  FrameCipher,
  KeepAwake,
  OwltoError,
  OwltoStore,
  RelayListener,
  RemoteService,
  RemoteStore,
  connectFrames,
  generateKeyPair,
  openFromClient,
  openPush,
  sealForHost,
  dialRelay,
  dropRelayItem,
  formatRemoteInvite,
  lookupRendezvous,
  normalizePairingCode,
  parseRemoteInvite,
  parseRemoteAddress,
  remotePairSchema,
  tcpListen,
  toFailure,
  usableAddresses
} = require('../../out/main/app/runtime.js')

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations')

/** safeStorage stand-in: reversible, so tests can check the key is stored encrypted at all. */
const cipher = {
  unavailable: async () => null,
  encrypt: async (plain) => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: async (encoded) => ({
    plain: Buffer.from(encoded.slice(4), 'base64').toString(),
    stale: false
  })
}

/** Two in-memory frame channels wired to each other, like the two ends of a socket. */
function framePair() {
  const make = () => ({
    frameListener: null,
    early: [],
    closeListeners: [],
    closed: false,
    closing: false,
    peer: null,
    send(frame) {
      if (this.closed || this.closing) return
      const peer = this.peer
      queueMicrotask(() => {
        if (peer.closed) return
        if (peer.frameListener) peer.frameListener(Buffer.from(frame))
        else peer.early.push(Buffer.from(frame))
      })
    },
    onFrame(listener) {
      this.frameListener = listener
      for (const frame of this.early.splice(0)) listener(frame)
    },
    onClose(listener) {
      if (this.closed) listener(null)
      else this.closeListeners.push(listener)
    },
    close() {
      if (this.closing) return
      this.closing = true
      // Like a socket, frames already sent still arrive before the close.
      queueMicrotask(() => {
        for (const end of [this, this.peer]) {
          if (end.closed) continue
          end.closed = true
          for (const listener of end.closeListeners.splice(0)) listener(null)
        }
      })
    }
  })
  const a = make()
  const b = make()
  a.peer = b
  b.peer = a
  return [a, b]
}

/** A fake network: hosts listen on names, and dialing a name connects in memory. */
function network() {
  const hosts = new Map()
  return {
    listen: (name) => async (_port, accept) => {
      hosts.set(name, accept)
      return { close: () => hosts.delete(name) }
    },
    dial: async (host) => {
      const accept = hosts.get(host)
      if (!accept) throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
      const [client, server] = framePair()
      accept(server)
      return client
    }
  }
}

function hostApi(calls) {
  const record = (name, value) => (input) => {
    calls.push({ name, input })
    return value
  }
  return {
    snapshot: record('snapshot', {
      sessions: [],
      projects: [],
      connection: {},
      claude: {},
      cursor: {},
      routers: [],
      workers: []
    }),
    threadItems: record('threadItems', []),
    createThread: record('createThread', { id: 'thread' }),
    sendRouter: record('sendRouter', undefined),
    stageAttachment: (input) => {
      calls.push({ name: 'stageAttachment', input })
      return {
        id: randomUUID(),
        name: input.name,
        mimeType: input.mimeType,
        size: input.data.length
      }
    },
    interruptRouter: record('interruptRouter', undefined),
    archiveThread: record('archiveThread', undefined),
    resolveBatch: record('resolveBatch', undefined),
    stopWorker: record('stopWorker', undefined),
    steerPendingMessage: record('steerPendingMessage', undefined),
    dropPendingMessage: record('dropPendingMessage', undefined),
    respond: record('respond', undefined),
    previewFile: record('previewFile', { kind: 'missing' })
  }
}

/** The credentials table, in memory. */
function memoryCredentials() {
  const rows = new Map()
  return {
    rows,
    credential: (id) => rows.get(id) ?? null,
    saveCredential: (id, type, secret) => rows.set(id, { type, secret }),
    removeCredential: (id) => rows.delete(id)
  }
}

function device(t, name, net, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), `owlto-remote-${name}-`))
  const client = openSqlite(join(dir, 'owlto.db'))
  const store = new OwltoStore(client, MIGRATIONS)
  let access = false
  let relay = false
  let keepAwake = false
  const calls = []
  const events = []
  const overviews = []
  const service = new RemoteService({
    store: new RemoteStore(store.db),
    cipher,
    deviceId: store.deviceId,
    appVersion: '2026.11.18',
    api: hostApi(calls),
    accessEnabled: () => access,
    saveAccess: (enabled) => {
      access = enabled
    },
    relayEnabled: () => relay,
    saveRelay: (enabled) => {
      relay = enabled
    },
    keepAwakeEnabled: () => keepAwake,
    saveKeepAwake: (enabled) => {
      keepAwake = enabled
    },
    listen: net ? net.listen(name) : tcpListen,
    dial: net ? net.dial : connectFrames,
    dialRelay,
    lookupRendezvous,
    dropItem: dropRelayItem,
    readAttachment: async () => new Uint8Array([1, 2, 3]),
    credentials: memoryCredentials(),
    // Most tests run a relay without accounts; the account tests turn this back on.
    relaySignInRequired: false,
    toFailure,
    changed: (overview) => overviews.push(overview),
    remoteEvent: (deviceId, event) => events.push({ deviceId, event }),
    deviceName: () => name,
    addresses: () => ['192.168.1.20'],
    ...overrides
  })
  t.after(() => {
    service.close()
    client.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { service, store, calls, events, overviews, raw: new RemoteStore(store.db) }
}

const until = async (check, ms = 2000) => {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

async function paired(t, address = 'mini') {
  const net = network()
  const host = device(t, 'mini', net)
  const laptop = device(t, 'laptop', net)
  await host.service.setAccess(true)
  const { pairing } = host.service.startPairing()
  const remote = await laptop.service.pair({ address, code: pairing.code.toLowerCase() })
  return { net, host, laptop, remote }
}

/** A Node relay for the test, like the Owlto relay but local. */
async function localRelay(t, options = {}) {
  const relay = await startNodeRelay(options)
  t.after(() => relay.close())
  return relay
}

/** A host that allows internet connections and is registered with the relay. */
async function relayHost(t, net, relayUrl, overrides = {}) {
  const host = device(t, 'mini', net, { relayUrl, ...overrides })
  await host.service.setAccess(true)
  await host.service.setRelay(true)
  await until(() => host.service.overview().relay.state === 'online')
  return host
}

test('pairing with the code links both devices and stores only an encrypted key', async (t) => {
  const { host, laptop, remote } = await paired(t, 'mini:47320')
  assert.equal(remote.deviceId, host.store.deviceId)
  assert.equal(remote.address, 'mini')
  assert.equal(remote.name, 'mini')
  assert.equal(remote.status, 'online')
  const overview = host.service.overview()
  assert.equal(overview.pairing, null, 'a code works once')
  assert.deepEqual(
    overview.clients.map((c) => [c.deviceId, c.name, c.connected]),
    [[laptop.store.deviceId, 'laptop', true]]
  )
  assert.deepEqual(overview.addresses, ['192.168.1.20'])
  const identity = laptop.raw.identity()
  assert.match(identity.secret, /^enc:/)
  assert.ok(!identity.secret.includes('PRIVATE'))
})

test('a paired device drives the host through the allowed methods only', async (t) => {
  const { host, laptop, remote } = await paired(t)
  const routerId = randomUUID()
  await laptop.service.call(remote.deviceId, 'sendRouter', {
    routerId,
    commandId: randomUUID(),
    text: 'Run the tests'
  })
  const snapshot = await laptop.service.call(remote.deviceId, 'snapshot', undefined)
  assert.deepEqual(snapshot.routers, [])
  assert.deepEqual(
    host.calls.map((c) => c.name),
    ['sendRouter', 'snapshot']
  )
  assert.equal(host.calls[0].input.text, 'Run the tests')
  // Files and notes stay on the device they belong to.
  await assert.rejects(
    laptop.service.call(remote.deviceId, 'sendRouter', {
      routerId,
      commandId: randomUUID(),
      text: 'x',
      cardIds: ['c_1']
    })
  )
  await assert.rejects(laptop.service.call(remote.deviceId, 'saveSettings', {}))
  assert.equal(host.calls.length, 2)
})

test('host events reach the client, with streaming session updates coalesced', async (t) => {
  const { host, laptop, remote } = await paired(t)
  const session = (n) => ({ type: 'session', session: { id: 's1', title: `v${n}` } })
  for (let n = 1; n <= 5; n++) host.service.observe(session(n))
  host.service.observe({ type: 'router', router: { id: 'r1' } })
  host.service.observe({ type: 'profile', profile: {} })
  await until(() => laptop.events.length >= 2)
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual(
    laptop.events.map(({ event }) => [event.type, event.session?.title ?? event.router?.id]),
    [
      ['session', 'v5'],
      ['router', 'r1']
    ]
  )
  assert.ok(laptop.events.every((e) => e.deviceId === remote.deviceId))
})

test('a wrong code fails, and five wrong codes end the pairing', async (t) => {
  const net = network()
  const host = device(t, 'mini', net)
  const laptop = device(t, 'laptop', net)
  await host.service.setAccess(true)
  const { pairing } = host.service.startPairing()
  const wrong = pairing.code === 'AAAAAAAA' ? 'BBBBBBBB' : 'AAAAAAAA'
  for (let i = 0; i < 5; i++) {
    await assert.rejects(laptop.service.pair({ address: 'mini', code: wrong }), (error) => {
      assert.equal(error.code, 'remote_pairing_failed')
      return true
    })
  }
  assert.equal(host.service.overview().pairing, null)
  await assert.rejects(laptop.service.pair({ address: 'mini', code: pairing.code }), {
    code: 'remote_pairing_failed'
  })
  assert.deepEqual(host.service.overview().clients, [])
  assert.deepEqual(laptop.service.overview().devices, [])
})

test('pairing needs remote access, and an unknown address is unreachable', async (t) => {
  const net = network()
  const host = device(t, 'mini', net)
  const laptop = device(t, 'laptop', net)
  assert.throws(() => host.service.startPairing(), { code: 'remote_unsupported' })
  await assert.rejects(laptop.service.pair({ address: 'nowhere', code: 'ABCDEFGH' }), {
    code: 'remote_unreachable'
  })
})

test('revoking a device closes it out; it cannot reconnect with its old key', async (t) => {
  const { host, laptop, remote } = await paired(t)
  host.service.revokeClient(laptop.store.deviceId)
  await until(() => laptop.service.overview().devices[0].status !== 'online')
  await assert.rejects(laptop.service.call(remote.deviceId, 'snapshot', undefined), {
    code: 'remote_identity_changed'
  })
  assert.equal(host.calls.length, 0)
})

test('a host that restarts is reconnected with the stored keys', async (t) => {
  const { host, laptop, remote } = await paired(t)
  await host.service.setAccess(false)
  await until(() => laptop.service.overview().devices[0].status !== 'online')
  await host.service.setAccess(true)
  await laptop.service.call(remote.deviceId, 'threadItems', { routerId: randomUUID() })
  assert.deepEqual(
    host.calls.map((c) => c.name),
    ['threadItems']
  )
})

test('direct connections work over real TCP', async (t) => {
  const port = 47_000 + Math.floor(Math.random() * 2000)
  const host = device(t, 'mini', null, { port })
  const laptop = device(t, 'laptop', null)
  await host.service.setAccess(true)
  const { pairing } = host.service.startPairing()
  const remote = await laptop.service.pair({ address: `127.0.0.1:${port}`, code: pairing.code })
  assert.deepEqual(parseRemoteAddress(remote.address), { host: '127.0.0.1', port })
  await laptop.service.call(remote.deviceId, 'interruptRouter', randomUUID())
  assert.deepEqual(
    host.calls.map((c) => c.name),
    ['interruptRouter']
  )
})

test('a frame that was tampered with, replayed, or reordered does not open', () => {
  const key = Buffer.alloc(32, 7)
  const sender = new FrameCipher(key)
  const receiver = new FrameCipher(key)
  const first = sender.seal(Buffer.from('one'))
  const second = sender.seal(Buffer.from('two'))
  assert.equal(receiver.open(first).toString(), 'one')
  const tampered = Buffer.from(second)
  tampered[0] ^= 1
  assert.throws(() => receiver.open(tampered))
  assert.throws(() => new FrameCipher(key).open(second), 'out of order')
})

test('addresses and pairing codes parse the way people type them', () => {
  assert.deepEqual(parseRemoteAddress('192.168.1.20'), { host: '192.168.1.20', port: 47320 })
  assert.deepEqual(parseRemoteAddress(' mini.tail1234.ts.net:5000 '), {
    host: 'mini.tail1234.ts.net',
    port: 5000
  })
  assert.deepEqual(parseRemoteAddress('[fd7a::1]:9'), { host: 'fd7a::1', port: 9 })
  assert.equal(parseRemoteAddress('http://x'), null)
  assert.equal(parseRemoteAddress('x:70000'), null)
  assert.equal(normalizePairingCode('abcd-efgh'), 'ABCDEFGH')
  assert.equal(remotePairSchema.safeParse({ address: 'x', code: 'abcd efgh' }).success, true)
  assert.equal(remotePairSchema.safeParse({ address: 'x', code: 'ILOU1234' }).success, false)
  const invite =
    'owlto://pair?v=1&relay=wss%3A%2F%2Frelay.owlto.dev&mailbox=AAAAAAAAAAAAAAAAAAAAAAAA&ticket=BBBBBBBBBBBBBBBBBBBBBBBB&code=abcd-efgh&key=' +
    'C'.repeat(43)
  assert.deepEqual(parseRemoteInvite(invite), {
    relay: 'wss://relay.owlto.dev',
    mailbox: 'A'.repeat(24),
    ticket: 'B'.repeat(24),
    code: 'ABCDEFGH',
    key: 'C'.repeat(43)
  })
  assert.equal(remotePairSchema.safeParse({ invite }).success, true)
  assert.equal(parseRemoteInvite(invite.replace('v=1', 'v=2')), null)
  assert.equal(parseRemoteInvite(invite.replace('wss%3A', 'http%3A')), null)
  assert.equal(remotePairSchema.safeParse({ invite: 'owlto://pair?v=1' }).success, false)
  assert.ok(OwltoError)
})

test('only Wi-Fi, Ethernet, and Tailscale addresses are offered', () => {
  const v4 = (address, internal = false) => ({ address, family: 'IPv4', internal })
  assert.deepEqual(
    usableAddresses({
      lo0: [v4('127.0.0.1', true)],
      en0: [v4('192.168.0.251'), { address: 'fe80::1', family: 'IPv6', internal: false }],
      bridge100: [v4('192.168.148.1')],
      vmenet0: [v4('192.168.155.1')],
      utun4: [v4('100.101.102.103')],
      utun5: [v4('10.255.71.186')]
    }),
    ['100.101.102.103', '192.168.0.251']
  )
  assert.deepEqual(usableAddresses({ bridge0: [v4('10.0.0.2')] }), ['10.0.0.2'])
})

test('a key the keychain no longer opens is replaced, and its pairings are dropped', async (t) => {
  const { host, laptop } = await paired(t)
  const before = laptop.raw.identity().publicKey
  // A new keychain item (e.g. the app's name changed): decrypting the stored key fails.
  const net = network()
  const again = device(t, 'laptop-again', net, {
    store: laptop.raw,
    cipher: { ...cipher, decrypt: async () => Promise.reject(new Error('bad key')) }
  })
  await host.service.setAccess(true)
  host.service.startPairing()
  await assert.rejects(again.service.pair({ address: 'nowhere', code: 'ABCDEFGH' }), {
    code: 'remote_unreachable'
  })
  assert.notEqual(laptop.raw.identity().publicKey, before)
  assert.deepEqual(laptop.raw.peers('host'), [])
})

test('remote access reports a keychain that will not open instead of listening', async (t) => {
  const net = network()
  const host = device(t, 'mini', net, {
    cipher: { ...cipher, unavailable: async () => 'locked' }
  })
  const overview = await host.service.setAccess(true).catch(() => host.service.overview())
  assert.equal(overview.listening, false)
  assert.match(overview.listenError ?? '', /keychain/)
})

test('a device on another network pairs from the invite and drives the host through the relay', async (t) => {
  const { url } = await localRelay(t)
  const host = await relayHost(t, network(), url)
  // The laptop shares no network with the host: only the relay connects them.
  const laptop = device(t, 'laptop', network())
  const { pairing } = host.service.startPairing()
  assert.ok(pairing.invite?.startsWith('owlto://pair?'))
  const remote = await laptop.service.pair({ invite: pairing.invite })
  assert.equal(remote.deviceId, host.store.deviceId)
  assert.equal(remote.address, null)
  assert.equal(remote.relay, true)
  assert.equal(remote.via, 'relay')
  assert.equal(host.service.overview().pairing, null, 'the invite works once')
  // The invite's ticket was swapped for the laptop's own.
  const saved = laptop.raw.peer(remote.deviceId, 'host')
  assert.notEqual(saved.relayTicket, parseRemoteInvite(pairing.invite).ticket)
  await laptop.service.call(remote.deviceId, 'sendRouter', {
    routerId: randomUUID(),
    commandId: randomUUID(),
    text: 'From the café'
  })
  assert.deepEqual(
    host.calls.map((c) => c.name),
    ['sendRouter']
  )
  host.service.observe({ type: 'router', router: { id: 'r1' } })
  await until(() => laptop.events.length === 1)
})

test('frames larger than a relay message arrive whole', async (t) => {
  const { url } = await localRelay(t)
  // A long thread's items: one frame of about 900 KB, far over one relay message, and
  // random so compression cannot shrink it below one.
  const big = randomBytes(700 * 1024).toString('base64')
  const items = [{ id: 'i1', text: big }]
  const host = await relayHost(t, network(), url, {
    api: { ...hostApi([]), threadItems: () => items }
  })
  const laptop = device(t, 'laptop', network())
  const { pairing } = host.service.startPairing()
  const remote = await laptop.service.pair({ invite: pairing.invite })
  const reply = await laptop.service.call(remote.deviceId, 'threadItems', {
    routerId: randomUUID()
  })
  assert.equal(reply[0].text.length, big.length)
})

test('a same-network QR invite pairs straight to the address and pins the host key', async (t) => {
  const net = network()
  const host = device(t, 'mini', net)
  const laptop = device(t, 'laptop', net)
  await host.service.setAccess(true)
  const { pairing } = host.service.startPairing()
  assert.match(pairing.key, /^[A-Za-z0-9_-]{43}$/)
  const forged = formatRemoteInvite({ host: 'mini', code: pairing.code, key: 'A'.repeat(43) })
  await assert.rejects(laptop.service.pair({ invite: forged }), { code: 'remote_pairing_failed' })
  const { pairing: fresh } = host.service.startPairing()
  const invite = formatRemoteInvite({ host: 'mini:47320', code: fresh.code, key: fresh.key })
  assert.deepEqual(parseRemoteInvite(invite), { host: 'mini', code: fresh.code, key: fresh.key })
  const remote = await laptop.service.pair({ invite })
  assert.equal(remote.address, 'mini')
  assert.equal(remote.status, 'online')
  assert.equal(host.service.overview().pairing, null, 'a code works once')
})

test('a device paired on the same network learns the relay route and falls back to it', async (t) => {
  const { url } = await localRelay(t)
  const net = network()
  const host = await relayHost(t, net, url)
  const laptop = device(t, 'laptop', net)
  const { pairing } = host.service.startPairing()
  const remote = await laptop.service.pair({ address: 'mini', code: pairing.code })
  assert.equal(remote.via, 'direct')
  await until(() => laptop.service.overview().devices[0].relay)
  // The laptop leaves the network: the direct address stops answering, the relay does not.
  const away = device(t, 'laptop-away', network(), {
    store: laptop.raw,
    deviceId: laptop.store.deviceId
  })
  await away.service.call(remote.deviceId, 'interruptRouter', randomUUID())
  assert.equal(away.service.overview().devices[0].via, 'relay')
  assert.deepEqual(
    host.calls.map((c) => c.name),
    ['interruptRouter']
  )
})

test('a revoked device cannot come back through the relay', async (t) => {
  const { url } = await localRelay(t)
  const host = await relayHost(t, network(), url)
  const laptop = device(t, 'laptop', network())
  const { pairing } = host.service.startPairing()
  const remote = await laptop.service.pair({ invite: pairing.invite })
  host.service.revokeClient(laptop.store.deviceId)
  await until(() => laptop.service.overview().devices[0].status !== 'online')
  await assert.rejects(laptop.service.call(remote.deviceId, 'snapshot', undefined), {
    code: 'remote_identity_changed'
  })
  assert.equal(host.calls.length, 0)
})

test('an invite pins the host key, and an offline host reads as offline', async (t) => {
  const { url } = await localRelay(t)
  const host = await relayHost(t, network(), url)
  const laptop = device(t, 'laptop', network())
  const { pairing } = host.service.startPairing()
  const forged = pairing.invite.replace(/key=[^&]+/, `key=${'A'.repeat(43)}`)
  await assert.rejects(laptop.service.pair({ invite: forged }), {
    code: 'remote_pairing_failed'
  })
  const { pairing: fresh } = host.service.startPairing()
  await host.service.setRelay(false)
  await assert.rejects(laptop.service.pair({ invite: fresh.invite }), (error) => {
    assert.ok(['remote_offline', 'remote_pairing_failed'].includes(error.code), error.code)
    return true
  })
})

test('the host keeps its relay mailbox across restarts and stores its secret encrypted', async (t) => {
  const { url } = await localRelay(t)
  const host = await relayHost(t, network(), url)
  const first = host.raw.relayIdentity()
  assert.match(first.secret, /^enc:/)
  await host.service.setAccess(false)
  assert.equal(host.service.overview().relay.state, 'off')
  await host.service.setAccess(true)
  await until(() => host.service.overview().relay.state === 'online')
  assert.deepEqual(host.raw.relayIdentity(), first)
})

test('two Macs with one relay mailbox do not push each other off forever', async (t) => {
  const { url } = await localRelay(t)
  const mailbox = 'M'.repeat(32)
  const secret = 'S'.repeat(32)
  const listener = () => {
    const created = new RelayListener({
      url,
      mailbox,
      secret,
      tickets: () => [],
      pairingTicket: () => null,
      session: async () => null,
      accept: (frames) => frames.close(),
      queued: () => {},
      pushGone: () => {},
      changed: () => {}
    })
    t.after(() => created.close())
    created.start()
    return created
  }
  const first = listener()
  await until(() => first.status().state === 'online')
  const second = listener()
  await until(() => second.status().state === 'online')
  await until(() => first.status().error === 'relay_replaced')
  // The first one waits for a wake instead of taking the mailbox back a second later.
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  assert.deepEqual(first.status(), { state: 'offline', error: 'relay_replaced' })
  assert.equal(second.status().state, 'online')
})

test('a device on another network pairs with a typed relay code, and both show the same digits', async (t) => {
  const { url } = await localRelay(t)
  const host = await relayHost(t, network(), url)
  const laptop = device(t, 'laptop', network(), { relayUrl: url })
  host.service.startPairing()
  await until(() => host.service.overview().pairing?.relayCode)
  const { relayCode, code } = host.service.overview().pairing
  assert.match(relayCode, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/)
  assert.equal(
    relayCode.replace(/-/g, '').slice(4),
    code,
    'the pairing code never reaches the relay'
  )
  await assert.rejects(laptop.service.pair({ relayCode: `0000${code}` }), {
    code: 'remote_pairing_failed'
  })
  const remote = await laptop.service.pair({ relayCode: relayCode.toLowerCase() })
  assert.equal(remote.via, 'relay')
  assert.match(remote.safetyCode, /^\d{6}$/)
  const shown = host.service.overview().justPaired
  assert.equal(shown.deviceId, laptop.store.deviceId)
  assert.equal(shown.safetyCode, remote.safetyCode)
  host.service.dismissJustPaired()
  assert.equal(host.service.overview().justPaired, null)
})

/**
 * GitHub's device flow, answered at once, in front of the real relay: the relay's own
 * account routes go through to it.
 */
function relayGitHub(githubToken, seen) {
  return async (url, init) => {
    const text = String(url)
    if (text === 'https://github.com/login/device/code') {
      seen.push(new URLSearchParams(init.body).get('client_id'))
      return Response.json({
        device_code: 'device',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 0
      })
    }
    if (text === 'https://github.com/login/oauth/access_token')
      return Response.json({ access_token: githubToken })
    return fetch(url, init)
  }
}

test('turning the relay on asks for a sign-in, keeps only the relay session, and signing out turns it off', async (t) => {
  const seen = []
  const { url } = await localRelay(t, {
    verifyIdentity: async (provider, token) => {
      seen.push(token)
      return provider === 'github' && token === 'gho_relay_0123456789abcdef'
        ? { id: 7, login: 'yanlin' }
        : null
    }
  })
  const credentials = memoryCredentials()
  const host = device(t, 'mini', network(), {
    relayUrl: url,
    credentials,
    relaySignInRequired: true,
    relayHttp: relayGitHub('gho_relay_0123456789abcdef', seen)
  })
  await host.service.setAccess(true)
  // Signed out, the switch waits for a sign-in: nothing is saved and the relay is not asked.
  const waiting = await host.service.setRelay(true)
  assert.equal(waiting.relay.enabled, false)
  assert.equal(waiting.relay.state, 'off')
  assert.equal(waiting.relay.signInToEnable, true)
  assert.equal(waiting.relay.account.status, 'signed-out')

  const pending = await host.service.relaySignIn('github')
  assert.equal(pending.relay.account.status, 'pending')
  assert.equal(pending.relay.account.provider, 'github')
  assert.equal(pending.relay.account.userCode, 'WDJB-MJHT')
  await until(() => host.service.overview().relay.state === 'online')
  assert.equal(host.service.overview().relay.enabled, true)
  assert.equal(host.service.overview().relay.signInToEnable, false)
  assert.deepEqual(host.service.overview().relay.account, {
    status: 'signed-in',
    provider: 'github',
    login: 'yanlin'
  })
  // The relay OAuth App asked GitHub, and the relay saw the token once; only the relay's own
  // session is kept, encrypted.
  assert.deepEqual(seen, ['Ov23liMVwICtVSHS13Jr', 'gho_relay_0123456789abcdef'])
  const row = credentials.rows.get('relay')
  assert.equal(row.type, 'relay_session')
  assert.match(row.secret, /^enc:/)
  assert.ok(!row.secret.includes('gho_'))

  const macs = await host.service.relayMacs()
  assert.equal(macs.length, 1)
  assert.equal(macs[0].name, 'mini')
  assert.equal(macs[0].thisMac, true)
  assert.equal(macs[0].online, true)

  // Reconnecting shows the stored session again; GitHub is not asked.
  await host.service.setRelay(false)
  await host.service.setRelay(true)
  await until(() => host.service.overview().relay.state === 'online')
  assert.equal(seen.length, 2)

  const signedOut = await host.service.relaySignOut()
  assert.equal(signedOut.relay.enabled, false)
  assert.equal(signedOut.relay.state, 'off')
  assert.equal(signedOut.relay.account.status, 'signed-out')
  assert.equal(credentials.rows.get('relay'), undefined)
  await assert.rejects(host.service.relayMacs(), { code: 'remote_relay_login' })
})

test('removing a Mac from the relay account cuts it off and ends its sign-in', async (t) => {
  const { url } = await localRelay(t, {
    verifyIdentity: async () => ({ id: 7, login: 'yanlin' })
  })
  const signedIn = async (name) => {
    // The relay switch is already on, as when a stored sign-in ended.
    const mac = device(t, name, network(), {
      relayUrl: url,
      relayHttp: relayGitHub(`gho_${name}_0123456789abcdef`, [])
    })
    await mac.service.setAccess(true)
    // The sign-in may finish before the relay's first, session-less attempt is turned
    // away; that refusal must not undo it.
    await Promise.all([mac.service.setRelay(true), mac.service.relaySignIn('github')])
    await until(() => mac.service.overview().relay.state === 'online')
    assert.equal(mac.service.overview().relay.account.status, 'signed-in')
    return mac
  }
  const mini = await signedIn('mini')
  const laptop = await signedIn('laptop')
  const macs = await mini.service.relayMacs()
  assert.deepEqual(
    macs.map((mac) => [mac.name, mac.thisMac]),
    [
      ['mini', true],
      ['laptop', false]
    ]
  )
  const left = await mini.service.relayRemoveMac(macs[1].mailbox)
  assert.deepEqual(
    left.map((mac) => mac.name),
    ['mini']
  )
  await until(() => laptop.service.overview().relay.error === 'relay_denied')
  // Waking the laptop does not bring it back: its session ended with it.
  laptop.service.wake()
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(laptop.service.overview().relay.state, 'offline')
})

test('a message sent while the host is away waits on the relay and runs once when it returns', async (t) => {
  const { url } = await localRelay(t)
  const host = await relayHost(t, network(), url)
  const laptop = device(t, 'laptop', network())
  const { pairing } = host.service.startPairing()
  const remote = await laptop.service.pair({ invite: pairing.invite })
  // The host quits: its relay socket and the laptop's pipe close.
  await host.service.setAccess(false)
  await until(() => laptop.service.overview().devices[0].status !== 'online')
  const message = { routerId: randomUUID(), commandId: randomUUID(), text: 'While you were out' }
  assert.deepEqual(await laptop.service.call(remote.deviceId, 'sendRouter', message), {
    queued: true
  })
  assert.equal(host.calls.length, 0)
  await host.service.setAccess(true)
  await until(() => host.calls.some((call) => call.name === 'sendRouter'))
  const sent = host.calls.find((call) => call.name === 'sendRouter')
  assert.equal(sent.input.text, 'While you were out')
  assert.equal(host.raw.peer(laptop.store.deviceId, 'client').queueSeq, 1)
  // Back online, the host has acked the item: a reconnect runs nothing again.
  await host.service.setRelay(false)
  await host.service.setRelay(true)
  await until(() => host.service.overview().relay.state === 'online')
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(host.calls.filter((call) => call.name === 'sendRouter').length, 1)
})

test('a queue item opens only on its host, from the client that sealed it, and once', () => {
  const host = generateKeyPair()
  const client = generateKeyPair()
  const stranger = generateKeyPair()
  const me = { deviceId: 'dv_0123abcd', identity: client }
  const message = { seq: 3, at: Date.now(), method: 'sendRouter', params: { text: 'hi' } }
  const item = sealForHost(message, me, host.publicKey)
  const keys = (id) => (id === me.deviceId ? client.publicKey : null)
  assert.deepEqual(openFromClient(item, host, keys), { from: me.deviceId, message })
  assert.equal(openFromClient(item, stranger, keys), null, 'another host cannot open it')
  assert.equal(
    openFromClient(item, host, () => stranger.publicKey),
    null,
    'it does not open as from another device'
  )
  const forged = sealForHost(message, { deviceId: me.deviceId, identity: stranger }, host.publicKey)
  assert.equal(openFromClient(forged, host, keys), null, 'a stranger cannot write as the client')
})

test('a phone away from the Mac gets a sealed notification it alone can open', async (t) => {
  const pushes = []
  const { url } = await localRelay(t, {
    push: async (request) => {
      pushes.push(request)
      return 'sent'
    }
  })
  const host = await relayHost(t, network(), url)
  const phone = device(t, 'phone', network())
  const { pairing } = host.service.startPairing()
  const remote = await phone.service.pair({ invite: pairing.invite })
  const key = randomBytes(32)
  const token = 'ab'.repeat(32)
  await phone.service.links.request(remote.deviceId, 'registerPush', {
    token,
    key: key.toString('base64url'),
    sandbox: true
  })
  const stored = host.raw.peer(phone.store.deviceId, 'client')
  assert.equal(stored.pushToken, token)
  assert.match(stored.pushKey, /^enc:/, 'the key is stored encrypted')
  const notice = {
    title: 'Codex needs your OK',
    subtitle: 'Fix the build',
    body: 'Wants to change files',
    routerId: randomUUID(),
    workerId: 'w1'
  }
  await host.service.notifyClients(notice)
  assert.equal(pushes.length, 0, 'a connected phone shows the request itself')
  phone.service.removeDevice(remote.deviceId)
  await until(() => host.service.overview().clients.every((client) => !client.connected))
  await host.service.notifyClients(notice)
  await until(() => pushes.length === 1)
  assert.equal(pushes[0].token, token)
  assert.equal(pushes[0].sandbox, true)
  assert.deepEqual(openPush(pushes[0].payload, key), notice)
})

test('files go to the host with the message, and the message carries the host copies', async (t) => {
  const { host, laptop, remote } = await paired(t)
  const local = { id: randomUUID(), name: 'shot.png', mimeType: 'image/png', size: 3 }
  await laptop.service.call(remote.deviceId, 'sendRouter', {
    routerId: randomUUID(),
    commandId: randomUUID(),
    text: 'Look',
    workerId: 'w1',
    attachments: [local]
  })
  const [staged, sent] = host.calls
  assert.equal(staged.name, 'stageAttachment')
  assert.deepEqual([...staged.input.data], [1, 2, 3])
  assert.equal(sent.name, 'sendRouter')
  assert.notEqual(sent.input.attachments[0].id, local.id)
  assert.equal(sent.input.attachments[0].name, 'shot.png')
})

test('the Mac stays awake on power while remote access wants it, and sleeps on battery', () => {
  const calls = []
  let battery = false
  let wanted = true
  const keep = new KeepAwake(
    {
      onBattery: () => battery,
      start: () => {
        calls.push('start')
        return 7
      },
      stop: (handle) => calls.push(`stop ${handle}`)
    },
    () => wanted
  )
  keep.update()
  keep.update()
  assert.deepEqual(calls, ['start'])
  battery = true
  keep.update()
  assert.deepEqual(calls, ['start', 'stop 7'])
  battery = false
  wanted = false
  keep.update()
  assert.equal(keep.active(), false)
})
