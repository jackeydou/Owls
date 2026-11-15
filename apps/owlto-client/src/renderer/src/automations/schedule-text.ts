import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { AutomationSchedule } from '../../../shared/automations'

const pad = (n: number) => String(n).padStart(2, '0')
export const clockText = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`

/** Weekday names in the UI language, Sunday first; Chinese reads better short (周一). */
export function useWeekdayNames(): string[] {
  const { i18n } = useTranslation()
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language, {
      weekday: i18n.language.startsWith('zh') ? 'short' : 'long'
    })
    // 2023-01-01 was a Sunday.
    return Array.from({ length: 7 }, (_, day) => format.format(new Date(2023, 0, 1 + day)))
  }, [i18n.language])
}

/** A schedule as one line, such as "Every Monday at 09:00". */
export function useScheduleText(): (schedule: AutomationSchedule) => string {
  const { t } = useTranslation()
  const weekdays = useWeekdayNames()
  return (schedule) => {
    if (schedule.frequency === 'hourly')
      return t('automations.every.hourly', { minute: pad(schedule.minute) })
    const time = clockText(schedule.hour, schedule.minute)
    if (schedule.frequency === 'weekly')
      return t('automations.every.weekly', { weekday: weekdays[schedule.weekday], time })
    if (schedule.frequency === 'monthly')
      return t('automations.every.monthly', { day: schedule.day, time })
    return t(`automations.every.${schedule.frequency}`, { time })
  }
}

/** A run time as a short local date and time, such as "Mon 09:00" or "11/18 09:00". */
export function useWhen(): (iso: string) => string {
  const { i18n } = useTranslation()
  return useMemo(() => {
    const time = new Intl.DateTimeFormat(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
    const day = new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' })
    const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' })
    return (iso) => {
      const date = new Date(iso)
      const now = new Date()
      const days = Math.round(
        (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
          new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
          86_400_000
      )
      const relative = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
      const prefix =
        Math.abs(days) <= 1
          ? relative.format(days, 'day')
          : Math.abs(days) < 7
            ? weekday.format(date)
            : day.format(date)
      return `${prefix} ${time.format(date)}`
    }
  }, [i18n.language])
}
