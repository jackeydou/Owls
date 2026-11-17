import { readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import type { AnalyticsIdentity } from './service.js'

const identitySchema = z.object({
  distinctId: z.string().uuid(),
  firstSeenAt: z.string().datetime()
})

/** The saved install id, or null when there is none or the file is unreadable. */
export function loadIdentity(path: string): AnalyticsIdentity | null {
  try {
    return identitySchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

export function saveIdentity(path: string, identity: AnalyticsIdentity): void {
  try {
    writeFileSync(path, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 })
  } catch {
    // Without the file the next launch counts as a new install; analytics must never break startup.
  }
}
