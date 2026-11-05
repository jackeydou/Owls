import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestCard } from '../codex/Conversation'
import { useCodexStore } from '../codex/store'
import { byAge, openRequests, workerTitle } from './activity'
import { useRouterStore } from './store'

/** Requests from this Router's workers, oldest worker first. */
function useWorkerRequests(routerId: string) {
  const sessions = useCodexStore((s) => s.sessions)
  const workers = useRouterStore((s) => s.workers)
  return useMemo(
    () =>
      workers
        .filter((w) => w.routerId === routerId && w.status !== 'removed')
        .sort(byAge)
        .flatMap((worker) => {
          const session = sessions.find((s) => s.id === worker.sessionId)
          return openRequests(session).map((request) => ({ worker, session, request }))
        }),
    [sessions, workers, routerId]
  )
}
/** Sits above the composer, so a request is never buried under the conversation. */
export function RequestTray({ routerId }: { routerId: string }) {
  const { t } = useTranslation()
  const requests = useWorkerRequests(routerId)
  const showPanel = useRouterStore((s) => s.showPanel)
  const [first] = requests
  if (!first?.session) return null
  const { worker, session, request } = first
  return (
    <section className="router-tray" aria-label={t('router.requests')}>
      <div className="router-tray-head">
        <strong>{t('router.requestFrom', { title: workerTitle(worker) })}</strong>
        <button type="button" onClick={() => showPanel({ kind: 'worker', workerId: worker.id })}>
          {t('router.viewContext')}
        </button>
      </div>
      <RequestCard
        key={request.id}
        request={request}
        sessionId={session.id}
        agent={t(`agent.${session.provider}`)}
      />
      {requests.length > 1 ? (
        <p className="router-tray-more">
          {t('router.moreRequests', { count: requests.length - 1 })}
        </p>
      ) : null}
    </section>
  )
}
