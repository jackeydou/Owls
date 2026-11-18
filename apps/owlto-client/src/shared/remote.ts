import { z } from 'zod'
import type { AppEvent, AppSnapshot, Reply, Router, ThreadItem } from './app.js'
import { deviceIdSchema, respondSchema } from './app.js'
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

export const remotePairSchema = z.object({
  address: remoteAddressSchema,
  code: pairingCodeSchema
})
export type RemotePair = z.input<typeof remotePairSchema>

/** A device this Owlto can drive. */
export type RemoteDevice = {
  deviceId: string
  name: string
  address: string
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
export type RemotePairing = { code: string; expiresAt: string }
export type RemoteOverview = {
  deviceId: string
  deviceName: string
  /** Whether this Owlto accepts connections from paired devices. */
  listening: boolean
  /** Why listening failed, such as the port being taken; null otherwise. */
  listenError: string | null
  port: number
  /** This Mac's network addresses another device can use. */
  addresses: string[]
  pairing: RemotePairing | null
  clients: RemoteClient[]
  devices: RemoteDevice[]
}

/**
 * The host's state as a client shows it. Settings and the GitHub account stay on each
 * device: the client keeps its own.
 */
export type RemoteSnapshot = Omit<AppSnapshot, 'settings' | 'github'>

/**
 * Everything a client may ask a host. Each request is checked again on the host with
 * the same schema the local IPC uses. Cards, attachments, settings, folders, and apps stay
 * local, so they are not here.
 */
export const remoteMethodSchemas = {
  snapshot: z.undefined(),
  threadItems: threadItemsSchema,
  createThread: createThreadSchema,
  sendRouter: sendRouterSchema.refine(
    (input) => input.cardIds.length === 0 && input.attachments.length === 0,
    'Notes and files cannot be sent to another device yet.'
  ),
  interruptRouter: z.string().uuid(),
  archiveThread: archiveThreadSchema,
  resolveBatch: resolveBatchSchema,
  stopWorker: workerActionSchema,
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
  sendRouter: void
  interruptRouter: void
  archiveThread: void
  resolveBatch: void
  stopWorker: void
  steerPendingMessage: void
  dropPendingMessage: void
  respond: void
  previewFile: FilePreviewResult
}
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
  /** Shows a one-time code another device types to pair. */
  startPairing(): Promise<Reply<RemoteOverview>>
  cancelPairing(): Promise<Reply<RemoteOverview>>
  /** Forgets a device that could drive this one and disconnects it. */
  revokeClient(deviceId: string): Promise<Reply<RemoteOverview>>
  /** Pairs with a device that shows a code. */
  pair(input: RemotePair): Promise<Reply<RemoteDevice>>
  removeDevice(deviceId: string): Promise<Reply<RemoteOverview>>
  /** Runs one Router action on a paired device. */
  call<M extends RemoteMethod>(input: RemoteCall<M>): Promise<Reply<RemoteResults[M]>>
  onEvent(listener: (envelope: RemoteEventEnvelope) => void): () => void
  onChanged(listener: (overview: RemoteOverview) => void): () => void
}
