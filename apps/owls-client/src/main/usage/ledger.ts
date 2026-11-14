import { asc, gte, type SQL, sql } from 'drizzle-orm'
import {
  emptyTokenCounts,
  type TokenCounts,
  totalTokens,
  type UsageDay,
  type UsageEntry,
  type UsageGroup,
  type UsageRange,
  type UsageStats,
  type UsageTotals
} from '../../shared/usage-stats.js'
import { usageEventsTable } from '../app/schema.js'
import type { OwlsStore } from '../app/store.js'

const RANGE_DAYS: Record<Exclude<UsageRange, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 }

const t = usageEventsTable
const sums = {
  input: sql<number>`coalesce(sum(${t.input}), 0)`,
  output: sql<number>`coalesce(sum(${t.output}), 0)`,
  cacheRead: sql<number>`coalesce(sum(${t.cacheRead}), 0)`,
  cacheWrite: sql<number>`coalesce(sum(${t.cacheWrite}), 0)`,
  reasoning: sql<number>`coalesce(sum(${t.reasoning}), 0)`
}
const priced = {
  costUsd: sql<number>`coalesce(sum(${t.costUsd}), 0)`,
  unpricedTokens: sql<number>`coalesce(sum(case when ${t.costUsd} is null then ${t.input} + ${t.output} + ${t.cacheRead} + ${t.cacheWrite} else 0 end), 0)`
}
const keys = {
  agent: sql<string | null>`${t.agent}`,
  role: sql<string | null>`${t.role}`,
  model: sql<string | null>`${t.model}`,
  project: sql<string | null>`${t.projectId}`
}
// SQLite's own local date, so days follow the user's time zone like `localDay`.
const localDate = sql<string>`date(${t.at}, 'localtime')`

/** `YYYY-MM-DD` of a time in the local time zone. */
export function localDay(time: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`
}

const countsOf = (row: TokenCounts): TokenCounts => ({
  input: row.input,
  output: row.output,
  cacheRead: row.cacheRead,
  cacheWrite: row.cacheWrite,
  reasoning: row.reasoning
})
const clean = (value: number) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0)

/**
 * Keeps the token usage agents report, one row per turn and model, and sums it
 * for the Settings usage page. Rows stay on this device.
 */
export class UsageLedger {
  private readonly now: () => Date
  constructor(
    private readonly store: Pick<OwlsStore, 'db'>,
    now?: () => Date
  ) {
    this.now = now ?? (() => new Date())
  }

  /** Saves one entry; entries without any tokens are skipped. */
  record(entry: UsageEntry): void {
    const counts: TokenCounts = {
      input: clean(entry.input),
      output: clean(entry.output),
      cacheRead: clean(entry.cacheRead),
      cacheWrite: clean(entry.cacheWrite),
      reasoning: Math.min(clean(entry.reasoning), clean(entry.output))
    }
    if (totalTokens(counts) === 0) return
    const cost = entry.costUsd
    this.store.db
      .insert(t)
      .values({
        at: this.now().toISOString(),
        agent: entry.agent,
        role: entry.role,
        model: entry.model?.slice(0, 200) || null,
        projectId: entry.projectId,
        ...counts,
        costUsd: cost !== null && Number.isFinite(cost) && cost >= 0 ? cost : null
      })
      .run()
  }

  stats(range: UsageRange): UsageStats {
    const now = this.now()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let start: Date | null =
      range === 'all'
        ? null
        : new Date(today.getFullYear(), today.getMonth(), today.getDate() - RANGE_DAYS[range] + 1)
    const where = start ? gte(t.at, start.toISOString()) : undefined
    const group = (key: SQL<string | null>): UsageGroup[] =>
      this.store.db
        .select({ key, ...sums, ...priced })
        .from(t)
        .where(where)
        .groupBy(key)
        .all()
        .map((row) => ({ ...row, key: row.key ?? null }))
        .sort((a, b) => totalTokens(b) - totalTokens(a) || (a.key ?? '').localeCompare(b.key ?? ''))
    const byAgent = group(keys.agent)
    const totals: UsageTotals = { ...emptyTokenCounts(), costUsd: 0, unpricedTokens: 0 }
    for (const row of byAgent) {
      for (const key of Object.keys(sums) as (keyof TokenCounts)[]) totals[key] += row[key]
      totals.costUsd += row.costUsd
      totals.unpricedTokens += row.unpricedTokens
    }
    const recorded = this.store.db
      .select({ day: localDate, ...sums })
      .from(t)
      .where(where)
      .groupBy(localDate)
      .orderBy(asc(localDate))
      .all()
    if (!start && recorded[0]) {
      const [y, m, d] = recorded[0].day.split('-').map(Number)
      start = new Date(y, m - 1, d)
    }
    const byDay = new Map<string, TokenCounts>(recorded.map((row) => [row.day, countsOf(row)]))
    const days: UsageDay[] = []
    if (start)
      for (
        let day = start;
        day <= today;
        day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
      ) {
        const key = localDay(day)
        const row = byDay.get(key)
        days.push({ ...(row ?? emptyTokenCounts()), day: key })
      }
    return {
      range,
      since: start ? localDay(start) : null,
      totals,
      days,
      byAgent,
      byRole: group(keys.role),
      byModel: group(keys.model),
      byProject: group(keys.project)
    }
  }
}
