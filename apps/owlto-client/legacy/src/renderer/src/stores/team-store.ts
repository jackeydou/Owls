import { create } from 'zustand'
import type { TeamAgentDefinition, TeamEvent, TeamStatus } from '../../../preload/index.d'

type TeamState = {
  open: boolean
  loaded: boolean
  status: TeamStatus | null
  agents: TeamAgentDefinition[]
  events: TeamEvent[]
  unsubscribeEvents: (() => void) | null
  toggleOpen: () => void
  bindEvents: () => void
  refreshStatus: () => Promise<void>
  loadAgents: () => Promise<void>
  createTeam: (teamName: string, cwd?: string) => Promise<void>
  destroyTeam: () => Promise<void>
}

export const useTeamStore = create<TeamState>((set, get) => ({
  open: false,
  loaded: false,
  status: null,
  agents: [],
  events: [],
  unsubscribeEvents: null,

  toggleOpen: () => set((state) => ({ open: !state.open })),

  bindEvents: () => {
    get().unsubscribeEvents?.()
    const off = window.api.team.onEvent((payload) => {
      const event = payload as TeamEvent
      set((state) => ({
        events: [...state.events.slice(-99), event]
      }))
      void get().refreshStatus()
    })
    set({ unsubscribeEvents: off })
  },

  refreshStatus: async () => {
    const status = await window.api.team.status()
    set({ status, loaded: true })
  },

  loadAgents: async () => {
    const agents = await window.api.team.listAgents()
    set({ agents })
  },

  createTeam: async (teamName, cwd) => {
    const status = await window.api.team.create(teamName, cwd)
    set({ status, loaded: true, open: true })
  },

  destroyTeam: async () => {
    await window.api.team.destroy()
    set({ status: null })
  }
}))
