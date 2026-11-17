import { create } from 'zustand'

/** Whether the full-screen onboarding is showing. Where the user stands is `settings.onboarding`. */
export const useOnboardingStore = create<{
  open: boolean
  show(): void
  hide(): void
}>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false })
}))
