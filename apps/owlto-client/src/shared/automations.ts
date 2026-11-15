import { z } from 'zod'

/** Longest automation name. */
export const AUTOMATION_NAME_LIMIT = 80
/** Longest automation instructions, in characters. */
export const AUTOMATION_INSTRUCTIONS_LIMIT = 8000
/** Most automations on one device, so a looping agent cannot fill the schedule. */
export const AUTOMATION_LIMIT = 50

export const automationFrequencies = ['hourly', 'daily', 'weekdays', 'weekly', 'monthly'] as const
export type AutomationFrequency = (typeof automationFrequencies)[number]

const hour = z.number().int().min(0).max(23)
const minute = z.number().int().min(0).max(59)
/** When an automation runs, in the device's local time. */
export const automationScheduleSchema = z.discriminatedUnion('frequency', [
  z.object({ frequency: z.literal('hourly'), minute }).strict(),
  z.object({ frequency: z.literal('daily'), hour, minute }).strict(),
  z.object({ frequency: z.literal('weekdays'), hour, minute }).strict(),
  z
    .object({
      frequency: z.literal('weekly'),
      /** 0 is Sunday, as `Date.getDay` counts. */
      weekday: z.number().int().min(0).max(6),
      hour,
      minute
    })
    .strict(),
  z
    .object({
      frequency: z.literal('monthly'),
      /** Runs on the month's last day when the month is shorter. */
      day: z.number().int().min(1).max(31),
      hour,
      minute
    })
    .strict()
])
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>

/**
 * Who a run wakes. `router` posts the instructions to a thread's Router; a null
 * `threadId` means the automation gets its own thread on its first run. `worker`
 * sends them to one worker as its next message.
 */
export const automationTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('router'), threadId: z.string().nullable() }),
  z.object({ kind: z.literal('worker'), threadId: z.string(), workerId: z.string() })
])
export type AutomationTarget = z.infer<typeof automationTargetSchema>

export const automationRunSchema = z.object({
  at: z.string(),
  status: z.enum(['started', 'failed']),
  /** The thread the run went to. */
  threadId: z.string().nullable(),
  /** Set when the run went to the thread's Router because its worker was gone. */
  fellBack: z.boolean().optional(),
  error: z.string().nullable()
})
export type AutomationRun = z.infer<typeof automationRunSchema>

/** A task that wakes the Router or a worker on a schedule. Local to this device. */
export const automationSchema = z.object({
  id: z.string(),
  name: z.string(),
  instructions: z.string(),
  schedule: automationScheduleSchema,
  target: automationTargetSchema,
  /** The new thread's project when the automation opens its own thread; null is the workspace. */
  projectId: z.string().nullable(),
  enabled: z.boolean(),
  createdBy: z.enum(['user', 'router', 'worker']),
  /** Null while the automation is paused. */
  nextRunAt: z.string().nullable(),
  lastRun: automationRunSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Automation = z.infer<typeof automationSchema>

const name = z.string().trim().min(1).max(AUTOMATION_NAME_LIMIT)
const instructions = z.string().trim().min(1).max(AUTOMATION_INSTRUCTIONS_LIMIT)
/** Creates an automation (no `id`) or edits one. Edits keep the automation's target. */
export const automationSaveSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    name,
    instructions,
    schedule: automationScheduleSchema,
    projectId: z.string().min(1).max(200).nullable(),
    enabled: z.boolean()
  })
  .strict()
export type AutomationSave = z.infer<typeof automationSaveSchema>
export const automationIdSchema = z.string().min(1).max(64)
export const automationEnableSchema = z
  .object({ id: automationIdSchema, enabled: z.boolean() })
  .strict()
export type AutomationEnable = z.infer<typeof automationEnableSchema>

const atTime = (date: Date, hours: number, minutes: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0)
const daysIn = (year: number, month: number) => new Date(year, month + 1, 0).getDate()

/**
 * The first local time after `after` that matches the schedule. Local `Date`
 * arithmetic keeps runs at the same wall-clock time across DST changes.
 */
export function nextAutomationRun(schedule: AutomationSchedule, after: Date): Date {
  if (schedule.frequency === 'hourly') {
    const next = new Date(after)
    next.setSeconds(0, 0)
    next.setMinutes(schedule.minute)
    while (next <= after) next.setHours(next.getHours() + 1)
    return next
  }
  if (schedule.frequency === 'monthly') {
    for (let offset = 0; offset <= 12; offset++) {
      const year = after.getFullYear()
      const month = after.getMonth() + offset
      const first = new Date(year, month, 1)
      const day = Math.min(schedule.day, daysIn(first.getFullYear(), first.getMonth()))
      const next = new Date(
        first.getFullYear(),
        first.getMonth(),
        day,
        schedule.hour,
        schedule.minute
      )
      if (next > after) return next
    }
    throw new Error('No monthly run within a year.')
  }
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + offset)
    const next = atTime(day, schedule.hour, schedule.minute)
    if (next <= after) continue
    const weekday = next.getDay()
    if (schedule.frequency === 'weekdays' && (weekday === 0 || weekday === 6)) continue
    if (schedule.frequency === 'weekly' && weekday !== schedule.weekday) continue
    return next
  }
  throw new Error('No run within a week.')
}

/**
 * The flat schedule agents fill in, turned into a stored schedule. Flat fields
 * keep the tool schema free of unions, which some agents' strict tool modes reject.
 */
export const automationScheduleInput = z
  .object({
    frequency: z
      .enum(automationFrequencies)
      .describe('hourly, daily, weekdays (Monday to Friday), weekly, or monthly.'),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .describe(
        'Local 24-hour time as HH:MM. For hourly, only the minutes count (e.g. "00:15" runs at a quarter past every hour).'
      ),
    weekday: z
      .number()
      .int()
      .min(0)
      .max(6)
      .optional()
      .describe('For weekly: 0 is Sunday through 6 Saturday. Defaults to Monday.'),
    day: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe(
        'For monthly: the day of the month; a shorter month uses its last day. Defaults to 1.'
      )
  })
  .strict()
export type AutomationScheduleInput = z.infer<typeof automationScheduleInput>

export function scheduleFromInput(input: AutomationScheduleInput): AutomationSchedule {
  const [hours, minutes] = input.time.split(':').map(Number)
  switch (input.frequency) {
    case 'hourly':
      return { frequency: 'hourly', minute: minutes }
    case 'weekly':
      return { frequency: 'weekly', weekday: input.weekday ?? 1, hour: hours, minute: minutes }
    case 'monthly':
      return { frequency: 'monthly', day: input.day ?? 1, hour: hours, minute: minutes }
    default:
      return { frequency: input.frequency, hour: hours, minute: minutes }
  }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const pad = (n: number) => String(n).padStart(2, '0')
/** An English schedule line for agents, e.g. "weekly on Monday at 09:00". */
export function describeSchedule(schedule: AutomationSchedule): string {
  if (schedule.frequency === 'hourly') return `hourly at minute ${pad(schedule.minute)}`
  const time = `${pad(schedule.hour)}:${pad(schedule.minute)}`
  if (schedule.frequency === 'weekly') return `weekly on ${WEEKDAYS[schedule.weekday]} at ${time}`
  if (schedule.frequency === 'monthly') return `monthly on day ${schedule.day} at ${time}`
  return `${schedule.frequency} at ${time}`
}
