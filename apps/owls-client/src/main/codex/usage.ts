import { z } from 'zod'
import { type AgentUsage, percent, type UsageWindow, windowKind } from '../../shared/usage.js'

const windowSchema = z
  .object({
    usedPercent: z.number(),
    windowDurationMins: z.number().nullish(),
    /** Unix seconds. */
    resetsAt: z.number().nullish()
  })
  .nullish()
const snapshotSchema = z.object({
  primary: windowSchema,
  secondary: windowSchema,
  credits: z
    .object({
      hasCredits: z.boolean(),
      unlimited: z.boolean(),
      balance: z.string().nullish()
    })
    .nullish(),
  planType: z.string().nullish()
})
const responseSchema = z.object({ rateLimits: snapshotSchema })

function usageWindow(value: z.infer<typeof windowSchema>): UsageWindow | null {
  const used = percent(value?.usedPercent)
  if (!value || used === null) return null
  const minutes = value.windowDurationMins ?? null
  return {
    kind: windowKind(minutes),
    label: null,
    windowMinutes: minutes,
    usedPercent: used,
    resetsAt: value.resetsAt ? new Date(value.resetsAt * 1000).toISOString() : null
  }
}

/**
 * Reads the app-server's `account/rateLimits/read` answer: the ChatGPT plan's
 * primary (usually 5-hour) and secondary (usually weekly) windows plus credits.
 */
export function parseCodexRateLimits(value: unknown, plan: string | null): AgentUsage {
  const limits = responseSchema.parse(value).rateLimits
  const windows = [usageWindow(limits.primary), usageWindow(limits.secondary)]
    .filter((w): w is UsageWindow => w !== null)
    .sort((a, b) => (a.windowMinutes ?? 0) - (b.windowMinutes ?? 0))
  return {
    provider: 'codex',
    state: 'ready',
    plan: limits.planType ?? plan,
    windows,
    spend: null,
    credits: limits.credits
      ? {
          hasCredits: limits.credits.hasCredits,
          unlimited: limits.credits.unlimited,
          balance: limits.credits.balance ?? null
        }
      : null,
    fetchedAt: new Date().toISOString()
  }
}
