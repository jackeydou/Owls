import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test, { type TestContext } from 'node:test'
import { type NodeRelay, startNodeRelay } from '../src/node.ts'
import { RELAY_PROTOCOL, sha256Hex } from '../src/protocol.ts'

const token = () => randomBytes(24).toString('base64url')

/** A WebSocket that collects text messages in order, so steps can wait for the next one. */
class Peer {
  readonly socket: WebSocket
  private texts: string[] = []
  private bytes: Uint8Array[] = []
  private waiters: (() => void)[] = []
  closed: { code: number; reason: string } | null = null
  constructor(url: string) {
    this.socket = new WebSocket(url)
    this.socket.binaryType = 'arraybuffer'
    this.socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') this.texts.push(event.data)
      else this.bytes.push(new Uint8Array(event.data as ArrayBuffer))
      this.wake()
    })
    this.socket.addEventListener('close', (event) => {
      this.closed = { code: event.code, reason: event.reason }
      this.wake()
    })
  }
  private wake() {
    for (const waiter of this.waiters.splice(0)) waiter()
  }
  private async until<T>(take: () => T | undefined): Promise<T> {
    const started = Date.now()
    for (;;) {
      const value = take()
      if (value !== undefined) return value
      if (Date.now() - started > 2000) throw new Error('timed out')
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
        setTimeout(resolve, 50)
      })
    }
  }
  opened(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(), { once: true })
      this.socket.addEventListener('error', () => reject(new Error('failed')), { once: true })
    })
  }
  async send(message: unknown) {
    await this.opened()
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message))
  }
  async sendBytes(bytes: Uint8Array) {
    await this.opened()
    this.socket.send(bytes)
  }
  async next(): Promise<Record<string, unknown> | string> {
    const text = await this.until(() => this.texts.shift())
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  nextBytes(): Promise<Uint8Array> {
    return this.until(() => this.bytes.shift())
  }
  closedWith(): Promise<{ code: number; reason: string }> {
    return this.until(() => this.closed ?? undefined)
  }
}

async function relay(t: TestContext): Promise<NodeRelay> {
  const started = await startNodeRelay()
  t.after(() => started.close())
  return started
}

function open(t: TestContext, base: string, kind: string, mailbox: string): Peer {
  const peer = new Peer(`${base}/v1/${kind}/${mailbox}`)
  t.after(() => peer.socket.close())
  return peer
}

/** A registered host with one client ticket, ready for pipes. */
async function hostWithTicket(t: TestContext, base: string) {
  const mailbox = token()
  const secret = token()
  const ticket = token()
  const host = open(t, base, 'host', mailbox)
  await host.send({ t: 'host', v: RELAY_PROTOCOL, secret })
  assert.deepEqual(await host.next(), { t: 'ready' })
  await host.send({ t: 'tickets', hashes: [await sha256Hex(ticket)] })
  return { mailbox, secret, ticket, host }
}

async function openPipe(t: TestContext, base: string) {
  const setup = await hostWithTicket(t, base)
  const client = open(t, base, 'client', setup.mailbox)
  await client.send({ t: 'client', v: RELAY_PROTOCOL, ticket: setup.ticket })
  const incoming = await setup.host.next()
  assert.equal(typeof incoming, 'object')
  const pipeId = (incoming as { t: string; pipe: string }).pipe
  assert.equal((incoming as { t: string }).t, 'incoming')
  const pipe = open(t, base, 'pipe', setup.mailbox)
  await pipe.send({ t: 'pipe', v: RELAY_PROTOCOL, secret: setup.secret, pipe: pipeId })
  assert.deepEqual(await client.next(), { t: 'open' })
  assert.deepEqual(await pipe.next(), { t: 'open' })
  return { ...setup, client, pipe }
}

test('a client with a ticket gets a pipe that carries bytes both ways, unchanged', async (t) => {
  const { url } = await relay(t)
  const { client, pipe } = await openPipe(t, url)
  await client.sendBytes(new Uint8Array([1, 2, 3]))
  assert.deepEqual([...(await pipe.nextBytes())], [1, 2, 3])
  const big = randomBytes(600 * 1024)
  await pipe.sendBytes(big)
  assert.deepEqual(Buffer.from(await client.nextBytes()), big)
})

test('closing one end of a pipe closes the other', async (t) => {
  const { url } = await relay(t)
  const { client, pipe } = await openPipe(t, url)
  pipe.socket.close()
  assert.equal((await client.closedWith()).reason, 'closed')
})

test('a client without a valid ticket never reaches the host', async (t) => {
  const { url } = await relay(t)
  const { mailbox, host } = await hostWithTicket(t, url)
  const stranger = open(t, url, 'client', mailbox)
  await stranger.send({ t: 'client', v: RELAY_PROTOCOL, ticket: token() })
  assert.deepEqual(await stranger.next(), { t: 'error', code: 'denied' })
  assert.equal((await stranger.closedWith()).reason, 'denied')
  await host.send('ping')
  assert.equal(await host.next(), 'pong', 'the host saw nothing but its own pong')
})

test('a removed ticket stops new pipes', async (t) => {
  const { url } = await relay(t)
  const { mailbox, ticket, host } = await hostWithTicket(t, url)
  await host.send({ t: 'tickets', hashes: [] })
  await host.send('ping')
  assert.equal(await host.next(), 'pong')
  const client = open(t, url, 'client', mailbox)
  await client.send({ t: 'client', v: RELAY_PROTOCOL, ticket })
  assert.deepEqual(await client.next(), { t: 'error', code: 'denied' })
})

test('a client learns the host is offline, at once or when it leaves', async (t) => {
  const { url } = await relay(t)
  const { mailbox, ticket, host } = await hostWithTicket(t, url)
  const waiting = open(t, url, 'client', mailbox)
  await waiting.send({ t: 'client', v: RELAY_PROTOCOL, ticket })
  await host.next()
  host.socket.close()
  assert.deepEqual(await waiting.next(), { t: 'error', code: 'offline' })
  const late = open(t, url, 'client', mailbox)
  await late.send({ t: 'client', v: RELAY_PROTOCOL, ticket })
  assert.deepEqual(await late.next(), { t: 'error', code: 'offline' })
})

test('only the secret that registered a mailbox can host it, and a new host replaces the old', async (t) => {
  const { url } = await relay(t)
  const { mailbox, secret, host } = await hostWithTicket(t, url)
  const impostor = open(t, url, 'host', mailbox)
  await impostor.send({ t: 'host', v: RELAY_PROTOCOL, secret: token() })
  assert.deepEqual(await impostor.next(), { t: 'error', code: 'denied' })
  const fakePipe = open(t, url, 'pipe', mailbox)
  await fakePipe.send({ t: 'pipe', v: RELAY_PROTOCOL, secret: token(), pipe: token() })
  assert.deepEqual(await fakePipe.next(), { t: 'error', code: 'denied' })
  const again = open(t, url, 'host', mailbox)
  await again.send({ t: 'host', v: RELAY_PROTOCOL, secret })
  assert.deepEqual(await again.next(), { t: 'ready' })
  assert.deepEqual(await host.next(), { t: 'error', code: 'replaced' })
})

test('hellos are checked against the socket kind and the protocol version', async (t) => {
  const { url } = await relay(t)
  const mailbox = token()
  const wrongKind = open(t, url, 'client', mailbox)
  await wrongKind.send({ t: 'host', v: RELAY_PROTOCOL, secret: token() })
  assert.deepEqual(await wrongKind.next(), { t: 'error', code: 'bad_request' })
  const future = open(t, url, 'host', mailbox)
  await future.send({ t: 'host', v: RELAY_PROTOCOL + 1, secret: token() })
  assert.deepEqual(await future.next(), { t: 'error', code: 'version' })
  const early = open(t, url, 'client', mailbox)
  await early.sendBytes(new Uint8Array([1]))
  assert.deepEqual(await early.next(), { t: 'error', code: 'bad_request' })
})

test('only /v1/<kind>/<mailbox> upgrades', async (t) => {
  const { url } = await relay(t)
  const bad = new Peer(`${url}/v1/nope/${token()}`)
  await assert.rejects(bad.opened())
  const short = new Peer(`${url}/v1/host/abc`)
  await assert.rejects(short.opened())
})
