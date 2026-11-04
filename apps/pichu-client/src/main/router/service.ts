import type { CodexEvent, CodexFailure, CodexItem, CodexRouter } from '../../shared/codex.js'
import type {
  DiscardWorktree,
  ResolveBatch,
  RouterEngineId,
  RouterProviderInfo,
  RouterWorker,
  SendRouterMessage,
  SetRouterKey
} from '../../shared/router.js'
import { CodexRuntimeError } from '../codex/errors.js'
import type { RouterCredentials } from './credentials.js'
import type { RouterBatchOutcome, RouterEngine, RouterSink } from './engine.js'
import type { EngineFactory } from './engines/factory.js'
import { builtinRouterModels, catalog, OWLS_PROVIDERS } from './engines/owls-models.js'
import type { InboxEvent, InboxEventBody } from './events.js'
import { ROUTER_PROMPT_VERSION } from './prompt.js'
import { renderBatch, renderState } from './render.js'
import type { RouterStore } from './store.js'
import { RouterToolError, routerTools } from './tools.js'
import {
  type TurnOutcome,
  type TurnProfile,
  type TurnProfiles,
  type WorkerHost,
  WorkerPool
} from './workers.js'
import { checkoutOnly, type WorkerWorkspaces } from './worktrees.js'

export type { TurnOutcome, TurnProfile, TurnProfiles, WorkerHost } from './workers.js'
export { WORKER_LIMIT } from './workers.js'

type ActiveBatch = { id: string; startedAt: number; tokens: number }
/** Characters recall returns per call; longer text continues at `<id>@<offset>`. */
const RECALL_PAGE = 4000

/**
 * Project Routers: their conversations, the persisted Inbox, and batch
 * delivery to the configured engine. Workers live in the WorkerPool.
 */
export class RouterService implements TurnProfiles {
  private readonly routers = new Map<string, CodexRouter>()
  private readonly engines = new Map<string, { engine: RouterEngine; key: string }>()
  private readonly active = new Map<string, ActiveBatch>()
  /** Workers dispatched in the current batch, by goal hash, so retried calls reuse them. */
  private readonly dispatched = new Map<string, Map<string, string>>()
  private readonly dirty = new Set<string>()
  private readonly pool: WorkerPool
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(
    private readonly store: RouterStore,
    private readonly credentials: RouterCredentials,
    private readonly commands: { acceptCommand(id: string, scope: string, text: string): boolean },
    private readonly host: WorkerHost,
    private readonly emit: (event: CodexEvent) => void,
    private readonly createEngine: EngineFactory,
    workspaces: WorkerWorkspaces = checkoutOnly
  ) {
    // A batch still sending when the app stopped may or may not have reached the model.
    for (const batch of store.batches('sending')) store.finishBatch(batch.id, 'dispatch_unknown')
    const unknown = store.batches('dispatch_unknown')
    for (const router of store.routers()) {
      if (router.status === 'running') {
        router.status = 'interrupted'
        router.error = { code: 'interrupted', message: '' }
        for (const item of router.items) if (item.status === 'running') item.status = 'interrupted'
      }
      router.unknownBatches = unknown
        .filter((b) => b.routerId === router.id)
        .map((b) => ({ id: b.id, events: b.eventSeqs.length, createdAt: b.createdAt }))
      store.saveRouter(router)
      this.routers.set(router.id, router)
    }
    this.pool = new WorkerPool(
      store,
      host,
      {
        add: (routerId, body, wake = true) => this.add(routerId, crypto.randomUUID(), body, wake),
        settle: (routerId, match, status) =>
          store.setEventStatus(
            store
              .events(routerId, 'pending')
              .filter(match)
              .map((e) => e.seq),
            status
          )
      },
      (worker) => {
        if (!this.closed) this.emit({ type: 'worker', worker })
      },
      workspaces
    )
  }

  /** Settles once startup cleanup of worker worktrees has run. */
  get recovered(): Promise<void> {
    return this.pool.recovered
  }

  snapshot(): { routers: CodexRouter[]; workers: RouterWorker[] } {
    return {
      routers: [...this.routers.values()].sort((a, b) => a.projectId.localeCompare(b.projectId)),
      workers: this.pool.snapshot()
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
      native: null,
      unknownBatches: [],
      createdAt: now,
      updatedAt: now
    }
    this.routers.set(router.id, router)
    this.changed(router)
    return router
  }

  async send(input: SendRouterMessage): Promise<void> {
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
    const body: InboxEventBody = {
      kind: 'user_message',
      at: new Date().toISOString(),
      text: input.text
    }
    // A running batch takes the user's message immediately; other events wait.
    const batch = this.active.get(router.id)
    const engine = this.engines.get(router.id)?.engine
    // Checked again after the await: the batch may have ended meanwhile.
    if (batch && engine && (await engine.steer(input.text)) === 'steered') {
      this.store.appendEvent(router.id, input.commandId, body, batch.id)
      return
    }
    this.add(router.id, input.commandId, body, true)
  }

  interrupt(routerId: string): void {
    const router = this.getRouter(routerId)
    if (router.status === 'running') this.engines.get(router.id)?.engine.abort()
  }

  /** Resends or dismisses a batch whose delivery is unknown after a restart. */
  resolveBatch(input: ResolveBatch): void {
    const router = this.getRouter(input.routerId)
    const batch = this.store.batch(input.batchId)
    if (!batch || batch.routerId !== router.id || batch.status !== 'dispatch_unknown')
      throw new CodexRuntimeError('request_unavailable', 'This batch is no longer waiting.')
    if (input.decision === 'retry') this.store.requeueBatch(batch.id)
    else this.store.finishBatch(batch.id, 'ignored')
    router.unknownBatches = router.unknownBatches.filter((b) => b.id !== batch.id)
    this.changed(router)
    if (input.decision === 'retry') queueMicrotask(() => void this.pump(router.id))
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

  /** Removes a worktree kept after its worker was removed, once the user confirmed it. */
  discardWorktree(input: DiscardWorktree): Promise<void> {
    this.getRouter(input.routerId)
    return this.pool.discard(input.routerId, input.workerId)
  }

  prepare(sessionId: string): Promise<void> {
    return this.pool.prepare(sessionId)
  }

  profile(sessionId: string): TurnProfile {
    return this.pool.profile(sessionId)
  }

  settled(sessionId: string, outcome: TurnOutcome): void {
    this.pool.settled(sessionId, outcome)
  }

  /** Follows task and connection events on behalf of the workers and engines. */
  observe(event: CodexEvent): void {
    if (this.closed) return
    if (event.type === 'claude-connection') this.dropIdleEngines()
    this.pool.observe(event)
  }

  isRunning(): boolean {
    return [...this.routers.values()].some((r) => r.status === 'running')
  }

  close(): void {
    if (this.closed) return
    // Stopping on quit is the user's choice, so these batches are not unknown later.
    for (const [routerId, batch] of this.active) {
      this.store.finishBatch(batch.id, 'delivered', {
        tokens: batch.tokens,
        durationMs: Date.now() - batch.startedAt
      })
      const router = this.routers.get(routerId)
      if (!router) continue
      router.status = 'interrupted'
      for (const item of router.items) if (item.status === 'running') item.status = 'interrupted'
      this.dirty.add(routerId)
    }
    this.flush()
    this.closed = true
    this.pool.close()
    for (const { engine } of this.engines.values()) engine.abort()
    this.engines.clear()
  }

  private add(routerId: string, id: string, body: InboxEventBody, wake: boolean): void {
    if (this.closed) return
    this.store.appendEvent(routerId, id, body)
    if (wake) queueMicrotask(() => void this.pump(routerId))
  }

  private async pump(routerId: string): Promise<void> {
    const router = this.routers.get(routerId)
    if (!router || router.status === 'running' || this.closed) return
    const events = this.store.events(routerId, 'pending')
    if (!events.length) return
    const engine = this.engine(router)
    if ('code' in engine) {
      // Keep the events so they go out once the Router is configured.
      router.status = 'failed'
      router.error = engine
      this.changed(router)
      return
    }
    const settings = this.host.settings().router
    const batch: ActiveBatch = {
      id: `b_${crypto.randomUUID().slice(0, 8)}`,
      startedAt: Date.now(),
      tokens: 0
    }
    this.store.openBatch(
      {
        id: batch.id,
        routerId,
        createdAt: new Date(batch.startedAt).toISOString(),
        engine: settings.engine,
        promptVersion: ROUTER_PROMPT_VERSION
      },
      events.map((e) => e.seq)
    )
    this.pool.delivered(events)
    const state = this.needsState(router, settings.engine)
      ? renderState(this.pool.list(routerId))
      : null
    this.active.set(routerId, batch)
    router.status = 'running'
    router.error = null
    this.changed(router)
    this.dispatched.set(routerId, new Map())
    const outcome = await this.runBatch(engine, router, batch, events, state)
    this.dispatched.delete(routerId)
    this.active.delete(routerId)
    if (this.closed) return
    this.store.finishBatch(batch.id, 'delivered', {
      tokens: batch.tokens,
      durationMs: Date.now() - batch.startedAt
    })
    router.native = outcome.native
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
    if (this.store.events(routerId, 'pending').length) void this.pump(routerId)
  }

  private async runBatch(
    engine: RouterEngine,
    router: CodexRouter,
    batch: ActiveBatch,
    events: InboxEvent[],
    state: string | null
  ): Promise<RouterBatchOutcome> {
    try {
      return await engine.run(
        { batchId: batch.id, text: renderBatch(batch.id, events, state), native: router.native },
        this.sink(router, batch)
      )
    } catch {
      const error: CodexFailure = { code: 'native_error', message: 'The Router engine failed.' }
      return { status: 'failed', error, native: router.native ?? { engine: 'owls' } }
    }
  }

  /**
   * True when the engine starts a context that has not seen this Router's
   * history: after an engine switch, or when Claude Code has no session to
   * resume. The batch then opens with the current worker summary (RFC 12).
   */
  private needsState(router: CodexRouter, engine: RouterEngineId): boolean {
    const native = router.native
    const history =
      native !== null || this.pool.list(router.id).length > 0 || this.store.hasMessages(router.id)
    if (!history) return false
    if (engine === 'owls') return native !== null && native.engine !== 'owls'
    return !(native?.engine === 'claude-code' && native.sessionId)
  }

  private engine(router: CodexRouter): RouterEngine | CodexFailure {
    const settings = this.host.settings().router
    const key = JSON.stringify(settings)
    const cached = this.engines.get(router.id)
    if (cached?.key === key) return cached.engine
    const engine = this.createEngine({
      router,
      settings,
      tools: routerTools({
        dispatchTask: (input) => this.pool.dispatch(router, input, this.dispatched.get(router.id)),
        messageWorker: (input) => this.pool.message(router.id, input),
        stopWorker: (workerId) => this.pool.stop(router.id, workerId),
        listWorkers: (input) => ({ workers: this.pool.describe(router.id, input.status) }),
        recall: (id) => this.recall(router.id, id)
      }),
      history: this.store.messages(router.id),
      state: () => renderState(this.pool.list(router.id)),
      persist: (batchId, messages) => this.store.appendMessages(router.id, batchId, messages)
    })
    if (!('code' in engine)) this.engines.set(router.id, { engine, key })
    return engine
  }

  private sink(router: CodexRouter, batch: ActiveBatch): RouterSink {
    return {
      item: (item: CodexItem) => {
        const index = router.items.findIndex((i) => i.id === item.id)
        if (index >= 0) router.items[index] = item
        else router.items.push(item)
        // Streaming text is batched; finished items are saved at once.
        this.changed(router, item.status !== 'running')
      },
      usage: (usage) => {
        const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite
        batch.tokens += tokens
        router.tokens = (router.tokens ?? 0) + tokens
      }
    }
  }

  /** Expands a worker, event, or batch ID for the Router, one page of long text at a time. */
  private recall(routerId: string, id: string): Record<string, unknown> {
    const [base = '', at = '0'] = id.split('@')
    const offset = /^\d+$/.test(at) ? Number(at) : 0
    const page = (text: string | null) => {
      if (!text || text.length <= offset + RECALL_PAGE) return { text: text?.slice(offset) ?? null }
      return {
        text: text.slice(offset, offset + RECALL_PAGE),
        next: `${base}@${offset + RECALL_PAGE}`
      }
    }
    const missing = () => new RouterToolError('not_found', `Nothing to recall for ${id}.`)
    if (base.startsWith('w_')) {
      const worker = this.pool.get(base)
      if (!worker || worker.routerId !== routerId) throw missing()
      return {
        id: worker.id,
        goal: worker.goal,
        status: worker.status,
        provider: worker.provider,
        permission: worker.permission,
        ...this.pool.place(worker),
        report: worker.report,
        context: page(worker.context),
        events: this.store.workerEvents(routerId, worker.id, 10).map((e) => `ev_${e.seq}`)
      }
    }
    const seq = /^ev_(\d+)$/.exec(base)?.[1]
    if (seq) {
      const found = this.store.event(Number(seq))
      if (!found || found.routerId !== routerId) throw missing()
      const { event, status, batchId } = found
      const text =
        event.kind === 'user_message'
          ? event.text
          : event.kind === 'worker_report'
            ? event.report.summary
            : event.kind === 'worker_waiting'
              ? event.detail
              : null
      return {
        id: base,
        kind: event.kind,
        at: event.at,
        status,
        batchId,
        ...('workerId' in event ? { workerId: event.workerId, goal: event.goal } : {}),
        ...(event.kind === 'worker_report'
          ? { reportStatus: event.report.status, artifacts: event.report.artifacts }
          : {}),
        ...page(text)
      }
    }
    if (base.startsWith('b_')) {
      const batch = this.store.batch(base)
      if (!batch || batch.routerId !== routerId) throw missing()
      return {
        id: batch.id,
        status: batch.status,
        engine: batch.engine,
        createdAt: batch.createdAt,
        events: batch.eventSeqs.map((n) => `ev_${n}`)
      }
    }
    throw missing()
  }

  private dropIdleEngines(): void {
    for (const [id] of this.engines) {
      if (this.routers.get(id)?.status !== 'running') this.engines.delete(id)
    }
  }
  private getRouter(id: string): CodexRouter {
    const router = this.routers.get(id)
    if (!router) throw new CodexRuntimeError('task_not_found', 'Router not found.')
    return router
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
