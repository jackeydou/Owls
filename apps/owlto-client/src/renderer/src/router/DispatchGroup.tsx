import { useTranslation } from 'react-i18next'
import type { RouterWorker } from '../../../shared/router'
import { showBrowserTab, useWorkerTab } from '../browser/store'
import { workerState, workerTitle, workerTone } from './activity'
import { useRouterStore } from './store'

/** Hooks the line to the Router message above it: this worker branched off from there. */
function DispatchConnector() {
  return (
    <svg className="router-dispatch-connector" viewBox="0 0 14 12" aria-hidden="true">
      <path d="M1.5 0 V3.5 Q1.5 9.5 7.5 9.5 H13" />
    </svg>
  )
}
/** Running workers breathe; settled ones say how they ended in a muted word. */
function DispatchStatus({ worker }: { worker: RouterWorker }) {
  const { t } = useTranslation()
  const state = workerState(worker)
  if (state === 'running') {
    return (
      <span className="router-dispatch-dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
    )
  }
  return <small aria-hidden>{t(`workerState.${state}`)}</small>
}
function DispatchRow({ worker }: { worker: RouterWorker }) {
  const { t } = useTranslation()
  const showPanel = useRouterStore((s) => s.showPanel)
  const browserTab = useWorkerTab(worker.id)
  const needsYou = browserTab?.needsYou ?? false
  const title = workerTitle(worker)
  const state = t(`workerState.${workerState(worker)}`)
  return (
    <li>
      <button
        type="button"
        className={`router-dispatch-row ${workerTone(worker)}`}
        aria-label={`${title}, ${needsYou ? t('browser.workerNeedsYou') : state}`}
        onClick={() => {
          showPanel({ kind: 'worker', workerId: worker.id })
          // A worker waiting in its browser tab shows that tab too.
          if (browserTab?.needsYou) showBrowserTab(browserTab.tabId)
        }}
      >
        <DispatchConnector />
        <span className="router-dispatch-title">{title}</span>
        {needsYou ? (
          <small className="router-dispatch-needs" aria-hidden>
            {t('browser.workerNeedsYou')}
          </small>
        ) : (
          <DispatchStatus worker={worker} />
        )}
      </button>
    </li>
  )
}
/** Consecutive dispatches read as one step: one quiet line per worker the Router sent out. */
export function DispatchGroup({ workerIds }: { workerIds: string[] }) {
  const { t } = useTranslation()
  const all = useRouterStore((s) => s.workers)
  const workers = workerIds
    .map((id) => all.find((w) => w.id === id))
    .filter((w): w is RouterWorker => Boolean(w) && w?.status !== 'removed')
  if (!workers.length) return null
  return (
    <ul className="router-dispatch" aria-label={t('router.dispatched', { count: workers.length })}>
      {workers.map((worker) => (
        <DispatchRow key={worker.id} worker={worker} />
      ))}
    </ul>
  )
}
