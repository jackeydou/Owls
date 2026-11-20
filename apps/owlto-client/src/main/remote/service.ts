import { hostname, networkInterfaces } from 'node:os'
import type { AppEvent, Failure } from '../../shared/app.js'
import type { Attachment } from '../../shared/attachments.js'
import {
  DEFAULT_RELAY_URL,
  isRemoteEvent,
  REMOTE_PORT,
  type RemoteEvent,
  type RemoteMethod,
  type RemoteOverview,
  type RemotePaired,
  type RemoteRelayMac,
  type RemoteRelayProvider,
  remoteMethodSchemas,
  remotePairSchema
} from '../../shared/remote.js'
import { OwltoError } from '../app/errors.js'
import type { GitHubCredentialStore } from '../github/auth.js'
import type { SecretCipher } from '../router/credentials.js'
import { type Dial, type DialRelay, HostLinks, type LookupRendezvous } from './client.js'
import { exportPrivateKey, generateKeyPair, importKeyPair, type KeyPair } from './crypto.js'
import type { Me } from './handshake.js'
import { KeepAwake, type KeepAwakePower } from './keep-awake.js'
import { newRelayToken, RelayListener, type RelayQueuedItem, type RelayRoute } from './relay.js'
import { RelayAccount } from './relay-account.js'
import { openFromClient, type PushMessage, sealPush } from './sealed.js'
import { HostServer, type Listen, type RegisterPush, type RemoteHostApi } from './server.js'
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
  /** The persisted switch that keeps this Mac awake on power while remote access is on. */
  keepAwakeEnabled: () => boolean
  saveKeepAwake: (enabled: boolean) => void
  /** Electron's power APIs; tests leave it out. */
  power?: KeepAwakePower
  listen: Listen
  dial: Dial
  dialRelay: DialRelay
  lookupRendezvous: LookupRendezvous
  dropItem: (route: RelayRoute, item: string) => Promise<void>
  /** Reads a staged attachment, to copy it to a host along with a message. */
  readAttachment: (attachment: Attachment) => Promise<Uint8Array>
  /** Where the relay session is kept, encrypted with `cipher`: the credentials table. */
  credentials: GitHubCredentialStore
  /** Requests to GitHub and the relay's account routes; tests stand in for both. */
  relayHttp?: typeof fetch
  /**
   * Whether turning the relay on needs a relay sign-in first. On for the Owlto relay; tests
   * against a relay without accounts turn it off.
   */
  relaySignInRequired?: boolean
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
/** IPv4 addresses another device can reach this Mac at, sorted. */
export function localAddresses(): string[] {
  return usableAddresses(networkInterfaces())
}

/** Wi-Fi and Ethernet ports: `en*` on macOS, `eth*` / `wl*` / `enp*` on Linux. */
const PHYSICAL_INTERFACE = /^(en|eth|wl)/
/** Tailscale hands out addresses from the carrier-grade NAT block, 100.64.0.0/10. */
function isTailscale(address: string): boolean {
  const [first, second] = address.split('.').map(Number)
  return first === 100 && second >= 64 && second < 128
}

/**
 * The non-loopback IPv4 addresses on Wi-Fi, Ethernet, and Tailscale. Bridges and virtual
 * interfaces (Docker, VM hosts, VPNs other than Tailscale) are left out, since another device
 * cannot reach them, unless nothing else is up.
 */
export function usableAddresses(
  interfaces: Partial<
    Record<string, { address: string; family: string | number; internal: boolean }[]>
  >
): string[] {
  const all = new Set<string>()
  const usable = new Set<string>()
  for (const [name, list] of Object.entries(interfaces))
    for (const entry of list ?? []) {
      if ((entry.family !== 'IPv4' && entry.family !== 4) || entry.internal) continue
      all.add(entry.address)
      if (PHYSICAL_INTERFACE.test(name) || isTailscale(entry.address)) usable.add(entry.address)
    }
  return [...(usable.size ? usable : all)].sort()
}

/**
 * Remote Router: this device as a host (paired devices drive its Router) and as a
 * client (it drives the Routers of hosts it paired with). Both directions use the same
 * key pair, handshake, and messages; only the transport differs later (TCP or relay).
 */
/** Messages left on the relay are dropped after a week, as the relay does. */
const QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60_000

export class RemoteService {
  private identity: Promise<KeyPair> | null = null
  private queueWork: Promise<void> = Promise.resolve()
  private relay: RelayListener | null = null
  private readonly account: RelayAccount
  /** The switch was turned on while signed out: turn the relay on once the sign-in lands. */
  private enableAfterSignIn = false
  private relayError: string | null = null
  private readonly relayUrl: string
  private listenError: string | null = null
  private readonly server: HostServer
  private readonly links: HostLinks
  private readonly keepAwake: KeepAwake | null
  private readonly port: number
  private readonly now: () => Date
  constructor(private readonly deps: RemoteServiceDeps) {
    this.port = deps.port ?? REMOTE_PORT
    this.now = deps.now ?? (() => new Date())
    this.relayUrl = deps.relayUrl ?? DEFAULT_RELAY_URL
    this.keepAwake = deps.power
      ? new KeepAwake(deps.power, () => deps.keepAwakeEnabled() && this.server.listening())
      : null
    const me = () => this.me()
    const changed = () => this.changed()
    this.account = new RelayAccount({
      store: deps.credentials,
      cipher: deps.cipher,
      relayUrl: this.relayUrl,
      deviceName: () => this.name(),
      http: deps.relayHttp,
      changed: () => this.accountChanged()
    })
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
      ticketsChanged: () => this.relay?.pushTickets(),
      rendezvous: () => this.relay?.rendezvous() ?? null,
      registerPush: (deviceId, push) => this.registerPush(deviceId, push)
    })
    this.links = new HostLinks({
      store: deps.store,
      me,
      dial: deps.dial,
      dialRelay: deps.dialRelay,
      relayUrl: this.relayUrl,
      lookupRendezvous: deps.lookupRendezvous,
      dropItem: deps.dropItem,
      toFailure: deps.toFailure,
      changed,
      event: deps.remoteEvent,
      now: this.now
    })
  }

  /** Listens when remote access was on, and connects to paired hosts. Failures show in the overview. */
  start(): void {
    void this.account.load()
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
    this.account.close()
    this.keepAwake?.close()
    this.stopRelay()
    this.server.stop()
    this.links.close()
  }
  /** The Mac switched between battery and power. */
  powerChanged(): void {
    this.keepAwake?.update()
    this.changed()
  }
  async setKeepAwake(enabled: boolean): Promise<RemoteOverview> {
    this.deps.saveKeepAwake(enabled)
    this.keepAwake?.update()
    return this.changed()
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
      justPaired: this.server.justPairedState(),
      keepAwake: {
        enabled: this.deps.keepAwakeEnabled(),
        active: this.keepAwake?.active() ?? false
      },
      relay: {
        enabled: this.deps.relayEnabled(),
        state: this.relay ? this.relay.status().state : 'off',
        error: this.relay ? this.relay.status().error : this.relayError,
        account: this.account.state(),
        signInToEnable: this.enableAfterSignIn
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
    if (enabled && this.deps.relaySignInRequired !== false) {
      await this.account.load()
      if (this.account.state().status !== 'signed-in') {
        // The sign-in is asked for here, when the user wants the relay; nothing is saved
        // until it lands.
        this.enableAfterSignIn = true
        return this.changed()
      }
    }
    if (!enabled && this.enableAfterSignIn) {
      this.enableAfterSignIn = false
      if (this.account.state().status === 'pending') this.account.cancelSignIn()
    }
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
  /** Hides the just-paired device's safety code once the user compared it. */
  dismissJustPaired(): RemoteOverview {
    this.server.dismissJustPaired()
    return this.changed()
  }
  /** Forgets a device that could drive this one and closes its connections. */
  revokeClient(deviceId: string): RemoteOverview {
    if (this.server.justPairedState()?.deviceId === deviceId) this.server.dismissJustPaired()
    this.deps.store.removePeer(deviceId, 'client')
    this.server.disconnect(deviceId)
    this.relay?.pushTickets()
    return this.changed()
  }
  /** Pairs by address and code, or from an invite (a `RemotePair`); the input is checked here. */
  async pair(input: unknown): Promise<RemotePaired> {
    const device = await this.links.pair(remotePairSchema.parse(input))
    this.changed()
    return device
  }
  removeDevice(deviceId: string): RemoteOverview {
    this.links.remove(deviceId)
    return this.changed()
  }
  /** Starts the relay's GitHub sign-in; its code shows in the overview. */
  async relaySignIn(provider: RemoteRelayProvider): Promise<RemoteOverview> {
    await this.account.signIn(provider)
    return this.overview()
  }
  relayCancelSignIn(): RemoteOverview {
    this.account.cancelSignIn()
    return this.overview()
  }
  /** Signs out of the relay; the relay goes off with it, since it needs a sign-in. */
  async relaySignOut(): Promise<RemoteOverview> {
    this.enableAfterSignIn = false
    await this.account.signOut()
    if (this.deps.relayEnabled()) {
      this.deps.saveRelay(false)
      this.stopRelay()
    }
    return this.changed()
  }
  relayMacs(): Promise<RemoteRelayMac[]> {
    return this.account.macs()
  }
  relayRemoveMac(mailbox: string): Promise<RemoteRelayMac[]> {
    return this.account.removeMac(mailbox)
  }
  /** Runs one host method on a paired device. The request is checked here and again on the host. */
  async call(deviceId: string, method: RemoteMethod, params: unknown): Promise<unknown> {
    if (method === 'sendRouter') {
      const input = remoteMethodSchemas.sendRouter.parse(params)
      if (!input.attachments.length) return this.links.sendOrQueue(deviceId, input)
      // Files live on this Mac: copy each to the host, then send the message with the
      // host's copies. A message with files is not queued while the host is away.
      const attachments: Attachment[] = []
      for (const attachment of input.attachments) {
        const data = await this.deps.readAttachment(attachment)
        attachments.push(
          (await this.links.request(deviceId, 'stageAttachment', {
            name: attachment.name,
            mimeType: attachment.mimeType,
            data: Buffer.from(data).toString('base64')
          })) as Attachment
        )
      }
      return this.links.request(deviceId, 'sendRouter', { ...input, attachments })
    }
    remoteMethodSchemas[method].parse(params ?? undefined)
    return this.links.request(deviceId, method, params ?? null)
  }
  /**
   * Sends a sealed notification to every paired phone that registered for them and is not
   * connected right now (a connected phone shows the request itself).
   */
  async notifyClients(message: PushMessage): Promise<void> {
    const relay = this.relay
    if (!relay || relay.status().state !== 'online') return
    for (const peer of this.deps.store.peers('client')) {
      if (!peer.pushToken || !peer.pushKey || this.server.connected(peer.deviceId)) continue
      const opened = await this.deps.cipher.decrypt(peer.pushKey).catch(() => null)
      if (!opened) continue
      relay.push(
        peer.pushToken,
        peer.pushSandbox,
        sealPush(message, Buffer.from(opened.plain, 'base64url'))
      )
    }
  }
  private async registerPush(deviceId: string, push: RegisterPush): Promise<void> {
    this.deps.store.savePush(
      deviceId,
      push ? { ...push, key: await this.deps.cipher.encrypt(push.key) } : null
    )
  }
  /**
   * Runs the messages clients left on the relay while this host was away, oldest first per
   * client. Each runs at most once: its sequence number must be above the last one run.
   */
  private queued(items: RelayQueuedItem[]): void {
    this.queueWork = this.queueWork.then(() => this.runQueued(items)).catch(() => {})
  }
  private async runQueued(items: RelayQueuedItem[]): Promise<void> {
    const me = await this.me()
    const clientKey = (id: string) => this.deps.store.peer(id, 'client')?.publicKey ?? null
    const opened = items
      .map((item) => ({ id: item.id, opened: openFromClient(item.item, me.identity, clientKey) }))
      .sort(
        (a, b) =>
          (a.opened?.from ?? '').localeCompare(b.opened?.from ?? '') ||
          (a.opened?.message.seq ?? 0) - (b.opened?.message.seq ?? 0)
      )
    const handled: string[] = []
    for (const { id, opened: item } of opened) {
      handled.push(id)
      if (!item) continue
      const peer = this.deps.store.peer(item.from, 'client')
      if (!peer || item.message.seq <= peer.queueSeq) continue
      this.deps.store.saveQueueSeq(item.from, 'client', item.message.seq)
      if (this.now().getTime() - item.message.at > QUEUE_MAX_AGE_MS) continue
      try {
        await this.deps.api.sendRouter(remoteMethodSchemas.sendRouter.parse(item.message.params))
      } catch {
        // The thread may be gone or archived by now; the message cannot run, so it is dropped.
      }
    }
    this.relay?.ack(handled)
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
        pairingTicket: () => this.server.pairingTicket(),
        session: () => this.account.session(),
        accept: (frames) => this.server.accept(frames),
        queued: (items) => this.queued(items),
        pushGone: (token) => this.deps.store.dropPushToken(token),
        changed: () => this.relayChanged()
      })
      this.relay.start()
    } catch (error) {
      this.relayError = error instanceof Error ? error.message : 'relay_unavailable'
      this.changed()
    }
  }
  /**
   * The relay turned a session down. When it was the stored one, the Mac has to sign in
   * again; when a sign-in finished after that attempt began, connect again with it.
   */
  private relayChanged(): void {
    const relay = this.relay
    if (relay?.status().error === 'relay_login') {
      const current = this.account.loadedSession()
      if (current && relay.shownSession() === current) this.account.invalidate()
      else if (current) this.restartRelay()
    }
    this.changed()
  }
  /**
   * A relay that stopped for want of a sign-in, or because this Mac was removed from the
   * account, connects again once there is a new sign-in. Signing out needs nothing here:
   * the relay disconnects the host itself.
   */
  private accountChanged(): void {
    if (this.enableAfterSignIn && this.account.state().status === 'signed-in') {
      this.enableAfterSignIn = false
      this.deps.saveRelay(true)
      if (this.server.listening()) void this.startRelay()
    }
    const relay = this.relay
    const current = this.account.loadedSession()
    if (
      relay &&
      current &&
      relay.shownSession() !== current &&
      relay.status().state === 'offline' &&
      (relay.status().error === 'relay_login' || relay.status().error === 'relay_denied')
    )
      this.restartRelay()
    this.changed()
  }
  private restartRelay(): void {
    this.stopRelay()
    void this.startRelay()
  }
  private stopRelay(): void {
    this.relay?.close()
    this.relay = null
    this.relayError = null
  }
  private changed(): RemoteOverview {
    this.keepAwake?.update()
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
