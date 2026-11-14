import { create } from 'zustand'

type State = {
  /** The thread Dreaming is reading right now, or null. */
  threadId: string | null
}

export const useDreamingStore = create<State>(() => ({ threadId: null }))

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
