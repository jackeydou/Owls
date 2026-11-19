import { hostname, networkInterfaces } from 'node:os'
import type { AppEvent, Failure } from '../../shared/app.js'
import {
  DEFAULT_RELAY_URL,
  isRemoteEvent,
  REMOTE_PORT,
  type RemoteDevice,
  type RemoteEvent,
  type RemoteMethod,
  type RemoteOverview,
  remoteMethodSchemas,
  remotePairSchema
} from '../../shared/remote.js'
import { OwltoError } from '../app/errors.js'
import type { SecretCipher } from '../router/credentials.js'
import { type Dial, type DialRelay, HostLinks } from './client.js'
import { exportPrivateKey, generateKeyPair, importKeyPair, type KeyPair } from './crypto.js'
import type { Me } from './handshake.js'
import { newRelayToken, RelayListener } from './relay.js'
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
  /** The persisted switch for connections through the relay. */
  relayEnabled: () => boolean
  saveRelay: (enabled: boolean) => void
  listen: Listen
  dial: Dial
  dialRelay: DialRelay
  /** The relay's base URL; the Owlto relay unless a test runs its own. */
  relayUrl?: string
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
  private relay: RelayListener | null = null
  private relayError: string | null = null
  private readonly relayUrl: string
  private listenError: string | null = null
  private readonly server: HostServer
  private readonly links: HostLinks
  private readonly port: number
  private readonly now: () => Date
  constructor(private readonly deps: RemoteServiceDeps) {
    this.port = deps.port ?? REMOTE_PORT
    this.now = deps.now ?? (() => new Date())
    this.relayUrl = deps.relayUrl ?? DEFAULT_RELAY_URL
    const me = () => this.me()
    const changed = () => this.changed()
    this.server = new HostServer({
      store: deps.store,
      me,
      api: deps.api,
      listen: deps.listen,
      toFailure: deps.toFailure,
      changed,
      now: this.now,
      relay: () => {
        const mailbox = this.relay ? this.deps.store.relayIdentity()?.mailbox : null
        return mailbox ? { url: this.relayUrl, mailbox } : null
      },
      ticketsChanged: () => this.relay?.pushTickets()
    })
    this.links = new HostLinks({
      store: deps.store,
      me,
      dial: deps.dial,
      dialRelay: deps.dialRelay,
      toFailure: deps.toFailure,
      changed,
      event: deps.remoteEvent,
      now: this.now
    })
  }

  /** Listens when remote access was on, and connects to paired hosts. Failures show in the overview. */
  start(): void {
    if (this.deps.accessEnabled())
      void this.listen().then(
        () => (this.deps.relayEnabled() ? this.startRelay() : undefined),
        () => {}
      )
    if (this.deps.store.peers('host').length)
      void this.me().then(
        () => this.links.start(),
        () => {}
      )
  }
  close(): void {
    this.stopRelay()
    this.server.stop()
    this.links.close()
  }
  /** Reconnects right away after the Mac wakes or its network changes. */
  wake(): void {
    this.relay?.reconnectNow()
    this.links.wake()
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
      relay: {
        enabled: this.deps.relayEnabled(),
        state: this.relay ? this.relay.status().state : 'off',
        error: this.relay ? this.relay.status().error : this.relayError
      },
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
    if (enabled) {
      await this.listen()
      if (this.deps.relayEnabled()) await this.startRelay()
    } else {
      this.stopRelay()
      this.server.stop()
      this.listenError = null
    }
    return this.changed()
  }
  /** Turns connections through the relay on or off; they also need remote access. */
  async setRelay(enabled: boolean): Promise<RemoteOverview> {
    this.deps.saveRelay(enabled)
    if (enabled && this.server.listening()) await this.startRelay()
    else if (!enabled) this.stopRelay()
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
    this.relay?.pushTickets()
    return this.changed()
  }
  /** Pairs by address and code, or from an invite (a `RemotePair`); the input is checked here. */
  async pair(input: unknown): Promise<RemoteDevice> {
    const device = await this.links.pair(remotePairSchema.parse(input))
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
      // Every handshake needs this device's key from the keychain. Open it before listening, so
      // a keychain problem shows here instead of as a silent timeout on the other Mac.
      await this.me().catch((error: unknown) => {
        throw new OwltoError(
          'secure_storage_unavailable',
          `Owlto could not open this Mac's device key in the keychain${error instanceof Error && error.message ? `: ${error.message}` : '.'}`
        )
      })
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
  /** Connects this host to its relay mailbox, making the mailbox on first use. */
  private async startRelay(): Promise<void> {
    if (this.relay) return
    try {
      await this.me()
      let saved = this.deps.store.relayIdentity()
      let secret: string | null = null
      if (saved) {
        const opened = await this.deps.cipher.decrypt(saved.secret).catch(() => null)
        secret = opened?.plain ?? null
      }
      if (!saved || !secret) {
        // No mailbox yet, or its secret no longer opens: start a new one. Clients get its
        // route the next time they connect directly, or pair again.
        secret = newRelayToken()
        saved = { mailbox: newRelayToken(), secret: await this.deps.cipher.encrypt(secret) }
        this.deps.store.saveRelayIdentity(saved)
      }
      this.relayError = null
      this.relay = new RelayListener({
        url: this.relayUrl,
        mailbox: saved.mailbox,
        secret,
        tickets: () => this.server.tickets(),
        accept: (frames) => this.server.accept(frames),
        changed: () => this.changed()
      })
      this.relay.start()
    } catch (error) {
      this.relayError = error instanceof Error ? error.message : 'relay_unavailable'
      this.changed()
    }
  }
  private stopRelay(): void {
    this.relay?.close()
    this.relay = null
    this.relayError = null
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
      this.deps.store.saveRelayIdentity(null)
    }
    const pair = generateKeyPair()
    const secret = await this.deps.cipher.encrypt(exportPrivateKey(pair.privateKey))
    this.deps.store.saveIdentity({ publicKey: pair.publicKey, secret })
    return pair
  }
}
