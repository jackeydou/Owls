import type { ActionOutcome } from '@renderer/components/ui/use-action'
import { create } from 'zustand'
import type { MemoryRun } from '../../../shared/memory'

/** What a manual Dreaming run ended with, shown at the end of its thread for a moment. */
export type DreamNotice = { threadId: string; kind: 'nothing' | 'failed'; run: MemoryRun | null }

type State = {
  /** The thread Dreaming is reading right now, or null. */
  threadId: string | null
  /** The thread the user asked to dream over; it takes no input until the run ends. */
  lockedThreadId: string | null
  notice: DreamNotice | null
  /** Dreams over one thread now; throws when the request or the run failed. */
  dreamThread(threadId: string): Promise<ActionOutcome>
  clearNotice(): void
}

const NOTICE_MS = 5000
let noticeTimer: ReturnType<typeof setTimeout> | null = null

export const useDreamingStore = create<State>((set, get) => {
  function notify(notice: DreamNotice) {
    if (noticeTimer) clearTimeout(noticeTimer)
    set({ notice })
    noticeTimer = setTimeout(() => get().clearNotice(), NOTICE_MS)
  }
  return {
    threadId: null,
    lockedThreadId: null,
    notice: null,
    async dreamThread(threadId) {
      if (get().lockedThreadId) return 'quiet'
      set({ lockedThreadId: threadId, notice: null })
      try {
        const reply = await window.owlto.memory.dreamThread(threadId)
        if (!reply.ok) {
          notify({ threadId, kind: 'failed', run: null })
          throw new Error(reply.error.message)
        }
        const run = reply.value
        if (!run) {
          notify({ threadId, kind: 'nothing', run: null })
          return 'quiet'
        }
        if (run.status !== 'completed') {
          notify({ threadId, kind: 'failed', run })
          throw new Error(run.error?.message ?? '')
        }
        return 'done'
      } finally {
        set({ lockedThreadId: null })
      }
    },
    clearNotice() {
      if (noticeTimer) clearTimeout(noticeTimer)
      noticeTimer = null
      set({ notice: null })
    }
  }
})

/** Newer reads win, so a slow reply cannot bring back a run that already ended. */
let generation = 0

async function read(): Promise<void> {
  const mine = ++generation
  const reply = await window.owlto.memory.overview()
  if (mine !== generation) return
  // Memory is off or not ready: no thread is dreaming.
  useDreamingStore.setState({ threadId: reply.ok ? reply.value.dreamingThreadId : null })
}

/** Follows which thread Dreaming is on; the main process signals each run's start and end. */
export function watchDreaming(): () => void {
  void read()
  return window.owlto.memory.onChanged(() => void read())
}

/** True while Dreaming reads this thread. */
export const useDreaming = (threadId: string | null | undefined): boolean =>
  useDreamingStore((s) => threadId != null && s.threadId === threadId)

/** True while the user's own Dreaming request holds this thread. */
export const useDreamLocked = (threadId: string | null | undefined): boolean =>
  useDreamingStore((s) => threadId != null && s.lockedThreadId === threadId)
