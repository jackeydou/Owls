import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeAccount } from '../../shared/app.js'
import {
  type AgentUsage,
  percent,
  type UsageUnavailable,
  type UsageWindow
} from '../../shared/usage.js'

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
 * Why the CLI sent no windows. Plan limits that apply but did not arrive mean
 * the usage endpoint failed for now (rate limited or offline). A CLI with no
 * claude.ai login and no API key is signed out, which also reports limits as
 * unavailable, so it must not read as a plan without limits.
 */
function missingReason(
  response: SDKControlGetUsageResponse,
  account: ClaudeAccount
): UsageUnavailable {
  if (response.rate_limits_available) return 'failed'
  if (account.kind === 'api-key') return 'api-key'
  if (account.kind === 'unknown' && !response.subscription_type) return 'signed-out'
  return 'no-plan-limits'
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
      reason: missingReason(response, account),
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
