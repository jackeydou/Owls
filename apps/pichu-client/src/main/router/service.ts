import { createHash } from 'node:crypto'
import type {
  AgentProvider,
  CodexEvent,
  CodexFailure,
  CodexItem,
  CodexProject,
  CodexRouter,
  CodexSession,
  CodexSettings,
  CreateCodexSession,
  SendCodexMessage
} from '../../shared/codex.js'
import type {
  RouterProviderInfo,
  RouterWorker,
  SendRouterMessage,
  SetRouterKey
} from '../../shared/router.js'
import { CodexRuntimeError } from '../codex/errors.js'
import { safeText } from '../codex/protocol.js'
import type { RouterCredentials } from './credentials.js'
import type { RouterEngine, RouterSink } from './engine.js'
import type { EngineFactory } from './engines/factory.js'
import { builtinRouterModels, catalog, OWLS_PROVIDERS } from './engines/owls-models.js'
import { WORKER_INSTRUCTIONS } from './prompt.js'
import { type InboxEvent, renderBatch, renderState } from './render.js'
import { parseReport, WORKER_REPORT_JSON_SCHEMA } from './report.js'
import type { RouterStore } from './store.js'
import { type DispatchTaskInput, RouterToolError, routerTools } from './tools.js'

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
}

/** Global cap on workers that are starting, running, or waiting for approval. */
export const WORKER_LIMIT = 4
const PERMISSION_RANK = { 'read-only': 0, 'workspace-write': 1, 'full-access': 2 } as const
const activeWorker = (w: RouterWorker) => ['starting', 'running', 'waiting'].includes(w.status)

export class RouterService implements TurnProfiles {
  private readonly routers = new Map<string, CodexRouter>()
  private readonly workers = new Map<string, RouterWorker>()
  private readonly engines = new Map<string, { engine: RouterEngine; key: string }>()
  private readonly pending = new Map<string, InboxEvent[]>()
  /** Workers dispatched in the current batch, by goal hash, so retried calls reuse them. */
  private readonly dispatched = new Map<string, Map<string, string>>()
  private readonly dirty = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private seq = 0
  private closed = false

  constructor(
    private readonly store: RouterStore,
    private readonly credentials: RouterCredentials,
    private readonly commands: { acceptCommand(id: string, scope: string, text: string): boolean },
    private readonly host: WorkerHost,
    private readonly emit: (event: CodexEvent) => void,
    private readonly createEngine: EngineFactory
  ) {
    for (const router of store.routers()) {
      if (router.status === 'running') {
        router.status = 'interrupted'
        router.error = { code: 'interrupted', message: '' }
        for (const item of router.items) if (item.status === 'running') item.status = 'interrupted'
        store.saveRouter(router)
      }
      this.routers.set(router.id, router)
    }
    for (const worker of store.workers()) {
      if (activeWorker(worker)) {
        worker.status = 'stopped'
        store.saveWorker(worker)
      }
      this.workers.set(worker.id, worker)
    }
  }

  snapshot(): { routers: CodexRouter[]; workers: RouterWorker[] } {
    return {
      routers: [...this.routers.values()].sort((a, b) => a.projectId.localeCompare(b.projectId)),
      workers: [...this.workers.values()].sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
      )
    }
  }

  open(projectId: string): CodexRouter {
    const existing = [...this.routers.values()].find((r) => r.projectId === projectId)
    if (existing) return existing
    const project = this.host.projects().find((p) => p.id === projectId)
    if (!project)
      throw new CodexRuntimeError('project_required', 'Choose a project before opening its Router.')
    const now = new Date().toISOString()
    const router: CodexRouter = {
      id: crypto.randomUUID(),
      projectId,
      cwd: project.path,
      status: 'idle',
      items: [],
      error: null,
      tokens: null,
      createdAt: now,
      updatedAt: now
    }
    this.routers.set(router.id, router)
    this.changed(router)
    return router
  }

  send(input: SendRouterMessage): void {
    const router = this.getRouter(input.routerId)
    if (!this.commands.acceptCommand(input.commandId, router.id, input.text)) return
    router.items.push({
      id: input.commandId,
      kind: 'user',
      status: 'completed',
      text: input.text,
      detail: '',
      turnId: null
    })
    this.changed(router)
    const engine = this.engines.get(router.id)?.engine
    // A running batch takes the user's message immediately; other events wait.
    if (router.status === 'running' && engine?.steer(input.text) === 'steered') return
    this.enqueue(router.id, {
      seq: ++this.seq,
      kind: 'user_message',
      at: new Date().toISOString(),
      text: input.text
    })
  }

  interrupt(routerId: string): void {
    const router = this.getRouter(routerId)
    if (router.status === 'running') this.engines.get(router.id)?.engine.abort()
  }

  providers(): RouterProviderInfo[] {
    const models = builtinRouterModels()
    const configured = new Set(this.credentials.configured())
    return OWLS_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      configured: configured.has(p.id),
      models: catalog(models, p.id)
    }))
  }

  setKey(input: SetRouterKey): void {
    this.credentials.setKey(input.providerId, input.key)
    this.dropIdleEngines()
  }

  removeKey(providerId: SetRouterKey['providerId']): void {
    this.credentials.remove(providerId)
    this.dropIdleEngines()
  }

  /** Router settings changed: idle engines are rebuilt on the next batch. */
  settingsChanged(): void {
    this.dropIdleEngines()
  }

  profile(sessionId: string): TurnProfile {
    return this.workerBySession(sessionId)
      ? {
          role: 'worker',
          instructions: WORKER_INSTRUCTIONS,
          reportSchema: WORKER_REPORT_JSON_SCHEMA
        }
      : { role: 'task' }
  }

  settled(sessionId: string, outcome: TurnOutcome): void {
    const worker = this.workerBySession(sessionId)
    if (!worker || this.closed) return
    const at = new Date().toISOString()
    if (outcome.status === 'completed') {
      const { report, degraded } = parseReport(outcome.structured, outcome.text)
      worker.report = report
      worker.degraded = degraded
      worker.status = 'reported'
      this.saveWorker(worker)
      this.enqueue(worker.routerId, {
        seq: ++this.seq,
        kind: 'worker_report',
        at,
        workerId: worker.id,
        goal: worker.goal,
        report
      })
      return
    }
    worker.status = outcome.status === 'interrupted' ? 'stopped' : 'failed'
    this.saveWorker(worker)
    this.enqueue(worker.routerId, {
      seq: ++this.seq,
      kind: 'worker_failed',
      at,
      workerId: worker.id,
      goal: worker.goal
    })
  }

  /** Follows task events so the Router hears when a worker waits for approval. */
  observe(event: CodexEvent): void {
    if (event.type !== 'session' || this.closed) return
    const worker = this.workerBySession(event.session.id)
    if (!worker) return
    const { session } = event
    if (session.status === 'waiting' && worker.status !== 'waiting') {
      worker.status = 'waiting'
      this.saveWorker(worker)
      const request = session.requests.find((r) => r.status === 'pending')
      this.enqueue(worker.routerId, {
        seq: ++this.seq,
        kind: 'worker_waiting',
        at: new Date().toISOString(),
        workerId: worker.id,
        goal: worker.goal,
        detail: request ? request.title || request.kind : ''
      })
    } else if (
      session.status === 'running' &&
      (worker.status === 'starting' || worker.status === 'waiting')
    ) {
      worker.status = 'running'
      this.saveWorker(worker)
    }
  }

  isRunning(): boolean {
    return [...this.routers.values()].some((r) => r.status === 'running')
  }

  close(): void {
    if (this.closed) return
    this.flush()
    this.closed = true
    for (const { engine } of this.engines.values()) engine.abort()
    this.engines.clear()
  }

  private enqueue(routerId: string, event: InboxEvent): void {
    const queue = this.pending.get(routerId) ?? []
    queue.push(event)
    this.pending.set(routerId, queue)
    queueMicrotask(() => void this.pump(routerId))
  }

  private async pump(routerId: string): Promise<void> {
    const router = this.routers.get(routerId)
    if (!router || router.status === 'running' || this.closed) return
    const events = this.pending.get(routerId) ?? []
    if (!events.length) return
    const engine = this.engine(router)
    if ('code' in engine) {
      // Keep the events so they go out once the Router is configured.
      router.status = 'failed'
      router.error = engine
      this.changed(router)
      return
    }
    this.pending.delete(routerId)
    for (const event of events) {
      const worker = event.kind === 'worker_report' ? this.workers.get(event.workerId) : null
      if (worker?.status === 'reported') {
        worker.status = 'idle'
        this.saveWorker(worker)
      }
    }
    const batchId = `b_${crypto.randomUUID().slice(0, 8)}`
    router.status = 'running'
    router.error = null
    this.changed(router)
    this.dispatched.set(router.id, new Map())
    const outcome = await engine.run(batchId, renderBatch(batchId, events, null), this.sink(router))
    this.dispatched.delete(router.id)
    router.status =
      outcome.status === 'completed'
        ? 'idle'
        : outcome.status === 'failed'
          ? 'failed'
          : 'interrupted'
    router.error = outcome.error
    for (const item of router.items)
      if (item.status === 'running')
        item.status = outcome.status === 'completed' ? 'completed' : outcome.status
    this.changed(router)
    if (this.pending.get(routerId)?.length) void this.pump(routerId)
  }

  private engine(router: CodexRouter): RouterEngine | CodexFailure {
    const settings = this.host.settings().router
    const key = JSON.stringify(settings)
    const cached = this.engines.get(router.id)
    if (cached?.key === key) return cached.engine
    const engine = this.createEngine({
      router,
      settings,
      tools: routerTools({ dispatchTask: (input) => this.dispatch(router.id, input) }),
      history: this.store.messages(router.id),
      state: () => renderState(this.routerWorkers(router.id)),
      persist: (batchId, messages) => this.store.appendMessages(router.id, batchId, messages)
    })
    if (!('code' in engine)) this.engines.set(router.id, { engine, key })
    return engine
  }

  private sink(router: CodexRouter): RouterSink {
    return {
      item: (item: CodexItem) => {
        const index = router.items.findIndex((i) => i.id === item.id)
        if (index >= 0) router.items[index] = item
        else router.items.push(item)
        // Streaming text is batched; finished items are saved at once.
        this.changed(router, item.status !== 'running')
      },
      usage: (usage) => {
        router.tokens =
          (router.tokens ?? 0) + usage.input + usage.output + usage.cacheRead + usage.cacheWrite
      }
    }
  }

  private async dispatch(
    routerId: string,
    input: DispatchTaskInput
  ): Promise<{ workerId: string; status: 'started' }> {
    const router = this.getRouter(routerId)
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
    const batch = this.dispatched.get(routerId)
    const repeated = batch?.get(key)
    if (repeated) return { workerId: repeated, status: 'started' }
    if ([...this.workers.values()].filter(activeWorker).length >= WORKER_LIMIT)
      throw new RouterToolError(
        'worker_limit_reached',
        `At most ${WORKER_LIMIT} workers can run at once. Wait for one to report.`
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
      routerId,
      sessionId: session.id,
      provider,
      goal: input.goal,
      status: 'starting',
      report: null,
      degraded: false,
      createdAt: now,
      updatedAt: now
    }
    // Registered before the first turn so the task service sees the worker profile.
    this.workers.set(worker.id, worker)
    this.saveWorker(worker)
    batch?.set(key, worker.id)
    const text = input.context ? `${input.goal}\n\nContext:\n${input.context}` : input.goal
    try {
      await this.host.send({ sessionId: session.id, commandId: crypto.randomUUID(), text })
    } catch {
      worker.status = 'failed'
      this.saveWorker(worker)
      throw new RouterToolError('dispatch_failed', 'The worker could not start its first turn.')
    }
    if (worker.status === 'starting') {
      worker.status = 'running'
      this.saveWorker(worker)
    }
    return { workerId: worker.id, status: 'started' }
  }

  private dropIdleEngines(): void {
    for (const [id] of this.engines) {
      if (this.routers.get(id)?.status !== 'running') this.engines.delete(id)
    }
  }
  private routerWorkers(routerId: string): RouterWorker[] {
    return [...this.workers.values()].filter((w) => w.routerId === routerId)
  }
  private workerBySession(sessionId: string): RouterWorker | undefined {
    for (const worker of this.workers.values()) if (worker.sessionId === sessionId) return worker
    return undefined
  }
  private getRouter(id: string): CodexRouter {
    const router = this.routers.get(id)
    if (!router) throw new CodexRuntimeError('task_not_found', 'Router not found.')
    return router
  }
  private saveWorker(worker: RouterWorker): void {
    if (this.closed) return
    worker.updatedAt = new Date().toISOString()
    this.store.saveWorker(worker)
    this.emit({ type: 'worker', worker })
  }
  private changed(router: CodexRouter, immediate = true): void {
    if (this.closed) return
    router.updatedAt = new Date().toISOString()
    this.dirty.add(router.id)
    if (immediate) this.flush()
    else if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 70)
  }
  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    for (const id of this.dirty) {
      const router = this.routers.get(id)
      if (!router) continue
      this.store.saveRouter(router)
      this.emit({ type: 'router', router })
    }
    this.dirty.clear()
  }
}
