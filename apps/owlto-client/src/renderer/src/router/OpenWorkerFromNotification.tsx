import { useEffect, useState } from 'react'
import type { OpenWorkerTarget } from '../../../shared/app'
import { useAppStore } from '../app/store'
import { useRouterStore } from './store'

function open(target: OpenWorkerTarget) {
  const { workerId, routerId } = target
  if (!workerId || !routerId) return
  const worker = useRouterStore.getState().workers.find((w) => w.id === workerId)
  if (!worker || worker.status === 'removed') return
  useAppStore.getState().showThread(routerId)
  useRouterStore.getState().showPanel({ kind: 'worker', workerId })
}

/**
 * Opens the worker whose request notification the user clicked. A click can
 * arrive before the app has loaded, when it made the window again, so it waits.
 */
export function OpenWorkerFromNotification() {
  const loaded = useAppStore((s) => s.loaded)
  const [waiting, setWaiting] = useState<OpenWorkerTarget | null>(null)
  useEffect(() => window.owlto.onOpenWorker(setWaiting), [])
  useEffect(() => {
    if (!loaded || !waiting) return
    open(waiting)
    setWaiting(null)
  }, [loaded, waiting])
  return null
}
