import { useTranslation } from 'react-i18next'
import type { CodexItem, CodexRequest, CodexRouter, CodexSession } from '../../../shared/codex'
import type { RouterWorker } from '../../../shared/router'
import { isInPlay } from '../../../shared/worker-map'

export type WorkerState =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'done'
  | 'blocked'
  | 'needs_input'
  | 'progress'
  | 'stopped'
  | 'failed'
/** Status colors. Project branches use their own hues, so these always mean state. */
export type WorkerTone = 'run' | 'wait' | 'bad' | 'queue' | 'done'

/** One state per worker: `idle` is `reported` after the Router read it, so both show the report. */
export function workerState(worker: RouterWorker): WorkerState {
  switch (worker.status) {
    case 'queued':
      return 'queued'
    case 'starting':
    case 'running':
      return 'running'
    case 'waiting':
      return 'waiting'
    case 'failed':
      return 'failed'
    case 'stopped':
    case 'removed':
      return 'stopped'
    case 'reported':
    case 'idle':
      return worker.report?.status ?? 'done'
  }
}
const TONES: Record<WorkerState, WorkerTone> = {
  queued: 'queue',
  running: 'run',
  waiting: 'wait',
  blocked: 'wait',
  needs_input: 'wait',
  failed: 'bad',
  done: 'done',
  progress: 'done',
  stopped: 'done'
}
export const workerTone = (worker: RouterWorker): WorkerTone => TONES[workerState(worker)]
export const workerTitle = (worker: RouterWorker): string =>
  worker.title ?? worker.goal.split('\n')[0]
export const isWorking = (worker: RouterWorker): boolean => workerState(worker) === 'running'
/** Waiting on the user: an approval, or a report that asked for a decision. */
export const isWaitingOnUser = (worker: RouterWorker): boolean => workerTone(worker) === 'wait'
export const canStop = (worker: RouterWorker): boolean =>
  ['queued', 'starting', 'running', 'waiting'].includes(worker.status)
export const openRequests = (session?: CodexSession): CodexRequest[] =>
  session?.requests.filter((r) => r.status === 'pending' || r.status === 'answering') ?? []
export const byAge = (a: RouterWorker, b: RouterWorker): number =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
/** Open-ended work first, then newest first: what a picker should reach for. */
export const byRelevance = (a: RouterWorker, b: RouterWorker): number =>
  Number(isInPlay(b)) - Number(isInPlay(a)) || byAge(b, a)

export type LiveLine = { text: string; mono: boolean }
const firstLine = (text: string) => text.trim().split('\n')[0]
function itemLine(item: CodexItem): LiveLine | null {
  if (item.kind === 'command') return item.text ? { text: firstLine(item.text), mono: true } : null
  if (item.kind === 'files') return item.text ? { text: firstLine(item.text), mono: true } : null
  if (item.kind === 'assistant' || item.kind === 'plan' || item.kind === 'reasoning')
    return item.text ? { text: firstLine(item.text), mono: false } : null
  return null
}
/** What a worker is doing right now, in one line: its open request or its latest activity. */
export function liveLine(session?: CodexSession): LiveLine | null {
  const [request] = openRequests(session)
  if (request?.title) return { text: firstLine(request.title), mono: request.kind === 'command' }
  // Runs for every node on each streamed delta, so it walks back without copying the list.
  const items = session?.items ?? []
  for (let i = items.length - 1; i >= 0; i--) {
    const line = itemLine(items[i])
    if (line) return line
  }
  return null
}
/** Removes Markdown a one-line preview cannot show, keeping a worker link's title. */
/** Most recently active first. */
export const byRecent = (a: CodexRouter, b: CodexRouter) =>
  b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
export const threadTitle = (thread: CodexRouter, untitled: string) => thread.title ?? untitled
/** The label for a thread with no message yet. */
export function useThreadTitle(): string {
  return useTranslation().t('thread.untitled')
}
export function plainLine(text: string): string {
  return (
    text
      .trim()
      .split('\n')
      .at(-1)
      ?.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[`*_]/g, '') ?? ''
  )
}
const MINUTE = 60_000
/** Whole units only: a map full of ticking seconds would read as noise. */
export function elapsed(from: string, now: number): { unit: 'm' | 'h'; value: number } {
  const minutes = Math.max(1, Math.round((now - Date.parse(from)) / MINUTE))
  return minutes < 60
    ? { unit: 'm', value: minutes }
    : { unit: 'h', value: Math.round(minutes / 60) }
}
const HUES = 4
/** Stable across restarts and added projects, so a project keeps its color. */
export function projectHue(projectId: string): string {
  let sum = 0
  for (const char of projectId) sum += char.charCodeAt(0)
  return `var(--owl-hue-${(sum % HUES) + 1})`
}
