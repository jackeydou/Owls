import { createHash, randomBytes } from 'node:crypto'
import { type FrameChannel, type Keepalive, MAX_FRAME_BYTES } from './frames.js'

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
/**
 * Text `ping`s keep a relay socket open through NATs and show when it died. The relay
 * answers them without waking its Durable Object, so they cost nothing there.
 */
const SOCKET_PING_MS = 30_000
/** No word from the relay this long, pongs included, means the socket is dead. */
const SOCKET_SILENCE_MS = 75_000
/**
 * End-to-end pings wake the relay's Durable Object, which bills by the time it stays awake,
 * so a quiet pipe checks on its peer every few minutes. A peer that drops is noticed sooner:
 * the relay closes the other end of its pipe.
 */
export const RELAY_KEEPALIVE: Keepalive = { pingMs: 240_000, idleMs: 600_000 }
/** A connection that lasted this long resets the reconnect backoff. */
export const STABLE_MS = 60_000
/** Relay answers that the same attempt would get again. */
const FINAL_ERRORS = new Set([
  'relay_replaced',
  'relay_denied',
  'relay_version',
  'relay_bad_request',
  'relay_login',
  'relay_quota'
])

function socketUrl(
  base: string,
  kind: 'host' | 'client' | 'pipe' | 'drop',
  mailbox: string
): string {
  return `${base.replace(/\/+$/, '')}/v1/${kind}/${mailbox}`
}
function isQueuedItem(value: unknown): value is RelayQueuedItem {
  const item = value as Partial<RelayQueuedItem> | null
  return (
    typeof item?.id === 'string' &&
    typeof item.from === 'string' &&
    typeof item.at === 'number' &&
    typeof item.item === 'string'
  )
}
type RelayMessage = {
  t?: unknown
  code?: unknown
  pipe?: unknown
  items?: unknown
  token?: unknown
  expiresAt?: unknown
}
function parse(data: unknown): RelayMessage | null {
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
  expect: 'open' | 'ready' | 'stored',
  /**
   * Gets every message from the start. Messages that follow the expected one can arrive in
   * the same read and be dispatched before the caller could add a listener of its own.
   */
  listener?: (event: MessageEvent) => void
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
    if (listener) socket.addEventListener('message', listener)
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
  private lastHeard = Date.now()
  private readonly pinger: NodeJS.Timeout
  readonly keepalive = RELAY_KEEPALIVE
  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      this.lastHeard = Date.now()
      this.receive(event.data)
    })
    socket.addEventListener('error', () => {
      this.failure ??= new RelayError('socket')
    })
    socket.addEventListener('close', () => this.finish())
    this.pinger = setInterval(() => {
      if (Date.now() - this.lastHeard > SOCKET_SILENCE_MS) {
        this.failure ??= new RelayError('silent')
        this.close()
      } else if (socket.readyState === WebSocket.OPEN) socket.send('ping')
    }, SOCKET_PING_MS)
    this.pinger.unref?.()
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
    clearInterval(this.pinger)
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

/**
 * Finds the mailbox and pairing ticket behind a rendezvous code (the first four characters of
 * a code like `K7Q2-ABCD-EFGH`). Null when the code is unknown or expired.
 */
export async function lookupRendezvous(
  url: string,
  code: string
): Promise<{ mailbox: string; ticket: string } | null> {
  const http = url.replace(/^ws/, 'http').replace(/\/+$/, '')
  let response: Response
  try {
    response = await fetch(`${http}/v1/rendezvous/${code}`, {
      signal: AbortSignal.timeout(OPEN_TIMEOUT_MS)
    })
  } catch {
    throw new RelayError('unreachable')
  }
  if (response.status === 404) return null
  if (response.status === 429) throw new RelayError('limited')
  if (!response.ok) throw new RelayError('unreachable')
  const body = (await response.json().catch(() => null)) as {
    mailbox?: unknown
    ticket?: unknown
  } | null
  const token = /^[A-Za-z0-9_-]{22,128}$/
  if (
    typeof body?.mailbox !== 'string' ||
    typeof body.ticket !== 'string' ||
    !token.test(body.mailbox) ||
    !token.test(body.ticket)
  )
    throw new RelayError('bad_request')
  return { mailbox: body.mailbox, ticket: body.ticket }
}

/** Leaves one sealed item for an offline host; it gets the item when it next connects. */
export async function dropRelayItem(route: RelayRoute, item: string): Promise<void> {
  const socket = await relaySocket(
    socketUrl(route.url, 'drop', route.mailbox),
    { t: 'drop', v: RELAY_PROTOCOL, ticket: route.ticket, item },
    'stored'
  )
  socket.close()
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
  /** The pairing invite's one-time ticket while pairing is open; null otherwise. */
  pairingTicket: () => string | null
  /** This Mac's relay session (`RelayAccount`); null when it is not signed in. */
  session: () => Promise<string | null>
  accept: (frames: FrameChannel) => void
  /** Sealed items clients left while this host was away; ack the ones handled. */
  queued: (items: RelayQueuedItem[]) => void
  /** APNs no longer takes this device token. */
  pushGone: (token: string) => void
  changed: () => void
}
/** An item a client left on the relay; `from` is the hash of the ticket it used. */
export type RelayQueuedItem = { id: string; from: string; at: number; item: string }
/** A short code that finds this host's mailbox while pairing is open. */
export type RelayRendezvous = { ticket: string; code: string; expiresAt: number }

/**
 * Host reconnect delays, each with ±20% jitter so a relay restart is not met all at once.
 * The backoff resets only after a connection stays up for `STABLE_MS`, so a relay that
 * accepts and then drops the socket is not hit in a tight loop.
 */
const HOST_BACKOFF_MS = [1_000, 3_000, 10_000, 30_000, 60_000, 300_000]

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
  private meet: RelayRendezvous | null = null
  /** The session the last connect showed, so a refusal can be told apart from a newer sign-in. */
  private shown: string | null = null
  constructor(private readonly options: RelayListenerOptions) {}

  start(): void {
    this.stopped = false
    void this.connect()
  }
  status(): RelayStatus {
    return this.current
  }
  /** The relay session the last connect attempt showed; null when it had none. */
  shownSession(): string | null {
    return this.shown
  }
  /**
   * Sends the current tickets; call after pairing, revoking, or issuing a ticket. While
   * pairing is open it also asks for a rendezvous code for the invite's ticket.
   */
  pushTickets(): void {
    const ticket = this.options.pairingTicket()
    if (this.meet && this.meet.ticket !== ticket) {
      this.meet = null
      this.options.changed()
    }
    if (this.current.state !== 'online') return
    this.send({ t: 'tickets', hashes: this.options.tickets() })
    if (ticket && !this.meet) this.send({ t: 'rendezvous', ticket })
  }
  /** The live rendezvous code for the open pairing; null when there is none yet. */
  rendezvous(): RelayRendezvous | null {
    return this.meet && this.meet.expiresAt > Date.now() ? this.meet : null
  }
  /** Tells the relay these queued items were handled, so it deletes them. */
  ack(ids: string[]): void {
    if (ids.length) this.send({ t: 'ack', ids })
  }
  /** Asks the relay to deliver a sealed notification through APNs. */
  push(token: string, sandbox: boolean, payload: string): void {
    this.send({ t: 'push', token, sandbox, payload })
  }
  private send(message: Record<string, unknown>): void {
    if (this.current.state === 'online' && this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(message))
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
    let lastHeard = Date.now()
    const onMessage = (event: MessageEvent) => {
      lastHeard = Date.now()
      this.receive(parse(event.data))
    }
    try {
      // A relay with accounts turns a missing session away with `login`; one without
      // accounts (a private deployment) does not ask.
      const session = await this.options.session()
      this.shown = session
      socket = await relaySocket(
        socketUrl(this.options.url, 'host', this.options.mailbox),
        { t: 'host', v: RELAY_PROTOCOL, secret: this.options.secret, session },
        'ready',
        onMessage
      )
    } catch (error) {
      const reason = error instanceof RelayError ? error.message : 'relay_unreachable'
      this.set('offline', reason)
      // Another secret owns this mailbox, the relay speaks another protocol, or the
      // sign-in is missing: retrying cannot help, and each attempt is a billed request.
      if (!FINAL_ERRORS.has(reason)) this.retryLater()
      return
    }
    if (this.stopped) {
      socket.close()
      return
    }
    this.socket = socket
    const openedAt = Date.now()
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      this.stopKeepalive()
      if (this.stopped) return
      if (Date.now() - openedAt >= STABLE_MS) this.failures = 0
      // Another Mac with this mailbox's secret took over (a copied data folder). Taking it
      // back would make the two push each other off forever, so wait for a wake or a
      // toggle instead.
      // Signed out, or removed on another Mac: the same session would be turned away again.
      if (this.current.error && FINAL_ERRORS.has(this.current.error)) {
        this.set('offline', this.current.error)
        return
      }
      this.set('offline', 'relay_closed')
      this.retryLater()
    })
    this.keepalive = setInterval(() => {
      if (Date.now() - lastHeard > SOCKET_SILENCE_MS) socket.close()
      else socket.send('ping')
    }, SOCKET_PING_MS)
    this.keepalive.unref?.()
    this.set('online', null)
    this.pushTickets()
  }
  private receive(message: RelayMessage | null): void {
    if (message?.t === 'incoming' && typeof message.pipe === 'string') this.openPipe(message.pipe)
    else if (message?.t === 'queued' && Array.isArray(message.items))
      this.options.queued(message.items.filter(isQueuedItem))
    else if (message?.t === 'push-gone' && typeof message.token === 'string')
      this.options.pushGone(message.token)
    else if (
      message?.t === 'rendezvous' &&
      typeof message.code === 'string' &&
      typeof message.expiresAt === 'number'
    ) {
      const ticket = this.options.pairingTicket()
      if (ticket) {
        this.meet = { ticket, code: message.code, expiresAt: message.expiresAt }
        this.options.changed()
      }
    } else if (message?.t === 'error' && typeof message.code === 'string') {
      const reason = `relay_${message.code}`
      if (FINAL_ERRORS.has(reason)) this.current = { state: 'offline', error: reason }
    }
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
    // A wake may end a takeover by another Mac, but not a missing or ended sign-in.
    const error = this.current.error
    if (error && error !== 'relay_replaced' && FINAL_ERRORS.has(error)) return
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    this.failures = 0
    void this.connect()
  }
}
