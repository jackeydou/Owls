import type { I18nKey } from './i18n'

type Translator = (key: I18nKey, options?: Record<string, unknown>) => string

export function padCronPart(value: string): string {
  return value.padStart(2, '0')
}

function isNumericPart(value: string): boolean {
  return /^\d+$/.test(value)
}

const CRON_DAY_KEYS: Record<string, I18nKey> = {
  '0': 'automation.cron.sunday',
  '1': 'automation.cron.monday',
  '2': 'automation.cron.tuesday',
  '3': 'automation.cron.wednesday',
  '4': 'automation.cron.thursday',
  '5': 'automation.cron.friday',
  '6': 'automation.cron.saturday',
  '7': 'automation.cron.sunday'
}

function translate(
  t: Translator | undefined,
  key: I18nKey,
  fallback: string,
  options?: Record<string, unknown>
): string {
  return t ? t(key, options) : fallback
}

export function describeCronSchedule(schedule: string, t?: Translator): string {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return translate(t, 'automation.cron.customSchedule', 'Custom schedule')

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  if (schedule === '* * * * *') return translate(t, 'automation.cron.everyMinute', 'Every minute')
  if (
    /^\*\/\d+$/.test(minute) &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const count = minute.slice(2)
    return translate(t, 'automation.cron.everyMinutes', `Every ${count} minutes`, { count })
  }
  if (
    isNumericPart(minute) &&
    /^\*\/\d+$/.test(hour) &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const count = hour.slice(2)
    const paddedMinute = padCronPart(minute)
    return translate(
      t,
      'automation.cron.everyHoursAtMinute',
      `Every ${count} hours at minute ${paddedMinute}`,
      { count, minute: paddedMinute }
    )
  }
  if (
    isNumericPart(minute) &&
    isNumericPart(hour) &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const time = `${padCronPart(hour)}:${padCronPart(minute)}`
    return translate(t, 'automation.cron.dailyAt', `Daily at ${time}`, { time })
  }
  if (
    isNumericPart(minute) &&
    isNumericPart(hour) &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '1-5'
  ) {
    const time = `${padCronPart(hour)}:${padCronPart(minute)}`
    return translate(t, 'automation.cron.weekdaysAt', `Weekdays at ${time}`, { time })
  }
  if (
    isNumericPart(minute) &&
    isNumericPart(hour) &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek !== '*'
  ) {
    const dayKey = CRON_DAY_KEYS[dayOfWeek]
    const day = dayKey && t ? t(dayKey) : dayOfWeek
    const time = `${padCronPart(hour)}:${padCronPart(minute)}`
    return translate(t, 'automation.cron.everyDayAt', `Every ${day} at ${time}`, { day, time })
  }

  return translate(t, 'automation.cron.customSchedule', 'Custom schedule')
}

export function formatDateTime(value: string | null | undefined, t?: Translator): string {
  if (!value) return translate(t, 'automation.time.never', 'Never')
  return new Date(value).toLocaleString()
}

export function formatRelativeDateTime(value: string | null | undefined, t?: Translator): string {
  if (!value) return translate(t, 'automation.time.never', 'Never')

  const timestamp = new Date(value).getTime()
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return translate(t, 'automation.time.justNow', 'just now')
  if (mins < 60) return translate(t, 'automation.time.minutesAgo', `${mins}m ago`, { count: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return translate(t, 'automation.time.hoursAgo', `${hours}h ago`, { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return translate(t, 'automation.time.daysAgo', `${days}d ago`, { count: days })
  return new Date(value).toLocaleDateString()
}
