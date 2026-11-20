import { AlertCircleIcon, ChevronRightIcon } from '@renderer/components/ui/icons'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentProvider, Session, SessionItem } from '../../../shared/app'
import type { FileBase } from '../../../shared/file-preview'
import { type RouterWorker, type WorkerReport, workerReportSchema } from '../../../shared/router'
import { ConversationItem, RequestCard } from '../app/Conversation'
import { failureMessage } from '../app/failures'
import { OwlAvatar } from '../app/OwlAvatar'
import { WorkingDots } from '../app/WorkingDots'
import { FileBaseContext } from '../files/FileLink'
import { isWorking, openRequests } from './activity'
import { WorkerArtifacts } from './WorkerArtifacts'
import { WorkerUserMessage } from './WorkerUserMessage'

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
      <WorkerArtifacts artifacts={report.artifacts} projectPath={projectPath} />
    </div>
  )
}

/**
 * Shown under the last message while the turn runs: the worker's owl typing away
 * and three dots bouncing in its color, so a quiet stretch never reads as done.
 */
function WorkingIndicator({ provider, agent }: { provider: AgentProvider; agent: string }) {
  const { t } = useTranslation()
  return (
    <div className="worker-working" role="status">
      <OwlAvatar speaker={provider} working />
      <WorkingDots speaker={provider} />
      <span className="sr-only">{t('worker.working', { agent })}</span>
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
  projectPath,
  onToggleFold
}: {
  worker: RouterWorker
  session: Session | undefined
  projectPath: string
  /** Opening or closing the earlier messages, which sit above whatever the user is reading. */
  onToggleFold?: () => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const fileBase = useMemo<FileBase>(
    () => ({ kind: 'worker', routerId: worker.routerId, workerId: worker.id }),
    [worker.routerId, worker.id]
  )
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
    if (item.kind === 'user')
      return item.author === 'user' ? (
        <WorkerUserMessage key={item.id} item={item} />
      ) : (
        <RouterMessage key={item.id} text={item.text} />
      )
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
    <FileBaseContext.Provider value={fileBase}>
      <div className="worker-conversation">
        {folded ? (
          <button
            type="button"
            className="worker-fold"
            aria-expanded={expanded}
            onClick={() => {
              onToggleFold?.()
              setExpanded((open) => !open)
            }}
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
        {isWorking(worker) && !session.error ? (
          <WorkingIndicator provider={session.provider} agent={agent} />
        ) : null}
        {openRequests(session).map((request) => (
          <RequestCard key={request.id} request={request} sessionId={session.id} agent={agent} />
        ))}
        {session.error ? (
          <div className="owlto-inline-error" role="alert">
            <AlertCircleIcon size={17} />
            <span>{failureMessage(session.error)}</span>
          </div>
        ) : null}
      </div>
    </FileBaseContext.Provider>
  )
}
