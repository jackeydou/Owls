import { and, eq } from 'drizzle-orm'
import { remoteIdentityTable, remotePeersTable } from '../app/schema.js'
import type { OwltoStore } from '../app/store.js'
import { relayTicketHash } from './relay.js'

export type PeerRole = 'client' | 'host'
export type PeerRecord = {
  deviceId: string
  role: PeerRole
  name: string
  publicKey: string
  /** Where a host is reached; null for a client. */
  host: string | null
  port: number | null
  pairedAt: string
  lastSeenAt: string | null
  /**
   * For a host: where it waits on the relay and the ticket this device shows there. For a
   * client: only the ticket it was given, handed out again when it asks for its route.
   */
  relayUrl: string | null
  relayMailbox: string | null
  relayTicket: string | null
  /** For a client: the hash of the relay ticket it holds, as the relay stores it. */
  relayTicketHash: string | null
  /** The relay queue's sequence number: the highest run (host side) or last used (client side). */
  queueSeq: number
  /** For a client: where its notifications go, and the key they are sealed with (encrypted). */
  pushToken: string | null
  pushKey: string | null
  pushSandbox: boolean
}
/** A new peer's queue and push fields. */
export const NEW_PEER_EXTRAS = {
  queueSeq: 0,
  pushToken: null,
  pushKey: null,
  pushSandbox: false
} as const satisfies Pick<PeerRecord, 'queueSeq' | 'pushToken' | 'pushKey' | 'pushSandbox'>
export type IdentityRecord = { publicKey: string; secret: string }
/** This device's mailbox on the relay; the secret is encrypted with safeStorage. */
export type RelayIdentity = { mailbox: string; secret: string }

const IDENTITY_ROW = 'local'

/** Remote Router's rows: this device's key pair and the devices it paired with. */
export class RemoteStore {
  constructor(private readonly db: OwltoStore['db']) {}
  identity(): IdentityRecord | null {
    const row = this.db
      .select()
      .from(remoteIdentityTable)
      .where(eq(remoteIdentityTable.id, IDENTITY_ROW))
      .get()
    return row ? { publicKey: row.publicKey, secret: row.secret } : null
  }
  saveIdentity(identity: IdentityRecord): void {
    this.db
      .insert(remoteIdentityTable)
      .values({ id: IDENTITY_ROW, ...identity, createdAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: remoteIdentityTable.id, set: identity })
      .run()
  }
  relayIdentity(): RelayIdentity | null {
    const row = this.db
      .select()
      .from(remoteIdentityTable)
      .where(eq(remoteIdentityTable.id, IDENTITY_ROW))
      .get()
    return row?.relayMailbox && row.relaySecret
      ? { mailbox: row.relayMailbox, secret: row.relaySecret }
      : null
  }
  /** Stores the relay mailbox, or forgets it; the identity row must exist (the key pair comes first). */
  saveRelayIdentity(relay: RelayIdentity | null): void {
    this.db
      .update(remoteIdentityTable)
      .set({ relayMailbox: relay?.mailbox ?? null, relaySecret: relay?.secret ?? null })
      .where(eq(remoteIdentityTable.id, IDENTITY_ROW))
      .run()
  }
  /** Peers in one role, by name then id, so lists stay in a stable order. */
  peers(role: PeerRole): PeerRecord[] {
    return this.db
      .select()
      .from(remotePeersTable)
      .where(eq(remotePeersTable.role, role))
      .all()
      .map((row) => ({ ...row, role }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.deviceId.localeCompare(b.deviceId))
  }
  peer(deviceId: string, role: PeerRole): PeerRecord | null {
    return this.peers(role).find((peer) => peer.deviceId === deviceId) ?? null
  }
  /** Adds a peer, or replaces it when the device pairs again with a new key. */
  savePeer(peer: PeerRecord): void {
    const { deviceId, role, ...rest } = peer
    this.db
      .insert(remotePeersTable)
      .values(peer)
      .onConflictDoUpdate({
        target: [remotePeersTable.deviceId, remotePeersTable.role],
        set: rest
      })
      .run()
  }
  seen(deviceId: string, role: PeerRole, name: string, at: string): void {
    this.db
      .update(remotePeersTable)
      .set({ lastSeenAt: at, name })
      .where(and(eq(remotePeersTable.deviceId, deviceId), eq(remotePeersTable.role, role)))
      .run()
  }
  /** A host's relay route as this device last received it. */
  saveRelayRoute(
    deviceId: string,
    route: { url: string; mailbox: string; ticket: string } | null
  ): void {
    this.db
      .update(remotePeersTable)
      .set({
        relayUrl: route?.url ?? null,
        relayMailbox: route?.mailbox ?? null,
        relayTicket: route?.ticket ?? null
      })
      .where(and(eq(remotePeersTable.deviceId, deviceId), eq(remotePeersTable.role, 'host')))
      .run()
  }
  /** A client's relay ticket and its hash; null takes its relay access away. */
  saveClientTicket(deviceId: string, ticket: string | null): void {
    this.db
      .update(remotePeersTable)
      .set({ relayTicket: ticket, relayTicketHash: ticket ? relayTicketHash(ticket) : null })
      .where(and(eq(remotePeersTable.deviceId, deviceId), eq(remotePeersTable.role, 'client')))
      .run()
  }
  saveQueueSeq(deviceId: string, role: PeerRole, seq: number): void {
    this.db
      .update(remotePeersTable)
      .set({ queueSeq: seq })
      .where(and(eq(remotePeersTable.deviceId, deviceId), eq(remotePeersTable.role, role)))
      .run()
  }
  /** A client's APNs token and sealed key; null stops its notifications. */
  savePush(deviceId: string, push: { token: string; key: string; sandbox: boolean } | null): void {
    this.db
      .update(remotePeersTable)
      .set({
        pushToken: push?.token ?? null,
        pushKey: push?.key ?? null,
        pushSandbox: push?.sandbox ?? false
      })
      .where(and(eq(remotePeersTable.deviceId, deviceId), eq(remotePeersTable.role, 'client')))
      .run()
  }
  /** APNs said this token is dead: forget it on whichever client had it. */
  dropPushToken(token: string): void {
    this.db
      .update(remotePeersTable)
      .set({ pushToken: null, pushKey: null, pushSandbox: false })
      .where(and(eq(remotePeersTable.pushToken, token), eq(remotePeersTable.role, 'client')))
      .run()
  }
  removePeer(deviceId: string, role: PeerRole): void {
    this.db
      .delete(remotePeersTable)
      .where(and(eq(remotePeersTable.deviceId, deviceId), eq(remotePeersTable.role, role)))
      .run()
  }
}
