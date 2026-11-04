import { createHash } from 'node:crypto'
import type {
  AgentProvider,
  CodexEvent,
  CodexProject,
  CodexRouter,
  CodexSession,
  CodexSettings,
  CreateCodexSession,
  SendCodexMessage
} from '../../shared/codex.js'
import type { RouterWorker, WorkerStatus } from '../../shared/router.js'
import { safeText } from '../codex/protocol.js'
import type { InboxEvent, InboxEventBody } from './events.js'
import { WORKER_INSTRUCTIONS } from './prompt.js'
import { parseReport, WORKER_REPORT_JSON_SCHEMA } from './report.js'
import type { RouterStore } from './store.js'
import {
  type DispatchTaskInput,
  type DispatchTaskResult,
  type MessageWorkerInput,
  type MessageWorkerResult,
  RouterToolError,
  type StopWorkerResult
} from './tools.js'

/** What a task service asks before each turn, and reports after it. */
export type TurnProfile =
  | { role: 'task' }
  | { role: 'worker'; instructions: string; reportSchema: Record<string, unknown> }
export type TurnOutcome = {
  status: 'completed' | 'failed' | 'interrupted'
  /** Claude Code `structured_output`; null for Codex, whose report is the final text. */
  structured: unknown
  text: string
}
export interface TurnProfiles {
  profile(sessionId: string): TurnProfile
  settled(sessionId: string, outcome: TurnOutcome): void
}

/** The parts of the task host a Router needs to start and observe workers. */
export type WorkerHost = {
  projects(): CodexProject[]
  settings(): CodexSettings
  providerReady(provider: AgentProvider): boolean
  createSession(input: CreateCodexSession): CodexSession
  send(input: SendCodexMessage): Promise<void>
  steer(sessionId: string, text: string): Promise<'steered' | 'not_running'>
  interrupt(sessionId: string): Promise<void>
}

/** How workers reach the Router Inbox. */
export type WorkerInbox = {
  /** Adds an event; `wake` false leaves it for the next batch instead of starting one. */
  add(routerId: string, body: InboxEventBody, wake?: boolean): void
  /** Settles a worker's events that are still pending. */
  settle(
    routerId: string,
    match: (event: InboxEvent) => boolean,
    status: 'superseded' | 'dropped'
  ): void
}

/** Global cap on workers that are starting, running, or waiting for approval. */
export const WORKER_LIMIT = 4
/** Dispatches beyond this many queued workers are refused. */
export const QUEUE_LIMIT = 16
/** Minimum gap between Codex worker starts, which lowers one-off 429s (F5). */
export const CODEX_START_GAP_MS = 1000
const PERMISSION_RANK = { 'read-only': 0, 'workspace-write': 1, 'full-access': 2 } as const
export const activeWorker = (w: RouterWorker) =>
  w.status === 'starting' || w.status === 'running' || w.status === 'waiting'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Router workers: ordinary tasks started through the host, plus the queue
 * that holds dispatches beyond the concurrency limit. Two workers that can
 * write never run in the same checkout at once (RFC 11).
 */
export class WorkerPool implements TurnProfiles {
  private readonly workers = new Map<string, RouterWorker>()
  /**
   * Sessions whose current turn the Router started. Any other worker turn is a
   * follow-up the user started in the worker's own task view.
   */
  private readonly routerTurns = new Set<string>()
  /** Workers the Router asked to stop, whose stop needs no new batch. */
  private readonly stopping = new Set<string>()
  private nextCodexStart = 0
  private closed = false

  constructor(
    private readonly store: RouterStore,
    private readonly host: WorkerHost,
    private readonly inbox: WorkerInbox,
    private readonly emit: (worker: RouterWorker) => void
  ) {
    for (const worker of store.workers()) {
      this.workers.set(worker.id, worker)
      // The task services interrupt their turns on restart; tell the Router on its next batch.
      if (activeWorker(worker)) {
        worker.status = 'stopped'
        this.save(worker)
        this.inbox.add(worker.routerId, this.event('worker_stopped', worker), false)
      }
    }
  }

  snapshot(): RouterWorker[] {
    return [...this.workers.values()].sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
    )
  }
  list(routerId: string): RouterWorker[] {
    return [...this.workers.values()].filter((w) => w.routerId === routerId)
  }
  get(id: string): RouterWorker | undefined {
    return this.workers.get(id)
  }

  /**
   * Creates a worker task and starts it, or queues it when the limit or the
   * checkout's writer is busy. `seen` maps goal hashes to workers dispatched in
   * the current batch, so a retried call reuses its worker.
   */
  async dispatch(
    router: CodexRouter,
    input: DispatchTaskInput,
    seen: Map<string, string> | undefined
  ): Promise<DispatchTaskResult> {
    const settings = this.host.settings()
    const permission = input.permission ?? settings.permission
    if (PERMISSION_RANK[permission] > PERMISSION_RANK[settings.router.maxPermission])
      throw new RouterToolError(
        'permission_not_allowed',
        `The Router may grant at most ${settings.router.maxPermission}.`
      )
    const provider = input.provider ?? settings.workerProvider ?? settings.provider
    if (!this.host.providerReady(provider))
      throw new RouterToolError('provider_unavailable', `${provider} is not connected.`)
    const key = createHash('sha256')
      .update(input.goal)
      .update('\0')
      .update(input.context ?? '')
      .digest('hex')
    const repeated = this.workers.get(seen?.get(key) ?? '')
    if (repeated)
      return { workerId: repeated.id, status: repeated.status === 'queued' ? 'queued' : 'started' }
    if ([...this.workers.values()].filter((w) => w.status === 'queued').length >= QUEUE_LIMIT)
      throw new RouterToolError(
        'worker_limit_reached',
        `At most ${QUEUE_LIMIT} workers can wait to start. Wait for some to report.`
      )
    const selection =
      provider === 'claude-code'
        ? { model: settings.claudeModel, effort: settings.claudeEffort }
        : { model: settings.model, effort: settings.effort }
    let session: CodexSession
    try {
      session = this.host.createSession({ provider, cwd: router.cwd, permission, ...selection })
    } catch (error) {
      throw new RouterToolError('dispatch_failed', safeText(String(error)).slice(0, 200))
    }
    const now = new Date().toISOString()
    const worker: RouterWorker = {
      id: `w_${crypto.randomUUID().slice(0, 8)}`,
      routerId: router.id,
      sessionId: session.id,
      provider,
      goal: input.goal,
      context: input.context ?? null,
      permission,
      next: input.context ? `${input.goal}\n\nContext:\n${input.context}` : input.goal,
      status: 'queued',
      report: null,
      degraded: false,
      createdAt: now,
      updatedAt: now
    }
    // Registered before the first turn so the task service sees the worker profile.
    this.workers.set(worker.id, worker)
    this.save(worker)
    seen?.set(key, worker.id)
    if (!this.canStart(worker)) return { workerId: worker.id, status: 'queued' }
    if (!(await this.start(worker, false)))
      throw new RouterToolError('dispatch_failed', 'The worker could not start its first turn.')
    return { workerId: worker.id, status: 'started' }
  }

  /**
   * Delivers a Router follow-up: into the running turn when possible, otherwise
   * as the worker's next turn, which may wait in the queue.
   */
  async message(routerId: string, input: MessageWorkerInput): Promise<MessageWorkerResult> {
    const worker = this.owned(routerId, input.workerId)
    const append = (text: string) => (worker.next ? `${worker.next}\n\n${text}` : text)
    if (activeWorker(worker)) {
      if ((await this.host.steer(worker.sessionId, input.text)) === 'steered')
        return { delivered: 'steered' }
      // The turn is ending; the message becomes the next turn once it settles.
      if (activeWorker(worker)) {
        worker.next = append(input.text)
        this.save(worker)
        return { delivered: 'queued' }
      }
    }
    worker.next = append(input.text)
    if (worker.status !== 'queued') worker.status = 'queued'
    this.save(worker)
    if (!this.canStart(worker)) return { delivered: 'queued' }
    if (!(await this.start(worker, false)))
      throw new RouterToolError('dispatch_failed', 'The worker could not start a new turn.')
    return { delivered: 'started' }
  }

  async stop(routerId: string, workerId: string): Promise<StopWorkerResult> {
    const worker = this.owned(routerId, workerId)
    if (worker.status === 'queued') {
      worker.status = worker.report ? 'idle' : 'stopped'
      worker.next = null
      this.save(worker)
      return { status: 'cancelled' }
    }
    worker.next = null
    if (!activeWorker(worker)) return { status: 'already_idle' }
    this.stopping.add(worker.id)
    await this.host.interrupt(worker.sessionId).catch(() => {})
    return { status: 'stopping' }
  }

  /** The list_workers result: newest first, report summaries shortened. */
  describe(routerId: string, status?: WorkerStatus) {
    return this.list(routerId)
      .filter((w) => (status ? w.status === status : w.status !== 'removed'))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
      .map((w) => ({
        workerId: w.id,
        goal: w.goal,
        status: w.status,
        provider: w.provider,
        report: w.report
          ? { status: w.report.status, summary: w.report.summary.slice(0, 300) }
          : null
      }))
  }

  /** Starts queued workers that the limits allow, oldest first. */
  schedule(): void {
    if (this.closed) return
    const queued = [...this.workers.values()]
      .filter((w) => w.status === 'queued')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    for (const worker of queued) {
      if (this.canStart(worker)) void this.start(worker, true)
    }
  }

  /** Worker reports in a batch now reach the Router, so their workers are idle again. */
  delivered(events: InboxEvent[]): void {
    for (const event of events) {
      const worker = event.kind === 'worker_report' ? this.workers.get(event.workerId) : null
      if (worker?.status === 'reported') {
        worker.status = 'idle'
        this.save(worker)
      }
    }
  }

  profile(sessionId: string): TurnProfile {
    const worker = this.bySession(sessionId)
    return worker && worker.status !== 'removed'
      ? {
          role: 'worker',
          instructions: WORKER_INSTRUCTIONS,
          reportSchema: WORKER_REPORT_JSON_SCHEMA
        }
      : { role: 'task' }
  }

  settled(sessionId: string, outcome: TurnOutcome): void {
    const worker = this.bySession(sessionId)
    if (!worker || worker.status === 'removed' || this.closed) return
    // The user is already looking at a follow-up turn, so its result waits for the
    // next batch instead of starting one (RFC 3.1, passthrough).
    const followUp = !this.routerTurns.delete(sessionId)
    const stopped = this.stopping.delete(worker.id)
    if (outcome.status === 'completed') {
      const { report, degraded } = parseReport(outcome.structured, outcome.text)
      // A report the Router has not seen yet is replaced, not stacked (RFC 8, rule 5).
      if (worker.status === 'reported')
        this.inbox.settle(
          worker.routerId,
          (e) => e.kind === 'worker_report' && e.workerId === worker.id,
          'superseded'
        )
      worker.report = report
      worker.degraded = degraded
      worker.status = 'reported'
      this.inbox.add(
        worker.routerId,
        { ...this.event('worker_report', worker, followUp), report },
        !followUp
      )
    } else {
      worker.status = outcome.status === 'interrupted' ? 'stopped' : 'failed'
      this.inbox.add(
        worker.routerId,
        this.event(
          outcome.status === 'interrupted' ? 'worker_stopped' : 'worker_failed',
          worker,
          followUp
        ),
        !followUp && !stopped
      )
    }
    // A Router follow-up that arrived as the turn ended runs next.
    if (worker.next) worker.status = 'queued'
    this.save(worker)
    this.schedule()
  }

  /** Follows task and connection events: approvals, removed tasks, and agents coming online. */
  observe(event: CodexEvent): void {
    if (this.closed) return
    if (event.type === 'connection' || event.type === 'claude-connection') {
      if (event.connection.status === 'ready') this.schedule()
      return
    }
    if (event.type === 'removed') {
      const worker = this.bySession(event.sessionId)
      if (!worker || worker.status === 'removed') return
      worker.status = 'removed'
      this.save(worker)
      this.inbox.settle(
        worker.routerId,
        (e) => 'workerId' in e && e.workerId === worker.id,
        'dropped'
      )
      this.inbox.add(worker.routerId, this.event('worker_removed', worker))
      this.schedule()
      return
    }
    if (event.type !== 'session') return
    const worker = this.bySession(event.session.id)
    if (!worker || worker.status === 'removed') return
    const { session } = event
    if (session.status === 'waiting' && worker.status !== 'waiting') {
      worker.status = 'waiting'
      this.save(worker)
      const request = session.requests.find((r) => r.status === 'pending')
      const followUp = !this.routerTurns.has(session.id)
      this.inbox.add(
        worker.routerId,
        {
          ...this.event('worker_waiting', worker, followUp),
          detail: request ? request.title || request.kind : ''
        },
        !followUp
      )
    } else if (session.status === 'running' && worker.status !== 'running') {
      // Also covers a follow-up the user started in the worker's own task view.
      worker.status = 'running'
      this.save(worker)
    }
  }

  close(): void {
    this.closed = true
  }

  private canStart(worker: RouterWorker): boolean {
    if (!this.host.providerReady(worker.provider)) return false
    const active = [...this.workers.values()].filter(activeWorker)
    if (active.length >= WORKER_LIMIT) return false
    if (worker.permission === 'read-only') return true
    return !active.some((w) => w.routerId === worker.routerId && w.permission !== 'read-only')
  }

  /**
   * Sends the first turn. Returns false when it could not start; `notify` adds a
   * worker_failed event unless the task service already reported the failure.
   */
  private async start(worker: RouterWorker, notify: boolean): Promise<boolean> {
    worker.status = 'starting'
    this.save(worker)
    if (worker.provider === 'codex') {
      const now = Date.now()
      const at = Math.max(now, this.nextCodexStart)
      this.nextCodexStart = at + CODEX_START_GAP_MS
      if (at > now) await sleep(at - now)
      // Removed, or started by the user from its task view, while waiting.
      if (this.closed || this.status(worker) !== 'starting') return true
    }
    const text = worker.next ?? worker.goal
    worker.next = null
    this.routerTurns.add(worker.sessionId)
    try {
      await this.host.send({ sessionId: worker.sessionId, commandId: crypto.randomUUID(), text })
    } catch {
      this.routerTurns.delete(worker.sessionId)
      // The task service settles turns that got far enough to start.
      if (worker.status === 'starting') {
        worker.status = 'failed'
        this.save(worker)
        if (notify) this.inbox.add(worker.routerId, this.event('worker_failed', worker))
      }
      return false
    }
    if (worker.status === 'starting') {
      worker.status = 'running'
      this.save(worker)
    }
    return true
  }

  private event<K extends Exclude<InboxEventBody['kind'], 'user_message'>>(
    kind: K,
    worker: RouterWorker,
    followUp = false
  ): { kind: K; at: string; workerId: string; goal: string; followUp: boolean } {
    return { kind, at: new Date().toISOString(), workerId: worker.id, goal: worker.goal, followUp }
  }
  /** A worker of this Router that can still take instructions. */
  private owned(routerId: string, workerId: string): RouterWorker {
    const worker = this.workers.get(workerId)
    if (!worker || worker.routerId !== routerId)
      throw new RouterToolError('worker_not_found', `No worker ${workerId} in this project.`)
    if (worker.status === 'removed')
      throw new RouterToolError('worker_closed', 'The user removed this worker.')
    return worker
  }
  /** Reads the status afresh after an await, where TypeScript keeps an older narrowing. */
  private status(worker: RouterWorker): RouterWorker['status'] {
    return worker.status
  }
  private bySession(sessionId: string): RouterWorker | undefined {
    for (const worker of this.workers.values()) if (worker.sessionId === sessionId) return worker
    return undefined
  }
  private save(worker: RouterWorker): void {
    if (this.closed) return
    worker.updatedAt = new Date().toISOString()
    this.store.saveWorker(worker)
    this.emit(worker)
  }
}
