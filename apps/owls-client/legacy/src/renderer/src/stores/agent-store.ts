import { create } from 'zustand'

type AgentStore = {
  hasSession: boolean
  sessionId: string | null
  error: string | null
  refreshStatus: () => Promise<void>
}

export const useAgentStore = create<AgentStore>((set) => ({
  hasSession: false,
  sessionId: null,
  error: null,

  refreshStatus: async () => {
    try {
      const { hasSession, sessionId } = await window.api.agent.status()
      set({ hasSession, sessionId, error: null })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  }
}))
