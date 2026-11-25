import { create } from 'zustand'
import type { Failure, NotesLocation } from '../../../shared/app'
import type { NotesStorage } from '../../../shared/cards'
import { uiFailure } from '../app/failures'
import { useAppStore } from '../app/store'

type State = {
  storage: NotesStorage | null
  /** Notes iCloud was still downloading when the user last tried to turn sync off. */
  pending: number
  error: Failure | null
  load(): Promise<void>
  /** Moves notes into iCloud or back to this Mac; true once they moved. */
  setLocation(location: NotesLocation): Promise<boolean>
}

/** Settings → Notes: where notes live, and the switch that moves them. */
export const useNotesStorageStore = create<State>((set) => ({
  storage: null,
  pending: 0,
  error: null,
  load: async () => {
    const reply = await window.owlto.cards.storage()
    if (reply.ok) set({ storage: reply.value, error: null })
    else set({ error: reply.error })
  },
  setLocation: async (location) => {
    try {
      const reply = await window.owlto.cards.setStorage(location)
      if (!reply.ok) {
        set({ error: reply.error })
        return false
      }
      const { storage } = reply.value
      if (reply.value.result === 'downloading') {
        set({ storage, pending: reply.value.pending, error: null })
        return false
      }
      set({ storage, pending: 0, error: null })
      useAppStore.setState((s) => ({
        settings: { ...s.settings, notesLocation: storage.location }
      }))
      return true
    } catch (error) {
      set({ error: uiFailure(error) })
      return false
    }
  }
}))
