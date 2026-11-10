import type { AppEvent } from '../../shared/app.js'
import type { RouterWorker } from '../../shared/router.js'

/** How long a thread stays quiet before Dreaming reads it (RFC_OWLS_MEMORY 5.2). */
export const DREAMING_IDLE_MS = 10 * 60 * 1000
/** Startup catch-up waits this long so it does not compete with the app starting. */
export const DREAMING_STARTUP_MS = 60 * 1000
const BUSY: RouterWorker['status'][] = ['queued', 'starting', 'running', 'waiting']

export type TriggerDeps = {
  /** Thread ids with their status. */
  threads: () => { id: string; status: string }[]
  workers: () => RouterWorker[]
  schedule: (threadId: string) => void
  setTimer?: (run: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

/**
 * Starts Dreaming for a thread once it has been idle for a while with no busy
 * workers, and once after startup for threads left unread. Every change to a
 * thread or one of its workers restarts that thread's wait.
 */
export class DreamingTriggers {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private startup: ReturnType<typeof setTimeout> | null = null
  private readonly setTimer: NonNullable<TriggerDeps['setTimer']>
  private readonly clearTimer: NonNullable<TriggerDeps['clearTimer']>

  constructor(private readonly deps: TriggerDeps) {
    this.setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms))
    this.clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer))
    this.startup = this.setTimer(() => {
      this.startup = null
      for (const thread of deps.threads()) this.fire(thread.id)
    }, DREAMING_STARTUP_MS)
  }

  observe(event: AppEvent): void {
    if (event.type === 'router') this.restart(event.router.id)
    else if (event.type === 'worker') this.restart(event.worker.routerId)
  }

  close(): void {
    if (this.startup) this.clearTimer(this.startup)
    this.startup = null
    for (const timer of this.timers.values()) this.clearTimer(timer)
    this.timers.clear()
  }

  private restart(threadId: string): void {
    const previous = this.timers.get(threadId)
    if (previous) this.clearTimer(previous)
    this.timers.set(
      threadId,
      this.setTimer(() => {
        this.timers.delete(threadId)
        this.fire(threadId)
      }, DREAMING_IDLE_MS)
    )
  }

  private fire(threadId: string): void {
    const thread = this.deps.threads().find((t) => t.id === threadId)
    if (!thread || thread.status === 'running') return
    if (this.deps.workers().some((w) => w.routerId === threadId && BUSY.includes(w.status))) return
    this.deps.schedule(threadId)
  }
}
