import { z } from 'zod'
import type { AppEvent, AppSnapshot, Reply, Router, ThreadItem } from './app.js'
import { deviceIdSchema, respondSchema } from './app.js'
import { ATTACHMENT_MAX_BYTES, type Attachment, stageAttachmentSchema } from './attachments.js'
import type { FilePreviewResult } from './file-preview.js'
import { fileTargetSchema } from './file-preview.js'
import {
  archiveThreadSchema,
  createThreadSchema,
  pendingMessageActionSchema,
  resolveBatchSchema,
  sendRouterSchema,
  threadItemsSchema,
  workerActionSchema
} from './router.js'

/**
 * Remote Router: one Owlto drives the Router of another Owlto it paired with. The host
 * keeps all data and runs the workers; the client only relays and shows. Bumped when a
 * message or a method changes in a way an older peer cannot read.
 */
export const REMOTE_PROTOCOL = 1
/** The TCP port a host listens on for direct connections. */
export const REMOTE_PORT = 47320
/** The Owlto relay, for devices that are not on the same network. */
export const DEFAULT_RELAY_URL = 'wss://relay.owlto.dev'
/** The debug relay (`wrangler deploy --env debug`), which debug builds and `pnpm dev` use. */
export const DEBUG_RELAY_URL = 'wss://relay-debug.owlto.dev'
/** How long a pairing code stays valid. */
export const PAIRING_CODE_TTL_MS = 5 * 60_000

/** Crockford base32 without the letters people misread: 8 characters, about 40 bits. */
export const PAIRING_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const PAIRING_CODE_LENGTH = 8
/** Uppercases and drops separators, so `abcd-efgh` and `ABCDEFGH` are the same code. */
export function normalizePairingCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '')
}
export const pairingCodeSchema = z
  .string()
  .max(32)
  .transform(normalizePairingCode)
  .pipe(
    z
      .string()
      .length(PAIRING_CODE_LENGTH)
      .regex(new RegExp(`^[${PAIRING_ALPHABET}]+$`))
  )

/**
 * A pairing code that works from any network: `K7Q2-ABCD-EFGH`. The first four characters
 * are a rendezvous code that lets the relay find the host; the last eight are the pairing
 * code, which never leaves the two devices.
 */
export const RENDEZVOUS_LENGTH = 4
export type RelayCode = { rendezvous: string; code: string }
export function parseRelayCode(text: string): RelayCode | null {
  const value = normalizePairingCode(text)
  if (value.length !== RENDEZVOUS_LENGTH + PAIRING_CODE_LENGTH) return null
  if (!new RegExp(`^[${PAIRING_ALPHABET}]+$`).test(value)) return null
  return { rendezvous: value.slice(0, RENDEZVOUS_LENGTH), code: value.slice(RENDEZVOUS_LENGTH) }
}
export function formatRelayCode({ rendezvous, code }: RelayCode): string {
  return `${rendezvous}-${code.slice(0, 4)}-${code.slice(4)}`
}
export const relayCodeSchema = z
  .string()
  .max(32)
  .transform((value, ctx) => {
    const parsed = parseRelayCode(value)
    if (!parsed) ctx.addIssue({ code: 'custom', message: 'Not a pairing code.' })
    return parsed ?? z.NEVER
  })

/** `host`, `host:port`, or `[ipv6]:port`, as the user types it. */
export const remoteAddressSchema = z.string().trim().min(1).max(260)
export type RemoteAddress = { host: string; port: number }
export function parseRemoteAddress(value: string): RemoteAddress | null {
  const text = value.trim()
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(text)
  const plain = /^([^:\s/]+)(?::(\d+))?$/.exec(text)
  const match = bracketed ?? plain
  if (!match) return null
  const port = match[2] ? Number(match[2]) : REMOTE_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null
  return { host: match[1], port }
}
export function formatRemoteAddress({ host, port }: RemoteAddress): string {
  const shown = host.includes(':') ? `[${host}]` : host
  return port === REMOTE_PORT ? shown : `${shown}:${port}`
}

/**
 * A pairing invite, shown as a QR code: everything another device needs to pair, with the
 * host's public key so nothing in between can stand in for the host. Through the relay, from
 * any network:
 *
 *   owlto://pair?v=1&relay=<wss url>&mailbox=<id>&ticket=<one-time ticket>&code=<code>&key=<public key>
 *
 * or straight to the host's address, on the same network or over Tailscale:
 *
 *   owlto://pair?v=1&host=<host[:port]>&code=<code>&key=<public key>
 */
export const REMOTE_INVITE_PREFIX = 'owlto://pair?'
export type RemoteInvite =
  | { relay: string; mailbox: string; ticket: string; code: string; key: string }
  | { host: string; code: string; key: string }
const TOKEN = /^[A-Za-z0-9_-]{22,128}$/
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/
export function formatRemoteInvite(invite: RemoteInvite): string {
  const params = new URLSearchParams({ v: '1', ...invite })
  return `${REMOTE_INVITE_PREFIX}${params.toString()}`
}
export function parseRemoteInvite(text: string): RemoteInvite | null {
  const value = text.trim()
  if (!value.startsWith(REMOTE_INVITE_PREFIX) || value.length > 2048) return null
  const params = new URLSearchParams(value.slice(REMOTE_INVITE_PREFIX.length))
  const key = params.get('key') ?? ''
  const code = pairingCodeSchema.safeParse(params.get('code') ?? '')
  if (params.get('v') !== '1' || !code.success || !PUBLIC_KEY.test(key)) return null
  const host = params.get('host')
  if (host !== null) {
    const address = host.length <= 260 ? parseRemoteAddress(host) : null
    return address ? { host: formatRemoteAddress(address), code: code.data, key } : null
  }
  const relay = params.get('relay') ?? ''
  const mailbox = params.get('mailbox') ?? ''
  const ticket = params.get('ticket') ?? ''
  if (!/^wss?:\/\/[^\s?#]+$/.test(relay) || relay.length > 512) return null
  if (!TOKEN.test(mailbox) || !TOKEN.test(ticket)) return null
  return { relay, mailbox, ticket, code: code.data, key }
}
export const remoteInviteSchema = z
  .string()
  .max(2048)
  .transform((value, ctx) => {
    const invite = parseRemoteInvite(value)
    if (!invite) ctx.addIssue({ code: 'custom', message: 'Not a pairing invite.' })
    return invite ?? z.NEVER
  })

/**
 * Pair by address and code on the same network, or from anywhere by an invite (a scanned
 * QR code or a pasted link) or a relay code typed by hand.
 */
export const remotePairSchema = z.union([
  z.object({ address: remoteAddressSchema, code: pairingCodeSchema }),
  z.object({ invite: remoteInviteSchema }),
  z.object({ relayCode: relayCodeSchema })
])
export type RemotePair = z.input<typeof remotePairSchema>

/** A device this Owlto can drive. */
export type RemoteDevice = {
  deviceId: string
  name: string
  /** Its address on the network; null for a device paired only through the relay. */
  address: string | null
  /** Whether this device can also reach it through the relay. */
  relay: boolean
  /** How the open connection goes; null while not connected. */
  via: 'direct' | 'relay' | null
  pairedAt: string
  status: 'connecting' | 'online' | 'offline'
  /** When it was last connected; null before the first connection after pairing. */
  lastSeenAt: string | null
}
/** A device allowed to drive this Owlto. */
export type RemoteClient = {
  deviceId: string
  name: string
  pairedAt: string
  lastSeenAt: string | null
  connected: boolean
}
export type RemotePairing = {
  code: string
  expiresAt: string
  /** An invite to pair through the relay, shown as a QR code; null while internet connections are off. */
  invite: string | null
  /** This Mac's public key, for invites to its own addresses (`formatRemoteInvite` with `host`). */
  key: string | null
  /** The code to type on a device on another network, `K7Q2-ABCD-EFGH`; null until the relay gives one. */
  relayCode: string | null
}
/**
 * The device that just paired, with the six digits it should show too. Kept for a few
 * minutes after pairing, so the user can compare them and remove the device if they differ.
 */
export type RemoteJustPaired = { deviceId: string; name: string; safetyCode: string }
/** What pairing returns on the device that typed the code or scanned the invite. */
export type RemotePaired = RemoteDevice & { safetyCode: string }
/** This device's connection to the relay, while it allows internet connections. */
export type RemoteRelayState = {
  /** The persisted switch. */
  enabled: boolean
  state: 'off' | 'connecting' | 'online' | 'offline'
  /** Why the relay is not reachable, such as `relay_unreachable`; null otherwise. */
  error: string | null
  account: RemoteRelayAccount
  /**
   * The user turned the switch on while signed out: the relay starts once they sign in.
   * Shown as on, with the sign-in under it.
   */
  signInToEnable: boolean
}
/** The identity providers a Mac can sign in to the relay with; `IDENTITY_PROVIDERS` on the relay. */
export const REMOTE_RELAY_PROVIDERS = ['github'] as const
export type RemoteRelayProvider = (typeof REMOTE_RELAY_PROVIDERS)[number]
export const remoteRelayProviderSchema = z.enum(REMOTE_RELAY_PROVIDERS)
/** Why a relay sign-in did not finish, or why a stored one stopped working. */
export type RemoteRelaySignInFailure = 'network' | 'denied' | 'expired' | 'relay'
/**
 * This Mac's relay account. A host needs one to use the relay: it signs in with an identity
 * provider once and the relay issues its own session, which signing out or removing the Mac
 * ends.
 */
export type RemoteRelayAccount =
  | { status: 'signed-out'; failure: RemoteRelaySignInFailure | null }
  | {
      status: 'pending'
      provider: RemoteRelayProvider
      userCode: string
      verificationUri: string
      expiresAt: string
    }
  | { status: 'signed-in'; provider: RemoteRelayProvider; login: string }
/** A Mac on this relay account, as the relay lists it. */
export type RemoteRelayMac = {
  mailbox: string
  /** The name the Mac gave when it signed in; null once that sign-in is gone. */
  name: string | null
  claimedAt: number
  /** This Mac's own mailbox. */
  thisMac: boolean
  online: boolean
  lastHostAt: number | null
}
export const relayMailboxSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/)
/** One of this Mac's network addresses, for the same-network QR code. */
export type RemoteNetworkAddress = {
  host: string
  /** The network interface it is on, such as `en0` or `bridge100`. */
  interface: string
  /** On Wi-Fi, Ethernet, or Tailscale; bridges and other virtual interfaces are not. */
  recommended: boolean
}

export type RemoteOverview = {
  deviceId: string
  deviceName: string
  /** Whether this Owlto accepts connections from paired devices. */
  listening: boolean
  /** Why listening failed, such as the port being taken; null otherwise. */
  listenError: string | null
  port: number
  /** This Mac's IPv4 addresses, recommended ones (Wi-Fi, Ethernet, Tailscale) first. */
  addresses: RemoteNetworkAddress[]
  pairing: RemotePairing | null
  justPaired: RemoteJustPaired | null
  /** Whether this Mac stays awake on power while remote access is on, and does now. */
  keepAwake: { enabled: boolean; active: boolean }
  relay: RemoteRelayState
  clients: RemoteClient[]
  devices: RemoteDevice[]
}

/**
 * The host's state as a client shows it. Settings and the GitHub account stay on each
 * device: the client keeps its own.
 */
export type RemoteSnapshot = Omit<AppSnapshot, 'settings' | 'github'>

/** A file a client sends to the host to attach to a worker message: base64 in JSON. */
export const remoteStageAttachmentSchema = z
  .object({
    name: z.string(),
    mimeType: z.string(),
    data: z
      .string()
      .max(Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4 + 4)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
  })
  .transform(({ data, ...rest }) => ({
    ...rest,
    data: Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
  }))
  .pipe(stageAttachmentSchema)

/**
 * Everything a client may ask a host. Each request is checked again on the host with
 * the same schema the local IPC uses. Cards, settings, folders, and apps stay local, so
 * they are not here; files are copied to the host first with `stageAttachment`.
 */
export const remoteMethodSchemas = {
  snapshot: z.undefined(),
  threadItems: threadItemsSchema,
  createThread: createThreadSchema,
  sendRouter: sendRouterSchema.refine(
    (input) => input.cardIds.length === 0,
    'Notes cannot be sent to another device yet.'
  ),
  stageAttachment: remoteStageAttachmentSchema,
  interruptRouter: z.string().uuid(),
  archiveThread: archiveThreadSchema,
  resolveBatch: resolveBatchSchema,
  stopWorker: workerActionSchema,
  resolveWorker: workerActionSchema,
  steerPendingMessage: pendingMessageActionSchema,
  dropPendingMessage: pendingMessageActionSchema,
  respond: respondSchema,
  previewFile: fileTargetSchema
} as const
export type RemoteMethod = keyof typeof remoteMethodSchemas
export const remoteMethodSchema = z.enum(
  Object.keys(remoteMethodSchemas) as [RemoteMethod, ...RemoteMethod[]]
)
export type RemoteParams = { [M in RemoteMethod]: z.input<(typeof remoteMethodSchemas)[M]> }
export type RemoteResults = {
  snapshot: RemoteSnapshot
  threadItems: ThreadItem[]
  createThread: Router
  /** `queued` when the host was offline and the message waits on the relay for it. */
  sendRouter: RemoteSendResult
  stageAttachment: Attachment
  interruptRouter: void
  archiveThread: void
  resolveBatch: void
  stopWorker: void
  resolveWorker: void
  steerPendingMessage: void
  dropPendingMessage: void
  respond: void
  previewFile: FilePreviewResult
}
export type RemoteSendResult = { queued: true } | undefined | void

export const remoteCallSchema = z.object({
  deviceId: deviceIdSchema,
  method: remoteMethodSchema,
  params: z.unknown()
})
export type RemoteCall<M extends RemoteMethod = RemoteMethod> = {
  deviceId: string
  method: M
  params: RemoteParams[M]
}

/** Host events a client receives; settings-wide events stay on each device. */
export type RemoteEvent = Exclude<AppEvent, { type: 'profile' } | { type: 'github-account' }>
export function isRemoteEvent(event: AppEvent): event is RemoteEvent {
  return event.type !== 'profile' && event.type !== 'github-account'
}
/** A host event, tagged with the host it came from. */
export type RemoteEventEnvelope = { deviceId: string; event: RemoteEvent }

/** `window.owlto.remote`: pairing, and driving the Routers of paired devices. */
export interface RemoteAPI {
  overview(): Promise<Reply<RemoteOverview>>
  /** Turns listening for paired devices on or off; remembered across restarts. */
  setAccess(enabled: boolean): Promise<Reply<RemoteOverview>>
  /** Turns connections through the relay on or off; remembered across restarts. */
  setRelay(enabled: boolean): Promise<Reply<RemoteOverview>>
  /** Keeps this Mac awake on power while remote access is on; remembered across restarts. */
  setKeepAwake(enabled: boolean): Promise<Reply<RemoteOverview>>
  /** Hides the just-paired device's safety code. */
  dismissJustPaired(): Promise<Reply<RemoteOverview>>
  /** Shows a one-time code another device types to pair. */
  startPairing(): Promise<Reply<RemoteOverview>>
  cancelPairing(): Promise<Reply<RemoteOverview>>
  /** Forgets a device that could drive this one and disconnects it. */
  revokeClient(deviceId: string): Promise<Reply<RemoteOverview>>
  /** Pairs with a device that shows a code, or from its invite. */
  pair(input: RemotePair): Promise<Reply<RemotePaired>>
  removeDevice(deviceId: string): Promise<Reply<RemoteOverview>>
  /** Starts the relay sign-in with a provider; its code shows in the overview. */
  relaySignIn(provider: RemoteRelayProvider): Promise<Reply<RemoteOverview>>
  relayCancelSignIn(): Promise<Reply<RemoteOverview>>
  /** Signs this Mac out of the relay, which disconnects it there and turns the relay off. */
  relaySignOut(): Promise<Reply<RemoteOverview>>
  /** The Macs on this relay account. */
  relayMacs(): Promise<Reply<RemoteRelayMac[]>>
  /** Removes a Mac from the account: its mailbox is deleted and its session ends. */
  relayRemoveMac(mailbox: string): Promise<Reply<RemoteRelayMac[]>>
  /** Runs one Router action on a paired device. */
  call<M extends RemoteMethod>(input: RemoteCall<M>): Promise<Reply<RemoteResults[M]>>
  onEvent(listener: (envelope: RemoteEventEnvelope) => void): () => void
  onChanged(listener: (overview: RemoteOverview) => void): () => void
}
