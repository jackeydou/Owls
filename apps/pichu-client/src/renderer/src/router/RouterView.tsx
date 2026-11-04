import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import {
  AlertCircle,
  ArrowUp,
  FolderOpen,
  GitBranch,
  Loader2,
  Network,
  Settings2,
  Square,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RouterWorker } from '../../../shared/router'
import { ConversationItem } from '../codex/Conversation'
import { failureMessage } from '../codex/failures'
import { useCodexStore } from '../codex/store'
import { useRouterStore } from './store'
import './router.css'

const SETUP_FAILURES = [
  'router_model_unconfigured',
  'model_unavailable',
  'router_unavailable',
  'claude_not_connected',
  'not_connected'
]

const SETUP_COPY = {
  owls: { title: 'router.setupTitle', body: 'router.setupBody' },
  claude: { title: 'router.claudeSetupTitle', body: 'router.claudeSetupBody' },
  codex: { title: 'router.codexSetupTitle', body: 'router.codexSetupBody' }
} as const

function WorkerCard({ worker }: { worker: RouterWorker }) {
  const { t } = useTranslation()
  const select = useCodexStore((s) => s.select)
  return (
    <button
      type="button"
      className={`router-worker ${worker.status}`}
      aria-label={t('router.openWorker', { goal: worker.goal })}
      onClick={() => select(worker.sessionId)}
    >
      <span className="router-worker-head">
        <i />
        <strong>{worker.goal}</strong>
      </span>
      <small>
        {t(`workerStatus.${worker.status}`)}
        {worker.report ? ` · ${t(`reportStatus.${worker.report.status}`)}` : ''}
        {worker.degraded ? ` · ${t('router.degraded')}` : ''}
      </small>
      {worker.workspace.kind === 'worktree' ? (
        <small className="router-worker-branch">
          <GitBranch size={11} aria-hidden />
          {t('router.branch', { branch: worker.workspace.branch })}
        </small>
      ) : null}
      {worker.report?.summary ? <p>{worker.report.summary}</p> : null}
    </button>
  )
}

export function RouterView() {
  const { t } = useTranslation()
  const projectId = useCodexStore((s) => s.routerProjectId)
  const project = useCodexStore((s) => s.projects.find((p) => p.id === projectId))
  const settings = useCodexStore((s) => s.settings)
  const claude = useCodexStore((s) => s.claude)
  const codex = useCodexStore((s) => s.connection)
  const showSettings = useCodexStore((s) => s.showSettings)
  const { open, send, interrupt, resolveBatch, discardWorktree, sending, error, clearError } =
    useRouterStore()
  const router = useRouterStore((s) => s.routers.find((r) => r.projectId === projectId))
  const allWorkers = useRouterStore((s) => s.workers)
  const workers = router
    ? allWorkers.filter((w) => w.routerId === router.id && w.status !== 'removed')
    : []
  // Removed workers whose worktrees still hold uncommitted changes (RFC 11.1).
  const kept = router
    ? allWorkers.filter(
        (w) =>
          w.routerId === router.id &&
          w.status === 'removed' &&
          w.workspace.kind === 'worktree' &&
          w.workspace.state === 'kept'
      )
    : []
  const [text, setText] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (projectId) void open(projectId)
  }, [projectId, open])
  useEffect(() => {
    textarea.current?.focus()
  }, [])
  const items = router?.items ?? []
  useEffect(() => {
    if (items.length) bottom.current?.scrollIntoView({ block: 'end' })
  }, [items])
  const running = router?.status === 'running'
  const engine = settings.router.engine
  const setupError = Boolean(router?.error && SETUP_FAILURES.includes(router.error.code))
  // Each engine has its own setup card; Owls never switches engines on its own.
  const setup =
    engine === 'claude-code'
      ? claude.status !== 'ready' || setupError
        ? 'claude'
        : null
      : engine === 'codex'
        ? codex.status !== 'ready' || codex.account.kind === 'signed-out' || setupError
          ? 'codex'
          : null
        : !settings.router.owls || setupError
          ? 'owls'
          : null
  const model =
    engine === 'owls'
      ? (settings.router.owls?.model ?? null)
      : engine === 'claude-code'
        ? (settings.router.claudeModel ?? t('router.cliDefaultModel'))
        : (settings.router.codexModel ?? t('router.cliDefaultModel'))
  const name = project?.name ?? ''
  async function submit() {
    if (!router || !text.trim() || sending) return
    if (await send(router.id, text.trim())) setText('')
  }
  return (
    <main className="codex-chat router-view">
      <header className="codex-topbar">
        <div className="codex-task-title">
          {t('router.title')}
          {name ? (
            <span>
              <FolderOpen size={12} />
              {name}
            </span>
          ) : null}
        </div>
        <div className="codex-topbar-actions">
          <span className="router-model">
            {t(`router.engineLabel.${engine}`)}
            {model ? ` · ${model}` : ''}
          </span>
          <IconButton
            label={t('router.openSettings')}
            tooltip={t('router.openSettings')}
            icon={<Settings2 size={16} />}
            onClick={showSettings}
          />
        </div>
      </header>
      <div className="codex-chat-body">
        <div className="codex-conversation-column">
          <section className="router-workers" aria-label={t('router.workers')}>
            {workers.length ? (
              workers.map((worker) => <WorkerCard key={worker.id} worker={worker} />)
            ) : (
              <p>{t('router.noWorkers')}</p>
            )}
          </section>
          {router && kept.length ? (
            <section className="router-kept" aria-label={t('router.keptWorktrees')}>
              <strong>{t('router.keptWorktrees')}</strong>
              <p>{t('router.keptWorktreesBody')}</p>
              <ul>
                {kept.map((worker) =>
                  worker.workspace.kind === 'worktree' ? (
                    <li key={worker.id}>
                      <span>
                        <span className="router-kept-goal">{worker.goal}</span>
                        <small>
                          {worker.workspace.branch} · {worker.workspace.path}
                        </small>
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={t('router.discardWorktreeLabel', { goal: worker.goal })}
                        onClick={() => void discardWorktree(router.id, worker.id)}
                      >
                        {t('router.discardWorktree')}
                      </Button>
                    </li>
                  ) : null
                )}
              </ul>
            </section>
          ) : null}
          <div className="codex-conversation-scroll">
            <div className="codex-conversation">
              {setup ? (
                <div className="codex-welcome">
                  <Network size={30} />
                  <h1>{t(SETUP_COPY[setup].title)}</h1>
                  <p>{t(SETUP_COPY[setup].body)}</p>
                  <Button size="sm" onClick={showSettings}>
                    <Settings2 size={14} />
                    {t('router.openSettings')}
                  </Button>
                </div>
              ) : !items.length ? (
                <div className="codex-welcome">
                  <Network size={30} />
                  <h1>{t('router.welcome')}</h1>
                  <p>{t('router.welcomeBody', { project: name })}</p>
                </div>
              ) : null}
              {items.map((item) => (
                <ConversationItem key={item.id} item={item} agent={t('router.agent')} />
              ))}
              {running ? (
                <div className="codex-working" role="status">
                  <Loader2 size={13} className="animate-spin" />
                  {t('router.working')}
                </div>
              ) : null}
              {router?.unknownBatches.map((batch) => (
                <div
                  className="codex-inline-error router-unknown-batch"
                  role="alert"
                  key={batch.id}
                >
                  <AlertCircle size={15} />
                  <span>{t('router.unknownBatch', { count: batch.events })}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void resolveBatch(router.id, batch.id, 'retry')}
                  >
                    {t('router.retryBatch')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void resolveBatch(router.id, batch.id, 'ignore')}
                  >
                    {t('router.ignoreBatch')}
                  </Button>
                </div>
              ))}
              {router?.error && !SETUP_FAILURES.includes(router.error.code) ? (
                <div className="codex-inline-error" role="alert">
                  <AlertCircle size={15} />
                  <span>{failureMessage(router.error)}</span>
                </div>
              ) : null}
              {error ? (
                <div className="codex-inline-error" role="alert">
                  <AlertCircle size={15} />
                  <span>{failureMessage(error)}</span>
                  <IconButton
                    size="sm"
                    label={t('dismissError')}
                    icon={<X size={14} />}
                    onClick={clearError}
                  />
                </div>
              ) : null}
              <div ref={bottom} />
            </div>
          </div>
          <div className="codex-composer-area">
            <div className="codex-composer">
              <textarea
                ref={textarea}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('router.prompt')}
                aria-label={t('router.prompt')}
                rows={2}
                disabled={!router || sending}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void submit()
                  }
                }}
              />
              <div className="codex-composer-toolbar">
                <div className="codex-composer-config" />
                {running ? (
                  <IconButton
                    className="codex-stop"
                    label={t('router.stop')}
                    tooltip={t('router.stop')}
                    icon={<Square size={13} fill="currentColor" />}
                    onClick={() => router && void interrupt(router.id)}
                  />
                ) : null}
                <IconButton
                  variant="default"
                  className="codex-send"
                  label={t('router.send')}
                  tooltip={t('router.send')}
                  icon={
                    sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} />
                  }
                  disabled={!router || !text.trim() || sending}
                  onClick={() => void submit()}
                />
              </div>
            </div>
            <div className="codex-composer-note">
              <span>{t('sendHint')}</span>
              {router?.tokens ? <span>{t('router.tokens', { count: router.tokens })}</span> : null}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
