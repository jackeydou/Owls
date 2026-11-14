import type { AgentProvider } from './app.js'

/**
 * One plan limit window as the agent reports it. `kind` drives the label:
 * `session` is the rolling 5-hour window, `weekly` the 7-day one, `model` a
 * weekly window scoped to one model family (named by `label`), and `window`
 * any other duration (`windowMinutes`).
 */
export type UsageWindow = {
  kind: 'session' | 'weekly' | 'model' | 'window'
  label: string | null
  windowMinutes: number | null
  /** Share of the window already used, 0-100. */
  usedPercent: number
  /** ISO 8601 time the window resets; null when the agent did not say. */
  resetsAt: string | null
}

/** Pay-as-you-go spend past the plan, such as Claude's extra usage. */
export type UsageSpend = {
  enabled: boolean
  /** Share of the monthly spend limit used, 0-100; null without a limit. */
  usedPercent: number | null
}

/** Prepaid credits, such as Codex credits on a ChatGPT plan. */
export type UsageCredits = {
  hasCredits: boolean
  unlimited: boolean
  /** The balance as the agent formats it; null when it sent none. */
  balance: string | null
}

/**
 * Why an agent cannot show plan usage. `api-key` and `no-plan-limits` mean the
 * account bills per request, so there is no window to show.
 */
export type UsageUnavailable =
  | 'not-connected'
  | 'signed-out'
  | 'api-key'
  | 'no-plan-limits'
  | 'not-supported'
  | 'failed'

export type AgentUsage =
  | {
      provider: AgentProvider
      state: 'ready'
      plan: string | null
      windows: UsageWindow[]
      spend: UsageSpend | null
      credits: UsageCredits | null
      /** ISO 8601 time the agent answered. */
      fetchedAt: string
    }
  | {
      provider: AgentProvider
      state: 'unavailable'
      reason: UsageUnavailable
      plan: string | null
    }

/** Every worker agent's usage, in a fixed provider order. */
export type UsageOverview = { agents: AgentUsage[] }

export function unavailableUsage(
  provider: AgentProvider,
  reason: UsageUnavailable,
  plan: string | null = null
): AgentUsage {
  return { provider, state: 'unavailable', reason, plan }
}

/** Clamps a reported percentage into 0-100; null for anything that is not a finite number. */
export function percent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, value))
}

/** Names a window by its duration: 5 hours is the session window, 7 days the weekly one. */
export function windowKind(minutes: number | null): UsageWindow['kind'] {
  if (minutes === 300) return 'session'
  if (minutes === 10_080) return 'weekly'
  return 'window'
}
