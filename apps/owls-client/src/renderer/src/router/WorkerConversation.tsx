import { AlertCircleIcon, ChevronRightIcon } from '@renderer/components/ui/icons'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentProvider, Session, SessionItem } from '../../../shared/app'
import { type RouterWorker, type WorkerReport, workerReportSchema } from '../../../shared/router'
import { ConversationItem, RequestCard } from '../app/Conversation'
import { failureMessage } from '../app/failures'
import { OwlAvatar } from '../app/OwlAvatar'
import { openRequests } from './activity'

/** A worker's final message is its JSON report; this reads it back so it is never shown raw. */
function itemReport(item: SessionItem): WorkerReport | null {
  if (item.kind !== 'assistant' || item.status === 'running') return null
  const text = item.text.trim()
  if (!text.startsWith('{')) return null
  try {
    const parsed = workerReportSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
/** Matches what ConversationItem renders, so the folded count is what the user would see. */
const isShown = (item: SessionItem) =>
  item.kind === 'user' ||
  item.kind === 'assistant' ||
  (item.kind !== 'worker' && Boolean(item.text || item.detail))

/** A worker's `user` items came from the Router, so they are shown as the Router speaking. */
function RouterMessage({ text }: { text: string }) {
  const { t } = useTranslation()
  return (
    <div className="worker-router-message">
      <div>
        <span>{t('router.agent')}</span>
        <p>{text}</p>
      </div>
      <OwlAvatar speaker="router" />
    </div>
  )
}
function ReportMessage({
  report,
  agent,
  provider,
  projectPath,
  degraded,
  id
}: {
  report: WorkerReport
  agent: string
  provider: AgentProvider
  projectPath: string
  degraded: boolean
  id: string
}) {
  const { t } = useTranslation()
  // A path outside the project may be private, so only its name is shown (RFC section 6).
  const artifact = (kind: string, ref: string) =>
    kind === 'file' && !ref.startsWith(`${projectPath}/`) ? (ref.split(/[\\/]/).at(-1) ?? ref) : ref
  const item: SessionItem = {
    id,
    kind: 'assistant',
    status: 'completed',
    text: report.summary,
    detail: '',
    turnId: null
  }
  return (
    <div className="worker-report">
      {degraded ? <p className="worker-report-note">{t('worker.degraded')}</p> : null}
      <ConversationItem item={item} agent={agent} speaker={provider} />
      {report.artifacts.length ? (
        <section aria-label={t('worker.artifacts')}>
          <h3>{t('worker.artifacts')}</h3>
          <ul>
            {report.artifacts.map((entry) => (
              <li key={`${entry.kind}:${entry.ref}`}>
                <code>{artifact(entry.kind, entry.ref)}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/**
 * The worker's whole run as one conversation. Once it has reported, the report leads and
 * everything before it folds away until the user opens it.
 */
export function WorkerConversation({
  worker,
  session,
  projectPath
}: {
  worker: RouterWorker
  session: Session | undefined
  projectPath: string
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  if (!session) return <p className="router-panel-empty">{t('worker.notStarted')}</p>
  const agent = t(`agent.${session.provider}`)
  const settled = worker.report !== null && ['reported', 'idle'].includes(worker.status)
  // The report is the last JSON report message, or, when the agent returned it as structured
  // output instead of text, it follows the whole run.
  let reportIndex = -1
  if (settled)
    for (let i = session.items.length - 1; i >= 0 && reportIndex < 0; i--)
      if (itemReport(session.items[i])) reportIndex = i
  const before = settled
    ? session.items.slice(0, reportIndex < 0 ? session.items.length : reportIndex)
    : session.items
  const after = settled && reportIndex >= 0 ? session.items.slice(reportIndex + 1) : []
  const folded = settled ? before.filter(isShown).length : 0
  const renderItem = (item: SessionItem) => {
    if (item.kind === 'user') return <RouterMessage key={item.id} text={item.text} />
    const report = itemReport(item)
    if (report)
      return (
        <ReportMessage
          key={item.id}
          id={item.id}
          report={report}
          agent={agent}
          provider={session.provider}
          projectPath={projectPath}
          degraded={false}
        />
      )
    return <ConversationItem key={item.id} item={item} agent={agent} speaker={session.provider} />
  }
  return (
    <div className="worker-conversation">
      {folded ? (
        <button
          type="button"
          className="worker-fold"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          <ChevronRightIcon size={14} />
          <span>
            {t(expanded ? 'worker.hideEarlier' : 'worker.showEarlier', { count: folded })}
          </span>
        </button>
      ) : null}
      {!settled || expanded ? before.map(renderItem) : null}
      {settled && worker.report ? (
        <ReportMessage
          id={reportIndex >= 0 ? session.items[reportIndex].id : `${worker.id}:report`}
          report={worker.report}
          agent={agent}
          provider={session.provider}
          projectPath={projectPath}
          degraded={worker.degraded}
        />
      ) : null}
      {after.map(renderItem)}
      {openRequests(session).map((request) => (
        <RequestCard key={request.id} request={request} sessionId={session.id} agent={agent} />
      ))}
      {session.error ? (
        <div className="owls-inline-error" role="alert">
          <AlertCircleIcon size={17} />
          <span>{failureMessage(session.error)}</span>
        </div>
      ) : null}
    </div>
  )
}
