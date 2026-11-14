import { create } from 'zustand'
import type { AgentUsage, UsageOverview, UsageWindow } from '../../../shared/usage'

type State = {
  /** Null until the first read answers. */
  overview: UsageOverview | null
  loading: boolean
  /** True when the last read failed outright; the previous answer stays on screen. */
  failed: boolean
  /** When the shown answer arrived, for the "Updated" line. */
  updatedAt: number | null
  /** `refresh` asks every agent again instead of reusing the last minute's answer. */
  load(refresh: boolean): Promise<'done' | 'quiet'>
}

/** Newer reads win, so a slow reply cannot replace a newer one. */
let generation = 0

export const useUsageStore = create<State>((set) => ({
  overview: null,
  loading: false,
  failed: false,
  updatedAt: null,
  load: async (refresh) => {
    const current = ++generation
    set({ loading: true })
    const reply = await window.owls.agentUsage(refresh).catch(() => null)
    if (current !== generation) return 'quiet'
    if (reply?.ok) {
      set({ overview: reply.value, loading: false, failed: false, updatedAt: Date.now() })
      return 'done'
    }
    set({ loading: false, failed: true })
    throw new Error('usage_failed')
  }
}))

/** How often the sidebar summary asks again; the host keeps answers for a minute. */
const SUMMARY_REFRESH_MS = 5 * 60_000

/** Reads now and then every few minutes for the sidebar summary; the return stops it. */
export function watchUsage(): () => void {
  const read = () => {
    useUsageStore
      .getState()
      .load(false)
      .catch(() => {
        /* The summary keeps the last answer; the panel shows the failure. */
      })
  }
  read()
  const timer = setInterval(read, SUMMARY_REFRESH_MS)
  return () => clearInterval(timer)
}

export type UsageSummaryRow = {
  usage: Extract<AgentUsage, { state: 'ready' }>
  window: UsageWindow
}

/** Each reporting agent's most-used window: the one that runs out first. */
export function usageSummaryRows(overview: UsageOverview | null): UsageSummaryRow[] {
  const rows: UsageSummaryRow[] = []
  for (const usage of overview?.agents ?? []) {
    if (usage.state !== 'ready') continue
    const window = usage.windows.reduce<UsageWindow | null>(
      (top, w) => (!top || w.usedPercent > top.usedPercent ? w : top),
      null
    )
    if (window) rows.push({ usage, window })
  }
  return rows
}
