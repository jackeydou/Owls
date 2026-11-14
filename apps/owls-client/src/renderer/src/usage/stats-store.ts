import { create } from 'zustand'
import type { UsageAgent, UsageRange, UsageStats } from '../../../shared/usage-stats'

export type UsageGroupBy = 'agent' | 'model' | 'project' | 'role'

type State = {
  range: UsageRange
  /** One agent's numbers, or every agent's (null). */
  agent: UsageAgent | null
  groupBy: UsageGroupBy
  /** The answer for `range`; null until the first read answers. */
  stats: UsageStats | null
  loading: boolean
  /** True when the last read failed; the previous answer stays on screen. */
  failed: boolean
  setRange(range: UsageRange): void
  setAgent(agent: UsageAgent | null): void
  setGroupBy(groupBy: UsageGroupBy): void
  load(): Promise<'done' | 'quiet'>
}

/** Newer reads win, so a slow reply for an old range cannot replace a newer one. */
let generation = 0

export const useUsageStatsStore = create<State>((set, get) => ({
  range: '30d',
  agent: null,
  groupBy: 'agent',
  stats: null,
  loading: false,
  failed: false,
  setRange: (range) => {
    set({ range })
    void get()
      .load()
      .catch(() => {
        /* The page shows the failure. */
      })
  },
  setAgent: (agent) => {
    // A single agent's numbers have nothing to group by agent.
    set((state) => ({
      agent,
      groupBy: agent && state.groupBy === 'agent' ? 'model' : state.groupBy
    }))
    void get()
      .load()
      .catch(() => {
        /* The page shows the failure. */
      })
  },
  setGroupBy: (groupBy) => set({ groupBy }),
  load: async () => {
    const current = ++generation
    set({ loading: true })
    const reply = await window.owls
      .usageStats({ range: get().range, agent: get().agent })
      .catch(() => null)
    if (current !== generation) return 'quiet'
    if (reply?.ok) {
      set({ stats: reply.value, loading: false, failed: false })
      return 'done'
    }
    set({ loading: false, failed: true })
    throw new Error('usage_stats_failed')
  }
}))
