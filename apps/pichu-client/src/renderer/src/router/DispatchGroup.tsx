import { useTranslation } from 'react-i18next'
import type { RouterWorker } from '../../../shared/router'
import { useCodexStore } from '../codex/store'
import { liveLine, workerState } from './activity'
import { useRouterStore } from './store'
import { WorkerLink } from './WorkerLink'

function DispatchRow({ worker }: { worker: RouterWorker }) {
  const { t } = useTranslation()
  const line = useCodexStore((s) =>
    worker.status === 'running' || worker.status === 'waiting'
      ? (liveLine(s.sessions.find((x) => x.id === worker.sessionId))?.text ?? '')
      : ''
  )
  return (
    <li>
      <WorkerLink worker={worker} />
      <small>{line || t(`workerState.${workerState(worker)}`)}</small>
    </li>
  )
}
/** Consecutive dispatches read as one step: the Router sent these out together. */
export function DispatchGroup({ workerIds }: { workerIds: string[] }) {
  const { t } = useTranslation()
  const all = useRouterStore((s) => s.workers)
  const workers = workerIds
    .map((id) => all.find((w) => w.id === id))
    .filter((w): w is RouterWorker => Boolean(w) && w?.status !== 'removed')
  if (!workers.length) return null
  return (
    <section className="router-dispatch" aria-label={t('router.workers')}>
      <h3>{t('router.dispatched', { count: workers.length })}</h3>
      <ul>
        {workers.map((worker) => (
          <DispatchRow key={worker.id} worker={worker} />
        ))}
      </ul>
    </section>
  )
}
