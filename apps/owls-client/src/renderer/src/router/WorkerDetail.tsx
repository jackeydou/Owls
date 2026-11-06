import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { AlertCircle, Forward, GitBranch, Loader2, Square, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CodexItem, CodexSession } from '../../../shared/codex'
import type { RouterWorker } from '../../../shared/router'
import { ConversationItem, RequestCard } from '../codex/Conversation'
import { failureMessage } from '../codex/failures'
import { useCodexStore } from '../codex/store'
import { canStop, openRequests, workerState, workerTitle } from './activity'
import { DiffView } from './DiffView'
import { useRouterStore } from './store'
import { WorkerDot } from './WorkerLink'

const TABS = ['activity', 'changes', 'report'] as const
type Tab = (typeof TABS)[number]

/** A worker's `user` items came from the Router, so the user sees what it was actually told. */
function ActivityItem({ item, first, agent }: { item: CodexItem; first: boolean; agent: string }) {
  const { t } = useTranslation()
  if (item.kind !== 'user') return <ConversationItem item={item} agent={agent} />
  return (
    <div className="router-brief">
      <span>{t(first ? 'worker.dispatched' : 'worker.relayed')}</span>
      <p>{item.text}</p>
    </div>
  )
}
function Activity({ session }: { session: CodexSession | undefined }) {
  const { t } = useTranslation()
  if (!session) return <p className="router-panel-empty">{t('worker.notStarted')}</p>
  const agent = t(`agent.${session.provider}`)
  const firstUser = session.items.find((i) => i.kind === 'user')
  return (
    <>
      {session.items.map((item) => (
        <ActivityItem key={item.id} item={item} first={item === firstUser} agent={agent} />
      ))}
      {openRequests(session).map((request) => (
        <RequestCard key={request.id} request={request} sessionId={session.id} agent={agent} />
      ))}
      {session.error ? (
        <div className="codex-inline-error" role="alert">
          <AlertCircle size={15} />
          <span>{failureMessage(session.error)}</span>
        </div>
      ) : null}
    </>
  )
}
function Report({ worker, projectPath }: { worker: RouterWorker; projectPath: string }) {
  const { t } = useTranslation()
  const { report } = worker
  if (!report) return <p className="router-panel-empty">{t('worker.noReport')}</p>
  // A path outside the project may be private, so only its name is shown (RFC section 6).
  const artifact = (kind: string, ref: string) =>
    kind === 'file' && !ref.startsWith(`${projectPath}/`) ? (ref.split(/[\\/]/).at(-1) ?? ref) : ref
  return (
    <div className="router-report">
      {worker.degraded ? <p className="router-report-note">{t('worker.degraded')}</p> : null}
      <p>{report.summary}</p>
      {report.artifacts.length ? (
        <>
          <h3>{t('worker.artifacts')}</h3>
          <ul>
            {report.artifacts.map((item) => (
              <li key={`${item.kind}:${item.ref}`}>
                <code>{artifact(item.kind, item.ref)}</code>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
export function WorkerDetail({ worker }: { worker: RouterWorker }) {
  const { t } = useTranslation()
  const session = useCodexStore((s) => s.sessions.find((x) => x.id === worker.sessionId))
  const projectPath = useCodexStore(
    (s) => s.projects.find((p) => p.id === worker.projectId)?.path ?? ''
  )
  const { stopWorker, removeWorker, showPanel, startForward } = useRouterStore()
  const { report } = worker
  const [tab, setTab] = useState<Tab>('activity')
  const title = workerTitle(worker)
  return (
    <aside className="router-panel" aria-label={title}>
      <header>
        <div>
          <h2>
            <WorkerDot worker={worker} />
            <span>{title}</span>
          </h2>
          <small>
            {t(`workerState.${workerState(worker)}`)}
            {worker.status === 'running' ? (
              <Loader2 size={11} className="animate-spin" aria-hidden />
            ) : null}
            {worker.workspace.kind === 'worktree' ? (
              <>
                <GitBranch size={11} aria-hidden />
                <code>{worker.workspace.branch}</code>
              </>
            ) : null}
          </small>
        </div>
        {canStop(worker) ? (
          <IconButton
            size="sm"
            label={t('worker.stop')}
            tooltip={t('worker.stop')}
            icon={<Square size={12} fill="currentColor" />}
            onClick={() => void stopWorker(worker.routerId, worker.id)}
          />
        ) : (
          <IconButton
            size="sm"
            label={t('worker.remove')}
            tooltip={t('worker.remove')}
            icon={<Trash2 size={13} />}
            onClick={() => void removeWorker(worker.routerId, worker.id)}
          />
        )}
        {report ? (
          <IconButton
            size="sm"
            label={t('forward.action')}
            tooltip={t('forward.action')}
            icon={<Forward size={13} />}
            onClick={() =>
              startForward({
                source: { kind: 'worker', routerId: worker.routerId, workerId: worker.id },
                preview: report.summary,
                projectId: worker.projectId
              })
            }
          />
        ) : null}
        <IconButton
          size="sm"
          label={t('worker.close')}
          tooltip={t('worker.close')}
          icon={<X size={15} />}
          onClick={() => showPanel(null)}
        />
      </header>
      <div className="router-tabs" role="tablist">
        {TABS.map((name) => (
          <Button
            key={name}
            size="sm"
            variant="ghost"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
          >
            {t(`worker.tab.${name}`)}
          </Button>
        ))}
      </div>
      <div className="router-panel-body">
        {tab === 'activity' ? <Activity session={session} /> : null}
        {tab === 'changes' ? <DiffView diff={session?.diff ?? ''} /> : null}
        {tab === 'report' ? <Report worker={worker} projectPath={projectPath} /> : null}
      </div>
    </aside>
  )
}
