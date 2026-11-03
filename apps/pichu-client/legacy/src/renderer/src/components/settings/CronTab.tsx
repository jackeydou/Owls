import type { CronJob } from '@renderer/../../preload/index.d'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { Clock3, PauseCircle, PlayCircle, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SettingRow } from './SettingRow'
import { ToggleButton } from './ToggleButton'

function pad(value: string): string {
  return value.padStart(2, '0')
}

function isNumericPart(value: string): boolean {
  return /^\d+$/.test(value)
}

function describeSchedule(schedule: string): string {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return 'Custom schedule'

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  if (schedule === '* * * * *') return 'Every minute'
  if (
    /^\*\/\d+$/.test(minute) &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return `Every ${minute.slice(2)} minutes`
  }
  if (
    isNumericPart(minute) &&
    /^\*\/\d+$/.test(hour) &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return `Every ${hour.slice(2)} hours at minute ${pad(minute)}`
  }
  if (
    isNumericPart(minute) &&
    isNumericPart(hour) &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return `Every day at ${pad(hour)}:${pad(minute)}`
  }
  if (
    isNumericPart(minute) &&
    isNumericPart(hour) &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek !== '*'
  ) {
    return `Weekly on day ${dayOfWeek} at ${pad(hour)}:${pad(minute)}`
  }

  return 'Custom schedule'
}

function formatLastRun(job: CronJob): string {
  if (!job.lastRunAt) return 'Never run'
  return new Date(job.lastRunAt).toLocaleString()
}

function StatusBadge({ status }: { status: CronJob['lastRunStatus'] }): React.JSX.Element {
  const classes =
    status === 'success'
      ? 'bg-green-500/12 text-green-700 dark:text-green-300'
      : status === 'error'
        ? 'bg-destructive/12 text-destructive'
        : status === 'running'
          ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
          : 'bg-foreground/6 text-muted-foreground'

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${classes}`}
    >
      {status ?? 'idle'}
    </span>
  )
}

function CronJobCard({
  job,
  busy,
  onToggle,
  onDelete
}: {
  job: CronJob
  busy: boolean
  onToggle: (job: CronJob, nextActive: boolean) => void
  onDelete: (job: CronJob) => void
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-border/60 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-foreground">{job.name}</span>
            <StatusBadge status={job.lastRunStatus} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md bg-foreground/5 px-2 py-1">
              <Clock3 className="size-3" strokeWidth={1.8} />
              {describeSchedule(job.schedule)}
            </span>
            <code className="rounded bg-foreground/5 px-2 py-1 font-mono text-[11px] text-foreground">
              {job.schedule}
            </code>
          </div>
          <p className="text-[13px] text-muted-foreground">{job.prompt}</p>
          <div className="space-y-1 text-[12px] text-muted-foreground">
            <p>Runs in: {job.cwd}</p>
            <p>Last run: {formatLastRun(job)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {job.active ? (
            <PlayCircle className="size-4 text-green-600" strokeWidth={1.8} />
          ) : (
            <PauseCircle className="size-4 text-muted-foreground" strokeWidth={1.8} />
          )}
          <ToggleButton checked={job.active} onClick={() => onToggle(job, !job.active)} />
          <button
            type="button"
            disabled={busy}
            onClick={() => onDelete(job)}
            className="rounded-md border border-border bg-background p-2 text-muted-foreground transition hover:border-destructive/30 hover:text-destructive disabled:opacity-40"
            title={`Delete ${job.name}`}
          >
            <Trash2 className="size-3.5" strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  )
}

export function CronTab(): React.JSX.Element {
  const { workingDirectory } = useSettingsStore()
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('0 9 * * *')
  const [prompt, setPrompt] = useState('')
  const [cwd, setCwd] = useState('')

  useEffect(() => {
    if (!cwd && workingDirectory) {
      setCwd(workingDirectory)
    }
  }, [cwd, workingDirectory])

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const nextJobs = await window.api.cron.list()
      setJobs(nextJobs)
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  const activeJobs = useMemo(() => jobs.filter((job) => job.active), [jobs])
  const inactiveJobs = useMemo(() => jobs.filter((job) => !job.active), [jobs])

  const handleCreate = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.cron.create({
        name,
        schedule,
        prompt,
        cwd
      })
      setName('')
      setPrompt('')
      setSchedule('0 9 * * *')
      setCwd(workingDirectory)
      setError(null)
      await loadJobs()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (job: CronJob, nextActive: boolean): Promise<void> => {
    setBusyJobId(job.id)
    try {
      await window.api.cron.toggle(job.id, nextActive)
      setError(null)
      await loadJobs()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setBusyJobId(null)
    }
  }

  const handleDelete = async (job: CronJob): Promise<void> => {
    setBusyJobId(job.id)
    try {
      await window.api.cron.delete(job.id)
      setError(null)
      await loadJobs()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setBusyJobId(null)
    }
  }

  return (
    <div>
      <SettingRow
        label="Create cron job"
        description="Schedule recurring agent tasks. When a job triggers, Owls runs the saved prompt once."
      >
        <div className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/40 focus:border-border-strong focus:ring-1 focus:ring-border-strong"
            placeholder="Daily repo health check"
            autoComplete="off"
          />
          <input
            type="text"
            value={schedule}
            onChange={(event) => setSchedule(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/40 focus:border-border-strong focus:ring-1 focus:ring-border-strong"
            placeholder="0 9 * * *"
            autoComplete="off"
            spellCheck={false}
          />
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="min-h-28 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/40 focus:border-border-strong focus:ring-1 focus:ring-border-strong"
            placeholder="Review the repo for broken builds and summarize anything that needs attention."
          />
          <input
            type="text"
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/40 focus:border-border-strong focus:ring-1 focus:ring-border-strong"
            placeholder={workingDirectory || '~/.pichu'}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] text-muted-foreground">
              Examples: <code className="font-mono">0 9 * * *</code>,{' '}
              <code className="font-mono">*/30 * * * *</code>,{' '}
              <code className="font-mono">15 18 * * 1</code>
            </p>
            <button
              type="button"
              disabled={saving || !name.trim() || !schedule.trim() || !prompt.trim() || !cwd.trim()}
              onClick={() => void handleCreate()}
              className="shrink-0 rounded-md bg-foreground px-3 py-2 text-[13px] font-medium text-background transition hover:opacity-90 disabled:opacity-30"
            >
              {saving ? 'Creating...' : 'Create Job'}
            </button>
          </div>
        </div>
        {error ? (
          <p className="mt-2 text-[13px] text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </SettingRow>

      <SettingRow
        label="Active jobs"
        description="Jobs that are currently scheduled and ready to trigger."
      >
        <div className="space-y-3">
          {loading ? (
            <div className="rounded-md border border-border/60 bg-card px-3 py-4 text-[13px] text-muted-foreground">
              Loading jobs...
            </div>
          ) : activeJobs.length > 0 ? (
            activeJobs.map((job) => (
              <CronJobCard
                key={job.id}
                job={job}
                busy={busyJobId === job.id}
                onToggle={(nextJob, nextActive) => void handleToggle(nextJob, nextActive)}
                onDelete={(nextJob) => void handleDelete(nextJob)}
              />
            ))
          ) : (
            <div className="rounded-md border border-dashed border-border/60 bg-card px-3 py-4 text-[13px] text-muted-foreground">
              No active cron jobs yet.
            </div>
          )}
        </div>
      </SettingRow>

      <SettingRow
        label="Inactive jobs"
        description="Paused jobs stay saved so you can enable them again later."
      >
        <div className="space-y-3">
          {loading ? (
            <div className="rounded-md border border-border/60 bg-card px-3 py-4 text-[13px] text-muted-foreground">
              Loading jobs...
            </div>
          ) : inactiveJobs.length > 0 ? (
            inactiveJobs.map((job) => (
              <CronJobCard
                key={job.id}
                job={job}
                busy={busyJobId === job.id}
                onToggle={(nextJob, nextActive) => void handleToggle(nextJob, nextActive)}
                onDelete={(nextJob) => void handleDelete(nextJob)}
              />
            ))
          ) : (
            <div className="rounded-md border border-dashed border-border/60 bg-card px-3 py-4 text-[13px] text-muted-foreground">
              No inactive cron jobs.
            </div>
          )}
        </div>
      </SettingRow>
    </div>
  )
}
