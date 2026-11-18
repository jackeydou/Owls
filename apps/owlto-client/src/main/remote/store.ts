import { and, eq } from 'drizzle-orm'
import { remoteIdentityTable, remotePeersTable } from '../app/schema.js'
import type { OwltoStore } from '../app/store.js'

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
}
export type IdentityRecord = { publicKey: string; secret: string }

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
  removePeer(deviceId: string, role: PeerRole): void {
    this.db
      .delete(remotePeersTable)
      .where(and(eq(remotePeersTable.deviceId, deviceId), eq(remotePeersTable.role, role)))
      .run()
  }
}
