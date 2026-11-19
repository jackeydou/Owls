import { z } from 'zod'
import type { AppEvent, Failure } from '../../shared/app.js'
import {
  formatRemoteAddress,
  isRemoteEvent,
  normalizePairingCode,
  parseRemoteAddress,
  type RemoteDevice,
  type RemoteEvent,
  type RemoteInvite
} from '../../shared/remote.js'
import { OwltoError } from '../app/errors.js'
import type { FrameChannel } from './frames.js'
import { HandshakeError, initiate, type Me, type Peer, type SecureChannel } from './handshake.js'
import { RelayError, type RelayRoute } from './relay.js'
import { RemoteCallError, RpcConnection } from './rpc.js'
import { RELAY_ROUTE_METHOD } from './server.js'
import type { PeerRecord, RemoteStore } from './store.js'

/** Opens a frame channel to an address; TCP in the app, in-memory in tests. */
export type Dial = (host: string, port: number) => Promise<FrameChannel>
/** Opens a pipe to a host through the relay. */
export type DialRelay = (route: RelayRoute) => Promise<FrameChannel>

type Via = NonNullable<RemoteDevice['via']>
type Link = {
  status: RemoteDevice['status']
  via: Via | null
  rpc: RpcConnection | null
  retry: NodeJS.Timeout | null
  /** Consecutive failures, for the reconnect backoff. */
  failures: number
  /** Resolves when the connection attempt in flight settles. */
  connecting: Promise<RpcConnection> | null
}

/** Reconnect delays: quick at first, then once a minute while the device stays away. */
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000]
/** A direct connection gets this head start before the relay is tried too. */
const RELAY_HEAD_START_MS = 300

const token = z.string().regex(/^[A-Za-z0-9_-]{22,128}$/)
const relayRouteSchema = z
  .object({
    url: z
      .string()
      .regex(/^wss?:\/\/\S+$/)
      .max(512),
    mailbox: token,
    ticket: token
  })
  .nullable()

/** One way to reach a host, tried in a race with the others. */
type Attempt = { via: Via; delay: number; dial: () => Promise<FrameChannel> }

/**
 * Dials every route, the later ones after their head start (or at once when an earlier one
 * fails), and keeps the first that completes the handshake; the others are closed.
 */
function race(
  attempts: Attempt[],
  handshake: (frames: FrameChannel) => Promise<{ channel: SecureChannel; peer: Peer }>
): Promise<{ channel: SecureChannel; peer: Peer; via: Via }> {
  return new Promise((resolve, reject) => {
    let won = false
    let left = attempts.length
    const errors: unknown[] = []
    const timers: NodeJS.Timeout[] = []
    const started = new Set<number>()
    const run = (index: number) => {
      if (won || started.has(index)) return
      started.add(index)
      clearTimeout(timers[index])
      const attempt = attempts[index]
      void (async () => {
        try {
          const frames = await attempt.dial()
          if (won) {
            frames.close()
            return
          }
          const opened = await handshake(frames)
          if (won) {
            opened.channel.close()
            return
          }
          won = true
          for (const timer of timers) clearTimeout(timer)
          resolve({ ...opened, via: attempt.via })
        } catch (error) {
          errors.push(error)
          // The next route need not wait out its head start.
          const next = attempts.findIndex((_, i) => !started.has(i))
          if (next !== -1) run(next)
          if (--left === 0 && !won) reject(pickError(errors))
        }
      })()
    }
    attempts.forEach((attempt, index) => {
      timers[index] = setTimeout(() => run(index), attempt.delay)
    })
  })
}
/** The most telling failure: a handshake's verdict over the relay's over the network's. */
function pickError(errors: unknown[]): unknown {
  return (
    errors.find((error) => error instanceof HandshakeError) ??
    errors.find((error) => error instanceof RelayError && error.reason !== 'unreachable') ??
    errors[0]
  )
}

export type HostLinksDeps = {
  store: RemoteStore
  me: () => Promise<Me>
  dial: Dial
  dialRelay: DialRelay
  toFailure: (error: unknown) => Failure
  /** A host's connection state changed. */
  changed: () => void
  event: (deviceId: string, event: RemoteEvent) => void
  now: () => Date
}

/** Maps a failed handshake or dial to what the user can act on. */
export function linkFailure(error: unknown, pairing: boolean): OwltoError {
  if (error instanceof OwltoError) return error
  if (error instanceof RemoteCallError) return new OwltoError(error.failure.code, error.message)
  if (error instanceof RelayError) {
    if (error.reason === 'offline') return new OwltoError('remote_offline')
    if (error.reason === 'denied')
      return new OwltoError(pairing ? 'remote_pairing_failed' : 'remote_identity_changed')
    if (error.reason === 'version') return new OwltoError('remote_version')
    return new OwltoError('remote_unreachable', error.message)
  }
  if (error instanceof HandshakeError) {
    if (error.reason === 'protocol') return new OwltoError('remote_version')
    if (error.reason === 'auth_failed' || error.reason === 'not_pairing')
      return new OwltoError(pairing ? 'remote_pairing_failed' : 'remote_identity_changed')
    if (error.reason === 'unknown_device' || error.reason === 'identity_changed')
      return new OwltoError('remote_identity_changed')
    // Connected, but the other Mac never finished the handshake: name the step for diagnosis.
    return new OwltoError('remote_unreachable', `handshake_${error.reason}`)
  }
  // Keep the system's reason (EHOSTUNREACH is macOS's Local Network permission; ECONNREFUSED is
  // nothing listening there) so a failed connection can be told apart.
  const code =
    error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string'
      ? (error as NodeJS.ErrnoException).code
      : null
  return new OwltoError('remote_unreachable', code ?? undefined)
}

/**
 * The client side of Remote Router: one connection per paired host, kept open and
 * reconnected with backoff, so the device list shows who is online and events flow in.
 */
export class HostLinks {
  private links = new Map<string, Link>()
  private closed = false
  constructor(private readonly deps: HostLinksDeps) {}

  /** Connects to every paired host. */
  start(): void {
    for (const peer of this.deps.store.peers('host'))
      void this.connect(peer.deviceId).catch(() => {})
  }
  devices(): RemoteDevice[] {
    return this.deps.store.peers('host').map((peer) => {
      const link = this.links.get(peer.deviceId)
      return {
        deviceId: peer.deviceId,
        name: peer.name,
        address:
          peer.host && peer.port ? formatRemoteAddress({ host: peer.host, port: peer.port }) : null,
        relay: relayRouteOf(peer) !== null,
        via: link?.status === 'online' ? link.via : null,
        pairedAt: peer.pairedAt,
        lastSeenAt: peer.lastSeenAt,
        status: link?.status ?? 'offline'
      }
    })
  }

  /**
   * Pairs with a host: at its address with the code it shows, or through the relay with its
   * invite. Keeps the connection open.
   */
  async pair(
    input: { address: string; code: string } | { invite: RemoteInvite }
  ): Promise<RemoteDevice> {
    const me = await this.deps.me()
    let direct: { host: string; port: number } | null = null
    let relay: RelayRoute | null = null
    let opened: Awaited<ReturnType<typeof initiate>>
    try {
      if ('invite' in input) {
        const { invite } = input
        relay = { url: invite.relay, mailbox: invite.mailbox, ticket: invite.ticket }
        const frames = await this.deps.dialRelay(relay)
        opened = await initiate(frames, me, { kind: 'pair', code: invite.code, key: invite.key })
      } else {
        direct = parseRemoteAddress(input.address)
        if (!direct)
          throw new OwltoError('invalid_request', 'Enter an address such as 192.168.1.20.')
        const frames = await this.deps.dial(direct.host, direct.port)
        opened = await initiate(frames, me, {
          kind: 'pair',
          code: normalizePairingCode(input.code)
        })
      }
    } catch (error) {
      throw linkFailure(error, true)
    }
    const at = this.deps.now().toISOString()
    const peer: PeerRecord = {
      deviceId: opened.peer.deviceId,
      role: 'host',
      name: opened.peer.name,
      publicKey: opened.peer.publicKey,
      host: direct?.host ?? null,
      port: direct?.port ?? null,
      pairedAt: at,
      lastSeenAt: at,
      // The invite's ticket worked once; the host hands out this device's own ticket next.
      relayUrl: relay?.url ?? null,
      relayMailbox: relay?.mailbox ?? null,
      relayTicket: relay?.ticket ?? null,
      relayTicketHash: null
    }
    this.drop(peer.deviceId)
    this.deps.store.savePeer(peer)
    const link = this.link(peer.deviceId)
    const rpc = this.attach(peer.deviceId, link, opened.channel, relay ? 'relay' : 'direct')
    // A device paired from an invite has no other way back: wait for its own ticket.
    if (relay) await this.refreshRoute(peer.deviceId, rpc)
    else void this.refreshRoute(peer.deviceId, rpc)
    const device = this.devices().find((d) => d.deviceId === peer.deviceId)
    if (!device) throw new OwltoError('storage_error')
    return device
  }
  remove(deviceId: string): void {
    this.drop(deviceId)
    this.deps.store.removePeer(deviceId, 'host')
    this.deps.changed()
  }
  /** Sends one request to a host, connecting first when it is not connected. */
  async request(deviceId: string, method: string, params: unknown): Promise<unknown> {
    const rpc = await this.connect(deviceId)
    try {
      return await rpc.request(method, params)
    } catch (error) {
      if (error instanceof RemoteCallError) throw new OwltoError(error.failure.code, error.message)
      throw error
    }
  }
  close(): void {
    this.closed = true
    for (const deviceId of [...this.links.keys()]) this.drop(deviceId)
  }
  /** Retries every offline host now, as after the Mac wakes or the network changes. */
  wake(): void {
    for (const [deviceId, link] of this.links) {
      if (!link.retry) continue
      clearTimeout(link.retry)
      link.retry = null
      link.failures = 0
      void this.connect(deviceId).catch(() => {})
    }
  }

  private link(deviceId: string): Link {
    let link = this.links.get(deviceId)
    if (!link) {
      link = {
        status: 'offline',
        via: null,
        rpc: null,
        retry: null,
        failures: 0,
        connecting: null
      }
      this.links.set(deviceId, link)
    }
    return link
  }
  private drop(deviceId: string): void {
    const link = this.links.get(deviceId)
    if (!link) return
    this.links.delete(deviceId)
    if (link.retry) clearTimeout(link.retry)
    link.rpc?.close()
  }
  private connect(deviceId: string): Promise<RpcConnection> {
    const peer = this.deps.store.peer(deviceId, 'host')
    if (!peer) return Promise.reject(new OwltoError('remote_offline', 'This device is not paired.'))
    const link = this.link(deviceId)
    if (link.rpc) return Promise.resolve(link.rpc)
    if (link.connecting) return link.connecting
    if (link.retry) {
      clearTimeout(link.retry)
      link.retry = null
    }
    link.status = 'connecting'
    this.deps.changed()
    link.connecting = this.open(peer, link).finally(() => {
      link.connecting = null
    })
    return link.connecting
  }
  private async open(peer: PeerRecord, link: Link): Promise<RpcConnection> {
    try {
      const me = await this.deps.me()
      const attempts: Attempt[] = []
      const { host, port } = peer
      if (host && port)
        attempts.push({ via: 'direct', delay: 0, dial: () => this.deps.dial(host, port) })
      const relay = relayRouteOf(peer)
      if (relay)
        attempts.push({
          via: 'relay',
          delay: attempts.length ? RELAY_HEAD_START_MS : 0,
          dial: () => this.deps.dialRelay(relay)
        })
      if (!attempts.length) throw new OwltoError('remote_offline', 'This device has no address.')
      const {
        channel,
        peer: answered,
        via
      } = await race(attempts, (frames) =>
        initiate(frames, me, { kind: 'auth', deviceId: peer.deviceId, publicKey: peer.publicKey })
      )
      if (this.links.get(peer.deviceId) !== link) {
        channel.close()
        throw new OwltoError('remote_offline')
      }
      this.deps.store.seen(peer.deviceId, 'host', answered.name, this.deps.now().toISOString())
      const rpc = this.attach(peer.deviceId, link, channel, via)
      void this.refreshRoute(peer.deviceId, rpc)
      return rpc
    } catch (error) {
      const failure = linkFailure(error, false)
      if (this.links.get(peer.deviceId) === link) {
        link.status = 'offline'
        this.retryLater(peer.deviceId, link)
        this.deps.changed()
      }
      throw failure
    }
  }
  /**
   * Asks a connected host for its relay route and a fresh ticket, so this device can reach it
   * from another network later. A host that does not use the relay, or predates it, has none.
   */
  private async refreshRoute(deviceId: string, rpc: RpcConnection): Promise<void> {
    let reply: unknown
    try {
      reply = await rpc.request(RELAY_ROUTE_METHOD, undefined)
    } catch {
      return
    }
    const route = relayRouteSchema.safeParse(reply)
    if (route.success && this.deps.store.peer(deviceId, 'host')) {
      this.deps.store.saveRelayRoute(deviceId, route.data)
      this.deps.changed()
    }
  }
  private attach(deviceId: string, link: Link, channel: SecureChannel, via: Via): RpcConnection {
    const rpc = new RpcConnection(
      channel,
      {
        request: async () => {
          throw new OwltoError('remote_unsupported')
        },
        event: (event) => {
          if (isEventShape(event) && isRemoteEvent(event)) this.deps.event(deviceId, event)
        }
      },
      this.deps.toFailure
    )
    link.rpc = rpc
    link.via = via
    link.status = 'online'
    link.failures = 0
    rpc.onClose(() => {
      if (this.links.get(deviceId) !== link) return
      link.rpc = null
      link.via = null
      link.status = 'offline'
      this.retryLater(deviceId, link)
      this.deps.changed()
    })
    this.deps.changed()
    return rpc
  }
  private retryLater(deviceId: string, link: Link): void {
    if (this.closed || link.retry) return
    const delay = BACKOFF_MS[Math.min(link.failures, BACKOFF_MS.length - 1)]
    link.failures++
    link.retry = setTimeout(() => {
      link.retry = null
      void this.connect(deviceId).catch(() => {})
    }, delay)
    link.retry.unref?.()
  }
}

/**
 * Events come from a paired host, which proved its key, so only their outer shape is
 * checked here; the renderer treats them as it treats its own device's events.
 */
function isEventShape(value: unknown): value is AppEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

function relayRouteOf(peer: PeerRecord): RelayRoute | null {
  return peer.relayUrl && peer.relayMailbox && peer.relayTicket
    ? { url: peer.relayUrl, mailbox: peer.relayMailbox, ticket: peer.relayTicket }
    : null
}
