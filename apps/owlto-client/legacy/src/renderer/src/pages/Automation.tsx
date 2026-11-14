import type { CronJob } from '@renderer/../../preload/index.d'
import { describeCronSchedule, formatRelativeDateTime } from '@renderer/lib/cron'
import { type I18nKey, useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { useAutomationStore } from '@renderer/stores/automation-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import {
  CheckCircle2,
  ClipboardList,
  Info,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  Sun,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

type AutomationTemplate = {
  id: string
  title: string
  description: string
  prompt: string
  schedule: string
  icon: React.ElementType
  iconClassName: string
}

type RepeatMode =
  | 'daily'
  | 'weekdays'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'
  | 'every30'
  | 'custom'

const WEEKDAY_REPEAT_MODES: Array<{ mode: RepeatMode; label: string; cronDay: string }> = [
  { mode: 'monday', label: 'Every Monday', cronDay: '1' },
  { mode: 'tuesday', label: 'Every Tuesday', cronDay: '2' },
  { mode: 'wednesday', label: 'Every Wednesday', cronDay: '3' },
  { mode: 'thursday', label: 'Every Thursday', cronDay: '4' },
  { mode: 'friday', label: 'Every Friday', cronDay: '5' },
  { mode: 'saturday', label: 'Every Saturday', cronDay: '6' },
  { mode: 'sunday', label: 'Every Sunday', cronDay: '0' }
]

const REPEAT_MODE_LABEL_KEYS: Partial<Record<RepeatMode, I18nKey>> = {
  daily: 'automation.repeat.daily',
  weekdays: 'automation.repeat.weekdays',
  monday: 'automation.repeat.monday',
  tuesday: 'automation.repeat.tuesday',
  wednesday: 'automation.repeat.wednesday',
  thursday: 'automation.repeat.thursday',
  friday: 'automation.repeat.friday',
  saturday: 'automation.repeat.saturday',
  sunday: 'automation.repeat.sunday',
  every30: 'automation.repeat.every30',
  custom: 'automation.repeat.custom'
}

const TEMPLATE_GROUPS: Array<{
  title: string
  templates: AutomationTemplate[]
}> = [
  {
    title: 'Recommended Tasks',
    templates: [
      {
        id: 'daily-plan',
        title: 'Plan Tomorrow',
        description: 'Every weekday at 8 PM, review open work and draft a plan for tomorrow.',
        prompt: 'Every weekday at 8 PM, review my open work and draft a todo list for tomorrow.',
        schedule: '0 20 * * 1-5',
        icon: Sun,
        iconClassName: 'bg-sky-500/10 text-sky-600 dark:text-sky-300'
      },
      {
        id: 'weekly-review',
        title: 'Create a Weekly Review',
        description: "Every Monday, summarize last week's work and identify follow-up items.",
        prompt:
          "Every Monday, summarize my work from last week and identify this week's follow-up items.",
        schedule: '0 9 * * 1',
        icon: ClipboardList,
        iconClassName: 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
      }
    ]
  }
]

function scheduleToRepeatMode(schedule: string): RepeatMode {
  if (schedule === '*/30 * * * *') return 'every30'
  if (/^\d+ \d+ \* \* 1-5$/.test(schedule)) return 'weekdays'
  if (/^\d+ \d+ \* \* \d$/.test(schedule)) {
    const cronDay = schedule.split(/\s+/)[4]
    return WEEKDAY_REPEAT_MODES.find((option) => option.cronDay === cronDay)?.mode ?? 'monday'
  }
  if (/^\d+ \d+ \* \* \*$/.test(schedule)) return 'daily'
  return 'custom'
}

function timeFromSchedule(schedule: string): string {
  const [minute = '0', hour = '9'] = schedule.split(/\s+/)
  if (!/^\d+$/.test(hour) || !/^\d+$/.test(minute)) return '09:00'
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
}

function buildSchedule(repeatMode: RepeatMode, time: string, customCron: string): string {
  if (repeatMode === 'custom') return customCron.trim()
  if (repeatMode === 'every30') return '*/30 * * * *'

  const [hour = '9', minute = '0'] = time.split(':')
  if (repeatMode === 'weekdays') return `${Number(minute)} ${Number(hour)} * * 1-5`
  const weekdayOption = WEEKDAY_REPEAT_MODES.find((option) => option.mode === repeatMode)
  if (weekdayOption) return `${Number(minute)} ${Number(hour)} * * ${weekdayOption.cronDay}`
  return `${Number(minute)} ${Number(hour)} * * *`
}

function deriveTitle(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0]?.trim() || 'Untitled automation'
  return firstLine.length > 56 ? `${firstLine.slice(0, 53)}...` : firstLine
}

function KeepAwakeSwitch({
  checked,
  onClick
}: {
  checked: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 rounded-full border p-0.5 transition-colors',
        checked ? 'border-blue-500 bg-blue-500' : 'border-border/70 bg-foreground/10'
      )}
    >
      <span
        className={cn(
          'block size-5 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  )
}

export function AutomationAwakeNotice({ className }: { className?: string }): React.JSX.Element {
  const { t } = useI18n()
  const { automationKeepAwake, load: loadSettings, updateAutomationKeepAwake } = useSettingsStore()

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-card-elevated px-4 py-3 shadow-sm',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Info className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
        <p className="text-[13px] leading-5 text-foreground">{t('automation.awakeNotice')}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <Sun className="size-4 text-muted-foreground" strokeWidth={1.8} />
        <span className="text-[13px] font-medium text-foreground">{t('automation.keepAwake')}</span>
        <KeepAwakeSwitch
          checked={automationKeepAwake}
          onClick={() => void updateAutomationKeepAwake(!automationKeepAwake)}
        />
      </div>
    </div>
  )
}

function AutomationCard({
  job,
  busy,
  onToggle,
  onDelete
}: {
  job: CronJob
  busy: boolean
  onToggle: (job: CronJob) => void
  onDelete: (job: CronJob) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const statusLabel =
    job.lastRunStatus === 'running'
      ? t('automation.running')
      : job.active
        ? t('automation.active')
        : job.lastRunStatus === 'error'
          ? t('automation.needsAttention')
          : t('automation.paused')

  return (
    <div className="group -mx-2 flex items-center gap-3 rounded-lg border-b border-border/50 px-2 py-3 transition hover:bg-card-elevated-hover last:border-b-0">
      <button
        type="button"
        disabled={busy}
        onClick={() => onToggle(job)}
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md transition hover:bg-sidebar-hover disabled:opacity-40',
          job.active ? 'text-emerald-500' : 'text-muted-foreground/70'
        )}
        aria-label={
          job.active ? t('automation.pauseAutomation') : t('automation.activateAutomation')
        }
      >
        {job.active ? (
          <PlayCircle className="size-4" strokeWidth={1.9} />
        ) : (
          <PauseCircle className="size-4" strokeWidth={1.9} />
        )}
      </button>

      <Link to={`/automation/${job.id}`} className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">{job.name}</span>
        </div>
        <div className="mt-1 line-clamp-1 text-[12px] text-muted-foreground">{job.prompt}</div>
      </Link>

      <div className="hidden shrink-0 text-right sm:block">
        <div className="text-[12px] text-muted-foreground">
          {describeCronSchedule(job.schedule, t)}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground/70">
          {statusLabel} -{' '}
          {t('automation.lastRun', { time: formatRelativeDateTime(job.lastRunAt, t) })}
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => onDelete(job)}
        className="rounded-md p-1.5 text-muted-foreground/0 transition group-hover:text-muted-foreground hover:bg-sidebar-hover hover:text-destructive disabled:opacity-40"
        aria-label={t('automation.delete', { name: job.name })}
      >
        <Trash2 className="size-3.5" strokeWidth={1.8} />
      </button>
    </div>
  )
}

function TemplateCard({
  template,
  onUse
}: {
  template: AutomationTemplate
  onUse: (template: AutomationTemplate) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const Icon = template.icon
  const titleKey = templateTitleKey(template.id)
  const descriptionKey = templateDescriptionKey(template.id)
  return (
    <button
      type="button"
      onClick={() => onUse(template)}
      className="flex min-h-28 flex-col items-start rounded-xl border border-border/60 bg-card-elevated px-4 py-3 text-left transition hover:border-border-strong hover:bg-card-elevated-hover"
    >
      <span
        className={cn(
          'mb-3 flex size-7 items-center justify-center rounded-lg',
          template.iconClassName
        )}
      >
        <Icon className="size-4" strokeWidth={1.8} />
      </span>
      <span className="text-[13px] font-semibold text-foreground">
        {titleKey ? t(titleKey) : template.title}
      </span>
      <span className="mt-1 text-[12px] leading-5 text-muted-foreground">
        {descriptionKey ? t(descriptionKey) : template.description}
      </span>
    </button>
  )
}

function templateTitleKey(id: string): I18nKey | null {
  const keys: Record<string, I18nKey> = {
    'daily-plan': 'automation.template.dailyPlan.title',
    'weekly-review': 'automation.template.weeklyReview.title'
  }
  return keys[id] ?? null
}

function templateDescriptionKey(id: string): I18nKey | null {
  const keys: Record<string, I18nKey> = {
    'daily-plan': 'automation.template.dailyPlan.description',
    'weekly-review': 'automation.template.weeklyReview.description'
  }
  return keys[id] ?? null
}

function templatePromptKey(id: string): I18nKey | null {
  const keys: Record<string, I18nKey> = {
    'daily-plan': 'automation.template.dailyPlan.prompt',
    'weekly-review': 'automation.template.weeklyReview.prompt'
  }
  return keys[id] ?? null
}

export function CreateAutomationDialog({
  open,
  template = null,
  saving,
  error,
  onClose,
  onCreate
}: {
  open: boolean
  template?: AutomationTemplate | null
  saving: boolean
  error: string | null
  onClose: () => void
  onCreate: (params: { name: string; prompt: string; schedule: string }) => Promise<void>
}): React.JSX.Element | null {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('weekdays')
  const [time, setTime] = useState('09:00')
  const [customCron, setCustomCron] = useState('0 9 * * 1-5')

  useEffect(() => {
    if (!open) return
    const nextSchedule = template?.schedule ?? '0 9 * * 1-5'
    const titleKey = template ? templateTitleKey(template.id) : null
    const promptKey = template ? templatePromptKey(template.id) : null
    setName(template ? (titleKey ? t(titleKey) : template.title) : '')
    setPrompt(template ? (promptKey ? t(promptKey) : template.prompt) : '')
    setRepeatMode(scheduleToRepeatMode(nextSchedule))
    setTime(timeFromSchedule(nextSchedule))
    setCustomCron(nextSchedule)
  }, [open, template, t])

  if (!open) return null

  const schedule = buildSchedule(repeatMode, time, customCron)
  const canCreate = prompt.trim() && schedule.trim()

  const handleCreate = async (): Promise<void> => {
    if (!canCreate) return
    await onCreate({
      name: name.trim() || deriveTitle(prompt),
      prompt: prompt.trim(),
      schedule
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('automation.createAria')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">
              {template
                ? templateTitleKey(template.id)
                  ? t(templateTitleKey(template.id) as I18nKey)
                  : template.title
                : t('automation.newAutomation')}
            </h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {t('automation.createDescription')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground"
            aria-label={t('automation.close')}
          >
            <X className="size-4" strokeWidth={1.8} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <span className="text-[12px] font-medium text-foreground">
              {t('automation.field.title')}
            </span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('automation.field.titlePlaceholder')}
              className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/45 focus:border-border-strong"
            />
          </label>

          <label className="block">
            <span className="text-[12px] font-medium text-foreground">
              {t('automation.field.agentTask')}
            </span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t('automation.field.agentTaskPlaceholder')}
              className="mt-2 min-h-36 w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-[13px] leading-5 text-foreground outline-none transition placeholder:text-muted-foreground/45 focus:border-border-strong"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
            <label className="block">
              <span className="text-[12px] font-medium text-foreground">
                {t('automation.field.repeats')}
              </span>
              <select
                value={repeatMode}
                onChange={(event) => setRepeatMode(event.target.value as RepeatMode)}
                className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none transition focus:border-border-strong"
              >
                <option value="weekdays">{t('automation.repeat.weekdays')}</option>
                <option value="daily">{t('automation.repeat.daily')}</option>
                {WEEKDAY_REPEAT_MODES.map((option) => (
                  <option key={option.mode} value={option.mode}>
                    {t(REPEAT_MODE_LABEL_KEYS[option.mode] ?? 'automation.repeat.monday')}
                  </option>
                ))}
                <option value="every30">{t('automation.repeat.every30')}</option>
                <option value="custom">{t('automation.repeat.custom')}</option>
              </select>
            </label>

            {repeatMode === 'custom' ? (
              <label className="block">
                <span className="text-[12px] font-medium text-foreground">
                  {t('automation.field.cron')}
                </span>
                <input
                  type="text"
                  value={customCron}
                  onChange={(event) => setCustomCron(event.target.value)}
                  placeholder="0 9 * * 1-5"
                  className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2 font-mono text-[13px] text-foreground outline-none transition focus:border-border-strong"
                  spellCheck={false}
                />
              </label>
            ) : repeatMode === 'every30' ? (
              <div className="rounded-xl border border-border/60 bg-card-muted/30 px-3 py-2">
                <span className="text-[12px] font-medium text-foreground">
                  {t('automation.field.cron')}
                </span>
                <div className="mt-2 font-mono text-[13px] text-muted-foreground">*/30 * * * *</div>
              </div>
            ) : (
              <div className="grid gap-3">
                <label className="block">
                  <span className="text-[12px] font-medium text-foreground">
                    {t('automation.field.time')}
                  </span>
                  <input
                    type="time"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none transition focus:border-border-strong"
                  />
                </label>
              </div>
            )}
          </div>

          {error ? (
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground"
          >
            {t('automation.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || !canCreate}
            onClick={() => void handleCreate()}
            className="rounded-lg bg-foreground px-3 py-2 text-[13px] font-medium text-background transition hover:opacity-90 disabled:opacity-35"
          >
            {saving ? t('automation.creating') : t('automation.create')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function AutomationPage(): React.JSX.Element {
  const { t } = useI18n()
  const { jobs, loaded, loading, busyJobId, error, load, createJob, toggleJob, deleteJob } =
    useAutomationStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<AutomationTemplate | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const activeJobs = useMemo(() => jobs.filter((job) => job.active), [jobs])
  const inactiveJobs = useMemo(() => jobs.filter((job) => !job.active), [jobs])

  const openDialog = (template: AutomationTemplate | null = null): void => {
    setSelectedTemplate(template)
    setDialogOpen(true)
  }

  const handleCreate = async (params: {
    name: string
    prompt: string
    schedule: string
  }): Promise<void> => {
    setCreating(true)
    const job = await createJob(params)
    setCreating(false)
    if (job) {
      setDialogOpen(false)
      setSelectedTemplate(null)
    }
  }

  const handleDelete = async (job: CronJob): Promise<void> => {
    const confirmed = window.confirm(t('automation.deleteConfirm', { name: job.name }))
    if (!confirmed) return
    await deleteJob(job.id)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-card px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
              {t('automation.title')}
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">{t('automation.description')}</p>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            {jobs.length > 0 ? (
              <div className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background/70 px-2.5 py-1.5">
                <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                  <CheckCircle2 className="size-3" strokeWidth={1.9} />
                </span>
                <span className="text-[12px] font-medium text-foreground">
                  {t('automation.activeCount', { count: activeJobs.length })}
                </span>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => openDialog()}
              className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-[13px] font-medium text-background shadow-sm transition hover:opacity-90"
            >
              <Plus className="size-4" strokeWidth={1.8} />
              {t('automation.new')}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
            {error}
          </div>
        ) : null}

        <AutomationAwakeNotice className="mb-6" />

        {!loaded && loading ? (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
            {t('automation.loading')}
          </div>
        ) : jobs.length > 0 ? (
          <section>
            <h2 className="mb-4 text-[13px] font-semibold text-foreground">
              {t('automation.current')}
            </h2>
            <div className="rounded-xl border border-border/60 bg-card-elevated px-4">
              {[...activeJobs, ...inactiveJobs].map((job) => (
                <AutomationCard
                  key={job.id}
                  job={job}
                  busy={busyJobId === job.id}
                  onToggle={(nextJob) => void toggleJob(nextJob.id, !nextJob.active)}
                  onDelete={(nextJob) => void handleDelete(nextJob)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {jobs.length === 0 ? (
          <div className="space-y-8">
            {TEMPLATE_GROUPS.map((group) => (
              <section key={group.title}>
                <h2 className="mb-3 text-[13px] font-semibold text-foreground">
                  {t('automation.recommendedTasks')}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.templates.map((template) => (
                    <TemplateCard key={template.id} template={template} onUse={openDialog} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>

      <CreateAutomationDialog
        open={dialogOpen}
        template={selectedTemplate}
        saving={creating}
        error={error}
        onClose={() => {
          setDialogOpen(false)
          setSelectedTemplate(null)
        }}
        onCreate={handleCreate}
      />
    </div>
  )
}
