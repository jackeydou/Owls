import { randomBytes } from 'node:crypto'
import { asc, eq, isNull, sql } from 'drizzle-orm'
import { deviceIdSchema } from '../../shared/app.js'
import {
  localDeviceTable,
  memoriesTable,
  memoryCategoriesTable,
  projectsTable,
  sessionsTable,
  threadItemsTable,
  threadsTable,
  workersTable
} from '../app/schema.js'
import type { OwlsStore } from '../app/store.js'
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
export function loadDeviceIdentity(db: OwlsStore['db']): DeviceIdentity {
  return db.transaction((tx) => {
    const row = tx.select().from(localDeviceTable).where(eq(localDeviceTable.id, LOCAL_ROW)).get()
    if (row) return { deviceId: deviceIdSchema.parse(row.deviceId), createdAt: row.createdAt }
    const identity: DeviceIdentity = {
      deviceId: newDeviceId(),
      createdAt: new Date().toISOString()
    }
    tx.insert(localDeviceTable)
      .values({ id: LOCAL_ROW, ...identity })
      .run()
    adoptRecords(tx, identity.deviceId)
    return identity
  })
}

type Tx = Pick<OwlsStore['db'], 'insert' | 'select' | 'update'>

/** Backfills owners and seeds the sync log in a fixed order: by kind, then by version or id. */
function adoptRecords(tx: Tx, deviceId: string): void {
  tx.update(projectsTable)
    .set({ ownerDeviceId: deviceId })
    .where(isNull(projectsTable.ownerDeviceId))
    .run()
  tx.update(threadsTable)
    .set({
      ownerDeviceId: deviceId,
      value: sql`json_set(${threadsTable.value}, '$.deviceId', ${deviceId})`
    })
    .where(isNull(threadsTable.ownerDeviceId))
    .run()
  tx.update(workersTable)
    .set({ ownerDeviceId: deviceId })
    .where(isNull(workersTable.ownerDeviceId))
    .run()
  tx.update(sessionsTable)
    .set({ ownerDeviceId: deviceId })
    .where(isNull(sessionsTable.ownerDeviceId))
    .run()

  const ids = (rows: { id: string }[]) => rows.map((r) => r.id)
  const projects = ids(
    tx.select({ id: projectsTable.id }).from(projectsTable).orderBy(asc(projectsTable.id)).all()
  )
  for (const id of projects) logChange(tx, 'project', id)
  const threads = ids(
    tx
      .select({ id: threadsTable.id })
      .from(threadsTable)
      .orderBy(asc(threadsTable.rev), asc(threadsTable.id))
      .all()
  )
  for (const id of threads) logChange(tx, 'thread', id)
  const items = tx
    .select({ threadId: threadItemsTable.threadId, itemId: threadItemsTable.itemId })
    .from(threadItemsTable)
    .orderBy(
      asc(threadItemsTable.rev),
      asc(threadItemsTable.threadId),
      asc(threadItemsTable.position)
    )
    .all()
  for (const { threadId, itemId } of items) logChange(tx, 'item', itemRecordId(threadId, itemId))
  const workers = ids(
    tx.select({ id: workersTable.id }).from(workersTable).orderBy(asc(workersTable.id)).all()
  )
  for (const id of workers) logChange(tx, 'worker', id)
  const sessions = ids(
    tx.select({ id: sessionsTable.id }).from(sessionsTable).orderBy(asc(sessionsTable.id)).all()
  )
  for (const id of sessions) logChange(tx, 'session', id)
  const categories = ids(
    tx
      .select({ id: memoryCategoriesTable.id })
      .from(memoryCategoriesTable)
      .orderBy(asc(memoryCategoriesTable.rev), asc(memoryCategoriesTable.id))
      .all()
  )
  for (const id of categories) logChange(tx, 'memory-category', id)
  const memories = ids(
    tx
      .select({ id: memoriesTable.id })
      .from(memoriesTable)
      .orderBy(asc(memoriesTable.rev), asc(memoriesTable.id))
      .all()
  )
  for (const id of memories) logChange(tx, 'memory', id)
}
