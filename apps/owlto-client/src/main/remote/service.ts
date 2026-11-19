import { hostname, networkInterfaces } from 'node:os'
import type { AppEvent, Failure } from '../../shared/app.js'
import {
  isRemoteEvent,
  REMOTE_PORT,
  type RemoteDevice,
  type RemoteEvent,
  type RemoteMethod,
  type RemoteOverview,
  remoteMethodSchemas
} from '../../shared/remote.js'
import { OwltoError } from '../app/errors.js'
import type { SecretCipher } from '../router/credentials.js'
import { type Dial, HostLinks } from './client.js'
import { exportPrivateKey, generateKeyPair, importKeyPair, type KeyPair } from './crypto.js'
import type { Me } from './handshake.js'
import { HostServer, type Listen, type RemoteHostApi } from './server.js'
import type { RemoteStore } from './store.js'

export type RemoteServiceDeps = {
  store: RemoteStore
  cipher: SecretCipher
  deviceId: string
  appVersion: string
  api: RemoteHostApi
  /** The persisted remote access switch. */
  accessEnabled: () => boolean
  saveAccess: (enabled: boolean) => void
  listen: Listen
  dial: Dial
  toFailure: (error: unknown) => Failure
  /** The overview changed: devices, connections, pairing, or listening. */
  changed: (overview: RemoteOverview) => void
  /** An event from a host this device drives. */
  remoteEvent: (deviceId: string, event: RemoteEvent) => void
  port?: number
  deviceName?: () => string
  addresses?: () => string[]
  now?: () => Date
}

/** This Mac's name as other devices see it: the host name without `.local`. */
export function localDeviceName(): string {
  return hostname().replace(/\.local$/i, '') || 'Mac'
}
/** IPv4 addresses on non-loopback interfaces, sorted; Tailscale's 100.x addresses included. */
export function localAddresses(): string[] {
  const found = new Set<string>()
  for (const list of Object.values(networkInterfaces()))
    for (const entry of list ?? [])
      if (entry.family === 'IPv4' && !entry.internal) found.add(entry.address)
  return [...found].sort()
}

/**
 * Remote Router: this device as a host (paired devices drive its Router) and as a
 * client (it drives the Routers of hosts it paired with). Both directions use the same
 * key pair, handshake, and messages; only the transport differs later (TCP or relay).
 */
export class RemoteService {
  private identity: Promise<KeyPair> | null = null
  private listenError: string | null = null
  private readonly server: HostServer
  private readonly links: HostLinks
  private readonly port: number
  private readonly now: () => Date
  constructor(private readonly deps: RemoteServiceDeps) {
    this.port = deps.port ?? REMOTE_PORT
    this.now = deps.now ?? (() => new Date())
    const me = () => this.me()
    const changed = () => this.changed()
    this.server = new HostServer({
      store: deps.store,
      me,
      api: deps.api,
      listen: deps.listen,
      toFailure: deps.toFailure,
      changed,
      now: this.now
    })
    this.links = new HostLinks({
      store: deps.store,
      me,
      dial: deps.dial,
      toFailure: deps.toFailure,
      changed,
      event: deps.remoteEvent,
      now: this.now
    })
  }

  /** Listens when remote access was on, and connects to paired hosts. Failures show in the overview. */
  start(): void {
    if (this.deps.accessEnabled()) void this.listen().catch(() => {})
    if (this.deps.store.peers('host').length)
      void this.me().then(
        () => this.links.start(),
        () => {}
      )
  }
  close(): void {
    this.server.stop()
    this.links.close()
  }
  overview(): RemoteOverview {
    return {
      deviceId: this.deps.deviceId,
      deviceName: this.name(),
      listening: this.server.listening(),
      listenError: this.listenError,
      port: this.port,
      addresses: this.server.listening() ? (this.deps.addresses ?? localAddresses)() : [],
      pairing: this.server.pairingState(),
      clients: this.deps.store.peers('client').map((peer) => ({
        deviceId: peer.deviceId,
        name: peer.name,
        pairedAt: peer.pairedAt,
        lastSeenAt: peer.lastSeenAt,
        connected: this.server.connected(peer.deviceId)
      })),
      devices: this.links.devices()
    }
  }
  async setAccess(enabled: boolean): Promise<RemoteOverview> {
    this.deps.saveAccess(enabled)
    if (enabled) await this.listen()
    else {
      this.server.stop()
      this.listenError = null
    }
    return this.changed()
  }
  startPairing(): RemoteOverview {
    this.server.startPairing()
    return this.changed()
  }
  cancelPairing(): RemoteOverview {
    this.server.cancelPairing()
    return this.changed()
  }
  /** Forgets a device that could drive this one and closes its connections. */
  revokeClient(deviceId: string): RemoteOverview {
    this.deps.store.removePeer(deviceId, 'client')
    this.server.disconnect(deviceId)
    return this.changed()
  }
  async pair(address: string, code: string): Promise<RemoteDevice> {
    const device = await this.links.pair(address, code)
    this.changed()
    return device
  }
  removeDevice(deviceId: string): RemoteOverview {
    this.links.remove(deviceId)
    return this.changed()
  }
  /** Runs one host method on a paired device. The request is checked here and again on the host. */
  async call(deviceId: string, method: RemoteMethod, params: unknown): Promise<unknown> {
    remoteMethodSchemas[method].parse(params ?? undefined)
    return this.links.request(deviceId, method, params ?? null)
  }
  /** Passes this device's events to the devices driving it. */
  observe(event: AppEvent): void {
    if (isRemoteEvent(event)) this.server.observe(event)
  }

  private name(): string {
    return (this.deps.deviceName ?? localDeviceName)()
  }
  private async listen(): Promise<void> {
    try {
      await this.server.start(this.port)
      this.listenError = null
    } catch (error) {
      this.listenError =
        error instanceof OwltoError
          ? error.message
          : (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
            ? `Port ${this.port} is in use by another app.`
            : error instanceof Error
              ? error.message
              : 'Owlto could not listen for other devices.'
      this.changed()
      throw error
    }
  }
  private changed(): RemoteOverview {
    const overview = this.overview()
    this.deps.changed(overview)
    return overview
  }
  private me(): Promise<Me> {
    this.identity ??= this.loadIdentity().catch((error) => {
      // A later try may succeed, e.g. once the keychain unlocks.
      this.identity = null
      throw error
    })
    return this.identity.then((identity) => ({
      deviceId: this.deps.deviceId,
      name: this.name(),
      appVersion: this.deps.appVersion,
      identity
    }))
  }
  /** The device key pair, made on first use; the private key is stored only encrypted. */
  private async loadIdentity(): Promise<KeyPair> {
    const saved = this.deps.store.identity()
    const reason = await this.deps.cipher.unavailable()
    if (reason) throw new OwltoError('secure_storage_unavailable', reason)
    if (saved) {
      const opened = await this.deps.cipher.decrypt(saved.secret).catch(() => null)
      if (opened) {
        const pair = importKeyPair(opened.plain)
        if (opened.stale)
          this.deps.store.saveIdentity({
            ...saved,
            secret: await this.deps.cipher.encrypt(opened.plain)
          })
        return pair
      }
      // The keychain works but no longer opens the key (its keychain item was replaced), so the
      // device starts over with a new key. Pairings were bound to the old one: pair again.
      for (const peer of this.deps.store.peers('host')) this.links.remove(peer.deviceId)
      for (const peer of this.deps.store.peers('client')) this.revokeClient(peer.deviceId)
    }
    const pair = generateKeyPair()
    const secret = await this.deps.cipher.encrypt(exportPrivateKey(pair.privateKey))
    this.deps.store.saveIdentity({ publicKey: pair.publicKey, secret })
    return pair
  }
}
