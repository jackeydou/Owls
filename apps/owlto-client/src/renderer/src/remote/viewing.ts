import { create } from 'zustand'

/**
 * Whose Router the window shows: null is this Mac, otherwise a paired device's id.
 * It is its own tiny store so the app store and the backend can read it without
 * importing each other.
 */
export const useViewingStore = create<{ deviceId: string | null }>(() => ({ deviceId: null }))

export function viewingDevice(): string | null {
  return useViewingStore.getState().deviceId
}
/** True while the window shows another device's Router. */
export function useViewingRemote(): boolean {
  return useViewingStore((s) => s.deviceId !== null)
}
