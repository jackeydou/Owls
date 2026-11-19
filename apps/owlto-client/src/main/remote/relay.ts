import { createHash, randomBytes } from 'node:crypto'
import type { FrameChannel } from './frames.js'
import { MAX_FRAME_BYTES } from './frames.js'

/**
 * The relay transport: a WebSocket to the Owlto relay that carries the same sealed frames
 * a direct TCP connection does. The relay only joins a client's socket to the host's; the
 * handshake and every frame after it are end-to-end between the two devices, so the relay
 * sees ciphertext only. The relay's protocol lives in `packages/owlto-relay/src/protocol.ts`.
 */
export const RELAY_PROTOCOL = 1

/** Where a host waits for clients on the relay, and the ticket a client shows to get in. */
export type RelayRoute = { url: string; mailbox: string; ticket: string }

/** A random token for mailbox ids, host secrets, and tickets: 192 bits, base64url. */
export function newRelayToken(): string {
  return randomBytes(24).toString('base64url')
}
/** What the relay stores in place of a ticket. */
export function relayTicketHash(ticket: string): string {
  return createHash('sha256').update(ticket).digest('hex')
}

/** Why the relay turned a socket away, as its `error` message names it. */
export class RelayError extends Error {
  constructor(readonly reason: string) {
    super(`relay_${reason}`)
  }
  /** Read by `linkFailure`, like a socket error's errno code. */
  get code(): string {
    return `RELAY_${this.reason.toUpperCase()}`
  }
}

/** Relay messages stay under 1 MiB, so larger frames go in chunks. */
const CHUNK_BYTES = 256 * 1024
const MORE = 1
const LAST = 0
const OPEN_TIMEOUT_MS = 10_000

function socketUrl(base: string, kind: 'host' | 'client' | 'pipe', mailbox: string): string {
  return `${base.replace(/\/+$/, '')}/v1/${kind}/${mailbox}`
}
function parse(data: unknown): { t?: unknown; code?: unknown; pipe?: unknown } | null {
  if (typeof data !== 'string') return null
  try {
    const value: unknown = JSON.parse(data)
    return typeof value === 'object' && value !== null ? value : null
  } catch {
    return null
  }
}

/**
 * Opens a relay socket and sends its hello. Resolves once the relay answers `expect`
 * (`open` for a pipe, `ready` for a host), with the socket ready for frames.
 */
function relaySocket(
  url: string,
  hello: Record<string, unknown>,
  expect: 'open' | 'ready'
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch (error) {
      reject(error)
      return
    }
    socket.binaryType = 'arraybuffer'
    let settled = false
    const finish = (error: Error | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeEventListener('message', onMessage)
      if (error) {
        socket.close()
        reject(error)
      } else resolve(socket)
    }
    const timer = setTimeout(() => finish(new RelayError('timeout')), OPEN_TIMEOUT_MS)
    const onMessage = (event: MessageEvent) => {
      const message = parse(event.data)
      if (message?.t === expect) finish(null)
      else if (message?.t === 'error')
        finish(new RelayError(typeof message.code === 'string' ? message.code : 'unknown'))
    }
    socket.addEventListener('message', onMessage)
    socket.addEventListener('open', () => socket.send(JSON.stringify(hello)), { once: true })
    socket.addEventListener('error', () => finish(new RelayError('unreachable')), { once: true })
    socket.addEventListener('close', () => finish(new RelayError('closed')), { once: true })
  })
}

/** Whole frames over an open relay pipe, split into chunks that fit a relay message. */
export class WebSocketFrames implements FrameChannel {
  private frameListener: ((frame: Buffer) => void) | null = null
  private early: Buffer[] = []
  private closeListeners: ((error: Error | null) => void)[] = []
  private parts: Buffer[] = []
  private partBytes = 0
  private closed = false
  private failure: Error | null = null
  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => this.receive(event.data))
    socket.addEventListener('error', () => {
      this.failure ??= new RelayError('socket')
    })
    socket.addEventListener('close', () => this.finish())
    if (socket.readyState === WebSocket.CLOSED) this.finish()
  }
  private receive(data: unknown): void {
    // Text after `open` is only the relay's `pong`.
    if (!(data instanceof ArrayBuffer) || data.byteLength < 1) return
    const chunk = Buffer.from(data)
    this.parts.push(chunk.subarray(1))
    this.partBytes += chunk.length - 1
    if (this.partBytes > MAX_FRAME_BYTES) {
      this.failure = new Error('Frame too large.')
      this.close()
      return
    }
    if (chunk[0] !== LAST) return
    const frame = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts)
    this.parts = []
    this.partBytes = 0
    if (this.frameListener) this.frameListener(frame)
    else this.early.push(frame)
  }
  private finish(): void {
    if (this.closed) return
    this.closed = true
    for (const listener of this.closeListeners) listener(this.failure)
    this.closeListeners = []
  }
  send(frame: Buffer): void {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return
    if (frame.length > MAX_FRAME_BYTES) throw new Error('Frame too large.')
    let offset = 0
    do {
      const end = Math.min(offset + CHUNK_BYTES, frame.length)
      const chunk = Buffer.allocUnsafe(1 + end - offset)
      chunk[0] = end < frame.length ? MORE : LAST
      frame.copy(chunk, 1, offset, end)
      this.socket.send(chunk)
      offset = end
    } while (offset < frame.length)
  }
  onFrame(listener: (frame: Buffer) => void): void {
    this.frameListener = listener
    const early = this.early
    this.early = []
    for (const frame of early) listener(frame)
  }
  onClose(listener: (error: Error | null) => void): void {
    if (this.closed) listener(this.failure)
    else this.closeListeners.push(listener)
  }
  close(): void {
    this.socket.close()
    // A socket that never finished opening fires no close event of its own.
    if (this.socket.readyState === WebSocket.CLOSED) this.finish()
  }
}

/** Asks the relay for a pipe to the host behind `route`. */
export async function dialRelay(route: RelayRoute): Promise<FrameChannel> {
  const socket = await relaySocket(
    socketUrl(route.url, 'client', route.mailbox),
    { t: 'client', v: RELAY_PROTOCOL, ticket: route.ticket },
    'open'
  )
  return new WebSocketFrames(socket)
}

export type RelayStatus = {
  state: 'connecting' | 'online' | 'offline'
  /** Why the last attempt failed, such as `relay_denied`; null when online. */
  error: string | null
}
export type RelayListenerOptions = {
  url: string
  mailbox: string
  secret: string
  /** Hashes of the tickets that may open pipes now. */
  tickets: () => string[]
  accept: (frames: FrameChannel) => void
  changed: () => void
}

/** Host reconnect delays, each with ±20% jitter so a relay restart is not met all at once. */
const HOST_BACKOFF_MS = [1_000, 3_000, 10_000, 30_000, 60_000]
const KEEPALIVE_MS = 30_000
/** No word from the relay this long, pongs included, means the socket is dead. */
const SILENCE_MS = 75_000

/**
 * The host side of the relay: keeps a control socket to its mailbox open, tells the relay
 * which tickets may connect, and opens a pipe socket for every client that arrives.
 */
export class RelayListener {
  private socket: WebSocket | null = null
  private retry: NodeJS.Timeout | null = null
  private keepalive: NodeJS.Timeout | null = null
  private failures = 0
  private stopped = false
  private current: RelayStatus = { state: 'connecting', error: null }
  constructor(private readonly options: RelayListenerOptions) {}

  start(): void {
    this.stopped = false
    void this.connect()
  }
  status(): RelayStatus {
    return this.current
  }
  /** Sends the current tickets; call after pairing, revoking, or issuing a ticket. */
  pushTickets(): void {
    if (this.current.state !== 'online') return
    this.socket?.send(JSON.stringify({ t: 'tickets', hashes: this.options.tickets() }))
  }
  close(): void {
    this.stopped = true
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    this.stopKeepalive()
    this.socket?.close()
    this.socket = null
  }

  private set(state: RelayStatus['state'], error: string | null): void {
    this.current = { state, error }
    this.options.changed()
  }
  private async connect(): Promise<void> {
    if (this.stopped) return
    this.set('connecting', this.current.error)
    let socket: WebSocket
    try {
      socket = await relaySocket(
        socketUrl(this.options.url, 'host', this.options.mailbox),
        { t: 'host', v: RELAY_PROTOCOL, secret: this.options.secret },
        'ready'
      )
    } catch (error) {
      const reason = error instanceof RelayError ? error.message : 'relay_unreachable'
      this.set('offline', reason)
      // Another secret owns this mailbox: retrying cannot help.
      if (reason !== 'relay_denied') this.retryLater()
      return
    }
    if (this.stopped) {
      socket.close()
      return
    }
    this.socket = socket
    this.failures = 0
    let lastHeard = Date.now()
    socket.addEventListener('message', (event) => {
      lastHeard = Date.now()
      const message = parse(event.data)
      if (message?.t === 'incoming' && typeof message.pipe === 'string') this.openPipe(message.pipe)
      else if (message?.t === 'error' && message.code === 'replaced')
        this.current = { state: 'offline', error: 'relay_replaced' }
    })
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      this.stopKeepalive()
      if (this.stopped) return
      const replaced = this.current.error === 'relay_replaced'
      this.set('offline', replaced ? 'relay_replaced' : 'relay_closed')
      this.retryLater()
    })
    this.keepalive = setInterval(() => {
      if (Date.now() - lastHeard > SILENCE_MS) socket.close()
      else socket.send('ping')
    }, KEEPALIVE_MS)
    this.keepalive.unref?.()
    this.set('online', null)
    this.pushTickets()
  }
  private openPipe(pipe: string): void {
    relaySocket(
      socketUrl(this.options.url, 'pipe', this.options.mailbox),
      { t: 'pipe', v: RELAY_PROTOCOL, secret: this.options.secret, pipe },
      'open'
    ).then(
      (socket) => {
        if (this.stopped) socket.close()
        else this.options.accept(new WebSocketFrames(socket))
      },
      // The client gave up first; it will dial again.
      () => {}
    )
  }
  private stopKeepalive(): void {
    if (this.keepalive) clearInterval(this.keepalive)
    this.keepalive = null
  }
  private retryLater(): void {
    if (this.stopped || this.retry) return
    const base = HOST_BACKOFF_MS[Math.min(this.failures, HOST_BACKOFF_MS.length - 1)]
    this.failures++
    const delay = Math.round(base * (0.8 + Math.random() * 0.4))
    this.retry = setTimeout(() => {
      this.retry = null
      void this.connect()
    }, delay)
    this.retry.unref?.()
  }
  /** Reconnects at once, as after the Mac wakes or the network changes. */
  reconnectNow(): void {
    if (this.stopped || this.current.state === 'online') return
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    this.failures = 0
    void this.connect()
  }
}
