import { createServer, type Server } from 'node:net'
import type { Failure } from '../../shared/app.js'
import {
  formatRemoteInvite,
  PAIRING_CODE_TTL_MS,
  type RemoteEvent,
  type RemoteMethod,
  type RemotePairing,
  type RemoteResults,
  remoteMethodSchemas
} from '../../shared/remote.js'
import { OwltoError } from '../app/errors.js'
import { newPairingCode } from './crypto.js'
import { type FrameChannel, SocketFrames } from './frames.js'
import { HandshakeError, type Me, respond } from './handshake.js'
import { newRelayToken, relayTicketHash } from './relay.js'
import { RpcConnection } from './rpc.js'
import type { RemoteStore } from './store.js'

/** What a host does for a request; params are already checked against the method's schema. */
export type RemoteHostApi = {
  [M in RemoteMethod]: (
    params: ReturnType<(typeof remoteMethodSchemas)[M]['parse']>
  ) => RemoteResults[M] | Promise<RemoteResults[M]>
}

/** Accepts frame channels, as TCP does; tests pass an in-memory listener. */
export type Listen = (
  port: number,
  accept: (frames: FrameChannel) => void
) => Promise<{ close(): void }>

export const tcpListen: Listen = (port, accept) =>
  new Promise((resolve, reject) => {
    const server: Server = createServer((socket) => accept(new SocketFrames(socket)))
    server.once('error', reject)
    server.listen(port, () => {
      server.off('error', reject)
      resolve({ close: () => server.close() })
    })
  })

/** Failed pairing attempts before the code stops working, so it cannot be guessed online. */
const PAIRING_ATTEMPTS = 5
/** Handshakes allowed at once; more are dropped before any work. */
const MAX_HANDSHAKES = 8
/** How long a session update may wait, so a streaming worker sends a few frames a second, not dozens. */
const SESSION_COALESCE_MS = 250

type Client = { deviceId: string; rpc: RpcConnection }

/**
 * Asked by a client after it connects, outside the Router API: where to find this host on
 * the relay, with a fresh ticket for it. Null while this host does not use the relay.
 */
export const RELAY_ROUTE_METHOD = 'relayRoute'
export type RelayRouteReply = { url: string; mailbox: string; ticket: string } | null

export type HostServerDeps = {
  store: RemoteStore
  me: () => Promise<Me>
  api: RemoteHostApi
  listen: Listen
  toFailure: (error: unknown) => Failure
  /** Paired devices or their connections changed. */
  changed: () => void
  now: () => Date
  /** This host's relay base URL and mailbox, while it uses the relay; null otherwise. */
  relay: () => { url: string; mailbox: string } | null
  /** The tickets that may reach this host through the relay changed. */
  ticketsChanged: () => void
}

/**
 * The host side of Remote Router: listens for paired devices, runs the pairing code,
 * answers their requests through the narrow `RemoteHostApi`, and streams events to them.
 */
export class HostServer {
  private listener: { close(): void } | null = null
  private pairing:
    | (Omit<RemotePairing, 'invite'> & {
        attempts: number
        timer: NodeJS.Timeout
        /** A one-time relay ticket for the device that pairs from the invite. */
        ticket: string | null
      })
    | null = null
  /** This device's public key, read at start, for invites. */
  private publicKey: string | null = null
  private clients = new Set<Client>()
  private handshakes = 0
  private pendingSessions = new Map<string, RemoteEvent>()
  private sessionTimer: NodeJS.Timeout | null = null
  constructor(private readonly deps: HostServerDeps) {}

  listening(): boolean {
    return this.listener !== null
  }
  async start(port: number): Promise<void> {
    if (this.listener) return
    // The key is made before the first device can connect, so a failure shows here.
    this.publicKey = (await this.deps.me()).identity.publicKey
    this.listener = await this.deps.listen(port, (frames) => this.accept(frames))
  }
  stop(): void {
    this.cancelPairing()
    this.listener?.close()
    this.listener = null
    for (const client of this.clients) client.rpc.close()
    this.clients.clear()
  }
  pairingState(): RemotePairing | null {
    if (!this.pairing) return null
    const { code, expiresAt, ticket } = this.pairing
    const relay = this.deps.relay()
    const invite =
      relay && ticket && this.publicKey
        ? formatRemoteInvite({
            relay: relay.url,
            mailbox: relay.mailbox,
            ticket,
            code,
            key: this.publicKey
          })
        : null
    return { code, expiresAt, invite }
  }
  /** Hashes of the relay tickets that may connect now: paired clients and a pairing invite. */
  tickets(): string[] {
    const hashes = this.deps.store
      .peers('client')
      .flatMap((peer) => (peer.relayTicketHash ? [peer.relayTicketHash] : []))
    if (this.pairing?.ticket) hashes.push(relayTicketHash(this.pairing.ticket))
    return [...new Set(hashes)].sort()
  }
  startPairing(): RemotePairing {
    if (!this.listener)
      throw new OwltoError('remote_unsupported', 'Turn on remote access before pairing a device.')
    this.cancelPairing()
    const expiresAt = new Date(this.deps.now().getTime() + PAIRING_CODE_TTL_MS).toISOString()
    const timer = setTimeout(() => {
      this.cancelPairing()
      this.deps.changed()
    }, PAIRING_CODE_TTL_MS)
    timer.unref?.()
    const ticket = this.deps.relay() ? newRelayToken() : null
    this.pairing = { code: newPairingCode(), expiresAt, attempts: 0, timer, ticket }
    if (ticket) this.deps.ticketsChanged()
    const state = this.pairingState()
    if (!state) throw new OwltoError('storage_error')
    return state
  }
  cancelPairing(): void {
    if (!this.pairing) return
    clearTimeout(this.pairing.timer)
    const hadTicket = this.pairing.ticket !== null
    this.pairing = null
    if (hadTicket) this.deps.ticketsChanged()
  }
  connected(deviceId: string): boolean {
    for (const client of this.clients) if (client.deviceId === deviceId) return true
    return false
  }
  /** Drops a device's connections, as after revoking it. */
  disconnect(deviceId: string): void {
    for (const client of [...this.clients]) if (client.deviceId === deviceId) client.rpc.close()
  }
  /** Sends a host event to every connected device. */
  observe(event: RemoteEvent): void {
    if (!this.clients.size) return
    if (event.type === 'session') {
      this.pendingSessions.set(event.session.id, event)
      this.sessionTimer ??= setTimeout(() => this.flushSessions(), SESSION_COALESCE_MS)
      return
    }
    // Any other event may depend on a session update, so those go first.
    this.flushSessions()
    this.broadcast(event)
  }
  private flushSessions(): void {
    if (this.sessionTimer) clearTimeout(this.sessionTimer)
    this.sessionTimer = null
    const pending = [...this.pendingSessions.values()]
    this.pendingSessions.clear()
    for (const event of pending) this.broadcast(event)
  }
  private broadcast(event: RemoteEvent): void {
    for (const client of this.clients) client.rpc.event(event)
  }

  /** Answers a connection from any transport: TCP, or a pipe from the relay. */
  accept(frames: FrameChannel): void {
    void this.answerConnection(frames)
  }
  private async answerConnection(frames: FrameChannel): Promise<void> {
    if (this.handshakes >= MAX_HANDSHAKES) {
      frames.close()
      return
    }
    this.handshakes++
    let opened: Awaited<ReturnType<typeof respond>>
    try {
      opened = await respond(frames, await this.deps.me(), {
        knownKey: (deviceId) => this.deps.store.peer(deviceId, 'client')?.publicKey ?? null,
        pairingCode: () => this.pairing?.code ?? null,
        pairingFailed: () => {
          if (!this.pairing) return
          this.pairing.attempts++
          if (this.pairing.attempts >= PAIRING_ATTEMPTS) {
            this.cancelPairing()
            this.deps.changed()
          }
        }
      })
    } catch (error) {
      if (!(error instanceof HandshakeError)) frames.close()
      return
    } finally {
      this.handshakes--
    }
    const { channel, peer, paired } = opened
    const at = this.deps.now().toISOString()
    if (paired) {
      // The code is spent once a device proves it; a second device needs a new code.
      this.cancelPairing()
      this.deps.store.savePeer({
        deviceId: peer.deviceId,
        role: 'client',
        name: peer.name,
        publicKey: peer.publicKey,
        host: null,
        port: null,
        pairedAt: at,
        lastSeenAt: at,
        relayUrl: null,
        relayMailbox: null,
        relayTicket: null,
        relayTicketHash: null
      })
    } else this.deps.store.seen(peer.deviceId, 'client', peer.name, at)
    const client: Client = {
      deviceId: peer.deviceId,
      rpc: new RpcConnection(
        channel,
        {
          request: (method, params) => this.answer(peer.deviceId, method, params),
          event: () => {}
        },
        this.deps.toFailure
      )
    }
    this.clients.add(client)
    client.rpc.onClose(() => {
      this.clients.delete(client)
      this.deps.changed()
    })
    this.deps.changed()
  }
  private async answer(deviceId: string, method: string, params: unknown): Promise<unknown> {
    // Revoking closes the connection, but a request may already be on its way.
    if (!this.deps.store.peer(deviceId, 'client'))
      throw new OwltoError('remote_identity_changed', 'This device was removed.')
    if (method === RELAY_ROUTE_METHOD) return this.relayRoute(deviceId)
    if (!Object.hasOwn(remoteMethodSchemas, method))
      throw new OwltoError('remote_unsupported', 'This action only works on the device itself.')
    const name = method as RemoteMethod
    const input = remoteMethodSchemas[name].parse(params ?? undefined)
    const run = this.deps.api[name] as (input: unknown) => unknown
    return await run(input)
  }
  /** Issues a client a new relay ticket; its old one stops working. */
  private relayRoute(deviceId: string): RelayRouteReply {
    const relay = this.deps.relay()
    if (!relay) return null
    const ticket = newRelayToken()
    this.deps.store.saveTicketHash(deviceId, relayTicketHash(ticket))
    this.deps.ticketsChanged()
    return { ...relay, ticket }
  }
}
