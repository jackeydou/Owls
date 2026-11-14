import type {
  CreateCronJobParams,
  CronJob,
  CronJobRunSession,
  UpdateCronJobPatch
} from '@renderer/../../preload/index.d'
import { create } from 'zustand'

type AutomationState = {
  jobs: CronJob[]
  runSessionsByJobId: Record<string, CronJobRunSession[]>
  loaded: boolean
  loading: boolean
  busyJobId: string | null
  error: string | null
  load: () => Promise<void>
  loadRunSessions: (jobId: string) => Promise<void>
  createJob: (params: CreateCronJobParams) => Promise<CronJob | null>
  updateJob: (jobId: string, patch: UpdateCronJobPatch) => Promise<CronJob | null>
  toggleJob: (jobId: string, active: boolean) => Promise<CronJob | null>
  deleteJob: (jobId: string) => Promise<boolean>
  runNow: (jobId: string) => Promise<CronJob | null>
  getJob: (jobId: string) => CronJob | undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function upsertJob(jobs: CronJob[], nextJob: CronJob): CronJob[] {
  const existingIndex = jobs.findIndex((job) => job.id === nextJob.id)
  if (existingIndex === -1) return [nextJob, ...jobs]
  return jobs.map((job) => (job.id === nextJob.id ? nextJob : job))
}

export const useAutomationStore = create<AutomationState>((set, get) => ({
  jobs: [],
  runSessionsByJobId: {},
  loaded: false,
  loading: false,
  busyJobId: null,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const jobs = await window.api.cron.list()
      set({ jobs, loaded: true, loading: false })
    } catch (error) {
      set({ error: errorMessage(error), loaded: true, loading: false })
    }
  },

  loadRunSessions: async (jobId) => {
    if (!jobId) return
    set({ error: null })
    try {
      const runSessions = await window.api.cron.runs(jobId)
      set((state) => ({
        runSessionsByJobId: {
          ...state.runSessionsByJobId,
          [jobId]: runSessions
        }
      }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  createJob: async (params) => {
    set({ error: null })
    try {
      const job = await window.api.cron.create(params)
      set((state) => ({ jobs: upsertJob(state.jobs, job) }))
      return job
    } catch (error) {
      set({ error: errorMessage(error) })
      return null
    }
  },

  updateJob: async (jobId, patch) => {
    set({ busyJobId: jobId, error: null })
    try {
      const job = await window.api.cron.update(jobId, patch)
      set((state) => ({ jobs: upsertJob(state.jobs, job), busyJobId: null }))
      return job
    } catch (error) {
      set({ error: errorMessage(error), busyJobId: null })
      return null
    }
  },

  toggleJob: async (jobId, active) => {
    set({ busyJobId: jobId, error: null })
    try {
      const job = await window.api.cron.toggle(jobId, active)
      set((state) => ({ jobs: upsertJob(state.jobs, job), busyJobId: null }))
      return job
    } catch (error) {
      set({ error: errorMessage(error), busyJobId: null })
      return null
    }
  },

  deleteJob: async (jobId) => {
    set({ busyJobId: jobId, error: null })
    try {
      await window.api.cron.delete(jobId)
      set((state) => ({
        jobs: state.jobs.filter((job) => job.id !== jobId),
        busyJobId: null
      }))
      return true
    } catch (error) {
      set({ error: errorMessage(error), busyJobId: null })
      return false
    }
  },

  runNow: async (jobId) => {
    set({ busyJobId: jobId, error: null })
    try {
      const job = await window.api.cron.runNow(jobId)
      const runSessions = await window.api.cron.runs(jobId)
      set((state) => ({
        jobs: upsertJob(state.jobs, job),
        runSessionsByJobId: {
          ...state.runSessionsByJobId,
          [jobId]: runSessions
        },
        busyJobId: null
      }))
      return job
    } catch (error) {
      set({ error: errorMessage(error), busyJobId: null })
      return null
    }
  },

  getJob: (jobId) => get().jobs.find((job) => job.id === jobId)
}))
