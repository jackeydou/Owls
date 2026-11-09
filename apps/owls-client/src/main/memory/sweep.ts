/** The first sweep waits this long so it stays off the startup path. */
export const MEMORY_SWEEP_STARTUP_MS = 10 * 1000
/** Later sweeps run once a day (RFC_OWLS_MEMORY 4). */
export const MEMORY_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

export type SweeperDeps = {
  sweep: () => void
  setTimer?: (run: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

/**
 * Runs the memory sweep shortly after startup and then daily. It runs whether
 * or not learning is on: expiry and tombstone cleanup do not call a model.
 */
export class MemorySweeper {
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private readonly setTimer: NonNullable<SweeperDeps['setTimer']>
  private readonly clearTimer: NonNullable<SweeperDeps['clearTimer']>

  constructor(private readonly deps: SweeperDeps) {
    this.setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms))
    this.clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer))
    this.next(MEMORY_SWEEP_STARTUP_MS)
  }

  close(): void {
    this.closed = true
    if (this.timer) this.clearTimer(this.timer)
    this.timer = null
  }

  private next(ms: number): void {
    this.timer = this.setTimer(() => {
      this.timer = null
      try {
        this.deps.sweep()
      } catch {
        // A failed sweep, such as one that met a closing database, retries on the next day.
      }
      if (!this.closed) this.next(MEMORY_SWEEP_INTERVAL_MS)
    }, ms)
  }
}
