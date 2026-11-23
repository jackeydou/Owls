import { create } from 'zustand'

/** A check the user asked for shows "Checking" at least this long, so a fast reply still reads. */
const MIN_CHECKING_MS = 700

type UpdateNoticeState = {
  /** The user chose Check for Updates, so the notice shows every step, not only a ready update. */
  manual: boolean
  /** The manual check has not answered yet (or answered within `MIN_CHECKING_MS`). */
  checking: boolean
  /** The ready version the user hid; a newer staged version shows the notice again. */
  dismissedVersion: string | null
  /** Runs a check and opens the notice in the bottom-right corner to follow it. */
  check: () => Promise<void>
  /** Hides the notice; a ready update stays hidden until a newer one is staged. */
  close: (readyVersion: string | null) => void
}

let checkRun = 0

export const useUpdateNoticeStore = create<UpdateNoticeState>((set) => ({
  manual: false,
  checking: false,
  dismissedVersion: null,
  check: async () => {
    const run = ++checkRun
    set({ manual: true, checking: true })
    const minimum = new Promise((resolve) => setTimeout(resolve, MIN_CHECKING_MS))
    // The result arrives through `onChanged` as well; a failed reply shows the snapshot as it is.
    await Promise.all([window.owlto.updates.check().catch(() => null), minimum])
    if (run === checkRun) set({ checking: false })
  },
  close: (readyVersion) => {
    checkRun++
    set((state) => ({
      manual: false,
      checking: false,
      dismissedVersion: readyVersion ?? state.dismissedVersion
    }))
  }
}))
