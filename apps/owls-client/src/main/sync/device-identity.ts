import { randomBytes } from 'node:crypto'
import { asc, eq, isNull, sql } from 'drizzle-orm'
import { deviceIdSchema } from '../../shared/codex.js'
import {
  codexLocalDevice,
  codexMemories,
  codexMemoryCategories,
  codexProjects,
  codexSessions,
  codexThreadItems,
  codexThreads,
  codexWorkers
} from '../codex/schema.js'
import type { CodexStore } from '../codex/store.js'
import { itemRecordId, logChange } from './sync-log.js'

/** The only row of `codex_local_device`. */
const LOCAL_ROW = 'local'

/**
 * This device's identity. It lives in the database next to the records it owns,
 * so a data root and its owner ids always move together. Device keys join it
 * when sync arrives (RFC_OWLS_MULTI_DEVICE 8.3).
 */
export type DeviceIdentity = { deviceId: string; createdAt: string }

export function newDeviceId(): string {
  return `dv_${randomBytes(4).toString('hex')}`
}

/**
 * Reads this device's identity, creating it on the first start. Creating it also
 * gives every existing record this device as its owner and enters each one in
 * the sync log, so the log covers every local record from then on.
 */
export function loadDeviceIdentity(db: CodexStore['db']): DeviceIdentity {
  return db.transaction((tx) => {
    const row = tx.select().from(codexLocalDevice).where(eq(codexLocalDevice.id, LOCAL_ROW)).get()
    if (row) return { deviceId: deviceIdSchema.parse(row.deviceId), createdAt: row.createdAt }
    const identity: DeviceIdentity = {
      deviceId: newDeviceId(),
      createdAt: new Date().toISOString()
    }
    tx.insert(codexLocalDevice)
      .values({ id: LOCAL_ROW, ...identity })
      .run()
    adoptRecords(tx, identity.deviceId)
    return identity
  })
}

type Tx = Pick<CodexStore['db'], 'insert' | 'select' | 'update'>

/** Backfills owners and seeds the sync log in a fixed order: by kind, then by version or id. */
function adoptRecords(tx: Tx, deviceId: string): void {
  tx.update(codexProjects)
    .set({ ownerDeviceId: deviceId })
    .where(isNull(codexProjects.ownerDeviceId))
    .run()
  tx.update(codexThreads)
    .set({
      ownerDeviceId: deviceId,
      value: sql`json_set(${codexThreads.value}, '$.deviceId', ${deviceId})`
    })
    .where(isNull(codexThreads.ownerDeviceId))
    .run()
  tx.update(codexWorkers)
    .set({ ownerDeviceId: deviceId })
    .where(isNull(codexWorkers.ownerDeviceId))
    .run()
  tx.update(codexSessions)
    .set({ ownerDeviceId: deviceId })
    .where(isNull(codexSessions.ownerDeviceId))
    .run()

  const ids = (rows: { id: string }[]) => rows.map((r) => r.id)
  const projects = ids(
    tx.select({ id: codexProjects.id }).from(codexProjects).orderBy(asc(codexProjects.id)).all()
  )
  for (const id of projects) logChange(tx, 'project', id)
  const threads = ids(
    tx
      .select({ id: codexThreads.id })
      .from(codexThreads)
      .orderBy(asc(codexThreads.rev), asc(codexThreads.id))
      .all()
  )
  for (const id of threads) logChange(tx, 'thread', id)
  const items = tx
    .select({ threadId: codexThreadItems.threadId, itemId: codexThreadItems.itemId })
    .from(codexThreadItems)
    .orderBy(
      asc(codexThreadItems.rev),
      asc(codexThreadItems.threadId),
      asc(codexThreadItems.position)
    )
    .all()
  for (const { threadId, itemId } of items) logChange(tx, 'item', itemRecordId(threadId, itemId))
  const workers = ids(
    tx.select({ id: codexWorkers.id }).from(codexWorkers).orderBy(asc(codexWorkers.id)).all()
  )
  for (const id of workers) logChange(tx, 'worker', id)
  const sessions = ids(
    tx.select({ id: codexSessions.id }).from(codexSessions).orderBy(asc(codexSessions.id)).all()
  )
  for (const id of sessions) logChange(tx, 'session', id)
  const categories = ids(
    tx
      .select({ id: codexMemoryCategories.id })
      .from(codexMemoryCategories)
      .orderBy(asc(codexMemoryCategories.rev), asc(codexMemoryCategories.id))
      .all()
  )
  for (const id of categories) logChange(tx, 'memory-category', id)
  const memories = ids(
    tx
      .select({ id: codexMemories.id })
      .from(codexMemories)
      .orderBy(asc(codexMemories.rev), asc(codexMemories.id))
      .all()
  )
  for (const id of memories) logChange(tx, 'memory', id)
}
