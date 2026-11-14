import { describeCronSchedule, formatDateTime, formatRelativeDateTime } from '@renderer/lib/cron'
import { useI18n } from '@renderer/lib/i18n'
import { useAutomationStore } from '@renderer/stores/automation-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { ChevronRight, Loader2, PauseCircle, PlayCircle, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

function statusCopy(
  active: boolean,
  lastRunStatus: string | null,
  t: ReturnType<typeof useI18n>['t']
): string {
  if (lastRunStatus === 'running') return t('automation.running')
  if (active) return t('automation.active')
  if (lastRunStatus === 'error') return t('automation.statusPausedAfterError')
  return t('automation.paused')
}

function statusClasses(active: boolean, lastRunStatus: string | null): string {
  if (lastRunStatus === 'running') return 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
  if (lastRunStatus === 'error') return 'bg-destructive/10 text-destructive'
  if (active) return 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
  return 'bg-foreground/6 text-muted-foreground'
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="max-w-[220px] text-right text-[12px] text-foreground">{value}</dd>
    </div>
  )
}

export function AutomationDetailPage({
  backTo = '/automation',
  backLabel,
  onDeleted
}: {
  backTo?: string
  backLabel?: string
  onDeleted?: (jobId: string) => Promise<void> | void
}): React.JSX.Element {
  const { t } = useI18n()
  const resolvedBackLabel = backLabel ?? t('automation.title')
  const { jobId = '' } = useParams()
  const navigate = useNavigate()
  const {
    loaded,
    loading,
    busyJobId,
    error,
    load,
    loadRunSessions,
    runSessionsByJobId,
    getJob,
    updateJob,
    toggleJob,
    deleteJob,
    runNow
  } = useAutomationStore()
  const loadSession = useSessionStore((state) => state.loadSession)
  const loadSessionIndex = useSessionStore((state) => state.loadSessionIndex)

  const job = getJob(jobId)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!jobId) return
    void loadRunSessions(jobId)
  }, [jobId, loadRunSessions])

  useEffect(() => {
    if (!jobId) return
    return window.api.cron.onEvent((event) => {
      if (event.jobId !== jobId) return
      void load()
      void loadRunSessions(jobId)
    })
  }, [jobId, load, loadRunSessions])

  useEffect(() => {
    if (!job) return
    setName(job.name)
    setPrompt(job.prompt)
    setDirty(false)
  }, [job])

  const previousRuns = useMemo(() => {
    return (runSessionsByJobId[jobId] ?? []).map((session) => ({
      id: session.sessionId,
      sessionId: session.sessionId,
      title: session.title || job?.name || t('automation.untitled'),
      ranAt: session.createdAt
    }))
  }, [job?.name, jobId, runSessionsByJobId, t])

  const busy = busyJobId === jobId

  const handleSave = async (): Promise<void> => {
    if (!job || !dirty) return
    const updated = await updateJob(job.id, {
      name,
      prompt
    })
    if (updated) setDirty(false)
  }

  const handleDelete = async (): Promise<void> => {
    if (!job) return
    const confirmed = window.confirm(t('automation.deleteConfirm', { name: job.name }))
    if (!confirmed) return
    const deleted = await deleteJob(job.id)
    if (deleted) {
      await onDeleted?.(job.id)
      navigate(backTo)
    }
  }

  const handleOpenRun = async (sessionId: string): Promise<void> => {
    await loadSession(sessionId)
    await loadSessionIndex()
    navigate('/')
  }

  if (!loaded && loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-card text-[13px] text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" strokeWidth={1.8} />
        {t('automation.loadingDetail')}
      </div>
    )
  }

  if (!job && loaded) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto bg-card px-6 py-8">
        <div className="mx-auto max-w-2xl rounded-2xl border border-border/70 bg-background/70 p-8 text-center">
          <h1 className="text-lg font-semibold text-foreground">{t('automation.notFound')}</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {t('automation.notFoundDescription')}
          </p>
          <Link
            to={backTo}
            className="mt-5 inline-flex rounded-lg bg-foreground px-3 py-2 text-[13px] font-medium text-background"
          >
            {backLabel ? t('workbench.back') : t('automation.backToAutomations')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-card">
      <div className="flex h-full min-h-0">
        <main className="min-w-0 flex-1 overflow-hidden px-6 pt-6">
          <div className="mx-auto flex h-full max-w-3xl flex-col">
            <div className="mb-8 flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
              <Link to={backTo} className="transition hover:text-foreground">
                {resolvedBackLabel}
              </Link>
              <ChevronRight className="size-3.5" strokeWidth={1.8} />
              <span className="truncate text-foreground">{job?.name}</span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <label className="block shrink-0">
                <span className="sr-only">{t('automation.titleSr')}</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                    setDirty(true)
                  }}
                  className="w-full border-0 bg-transparent px-0 text-3xl font-semibold tracking-[-0.03em] text-foreground outline-none placeholder:text-muted-foreground/40"
                  placeholder={t('automation.untitled')}
                />
              </label>

              <label className="mt-5 flex min-h-0 flex-1 flex-col">
                <span className="mb-2 block text-[12px] font-medium text-muted-foreground">
                  {t('automation.field.agentTask')}
                </span>
                <textarea
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value)
                    setDirty(true)
                  }}
                  className="min-h-[420px] flex-1 resize-none rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-[14px] leading-6 text-foreground outline-none transition placeholder:text-muted-foreground/45 focus:border-border-strong"
                  placeholder={t('automation.promptPlaceholder')}
                />
              </label>

              {error ? (
                <div className="mt-4 shrink-0 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
                  {error}
                </div>
              ) : null}

              <div className="mt-5 flex shrink-0 justify-end bg-card py-4">
                <button
                  type="button"
                  disabled={!dirty || busy || !name.trim() || !prompt.trim()}
                  onClick={() => void handleSave()}
                  className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-[13px] font-medium text-background transition hover:opacity-90 disabled:opacity-35"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
                  ) : (
                    <Save className="size-4" strokeWidth={1.8} />
                  )}
                  {t('automation.saveChanges')}
                </button>
              </div>
            </div>
          </div>
        </main>

        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border/70 bg-background/55 px-5 py-6 lg:block">
          <div className="mb-4 flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => job && void toggleJob(job.id, !job.active)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[12px] font-medium text-foreground transition hover:bg-sidebar-hover disabled:opacity-35"
            >
              {job?.active ? (
                <PauseCircle className="size-3.5" strokeWidth={1.8} />
              ) : (
                <PlayCircle className="size-3.5" strokeWidth={1.8} />
              )}
              {job?.active ? t('automation.pause') : t('automation.activate')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => job && void runNow(job.id)}
              className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-[12px] font-medium text-background transition hover:opacity-90 disabled:opacity-35"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
              ) : (
                <PlayCircle className="size-3.5" strokeWidth={1.8} />
              )}
              {t('automation.runNow')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDelete()}
              className="rounded-lg border border-border bg-card p-2 text-muted-foreground transition hover:border-destructive/30 hover:text-destructive disabled:opacity-35"
              aria-label={t('automation.deleteAutomation')}
            >
              <Trash2 className="size-3.5" strokeWidth={1.8} />
            </button>
          </div>

          <section className="border-t border-border/70 py-5">
            <h2 className="mb-3 text-[12px] font-medium text-muted-foreground">
              {t('automation.status')}
            </h2>
            <dl>
              <DetailRow
                label={t('automation.status')}
                value={
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClasses(
                      Boolean(job?.active),
                      job?.lastRunStatus ?? null
                    )}`}
                  >
                    {statusCopy(Boolean(job?.active), job?.lastRunStatus ?? null, t)}
                  </span>
                }
              />
              <DetailRow
                label={t('automation.lastRunLabel')}
                value={formatDateTime(job?.lastRunAt, t)}
              />
            </dl>
          </section>

          <section className="border-t border-border/70 py-5">
            <h2 className="mb-3 text-[12px] font-medium text-muted-foreground">
              {t('automation.details')}
            </h2>
            <dl>
              <DetailRow
                label={t('automation.repeats')}
                value={describeCronSchedule(job?.schedule ?? '', t)}
              />
              <DetailRow
                label={t('automation.created')}
                value={formatDateTime(job?.createdAt, t)}
              />
            </dl>
          </section>

          <section className="border-t border-border/70 py-5">
            <h2 className="mb-3 text-[12px] font-medium text-muted-foreground">
              {t('automation.previousRuns')}
            </h2>
            {previousRuns.length > 0 ? (
              <div className="space-y-3">
                {previousRuns.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => void handleOpenRun(run.sessionId)}
                    className="block w-full rounded-lg p-1 text-left transition hover:bg-sidebar-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-foreground">
                        {run.title}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatRelativeDateTime(run.ranAt, t)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">{t('automation.noRuns')}</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
