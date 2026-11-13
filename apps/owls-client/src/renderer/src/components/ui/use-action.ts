import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * What a clicked action reports when it settles:
 * - `done` briefly confirms success on the button. Return it only when the work verifiably
 *   succeeded; store actions that swallow errors into a toast cannot claim it.
 * - `quiet` (or nothing) returns to rest without a confirmation, for a cancelled dialog or a
 *   result that already shows elsewhere (a status line, an error toast, a view that changes).
 * A thrown error briefly marks the button as failed.
 */
export type ActionOutcome = 'done' | 'quiet'

export type ActionPhase = 'idle' | 'pending' | 'done' | 'failed'

/** Long enough that a fast reply still reads as "it worked on it", short enough not to stall. */
export const ACTION_MIN_PENDING_MS = 450
/** How long the success or failure mark stays before the button returns to rest. */
export const ACTION_RESULT_MS = 1600

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs a button's async work with visible feedback: pending for at least
 * `ACTION_MIN_PENDING_MS`, then a short-lived `done` or `failed` phase. Repeated clicks while
 * pending are ignored, and nothing updates after the component unmounts.
 */
export function useAction(action: () => Promise<unknown>): {
  phase: ActionPhase
  run: () => Promise<void>
} {
  const [phase, setPhase] = useState<ActionPhase>('idle')
  const live = useRef(true)
  const running = useRef(false)
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(action)
  latest.current = action

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      if (reset.current) clearTimeout(reset.current)
    }
  }, [])

  const run = useCallback(async () => {
    if (running.current) return
    running.current = true
    if (reset.current) clearTimeout(reset.current)
    setPhase('pending')
    const started = Date.now()
    let next: ActionPhase
    try {
      next = (await latest.current()) === 'done' ? 'done' : 'idle'
    } catch {
      next = 'failed'
    }
    const left = ACTION_MIN_PENDING_MS - (Date.now() - started)
    if (left > 0) await wait(left)
    running.current = false
    if (!live.current) return
    setPhase(next)
    if (next !== 'idle') {
      reset.current = setTimeout(() => {
        if (live.current) setPhase('idle')
      }, ACTION_RESULT_MS)
    }
  }, [])

  return { phase, run }
}
