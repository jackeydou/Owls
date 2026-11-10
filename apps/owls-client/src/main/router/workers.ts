import { createHash } from 'node:crypto'
import type {
  AgentProvider,
  AppEvent,
  AppSettings,
  CreateSession,
  Project,
  RespondRequest,
  SendMessage,
  Session
} from '../../shared/app.js'
import { defaultProjectSettings, type ProjectSettings } from '../../shared/projects.js'
import type { RouterWorker, WorkerPullRequestLink, WorkerStatus } from '../../shared/router.js'
import { OwlsError } from '../app/errors.js'
import { safeText } from '../codex/protocol.js'
import type { InboxEvent, InboxEventBody } from './events.js'
import { projectInstructions, WORKER_INSTRUCTIONS, worktreeInstructions } from './prompt.js'
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
import type {
  ApproveWorkerInput,
  ApproveWorkerResult,
  WorkerDispatch,
  WorkerMessageMode
} from './worker-target.js'
import type { WorkerWorkspaces, WorktreeRepo, WorktreeWorkspace } from './worktrees.js'

/** What a task service asks before each turn, and reports after it. */
export type TurnProfile = { instructions: string; reportSchema: Record<string, unknown> }
export type TurnOutcome = {
  status: 'completed' | 'failed' | 'interrupted'
  /** Claude Code `structured_output`; null for Codex, whose report is the final text. */
  structured: unknown
  text: string
}
export interface TurnProfiles {
  /**
   * Runs before every turn of a session, so a worker's worktree exists before
   * the agent starts. Returns the directories outside the session's `cwd`
   * that its agent must be able to write, such as the git metadata that a
   * worker's commits go to.
   */
  prepare(sessionId: string): Promise<string[]>
  /** Null once the session no longer belongs to a worker. */
  profile(sessionId: string): TurnProfile | null
  settled(sessionId: string, outcome: TurnOutcome): void
}

/** The parts of the task host a Router needs to start and observe workers. */
export type WorkerHost = {
  projects(): Project[]
  /** The engine's working directory for a thread with no default project. */
  threadHome(): string
  settings(): AppSettings
  providerReady(provider: AgentProvider): boolean
  /** `worker` marks a session whose `cwd` is a worker worktree of `projectPath`. */
  createSession(input: CreateSession, worker?: { projectPath: string }): Session
  /** Removes a stopped worker's session; the `removed` event does the rest. */
  remove(sessionId: string): void
  send(input: SendMessage): Promise<void>
  steer(sessionId: string, text: string): Promise<'steered' | 'not_running'>
  interrupt(sessionId: string): Promise<void>
  /** Answers a pending request; throws `request_unavailable` once it is no longer pending. */
  respond(input: RespondRequest): void
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

/** How many of a thread's events about a worker are searched for its forward. */
const FORWARD_LOOKBACK = 50
/** Longest title kept for the UI; models sometimes write a sentence. */
const TITLE_LIMIT = 60
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
const worktreeOf = (w: RouterWorker): WorktreeWorkspace | null =>
  w.workspace.kind === 'worktree' ? w.workspace : null

/**
 * Router workers: ordinary tasks started through the host, plus the queue
 * that holds dispatches beyond the concurrency limit. Workers that can write
 * get their own git worktree where the project allows it; two writers never
 * run in the same checkout at once (RFC 11, 11.1).
 */
export class WorkerPool implements TurnProfiles {
  private readonly workers = new Map<string, RouterWorker>()
  /** Workers the Router asked to stop, whose stop needs no new batch. */
  private readonly stopping = new Set<string>()
  private nextCodexStart = 0
  private closed = false
  /** Settles once startup cleanup of worktrees has run. */
  readonly recovered: Promise<void>

  constructor(
    private readonly store: RouterStore,
    private readonly host: WorkerHost,
    private readonly inbox: WorkerInbox,
    private readonly emit: (worker: RouterWorker) => void,
    private readonly workspaces: WorkerWorkspaces
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
    this.recovered = this.recover()
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
  /** Keeps `updatedAt`, because finding a pull request is not activity on the worker. */
  linkPullRequest(id: string, link: WorkerPullRequestLink): void {
    const worker = this.workers.get(id)
    if (!worker || this.closed) return
    worker.pullRequest = link
    this.store.saveWorker(worker)
    this.emit(worker)
  }

  /**
   * Creates a worker task and starts it, or queues it when the limit or the
   * checkout's writer is busy. A retried call reuses its worker: by goal hash
   * within a batch (`seen`), or by the id the sender chose.
   */
  async dispatch(request: WorkerDispatch): Promise<DispatchTaskResult> {
    const { input, seen } = request
    const settings = this.host.settings()
    const permission = input.permission ?? settings.permission
    if (PERMISSION_RANK[permission] > PERMISSION_RANK[settings.router.maxPermission])
      throw new RouterToolError(
        'permission_not_allowed',
        `The Router may grant at most ${settings.router.maxPermission}.`
      )
    const provider = input.provider ?? settings.provider
    if (!this.host.providerReady(provider))
      throw new RouterToolError('provider_unavailable', `${provider} is not connected.`)
    const project = this.projectFor(request.defaultProjectId, input)
    const key = createHash('sha256')
      .update(project.id)
      .update('\0')
      .update(input.goal)
      .update('\0')
      .update(input.context ?? '')
      .digest('hex')
    const repeated = () => {
      const worker = this.workers.get(request.workerId ?? seen?.get(key) ?? '')
      return worker
        ? {
            workerId: worker.id,
            status: worker.status === 'queued' ? ('queued' as const) : ('started' as const),
            ...this.place(worker)
          }
        : null
    }
    const before = repeated()
    if (before) return before
    const parent = input.parent ? this.parentFor(request.routerId, input.parent) : null
    if ([...this.workers.values()].filter((w) => w.status === 'queued').length >= QUEUE_LIMIT)
      throw new RouterToolError(
        'worker_limit_reached',
        `At most ${QUEUE_LIMIT} workers can wait to start. Wait for some to report.`
      )
    const wantsWorktree =
      permission !== 'read-only' && settings.router.worktrees && input.workspace !== 'checkout'
    const repo = wantsWorktree ? await this.workspaces.inspect(project.path) : null
    // The same call may have finished while the repository was inspected.
    const after = repeated()
    if (after) return after
    const id = request.workerId ?? `w_${crypto.randomUUID().slice(0, 8)}`
    const base = input.base ?? 'head'
    const baseBranch = base === 'parent' ? this.parentBranch(parent, repo) : null
    const workspace = repo
      ? { ...this.workspaces.plan(repo, id, base), baseBranch }
      : ({ kind: 'checkout' } as const)
    const selection =
      request.selection ??
      (provider === 'claude-code'
        ? { model: settings.claudeModel, effort: settings.claudeEffort }
        : { model: settings.model, effort: settings.effort })
    let session: Session
    try {
      session =
        workspace.kind === 'worktree'
          ? this.host.createSession(
              { provider, cwd: workspace.cwd, permission, ...selection },
              { projectPath: project.path }
            )
          : this.host.createSession({ provider, cwd: project.path, permission, ...selection })
    } catch (error) {
      throw new RouterToolError('dispatch_failed', safeText(String(error)).slice(0, 200))
    }
    const now = new Date().toISOString()
    const worker: RouterWorker = {
      id,
      routerId: request.routerId,
      projectId: project.id,
      sessionId: session.id,
      provider,
      goal: input.goal,
      title: input.title?.slice(0, TITLE_LIMIT) ?? null,
      parentId: input.parent ?? null,
      context: input.context ?? null,
      pullRequest: null,
      permission,
      next: input.context ? `${input.goal}\n\nContext:\n${input.context}` : input.goal,
      status: 'queued',
      workspace,
      report: null,
      degraded: false,
      createdAt: now,
      updatedAt: now
    }
    // Registered before the first turn so the task service sees the worker profile.
    this.workers.set(worker.id, worker)
    this.save(worker)
    seen?.set(key, worker.id)
    if (!this.canStart(worker))
      return { workerId: worker.id, status: 'queued', ...this.place(worker) }
    if (!(await this.start(worker, false)))
      throw new RouterToolError('dispatch_failed', 'The worker could not start its first turn.')
    return { workerId: worker.id, status: 'started', ...this.place(worker) }
  }

  /**
   * Delivers a Router follow-up: into the running turn when possible, otherwise
   * as the worker's next turn, which may wait in the queue.
   */
  async message(
    routerId: string,
    input: MessageWorkerInput,
    mode: WorkerMessageMode = 'steer'
  ): Promise<MessageWorkerResult> {
    const worker = this.owned(routerId, input.workerId)
    const append = (text: string) => (worker.next ? `${worker.next}\n\n${text}` : text)
    if (activeWorker(worker)) {
      if (mode === 'steer' && (await this.host.steer(worker.sessionId, input.text)) === 'steered')
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

  /**
   * Stops a worker for the Router or the user. A worker cancelled from the queue
   * never settles a turn, so when the user cancels it the Router hears about it
   * here, with its next batch.
   */
  async stop(
    routerId: string,
    workerId: string,
    by: 'router' | 'user' = 'router'
  ): Promise<StopWorkerResult> {
    const worker = this.owned(routerId, workerId)
    if (worker.status === 'queued') {
      worker.status = worker.report ? 'idle' : 'stopped'
      worker.next = null
      this.save(worker)
      if (by === 'user') this.inbox.add(routerId, this.event('worker_stopped', worker), false)
      return { status: 'cancelled' }
    }
    worker.next = null
    if (!activeWorker(worker)) return { status: 'already_idle' }
    this.stopping.add(worker.id)
    await this.host.interrupt(worker.sessionId).catch(() => {})
    return { status: 'stopping' }
  }

  /**
   * Answers a worker's pending approval request. Whichever answer arrives first
   * wins; a later one finds the request resolved.
   */
  async approve(routerId: string, input: ApproveWorkerInput): Promise<ApproveWorkerResult> {
    const worker = this.owned(routerId, input.workerId)
    if (worker.status !== 'waiting') return { status: 'already_resolved' }
    try {
      this.host.respond({
        sessionId: worker.sessionId,
        requestId: input.requestId,
        decision: input.decision === 'approve' ? 'accept' : 'decline'
      })
    } catch (error) {
      if (error instanceof OwlsError && error.code === 'request_unavailable')
        return { status: 'already_resolved' }
      throw error
    }
    return { status: 'answered' }
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
        project: this.projectName(w),
        parent: w.parentId,
        ...this.place(w),
        report: w.report
          ? { status: w.report.status, summary: w.report.summary.slice(0, 300) }
          : null
      }))
  }

  /** The name of the project a worker runs in, while that project exists. */
  projectName(worker: RouterWorker): string | null {
    return this.host.projects().find((p) => p.id === worker.projectId)?.name ?? null
  }

  /**
   * The settings of the project a worker runs in, read afresh each time so a
   * change applies from the worker's next turn. Defaults once the project is gone.
   */
  projectSettings(worker: RouterWorker): ProjectSettings {
    const project = this.host.projects().find((p) => p.id === worker.projectId)
    return project?.settings ?? defaultProjectSettings
  }

  /** Where a worker runs, as the Router tools describe it. */
  place(worker: RouterWorker): { workspace: 'worktree' | 'checkout'; branch: string | null } {
    const tree = worktreeOf(worker)
    return tree
      ? { workspace: 'worktree', branch: tree.branch }
      : { workspace: 'checkout', branch: null }
  }

  /**
   * Creates or re-attaches a worker's worktree before its turn, whether the
   * Router or the user started it. Task sessions that are not workers pass.
   */
  async prepare(sessionId: string): Promise<string[]> {
    const worker = this.bySession(sessionId)
    const tree = worker && worker.status !== 'removed' ? worktreeOf(worker) : null
    if (!worker || !tree) return []
    try {
      const baseCommit = await this.workspaces.ensure(tree, this.projectSettings(worker).git)
      if (tree.baseCommit !== baseCommit) {
        tree.baseCommit = baseCommit
        this.save(worker)
      }
    } catch {
      throw new OwlsError('worktree_failed', "Owls could not prepare this worker's git worktree.")
    }
    return this.workspaces.commitPaths(tree)
  }

  /** Removes a worktree the user chose to discard after removing its worker. */
  async discard(routerId: string, workerId: string): Promise<void> {
    const worker = this.workers.get(workerId)
    const tree = worker?.routerId === routerId ? worktreeOf(worker) : null
    if (!worker || !tree || tree.state !== 'kept')
      throw new OwlsError('request_unavailable', 'This worktree is no longer kept.')
    try {
      await this.workspaces.release(tree, true, this.projectSettings(worker).git)
    } catch {
      throw new OwlsError('worktree_failed', 'Owls could not remove this git worktree.')
    }
    tree.state = 'released'
    this.save(worker)
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

  profile(sessionId: string): TurnProfile | null {
    const worker = this.bySession(sessionId)
    if (!worker || worker.status === 'removed') return null
    const tree = worktreeOf(worker)
    const settings = this.projectSettings(worker)
    const project = projectInstructions(settings.instructions)
    return {
      instructions: [
        WORKER_INSTRUCTIONS,
        tree ? worktreeInstructions(tree.branch, settings.git.remote) : null,
        project
      ]
        .filter(Boolean)
        .join('\n\n'),
      reportSchema: WORKER_REPORT_JSON_SCHEMA
    }
  }

  settled(sessionId: string, outcome: TurnOutcome): void {
    const worker = this.bySession(sessionId)
    if (!worker || worker.status === 'removed' || this.closed) return
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
      this.inbox.add(worker.routerId, { ...this.event('worker_report', worker), report })
    } else {
      worker.status = outcome.status === 'interrupted' ? 'stopped' : 'failed'
      this.inbox.add(
        worker.routerId,
        this.event(outcome.status === 'interrupted' ? 'worker_stopped' : 'worker_failed', worker),
        !stopped
      )
    }
    // A Router follow-up that arrived as the turn ended runs next.
    if (worker.next) worker.status = 'queued'
    this.save(worker)
    this.schedule()
  }

  /** Follows task and connection events: approvals, removed tasks, and agents coming online. */
  observe(event: AppEvent): void {
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
      const removed = (branch: string | null) => {
        if (this.closed) return
        this.inbox.add(worker.routerId, { ...this.event('worker_removed', worker), branch })
      }
      if (worktreeOf(worker)) void this.release(worker).then(removed)
      else removed(null)
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
      // The user sees the request directly, so the Router only reads about it on its next batch.
      this.inbox.add(
        worker.routerId,
        {
          ...this.event('worker_waiting', worker),
          detail: request ? request.title || request.kind : ''
        },
        false
      )
    } else if (session.status === 'running' && worker.status !== 'running') {
      // An answered request lets the turn go on.
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
    // A worktree is this worker's alone; only writers sharing the checkout wait for each other.
    if (worker.permission === 'read-only' || worktreeOf(worker)) return true
    // Threads share projects, so this compares the project, not the thread.
    return !active.some(
      (w) => w.projectId === worker.projectId && w.permission !== 'read-only' && !worktreeOf(w)
    )
  }

  /**
   * Cleans up a removed worker's worktree. Returns the branch when it holds
   * work the user's checkout does not have yet. A worktree with uncommitted
   * changes is kept until the user discards it; a failed cleanup stays
   * `active` and runs again on the next start.
   */
  private async release(worker: RouterWorker): Promise<string | null> {
    const tree = worktreeOf(worker)
    if (!tree || tree.state !== 'active') return null
    try {
      const result = await this.workspaces.release(tree, false, this.projectSettings(worker).git)
      tree.state = result.worktree === 'kept' ? 'kept' : 'released'
      this.save(worker)
      return result.branch === 'kept' ? tree.branch : null
    } catch {
      return null
    }
  }

  /** Startup: prunes registrations of deleted worktrees and finishes interrupted cleanups. */
  private async recover(): Promise<void> {
    const trees = [...this.workers.values()].map((w) => worktreeOf(w)).filter((t) => t !== null)
    for (const repo of [...new Set(trees.map((t) => t.repo))].sort())
      await this.workspaces.prune(repo).catch(() => {})
    for (const worker of [...this.workers.values()].sort((a, b) => a.id.localeCompare(b.id)))
      if (worker.status === 'removed') await this.release(worker)
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
      // Removed while waiting.
      if (this.closed || this.status(worker) !== 'starting') return true
    }
    const text = worker.next ?? worker.goal
    worker.next = null
    try {
      await this.host.send({ sessionId: worker.sessionId, commandId: crypto.randomUUID(), text })
    } catch {
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

  /** The named project, else the parent's, else the thread's default, else the only one. */
  private projectFor(defaultProjectId: string | null, input: DispatchTaskInput): Project {
    const projects = this.host.projects()
    const names = () =>
      projects
        .map((p) => p.name)
        .sort((a, b) => a.localeCompare(b))
        .join(', ')
    const wanted = input.project?.toLocaleLowerCase()
    if (wanted) {
      const matches = projects.filter(
        (p) => p.id === input.project || p.name.toLocaleLowerCase() === wanted
      )
      if (matches.length === 1) return matches[0]
      throw new RouterToolError(
        'project_required',
        matches.length
          ? 'Several projects have this name. Use the project ID from the batch.'
          : `There is no such project. The projects are: ${names()}.`
      )
    }
    const fallback = (input.parent && this.workers.get(input.parent)?.projectId) || defaultProjectId
    const found = projects.find((p) => p.id === fallback)
    if (found) return found
    if (projects.length === 1) return projects[0]
    throw new RouterToolError(
      'project_required',
      projects.length
        ? `Name the project for this task. The projects are: ${names()}.`
        : 'The user has no projects yet. Ask them to add one.'
    )
  }
  /** A worker this Router may build on: its own, or one the user forwarded to this thread. */
  private parentFor(routerId: string, workerId: string): RouterWorker {
    const worker = this.workers.get(workerId)
    const forwarded =
      worker &&
      worker.routerId !== routerId &&
      this.store
        .workerEvents(routerId, workerId, FORWARD_LOOKBACK)
        .some((e) => e.kind === 'forwarded')
    if (!forwarded) return this.owned(routerId, workerId)
    if (worker.status === 'removed')
      throw new RouterToolError('worker_closed', 'The user removed this worker.')
    return worker
  }
  private parentBranch(parent: RouterWorker | null, repo: WorktreeRepo | null): string {
    const tree = parent ? worktreeOf(parent) : null
    if (!repo || tree?.repo !== repo.repo)
      throw new RouterToolError(
        'invalid_request',
        'Base parent needs a parent worker with a branch in this project.'
      )
    return tree.branch
  }

  private event<K extends Exclude<InboxEventBody['kind'], 'user_message' | 'forwarded'>>(
    kind: K,
    worker: RouterWorker
  ): { kind: K; at: string; workerId: string; goal: string } {
    return { kind, at: new Date().toISOString(), workerId: worker.id, goal: worker.goal }
  }
  /** A worker of this Router that can still take instructions. */
  private owned(routerId: string, workerId: string): RouterWorker {
    const worker = this.workers.get(workerId)
    if (!worker || worker.routerId !== routerId)
      throw new RouterToolError('worker_not_found', `No worker ${workerId} in this thread.`)
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
