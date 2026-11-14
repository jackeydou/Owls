import { create } from 'zustand'

type UiOverlayState = {
  blockingOverlayIds: string[]
  hasBlockingOverlay: boolean
  pushBlockingOverlay: (id: string) => void
  popBlockingOverlay: (id: string) => void
}

export const useUiOverlayStore = create<UiOverlayState>((set) => ({
  blockingOverlayIds: [],
  hasBlockingOverlay: false,
  pushBlockingOverlay: (id) =>
    set((state) => {
      if (state.blockingOverlayIds.includes(id)) return state
      const blockingOverlayIds = [...state.blockingOverlayIds, id]
      return {
        blockingOverlayIds,
        hasBlockingOverlay: blockingOverlayIds.length > 0
      }
    }),
  popBlockingOverlay: (id) =>
    set((state) => {
      const blockingOverlayIds = state.blockingOverlayIds.filter((currentId) => currentId !== id)
      return {
        blockingOverlayIds,
        hasBlockingOverlay: blockingOverlayIds.length > 0
      }
    })
}))
