import { create } from 'zustand'
import type { UsageOverview } from '../../../shared/usage'

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
