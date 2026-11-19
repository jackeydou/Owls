import type { AppEvent, Failure } from '../../shared/app.js'
import {
  formatRemoteAddress,
  isRemoteEvent,
  normalizePairingCode,
  parseRemoteAddress,
  type RemoteDevice,
  type RemoteEvent
} from '../../shared/remote.js'
import { OwltoError } from '../app/errors.js'
import type { FrameChannel } from './frames.js'
import { HandshakeError, initiate, type Me, type SecureChannel } from './handshake.js'
import { RemoteCallError, RpcConnection } from './rpc.js'
import type { PeerRecord, RemoteStore } from './store.js'

/** Opens a frame channel to an address; TCP in the app, in-memory in tests. */
export type Dial = (host: string, port: number) => Promise<FrameChannel>

type Link = {
  status: RemoteDevice['status']
  rpc: RpcConnection | null
  retry: NodeJS.Timeout | null
  /** Consecutive failures, for the reconnect backoff. */
  failures: number
  /** Resolves when the connection attempt in flight settles. */
  connecting: Promise<RpcConnection> | null
}

/** Reconnect delays: quick at first, then once a minute while the device stays away. */
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000]

export type HostLinksDeps = {
  store: RemoteStore
  me: () => Promise<Me>
  dial: Dial
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
  if (error instanceof HandshakeError) {
    if (error.reason === 'protocol') return new OwltoError('remote_version')
    if (error.reason === 'auth_failed' || error.reason === 'not_pairing')
      return new OwltoError(pairing ? 'remote_pairing_failed' : 'remote_identity_changed')
    if (error.reason === 'unknown_device' || error.reason === 'identity_changed')
      return new OwltoError('remote_identity_changed')
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
    return this.deps.store.peers('host').map((peer) => ({
      deviceId: peer.deviceId,
      name: peer.name,
      address: formatRemoteAddress({ host: peer.host ?? '', port: peer.port ?? 0 }),
      pairedAt: peer.pairedAt,
      lastSeenAt: peer.lastSeenAt,
      status: this.links.get(peer.deviceId)?.status ?? 'offline'
    }))
  }

  /** Pairs with the host at `address` using the code it shows; keeps the connection open. */
  async pair(address: string, code: string): Promise<RemoteDevice> {
    const target = parseRemoteAddress(address)
    if (!target) throw new OwltoError('invalid_request', 'Enter an address such as 192.168.1.20.')
    const me = await this.deps.me()
    let frames: FrameChannel
    try {
      frames = await this.deps.dial(target.host, target.port)
    } catch (error) {
      throw linkFailure(error, true)
    }
    let opened: Awaited<ReturnType<typeof initiate>>
    try {
      opened = await initiate(frames, me, { kind: 'pair', code: normalizePairingCode(code) })
    } catch (error) {
      throw linkFailure(error, true)
    }
    const at = this.deps.now().toISOString()
    const peer: PeerRecord = {
      deviceId: opened.peer.deviceId,
      role: 'host',
      name: opened.peer.name,
      publicKey: opened.peer.publicKey,
      host: target.host,
      port: target.port,
      pairedAt: at,
      lastSeenAt: at
    }
    this.drop(peer.deviceId)
    this.deps.store.savePeer(peer)
    const link = this.link(peer.deviceId)
    this.attach(peer.deviceId, link, opened.channel)
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

  private link(deviceId: string): Link {
    let link = this.links.get(deviceId)
    if (!link) {
      link = { status: 'offline', rpc: null, retry: null, failures: 0, connecting: null }
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
      const frames = await this.deps.dial(peer.host ?? '', peer.port ?? 0)
      const { channel, peer: answered } = await initiate(frames, me, {
        kind: 'auth',
        deviceId: peer.deviceId,
        publicKey: peer.publicKey
      })
      if (this.links.get(peer.deviceId) !== link) {
        channel.close()
        throw new OwltoError('remote_offline')
      }
      this.deps.store.seen(peer.deviceId, 'host', answered.name, this.deps.now().toISOString())
      return this.attach(peer.deviceId, link, channel)
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
  private attach(deviceId: string, link: Link, channel: SecureChannel): RpcConnection {
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
    link.status = 'online'
    link.failures = 0
    rpc.onClose(() => {
      if (this.links.get(deviceId) !== link) return
      link.rpc = null
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
