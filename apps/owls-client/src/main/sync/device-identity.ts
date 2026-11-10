import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { deviceIdSchema } from '../../shared/app.js'
import { localDeviceTable } from '../app/schema.js'
import type { OwlsStore } from '../app/store.js'

/** The only row of `local_device`. */
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
 * Reads this device's identity, creating it on the first start. The store opens
 * it right after migrating, so a new identity always comes before any record.
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
    return identity
  })
}
