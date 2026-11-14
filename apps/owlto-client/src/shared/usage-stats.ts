import { z } from 'zod'

/** Who ran a model call: a worker provider, or the Owlto Router engine with the user's API key. */
export const usageAgentSchema = z.enum(['claude-code', 'codex', 'cursor', 'owlto'])
/** What the call was for. */
export const usageRoleSchema = z.enum(['router', 'worker', 'dreaming'])
export const usageRangeSchema = z.enum(['7d', '30d', '90d', 'all'])

export type UsageAgent = z.infer<typeof usageAgentSchema>
export type UsageRole = z.infer<typeof usageRoleSchema>
export type UsageRange = z.infer<typeof usageRangeSchema>

/**
 * Tokens of one or more model calls. `input` is new input only, without cache
 * reads or writes; `reasoning` is the part of `output` spent thinking.
 */
export type TokenCounts = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
}

/** Usage an agent reported for part of a turn, for one model. */
export type TurnUsage = TokenCounts & {
  /** The model the agent named; null when it did not say. */
  model: string | null
  /** The agent's own cost estimate in USD; null when it gives none. */
  costUsd: number | null
}

/** One recorded row: a turn's usage for one model, with who ran it and where. */
export type UsageEntry = TurnUsage & {
  agent: UsageAgent
  role: UsageRole
  projectId: string | null
}

export type UsageTotals = TokenCounts & {
  /** Sum of the reported costs. */
  costUsd: number
  /** Tokens whose agent reported no cost, so `costUsd` leaves them out. */
  unpricedTokens: number
}

/** Totals for one local calendar day, `YYYY-MM-DD`. */
export type UsageDay = TokenCounts & { day: string }

/** Totals for one group; `key` is null for rows with no model or no project. */
export type UsageGroup = UsageTotals & { key: string | null }

/** What the usage page asks for: a range, and one agent or every agent (null). */
export const usageStatsRequestSchema = z.object({
  range: usageRangeSchema,
  agent: usageAgentSchema.nullable()
})
export type UsageStatsRequest = z.infer<typeof usageStatsRequestSchema>

export type UsageStats = {
  range: UsageRange
  /** The agent the numbers are for; null for every agent. */
  agent: UsageAgent | null
  /** Agents with any recorded usage, in a fixed order, for the agent filter. */
  agents: UsageAgent[]
  /** First day of the range, `YYYY-MM-DD`; for `all`, the first recorded day or null when empty. */
  since: string | null
  totals: UsageTotals
  /** Every day of the range in order, days without usage included. */
  days: UsageDay[]
  byAgent: UsageGroup[]
  byRole: UsageGroup[]
  byModel: UsageGroup[]
  /** Project ids; the renderer names them from the project list. */
  byProject: UsageGroup[]
}

export const emptyTokenCounts = (): TokenCounts => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0
})

/** All tokens the model read or wrote; `reasoning` is already inside `output`. */
export const totalTokens = (counts: TokenCounts): number =>
  counts.input + counts.output + counts.cacheRead + counts.cacheWrite

/** Share of input tokens served from the cache, 0-1; null without input. */
export function cacheHitRate(counts: TokenCounts): number | null {
  const input = counts.input + counts.cacheRead + counts.cacheWrite
  return input > 0 ? counts.cacheRead / input : null
}
