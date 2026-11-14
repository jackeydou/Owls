import { ipcMain, type WebContents } from 'electron'
import {
  type CreateCronJobParams,
  type CronEventPayload,
  createCronJob,
  deleteCronJob,
  disposeCronScheduler,
  listCronJobRunSessions,
  listCronJobs,
  runCronJobNow,
  subscribeToCronEvents,
  toggleCronJob,
  type UpdateCronJobPatch,
  updateCronJob
} from './cron-scheduler.js'

const CRON_EVENT_CHANNEL = 'cron:event'
let getCronWebContents: () => WebContents | null = () => null
let unsubscribeCronEvents: (() => void) | null = null

export function setCronWebContentsGetter(getter: () => WebContents | null): void {
  getCronWebContents = getter
}

function forwardCronEvent(event: CronEventPayload): void {
  getCronWebContents()?.send(CRON_EVENT_CHANNEL, event)
}

export function registerCronIpc(): void {
  unsubscribeCronEvents ??= subscribeToCronEvents(forwardCronEvent)

  ipcMain.handle('cron:list', () => listCronJobs())

  ipcMain.handle('cron:runs', (_, jobId: string) => listCronJobRunSessions(jobId))

  ipcMain.handle('cron:create', (_, params: CreateCronJobParams) => createCronJob(params))

  ipcMain.handle('cron:update', (_, jobId: string, patch: UpdateCronJobPatch) =>
    updateCronJob(jobId, patch)
  )

  ipcMain.handle('cron:delete', (_, jobId: string) => {
    deleteCronJob(jobId)
    return { deleted: true }
  })

  ipcMain.handle('cron:run-now', (_, jobId: string) => runCronJobNow(jobId))

  ipcMain.handle('cron:toggle', (_, jobId: string, active: boolean) => toggleCronJob(jobId, active))
}

export function disposeCron(): void {
  unsubscribeCronEvents?.()
  unsubscribeCronEvents = null
  disposeCronScheduler()
}
