import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { IconButton } from '@renderer/components/ui/icon-button'
import { AutomationIcon, XIcon } from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AUTOMATION_INSTRUCTIONS_LIMIT,
  AUTOMATION_NAME_LIMIT,
  type AutomationFrequency,
  type AutomationSchedule,
  automationFrequencies
} from '../../../shared/automations'
import { WORKSPACE_ID } from '../../../shared/workspace'
import { failureMessage, uiFailure } from '../app/failures'
import { useAppStore } from '../app/store'
import { clockText, useWeekdayNames } from './schedule-text'
import { type Editing, useAutomationsStore } from './store'

/** The dialog's schedule fields; each frequency reads only the ones it needs. */
type Fields = { frequency: AutomationFrequency; time: string; weekday: number; day: number }

function fieldsOf(schedule: AutomationSchedule | null): Fields {
  const now = new Date()
  const base: Fields = {
    frequency: 'daily',
    time: '09:00',
    weekday: now.getDay(),
    day: now.getDate()
  }
  if (!schedule) return base
  if (schedule.frequency === 'hourly')
    return { ...base, frequency: 'hourly', time: clockText(9, schedule.minute) }
  return {
    ...base,
    frequency: schedule.frequency,
    time: clockText(schedule.hour, schedule.minute),
    ...(schedule.frequency === 'weekly' ? { weekday: schedule.weekday } : {}),
    ...(schedule.frequency === 'monthly' ? { day: schedule.day } : {})
  }
}

function scheduleOf(fields: Fields): AutomationSchedule {
  const [hour = 9, minute = 0] = fields.time.split(':').map(Number)
  switch (fields.frequency) {
    case 'hourly':
      return { frequency: 'hourly', minute }
    case 'weekly':
      return { frequency: 'weekly', weekday: fields.weekday, hour, minute }
    case 'monthly':
      return { frequency: 'monthly', day: fields.day, hour, minute }
    default:
      return { frequency: fields.frequency, hour, minute }
  }
}

const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1)

/** Creates or edits an automation: a name, instructions, and when it runs. */
export function AutomationDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const { t } = useTranslation()
  const save = useAutomationsStore((s) => s.save)
  const projects = useAppStore((s) => s.projects)
  const focused = useAppStore((s) => s.routerProjectId)
  const weekdays = useWeekdayNames()
  const existing = editing.kind === 'edit' ? editing.automation : null
  const [name, setName] = useState(existing?.name ?? '')
  const [instructions, setInstructions] = useState(existing?.instructions ?? '')
  const [projectId, setProjectId] = useState<string | null>(
    existing ? existing.projectId : focused === WORKSPACE_ID ? null : focused
  )
  const [fields, setFields] = useState(() => fieldsOf(existing?.schedule ?? null))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { name: useId(), instructions: useId(), project: useId() }
  // An automation that already runs in a thread keeps it; only its own thread can move.
  const ownThread = !existing || existing.target.threadId === null
  const ready = name.trim() && instructions.trim() && !saving
  const title = t(existing ? 'automations.dialogEdit' : 'automations.dialogNew')
  const set = (next: Partial<Fields>) => setFields((current) => ({ ...current, ...next }))
  async function submit() {
    if (!ready) return
    setSaving(true)
    setError(null)
    try {
      await save({
        ...(existing ? { id: existing.id } : {}),
        name,
        instructions,
        schedule: scheduleOf(fields),
        projectId: ownThread ? projectId : (existing?.projectId ?? null),
        enabled: existing?.enabled ?? true
      })
      onClose()
    } catch (failure) {
      const message = failureMessage(uiFailure(failure))
      setError(message || t('automations.saveFailed'))
      setSaving(false)
    }
  }
  const minute = Number(fields.time.split(':')[1] ?? 0)
  return (
    <Dialog className="automation-dialog" aria-label={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <header>
          <h2>{title}</h2>
          <IconButton
            size="sm"
            label={t('automations.cancel')}
            icon={<XIcon size={16} />}
            onClick={onClose}
          />
        </header>
        <label htmlFor={ids.name} className="automation-field">
          <span>{t('automations.name')}</span>
        </label>
        <input
          id={ids.name}
          className="automation-name"
          value={name}
          maxLength={AUTOMATION_NAME_LIMIT}
          placeholder={t('automations.namePlaceholder')}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
        <div className="automation-prompt">
          <textarea
            id={ids.instructions}
            aria-label={t('automations.instructions')}
            value={instructions}
            maxLength={AUTOMATION_INSTRUCTIONS_LIMIT}
            placeholder={t('automations.instructionsPlaceholder')}
            onChange={(event) => setInstructions(event.target.value)}
          />
          <footer>
            {ownThread ? (
              <Select
                id={ids.project}
                aria-label={t('automations.project')}
                value={projectId ?? ''}
                onChange={(event) => setProjectId(event.target.value || null)}
              >
                <option value="">{t('automations.workspace')}</option>
                {projects
                  .filter((project) => project.id !== WORKSPACE_ID)
                  .map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
              </Select>
            ) : (
              <span />
            )}
            <span className="automation-runner">{t('automations.target.router')}</span>
          </footer>
        </div>
        <p className="automation-notice">
          {t(ownThread ? 'automations.runsIn' : 'automations.runsInThread')}
          {t('automations.openNote')}
        </p>
        <div className="automation-trigger">
          <span className="automation-trigger-label">{t('automations.trigger')}</span>
          <span className="automation-chip">
            <AutomationIcon size={16} />
            {t('automations.schedule')}
          </span>
          <Select
            aria-label={t('automations.frequency')}
            value={fields.frequency}
            onChange={(event) => set({ frequency: event.target.value as AutomationFrequency })}
          >
            {automationFrequencies.map((value) => (
              <option key={value} value={value}>
                {t(`automations.frequency.${value}`)}
              </option>
            ))}
          </Select>
          {fields.frequency === 'weekly' ? (
            <Select
              aria-label={t('automations.weekday')}
              value={fields.weekday}
              onChange={(event) => set({ weekday: Number(event.target.value) })}
            >
              {/* Monday first, as calendars usually start the week. */}
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <option key={day} value={day}>
                  {weekdays[day]}
                </option>
              ))}
            </Select>
          ) : null}
          {fields.frequency === 'monthly' ? (
            <Select
              aria-label={t('automations.day')}
              value={fields.day}
              onChange={(event) => set({ day: Number(event.target.value) })}
            >
              {DAYS.map((day) => (
                <option key={day} value={day}>
                  {t('automations.dayOption', { day })}
                </option>
              ))}
            </Select>
          ) : null}
          {fields.frequency === 'hourly' ? (
            <Select
              aria-label={t('automations.minute')}
              value={MINUTES.includes(minute) ? minute : 0}
              onChange={(event) => set({ time: clockText(9, Number(event.target.value)) })}
            >
              {MINUTES.map((value) => (
                <option key={value} value={value}>
                  {t('automations.minuteOption', { minute: String(value).padStart(2, '0') })}
                </option>
              ))}
            </Select>
          ) : (
            <input
              type="time"
              className="automation-time"
              aria-label={t('automations.time')}
              value={fields.time}
              required
              onChange={(event) => event.target.value && set({ time: event.target.value })}
            />
          )}
        </div>
        {error ? (
          <p className="automation-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer className="automation-actions">
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            {t('automations.cancel')}
          </Button>
          <Button type="submit" size="sm" pending={saving} disabled={!ready}>
            {t(existing ? 'automations.save' : 'automations.create')}
          </Button>
        </footer>
      </form>
    </Dialog>
  )
}
