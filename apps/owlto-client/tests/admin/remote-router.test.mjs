import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { openSqlite } from '../fixtures/sqlite.mjs'

const require = createRequire(import.meta.url)
const {
  FrameCipher,
  OwltoError,
  OwltoStore,
  RemoteService,
  RemoteStore,
  connectFrames,
  normalizePairingCode,
  parseRemoteAddress,
  remotePairSchema,
  tcpListen,
  toFailure
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

function device(t, name, net, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), `owlto-remote-${name}-`))
  const client = openSqlite(join(dir, 'owlto.db'))
  const store = new OwltoStore(client, MIGRATIONS)
  let access = false
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
    listen: net ? net.listen(name) : tcpListen,
    dial: net ? net.dial : connectFrames,
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

async function paired(t) {
  const net = network()
  const host = device(t, 'mini', net)
  const laptop = device(t, 'laptop', net)
  await host.service.setAccess(true)
  const { pairing } = host.service.startPairing()
  const remote = await laptop.service.pair('mini', pairing.code.toLowerCase())
  return { net, host, laptop, remote }
}

test('pairing with the code links both devices and stores only an encrypted key', async (t) => {
  const { host, laptop, remote } = await paired(t)
  assert.equal(remote.deviceId, host.store.deviceId)
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
    await assert.rejects(laptop.service.pair('mini', wrong), (error) => {
      assert.equal(error.code, 'remote_pairing_failed')
      return true
    })
  }
  assert.equal(host.service.overview().pairing, null)
  await assert.rejects(laptop.service.pair('mini', pairing.code), { code: 'remote_pairing_failed' })
  assert.deepEqual(host.service.overview().clients, [])
  assert.deepEqual(laptop.service.overview().devices, [])
})

test('pairing needs remote access, and an unknown address is unreachable', async (t) => {
  const net = network()
  const host = device(t, 'mini', net)
  const laptop = device(t, 'laptop', net)
  assert.throws(() => host.service.startPairing(), { code: 'remote_unsupported' })
  await assert.rejects(laptop.service.pair('nowhere', 'ABCDEFGH'), { code: 'remote_unreachable' })
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
  const remote = await laptop.service.pair(`127.0.0.1:${port}`, pairing.code)
  assert.equal(remote.address, `127.0.0.1:${port}`)
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
  assert.ok(OwltoError)
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
  await assert.rejects(again.service.pair('nowhere', 'ABCDEFGH'), { code: 'remote_unreachable' })
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
