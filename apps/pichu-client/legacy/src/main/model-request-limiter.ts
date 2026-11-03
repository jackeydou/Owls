type QueueEntry = {
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  abortListener?: () => void
  queueTimer?: NodeJS.Timeout
}

export type ModelRequestLimiterOptions = {
  maxConcurrentRequests: number
  maxRequestsPerWindow: number
  windowMs: number
  maxQueuedRequests: number
  maxQueueWaitMs: number
}

export class ModelRequestLimiter {
  private activeRequests = 0
  private readonly startTimes: number[] = []
  private readonly queue: QueueEntry[] = []
  private drainTimer: NodeJS.Timeout | null = null
  private readonly options: ModelRequestLimiterOptions

  constructor(options: ModelRequestLimiterOptions) {
    if (options.maxConcurrentRequests < 1) {
      throw new Error('maxConcurrentRequests must be at least 1')
    }
    if (options.maxRequestsPerWindow < 1) {
      throw new Error('maxRequestsPerWindow must be at least 1')
    }
    if (options.windowMs < 1) {
      throw new Error('windowMs must be at least 1')
    }
    if (options.maxQueuedRequests < 1) {
      throw new Error('maxQueuedRequests must be at least 1')
    }
    if (options.maxQueueWaitMs < 1) {
      throw new Error('maxQueueWaitMs must be at least 1')
    }
    this.options = options
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(abortError())
    }
    if (this.queue.length >= this.options.maxQueuedRequests) {
      return Promise.reject(new Error('Too many model requests are already queued.'))
    }

    return new Promise((resolve, reject) => {
      const entry: QueueEntry = { resolve, reject, signal }
      entry.queueTimer = setTimeout(() => {
        this.removeQueuedEntry(entry)
        reject(new Error('Timed out waiting for a model request slot.'))
      }, this.options.maxQueueWaitMs)
      if (signal) {
        entry.abortListener = () => {
          this.removeQueuedEntry(entry)
          reject(abortError())
        }
        signal.addEventListener('abort', entry.abortListener, { once: true })
      }

      this.queue.push(entry)
      this.drain()
    })
  }

  getSnapshot(): {
    activeRequests: number
    queuedRequests: number
    recentRequestStarts: number
    maxConcurrentRequests: number
    maxRequestsPerWindow: number
    windowMs: number
    maxQueuedRequests: number
    maxQueueWaitMs: number
  } {
    this.pruneStartTimes(Date.now())
    return {
      activeRequests: this.activeRequests,
      queuedRequests: this.queue.length,
      recentRequestStarts: this.startTimes.length,
      maxConcurrentRequests: this.options.maxConcurrentRequests,
      maxRequestsPerWindow: this.options.maxRequestsPerWindow,
      windowMs: this.options.windowMs,
      maxQueuedRequests: this.options.maxQueuedRequests,
      maxQueueWaitMs: this.options.maxQueueWaitMs
    }
  }

  private drain(): void {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer)
      this.drainTimer = null
    }

    while (this.queue.length > 0 && this.activeRequests < this.options.maxConcurrentRequests) {
      const now = Date.now()
      this.pruneStartTimes(now)
      if (this.startTimes.length >= this.options.maxRequestsPerWindow) {
        this.scheduleNextDrain(now)
        return
      }

      const entry = this.queue.shift()
      if (!entry) return
      if (entry.signal?.aborted) {
        this.clearAbortListener(entry)
        entry.reject(abortError())
        continue
      }

      this.clearAbortListener(entry)
      this.clearQueueTimer(entry)
      this.activeRequests += 1
      this.startTimes.push(now)

      let released = false
      entry.resolve(() => {
        if (released) return
        released = true
        this.activeRequests = Math.max(0, this.activeRequests - 1)
        this.drain()
      })
    }
  }

  private scheduleNextDrain(now: number): void {
    if (this.startTimes.length === 0) return
    const nextStartAt = this.startTimes[0] + this.options.windowMs
    const delayMs = Math.max(1, nextStartAt - now)
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null
      this.drain()
    }, delayMs)
  }

  private pruneStartTimes(now: number): void {
    const cutoff = now - this.options.windowMs
    while (this.startTimes.length > 0 && this.startTimes[0] <= cutoff) {
      this.startTimes.shift()
    }
  }

  private removeQueuedEntry(entry: QueueEntry): void {
    const index = this.queue.indexOf(entry)
    if (index >= 0) {
      this.queue.splice(index, 1)
      this.clearAbortListener(entry)
      this.clearQueueTimer(entry)
    }
  }

  private clearAbortListener(entry: QueueEntry): void {
    if (entry.signal && entry.abortListener) {
      entry.signal.removeEventListener('abort', entry.abortListener)
      entry.abortListener = undefined
    }
  }

  private clearQueueTimer(entry: QueueEntry): void {
    if (entry.queueTimer) {
      clearTimeout(entry.queueTimer)
      entry.queueTimer = undefined
    }
  }
}

function abortError(): Error {
  return new Error('Request was aborted')
}
