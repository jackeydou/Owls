import { useEffect, useState } from 'react'
import type { UpdateSnapshot } from '../../../shared/updates'

/** `undefined` while loading, null when the main process could not answer. */
export function useUpdateSnapshot(): UpdateSnapshot | null | undefined {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot | null | undefined>(undefined)
  useEffect(() => {
    let active = true
    void window.owlto.updates.snapshot().then((reply) => {
      if (active) setSnapshot(reply.ok ? reply.value : null)
    })
    const unsubscribe = window.owlto.updates.onChanged((next) => setSnapshot(next))
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return snapshot
}
