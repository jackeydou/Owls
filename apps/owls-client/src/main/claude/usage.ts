import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeAccount } from '../../shared/app.js'
import { type AgentUsage, percent, type UsageWindow } from '../../shared/usage.js'

type Limits = NonNullable<SDKControlGetUsageResponse['rate_limits']>
type Bucket = { utilization: number | null; resets_at: string | null } | null | undefined

function bucket(
  value: Bucket,
  kind: UsageWindow['kind'],
  windowMinutes: number,
  label: string | null = null
): UsageWindow | null {
  const used = percent(value?.utilization)
  if (!value || used === null) return null
  return { kind, label, windowMinutes, usedPercent: used, resetsAt: value.resets_at ?? null }
}

/** Per-model weekly windows: the server's own list when it sent one, else the fixed fields. */
function modelWindows(limits: Limits): Array<UsageWindow | null> {
  if (limits.model_scoped)
    return limits.model_scoped.map((m) => bucket(m, 'model', 10_080, m.display_name))
  return [
    bucket(limits.seven_day_opus, 'model', 10_080, 'Opus'),
    bucket(limits.seven_day_sonnet, 'model', 10_080, 'Sonnet')
  ]
}

/**
 * Reads the CLI's structured `/usage` answer: the claude.ai plan's 5-hour and
 * weekly windows, per-model weekly windows, and extra usage. Accounts without
 * plan limits (API key, Bedrock, Vertex) report none.
 */
export function parseClaudeUsage(
  response: SDKControlGetUsageResponse,
  account: ClaudeAccount
): AgentUsage {
  const plan = response.subscription_type ?? (account.kind === 'claude' ? account.plan : null)
  const limits = response.rate_limits
  if (!response.rate_limits_available || !limits)
    return {
      provider: 'claude-code',
      state: 'unavailable',
      reason: account.kind === 'api-key' ? 'api-key' : 'no-plan-limits',
      plan
    }
  const windows = [
    bucket(limits.five_hour, 'session', 300),
    bucket(limits.seven_day, 'weekly', 10_080),
    ...modelWindows(limits)
  ].filter((w): w is UsageWindow => w !== null)
  const extra = limits.extra_usage
  return {
    provider: 'claude-code',
    state: 'ready',
    plan,
    windows,
    spend: extra ? { enabled: extra.is_enabled, usedPercent: percent(extra.utilization) } : null,
    credits: null,
    fetchedAt: new Date().toISOString()
  }
}
