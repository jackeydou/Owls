import * as crypto from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import cron, { type ScheduledTask } from 'node-cron'
import { db } from '../db/index.js'
import { cronJobs } from '../db/schema.js'
import {
  getSessionsByAgentId,
  getSettingsForRenderer,
  type SessionIndexEntry
} from '../stores/settings-store.js'

export type CronJob = {
  id: string
  name: string
  schedule: string
  prompt: string
  cwd: string
  active: boolean
  createdAt: string
  updatedAt: string
  lastRunAt: string | null
  lastRunStatus: 'running' | 'success' | 'error' | null
}

export type CreateCronJobParams = {
  name: string
  schedule: string
  prompt: string
  cwd?: string
  active?: boolean
}

export type UpdateCronJobPatch = Partial<{
  name: string
  schedule: string
  prompt: string
  cwd: string
}>

export type CronJobRunSession = SessionIndexEntry

export type CronRunResult = {
  sessionId?: string
}

export type CronEventPayload =
  | {
      type: 'run-session-created'
      jobId: string
      sessionId: string
    }
  | {
      type: 'run-complete'
      jobId: string
      sessionId: string | null
    }

type CronJobRunnerHooks = {
  onSessionCreated: (sessionId: string) => void
}

type CronJobRunner = (job: CronJob, hooks: CronJobRunnerHooks) => Promise<CronRunResult | undefined>
type CronEventListener = (event: CronEventPayload) => void

const scheduledTasks = new Map<string, ScheduledTask>()
const runningJobs = new Set<string>()
const cronEventListeners = new Set<CronEventListener>()
let cronJobRunner: CronJobRunner | null = null

function toCronJob(row: typeof cronJobs.$inferSelect): CronJob {
  return {
    id: row.id,
    name: row.name,
    schedule: row.schedule,
    prompt: row.prompt,
    cwd: row.cwd,
    active: row.active === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastRunAt: row.lastRunAt ?? null,
    lastRunStatus: (row.lastRunStatus as CronJob['lastRunStatus']) ?? null
  }
}

function requireNonEmpty(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error(`${field} is required`)
  }
  return trimmed
}

function validateSchedule(schedule: string): string {
  const normalized = requireNonEmpty(schedule, 'Schedule')
  if (!cron.validate(normalized)) {
    throw new Error('Invalid cron schedule')
  }
  return normalized
}

function stopScheduledTask(jobId: string): void {
  const task = scheduledTasks.get(jobId)
  if (!task) return
  task.stop()
  task.destroy()
  scheduledTasks.delete(jobId)
}

function getCronJobRow(jobId: string): typeof cronJobs.$inferSelect | undefined {
  return db().select().from(cronJobs).where(eq(cronJobs.id, jobId)).get()
}

export function getCronJobAgentId(jobId: string): string {
  return `automation:${jobId}`
}

function emitCronEvent(event: CronEventPayload): void {
  for (const listener of cronEventListeners) {
    listener(event)
  }
}

function scheduleCronJob(job: CronJob): void {
  stopScheduledTask(job.id)
  if (!job.active) return

  const task = cron.schedule(job.schedule, () => {
    void runCronJob(job.id)
  })
  scheduledTasks.set(job.id, task)
}

function updateRunState(
  jobId: string,
  patch: {
    lastRunAt?: string | null
    lastRunStatus?: CronJob['lastRunStatus']
  }
): void {
  db()
    .update(cronJobs)
    .set({
      lastRunAt: patch.lastRunAt ?? null,
      lastRunStatus: patch.lastRunStatus ?? null
    })
    .where(eq(cronJobs.id, jobId))
    .run()
}

async function runCronJob(jobId: string, options?: { ignoreActive?: boolean }): Promise<void> {
  if (runningJobs.has(jobId)) {
    return
  }

  const row = getCronJobRow(jobId)
  if (!row || (!options?.ignoreActive && row.active !== 1)) {
    stopScheduledTask(jobId)
    return
  }
  if (!cronJobRunner) {
    console.warn('[cron] no runner configured, skipping job %s', jobId)
    return
  }

  runningJobs.add(jobId)
  const startedAt = new Date().toISOString()
  updateRunState(jobId, {
    lastRunAt: startedAt,
    lastRunStatus: 'running'
  })

  try {
    let runSessionId: string | null = null
    const result = await cronJobRunner(toCronJob(row), {
      onSessionCreated(sessionId) {
        runSessionId = sessionId
        emitCronEvent({
          type: 'run-session-created',
          jobId,
          sessionId
        })
      }
    })
    updateRunState(jobId, {
      lastRunAt: startedAt,
      lastRunStatus: 'success'
    })
    emitCronEvent({
      type: 'run-complete',
      jobId,
      sessionId: result?.sessionId ?? runSessionId
    })
  } catch (error) {
    console.error('[cron] job %s failed:', jobId, error)
    updateRunState(jobId, {
      lastRunAt: startedAt,
      lastRunStatus: 'error'
    })
    emitCronEvent({
      type: 'run-complete',
      jobId,
      sessionId: null
    })
  } finally {
    runningJobs.delete(jobId)
  }
}

export function setCronJobRunner(runner: CronJobRunner | null): void {
  cronJobRunner = runner
}

export function subscribeToCronEvents(listener: CronEventListener): () => void {
  cronEventListeners.add(listener)
  return () => {
    cronEventListeners.delete(listener)
  }
}

export function initCronScheduler(): void {
  for (const row of db().select().from(cronJobs).all()) {
    scheduleCronJob(toCronJob(row))
  }
}

export function disposeCronScheduler(): void {
  for (const jobId of scheduledTasks.keys()) {
    stopScheduledTask(jobId)
  }
  runningJobs.clear()
}

export function listCronJobs(): CronJob[] {
  return db()
    .select()
    .from(cronJobs)
    .orderBy(desc(cronJobs.active), desc(cronJobs.updatedAt))
    .all()
    .map(toCronJob)
}

export function listCronJobRunSessions(jobId: string): CronJobRunSession[] {
  return getSessionsByAgentId(getCronJobAgentId(jobId))
}

export function createCronJob(params: CreateCronJobParams): CronJob {
  const now = new Date().toISOString()
  const job: typeof cronJobs.$inferInsert = {
    id: crypto.randomUUID(),
    name: requireNonEmpty(params.name, 'Name'),
    schedule: validateSchedule(params.schedule),
    prompt: requireNonEmpty(params.prompt, 'Prompt'),
    cwd: requireNonEmpty(
      params.cwd ?? getSettingsForRenderer().workingDirectory,
      'Working directory'
    ),
    active: params.active === false ? 0 : 1,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    lastRunStatus: null
  }

  db().insert(cronJobs).values(job).run()
  const created = toCronJob(job as typeof cronJobs.$inferSelect)
  scheduleCronJob(created)
  return created
}

export function updateCronJob(jobId: string, patch: UpdateCronJobPatch): CronJob {
  const existing = getCronJobRow(jobId)
  if (!existing) {
    throw new Error('Cron job not found')
  }

  const next = {
    name: patch.name !== undefined ? requireNonEmpty(patch.name, 'Name') : existing.name,
    schedule: patch.schedule !== undefined ? validateSchedule(patch.schedule) : existing.schedule,
    prompt: patch.prompt !== undefined ? requireNonEmpty(patch.prompt, 'Prompt') : existing.prompt,
    cwd: patch.cwd !== undefined ? requireNonEmpty(patch.cwd, 'Working directory') : existing.cwd
  }

  db()
    .update(cronJobs)
    .set({
      ...next,
      updatedAt: new Date().toISOString()
    })
    .where(eq(cronJobs.id, jobId))
    .run()

  const updated = toCronJob({
    ...existing,
    ...next,
    updatedAt: new Date().toISOString()
  })
  scheduleCronJob(updated)
  return updated
}

export function toggleCronJob(jobId: string, active: boolean): CronJob {
  const existing = getCronJobRow(jobId)
  if (!existing) {
    throw new Error('Cron job not found')
  }

  const updatedAt = new Date().toISOString()
  db()
    .update(cronJobs)
    .set({
      active: active ? 1 : 0,
      updatedAt
    })
    .where(eq(cronJobs.id, jobId))
    .run()

  const updated = toCronJob({
    ...existing,
    active: active ? 1 : 0,
    updatedAt
  })
  scheduleCronJob(updated)
  return updated
}

export async function runCronJobNow(jobId: string): Promise<CronJob> {
  const existing = getCronJobRow(jobId)
  if (!existing) {
    throw new Error('Cron job not found')
  }

  await runCronJob(jobId, { ignoreActive: true })
  const updated = getCronJobRow(jobId)
  return toCronJob(updated ?? existing)
}

export function deleteCronJob(jobId: string): void {
  stopScheduledTask(jobId)
  db().delete(cronJobs).where(eq(cronJobs.id, jobId)).run()
}
