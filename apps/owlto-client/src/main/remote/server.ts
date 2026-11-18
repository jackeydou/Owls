import { createServer, type Server } from 'node:net'
import type { Failure } from '../../shared/app.js'
import {
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

export type HostServerDeps = {
  store: RemoteStore
  me: () => Promise<Me>
  api: RemoteHostApi
  listen: Listen
  toFailure: (error: unknown) => Failure
  /** Paired devices or their connections changed. */
  changed: () => void
  now: () => Date
}

/**
 * The host side of Remote Router: listens for paired devices, runs the pairing code,
 * answers their requests through the narrow `RemoteHostApi`, and streams events to them.
 */
export class HostServer {
  private listener: { close(): void } | null = null
  private pairing: (RemotePairing & { attempts: number; timer: NodeJS.Timeout }) | null = null
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
    await this.deps.me()
    this.listener = await this.deps.listen(port, (frames) => void this.accept(frames))
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
    return { code: this.pairing.code, expiresAt: this.pairing.expiresAt }
  }
  startPairing(): RemotePairing {
    if (!this.listener)
      throw new OwltoError('remote_unsupported', 'Turn on remote access before pairing a device.')
    this.cancelPairing()
    const expiresAt = new Date(this.deps.now().getTime() + PAIRING_CODE_TTL_MS).toISOString()
    const timer = setTimeout(() => {
      this.pairing = null
      this.deps.changed()
    }, PAIRING_CODE_TTL_MS)
    timer.unref?.()
    this.pairing = { code: newPairingCode(), expiresAt, attempts: 0, timer }
    return { code: this.pairing.code, expiresAt }
  }
  cancelPairing(): void {
    if (!this.pairing) return
    clearTimeout(this.pairing.timer)
    this.pairing = null
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

  private async accept(frames: FrameChannel): Promise<void> {
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
        lastSeenAt: at
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
    if (!Object.hasOwn(remoteMethodSchemas, method))
      throw new OwltoError('remote_unsupported', 'This action only works on the device itself.')
    const name = method as RemoteMethod
    const input = remoteMethodSchemas[name].parse(params ?? undefined)
    const run = this.deps.api[name] as (input: unknown) => unknown
    return await run(input)
  }
}
