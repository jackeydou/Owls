import { create } from 'zustand'
import type { LocalFeatureGateState } from '../../../shared/feature-gates'

type FeatureGateState = {
  gates: LocalFeatureGateState[]
  loaded: boolean
  busyKey: LocalFeatureGateState['key'] | null
  error: string | null
  load: () => Promise<void>
  setEnabled: (featureKey: LocalFeatureGateState['key'], enabled: boolean) => Promise<void>
  isFeatureGated: (featureKey: LocalFeatureGateState['key']) => boolean
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useFeatureGateStore = create<FeatureGateState>((set, get) => ({
  gates: [],
  loaded: false,
  busyKey: null,
  error: null,

  load: async () => {
    set({ error: null })
    try {
      const gates = await window.api.featureGates.list()
      set({ gates, loaded: true, error: null })
    } catch (error) {
      set({ loaded: true, error: errorMessage(error) })
    }
  },

  setEnabled: async (featureKey, enabled) => {
    set({ busyKey: featureKey, error: null })
    try {
      const updated = await window.api.featureGates.setEnabled(featureKey, enabled)
      set({
        busyKey: null,
        gates: get().gates.map((gate) => (gate.key === updated.key ? updated : gate))
      })
    } catch (error) {
      set({ busyKey: null, error: errorMessage(error) })
      throw error
    }
  },

  isFeatureGated: (featureKey) => {
    const gate = get().gates.find((candidate) => candidate.key === featureKey)
    return gate?.enabled ?? false
  }
}))
