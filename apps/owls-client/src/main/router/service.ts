import type {
  AppEvent,
  Failure,
  ForwardOrigin,
  Project,
  Router,
  SessionItem,
  ThreadItem
} from '../../shared/app.js'
import type { AttachedCard } from '../../shared/cards.js'
import type { ProjectGitRefs } from '../../shared/projects.js'
import type {
  CreateThread,
  ForwardMessage,
  ResolveBatch,
  RouterEngineId,
  RouterProviderInfo,
  RouterWorker,
  SendRouterMessage,
  SetRouterKey,
  WorkerAction,
  WorkerPullRequestLink,
  WorkerReport
} from '../../shared/router.js'
import { totalTokens, type UsageEntry } from '../../shared/usage-stats.js'
import { OwlsError } from '../app/errors.js'
import type { CapturedContent } from '../cards/service.js'
import type { RouterMemory } from '../memory/service.js'
import type { RouterCredentials } from './credentials.js'
import type { RouterBatchOutcome, RouterEngine, RouterSink } from './engine.js'
import type { EngineFactory } from './engines/factory.js'
import { builtinRouterModels, catalog, OWLS_PROVIDERS } from './engines/owls-models.js'
import { type InboxEvent, type InboxEventBody, isQuietEvent } from './events.js'
import { ROUTER_PROMPT_VERSION } from './prompt.js'
import { cardsText, renderBatch, renderProjects, renderState } from './render.js'
import { WorkerReportServer } from './report-server.js'
import type { RouterStore } from './store.js'
import { ThreadLog } from './thread-log.js'
import { RouterToolError, routerTools } from './tools.js'
import { LocalWorkers, type WorkerTarget } from './worker-target.js'
import {
  type TurnOutcome,
  type TurnProfile,
  type TurnProfiles,
  type WorkerHost,
  WorkerPool
} from './workers.js'
import { checkoutOnly, type WorkerRemoteBranch, type WorkerWorkspaces } from './worktrees.js'

export type { TurnOutcome, TurnProfile, TurnProfiles, WorkerHost } from './workers.js'
export { WORKER_LIMIT } from './workers.js'

type ActiveBatch = {
  id: string
  startedAt: number
  tokens: number
  /** The engine the batch runs on, for usage records. */
  engine: RouterEngineId
  /** Workers dispatched in this batch that the conversation does not show yet. */
  dispatches: Set<string>
}
/** Characters recall returns per call; longer text continues at `<id>@<offset>`. */
const RECALL_PAGE = 4000
const TITLE_LIMIT = 60
const PREVIEW_LIMIT = 200
/** Memory for a Router built without it, as in most tests. */
const noMemory: RouterMemory = {
  enabled: () => false,
  injection: () => null,
  categoryLine: () => null,
  search: () => ({ memories: [] })
}

/** How a user item names the cards its message carried. */
const cardRefs = (cards: AttachedCard[]) =>
  cards.length ? { cards: cards.map(({ id, title }) => ({ id, title })) } : {}

/** A short thread title: the first line with text, on one line. */
function titleOf(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? text
  return line.trim().replace(/\s+/g, ' ').slice(0, TITLE_LIMIT)
}

/**
 * Global threads, each with its own Router: their conversations, the persisted
 * Inbox, and batch delivery to the configured engine. Workers live in the
 * WorkerPool. A thread's items load on first use and are saved one by one.
 * Only threads whose `deviceId` is this device run here; others are read-only.
 */
export class RouterService implements TurnProfiles {
  private readonly routers = new Map<string, Router>()
  private readonly logs = new Map<string, ThreadLog>()
  private readonly engines = new Map<string, { engine: RouterEngine; key: string }>()
  private readonly active = new Map<string, ActiveBatch>()
  /** Workers dispatched in the current batch, by goal hash, so retried calls reuse them. */
  private readonly dispatched = new Map<string, Map<string, string>>()
  /** Threads whose record changed since the last flush. */
  private readonly dirty = new Set<string>()
  /** Changed items by thread since the last flush, streaming ones included. */
  private readonly dirtyItems = new Map<string, Set<string>>()
  private readonly pool: WorkerPool
  /** Serves the report tool to workers whose agent takes MCP servers only by URL. */
  private readonly reports: WorkerReportServer
  /** Where worker actions go; every worker runs on this device for now. */
  private readonly workers: WorkerTarget
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(
    private readonly store: RouterStore,
    private readonly credentials: RouterCredentials,
    private readonly commands: { acceptCommand(id: string, scope: string, text: string): boolean },
    private readonly host: WorkerHost,
    private readonly emit: (event: AppEvent) => void,
    private readonly createEngine: EngineFactory,
    private readonly workspaces: WorkerWorkspaces = checkoutOnly,
    private readonly memory: RouterMemory = noMemory,
    /** Keeps the token usage the engines report, for the usage page. */
    private readonly recordUsage: (entry: UsageEntry) => void = () => {}
  ) {
    // A batch still sending when the app stopped may or may not have reached the model.
    for (const batch of store.batches('sending')) store.finishBatch(batch.id, 'dispatch_unknown')
    const unknown = store.batches('dispatch_unknown')
    for (const router of store.routers()) {
      this.routers.set(router.id, router)
      // Another device recovers its own threads.
      if (!this.local(router)) continue
      const unknownBatches = unknown
        .filter((b) => b.routerId === router.id)
        .map((b) => ({ id: b.id, events: b.eventSeqs.length, createdAt: b.createdAt }))
      const interrupted = router.status === 'running'
      if (!interrupted && !unknownBatches.length && !router.unknownBatches.length) continue
      router.unknownBatches = unknownBatches
      const saved: ThreadItem[] = []
      if (interrupted) {
        router.status = 'interrupted'
        router.error = { code: 'interrupted', message: '' }
        const log = this.log(router)
        for (const item of log.running()) saved.push(log.put({ ...item, status: 'interrupted' }))
      }
      router.rev = store.saveThread(router, saved)
      for (const entry of saved) entry.rev = router.rev
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
      workspaces,
      (sessionId) => this.reports.endpoint(sessionId)
    )
    this.reports = new WorkerReportServer((sessionId, input) =>
      this.pool.toolReport(sessionId, input)
    )
    this.workers = new LocalWorkers(this.pool)
  }

  /** Settles once startup cleanup of worker worktrees has run. */
  get recovered(): Promise<void> {
    return this.pool.recovered
  }

  snapshot(): { routers: Router[]; workers: RouterWorker[] } {
    return {
      routers: [...this.routers.values()].sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
      ),
      workers: this.pool.snapshot()
    }
  }

  /** Starts an empty thread. `id` lets a forward stay idempotent. */
  createThread(input: CreateThread, id: string = crypto.randomUUID()): Router {
    const project = input.projectId
      ? this.host.projects().find((p) => p.id === input.projectId)
      : null
    if (input.projectId && !project)
      throw new OwlsError('project_required', 'This project no longer exists.')
    const now = new Date().toISOString()
    const router: Router = {
      id,
      deviceId: this.store.deviceId,
      title: null,
      projectId: project?.id ?? null,
      cwd: project?.path ?? this.host.threadHome(),
      status: 'idle',
      rev: 0,
      itemCount: 0,
      preview: null,
      projectsShown: null,
      error: null,
      tokens: null,
      native: null,
      unknownBatches: [],
      createdAt: now,
      updatedAt: now
    }
    this.routers.set(router.id, router)
    this.logs.set(router.id, new ThreadLog([]))
    this.changed(router)
    return router
  }

  /** A thread's items changed after version `after`, in position order. */
  items(routerId: string, after = 0): ThreadItem[] {
    return this.log(this.getRouter(routerId)).after(after)
  }

  /**
   * `cards` are the frozen copies of `input.cardIds`, which the caller reads from
   * the card library, so a thread never depends on a card after it was sent.
   */
  async send(input: SendRouterMessage, cards: AttachedCard[] = []): Promise<void> {
    const router = this.ownRouter(input.routerId)
    const accepted = this.commands.acceptCommand(
      input.commandId,
      router.id,
      cards.length ? JSON.stringify([input.text, cards.map((c) => c.id)]) : input.text
    )
    if (!accepted) return
    if (input.workerId) return this.sendToWorker(router, input, input.workerId, cards)
    router.title ??= titleOf(input.text)
    this.put(router, {
      id: input.commandId,
      kind: 'user',
      status: 'completed',
      text: input.text,
      detail: '',
      turnId: null,
      ...cardRefs(cards)
    })
    const body: InboxEventBody = {
      kind: 'user_message',
      at: new Date().toISOString(),
      text: input.text,
      ...(cards.length ? { cards } : {})
    }
    // A running batch takes the user's message immediately; other events wait.
    // Cards always wait, so they reach the Router marked as reference material.
    const batch = this.active.get(router.id)
    const engine = this.engines.get(router.id)?.engine
    // Checked again after the await: the batch may have ended meanwhile.
    if (!cards.length && batch && engine && (await engine.steer(input.text)) === 'steered') {
      this.store.appendEvent(router.id, input.commandId, body, batch.id)
      return
    }
    this.add(router.id, input.commandId, body, true)
  }

  /**
   * The user named the worker, so Owls delivers the message without a model
   * call (RFC_OWLS_ROUTER_SHELL 4.4). The Router reads it in its next batch, and
   * the worker's report starts that batch as usual. Cards go ahead of the text.
   */
  private async sendToWorker(
    router: Router,
    input: SendRouterMessage,
    workerId: string,
    cards: AttachedCard[]
  ): Promise<void> {
    const text = cards.length ? `${cardsText(cards)}\n\n${input.text}` : input.text
    await this.forUser(() => this.workers.message(router.id, { workerId, text }))
    this.put(router, {
      id: input.commandId,
      kind: 'user',
      status: 'completed',
      text: input.text,
      detail: '',
      turnId: null,
      workerId,
      ...cardRefs(cards)
    })
    const body: InboxEventBody = {
      kind: 'user_message',
      at: new Date().toISOString(),
      text: input.text,
      workerId,
      ...(cards.length ? { cards } : {})
    }
    this.add(router.id, input.commandId, body, false)
  }

  /**
   * Copies content into another thread and starts the Router there. The copy is
   * frozen, so it does not depend on the source thread afterwards, and it goes
   * through the Inbox, so every engine gets it the same way. Returns the thread
   * that received it; `commandId` names a new one so a repeated call finds it.
   */
  forward(input: ForwardMessage): Router {
    const source = this.getRouter(input.source.routerId)
    const targetId = input.target.kind === 'thread' ? input.target.routerId : input.commandId
    if (targetId === source.id)
      throw new OwlsError('invalid_request', 'This content is already in that thread.')
    if (input.target.kind === 'thread') this.ownRouter(targetId)
    const content = this.forwardContent(input.source, source)
    const note = input.note || null
    const accepted = this.commands.acceptCommand(
      input.commandId,
      source.id,
      JSON.stringify([input.source, input.target, note])
    )
    if (!accepted) return this.getRouter(targetId)
    const target =
      input.target.kind === 'thread'
        ? this.ownRouter(targetId)
        : this.createThread({ projectId: input.target.projectId }, targetId)
    target.title ??= titleOf(note ?? content.text)
    const { goal, artifacts, ...origin } = content.origin
    this.put(target, {
      id: input.commandId,
      kind: 'forward',
      status: 'completed',
      text: content.text,
      detail: note ?? '',
      turnId: null,
      forward: origin
    })
    this.add(
      target.id,
      input.commandId,
      {
        kind: 'forwarded',
        at: new Date().toISOString(),
        from: source.title,
        note,
        text: content.text,
        ...(origin.workerId ? { workerId: origin.workerId, goal } : {}),
        branch: origin.branch,
        artifacts
      },
      true
    )
    return target
  }

  /** A message or worker result to save as a card: its frozen text and where it came from. */
  contentOf(input: ForwardMessage['source']): CapturedContent {
    const router = this.getRouter(input.routerId)
    const content = this.forwardContent(input, router)
    const { workerId, branch } = content.origin
    return {
      text: branch ? `${content.text}\n\nBranch: \`${branch}\`` : content.text,
      source: {
        kind: input.kind === 'item' ? 'message' : 'worker',
        threadId: router.id,
        threadTitle: router.title,
        itemId: input.kind === 'item' ? input.itemId : null,
        workerId
      }
    }
  }

  /** The text to freeze and where it came from. Refuses anything with nothing to forward. */
  private forwardContent(
    input: ForwardMessage['source'],
    source: Router
  ): {
    text: string
    origin: ForwardOrigin & { goal?: string; artifacts: WorkerReport['artifacts'] }
  } {
    const base = { routerId: source.id, title: source.title, artifacts: [] }
    const unavailable = () =>
      new OwlsError('request_unavailable', 'This content can no longer be forwarded.')
    if (input.kind === 'item') {
      const item = this.log(source).get(input.itemId)?.item
      if (!item?.text || !['user', 'assistant', 'forward'].includes(item.kind)) throw unavailable()
      return { text: item.text, origin: { ...base, workerId: null, branch: null } }
    }
    const worker = this.pool.get(input.workerId)
    if (worker?.routerId !== source.id || !worker.report) throw unavailable()
    return {
      text: worker.report.summary,
      origin: {
        ...base,
        workerId: worker.id,
        branch: this.pool.place(worker).branch,
        goal: worker.goal,
        artifacts: worker.report.artifacts
      }
    }
  }

  async stopWorker(input: WorkerAction): Promise<void> {
    const router = this.ownRouter(input.routerId)
    await this.forUser(() => this.workers.stop(router.id, input.workerId, 'user'))
  }

  /** Removes a worker that is not running; the `removed` event tells the Router. */
  removeWorker(input: WorkerAction): void {
    const worker = this.pool.get(input.workerId)
    if (!worker || worker.routerId !== this.ownRouter(input.routerId).id)
      throw new OwlsError('request_unavailable', 'This worker no longer exists.')
    if (worker.status !== 'removed') this.host.remove(worker.sessionId)
  }

  /** The session of a worker on this device, whose folder the user can open in another app. */
  workerSession(input: WorkerAction): string {
    const worker = this.pool.get(input.workerId)
    if (!worker || worker.routerId !== this.ownRouter(input.routerId).id)
      throw new OwlsError('request_unavailable', 'This worker no longer exists.')
    return worker.sessionId
  }

  /** Worker calls report model-facing errors; the user gets a stable failure instead. */
  private async forUser<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (error) {
      if (error instanceof RouterToolError)
        throw new OwlsError('request_unavailable', 'This worker cannot take this action.')
      throw error
    }
  }

  interrupt(routerId: string): void {
    const router = this.ownRouter(routerId)
    if (router.status === 'running') this.engines.get(router.id)?.engine.abort()
  }

  /** Resends or dismisses a batch whose delivery is unknown after a restart. */
  resolveBatch(input: ResolveBatch): void {
    const router = this.ownRouter(input.routerId)
    const batch = this.store.batch(input.batchId)
    if (!batch || batch.routerId !== router.id || batch.status !== 'dispatch_unknown')
      throw new OwlsError('request_unavailable', 'This batch is no longer waiting.')
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

  async setKey(input: SetRouterKey): Promise<void> {
    await this.credentials.setKey(input.providerId, input.key)
    this.dropIdleEngines()
  }

  removeKey(providerId: SetRouterKey['providerId']): void {
    this.credentials.remove(providerId)
    this.dropIdleEngines()
  }

  /** Router settings changed: idle engines are rebuilt on the next batch. */
  settingsChanged(): void {
    this.dropIdleEngines()
    // A failure from the old settings no longer applies, and messages that waited for a
    // working engine can go out now.
    for (const router of this.routers.values()) {
      if (router.status !== 'failed' || !this.local(router)) continue
      router.status = 'idle'
      router.error = null
      this.changed(router)
      if (this.store.events(router.id, 'pending').some((e) => !isQuietEvent(e)))
        void this.pump(router.id)
    }
  }

  /** Removes a worktree kept after its worker was removed, once the user confirmed it. */
  discardWorktree(input: WorkerAction): Promise<void> {
    this.ownRouter(input.routerId)
    return this.pool.discard(input.routerId, input.workerId)
  }

  prepare(sessionId: string): Promise<string[]> {
    return this.pool.prepare(sessionId)
  }

  profile(sessionId: string): TurnProfile | null {
    return this.pool.profile(sessionId)
  }

  settled(sessionId: string, outcome: TurnOutcome): void {
    this.pool.settled(sessionId, outcome)
  }

  /** Follows task and connection events on behalf of the workers and engines. */
  observe(event: AppEvent): void {
    if (this.closed) return
    if (event.type === 'claude-connection') this.dropIdleEngines()
    this.pool.observe(event)
  }

  /** A thread's title; null for an untitled or unknown thread. */
  title(routerId: string): string | null {
    return this.routers.get(routerId)?.title ?? null
  }

  worker(workerId: string): RouterWorker | undefined {
    return this.pool.get(workerId)
  }
  async remoteBranch(workerId: string): Promise<WorkerRemoteBranch | null> {
    const worker = this.pool.get(workerId)
    const workspace = worker?.workspace
    return worker && workspace?.kind === 'worktree'
      ? this.workspaces.remoteBranch(workspace, this.pool.projectSettings(worker).git)
      : null
  }
  /** A project repository's branches and remotes, for its settings page. */
  gitRefs(projectPath: string): Promise<ProjectGitRefs | null> {
    return this.workspaces.refs(projectPath)
  }
  /** The URL of the remote a project's workers push to, for finding their pull requests. */
  projectRemoteUrl(project: Project): Promise<string | null> {
    return this.workspaces.remoteUrl(project.path, project.settings.git)
  }
  linkPullRequest(workerId: string, link: WorkerPullRequestLink): void {
    this.pool.linkPullRequest(workerId, link)
  }

  isRunning(): boolean {
    return [...this.routers.values()].some((r) => r.status === 'running' && this.local(r))
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
      this.finishItems(router, 'interrupted')
      this.dirty.add(routerId)
    }
    this.flush()
    this.closed = true
    this.pool.close()
    this.reports.close()
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
    if (!router || !this.local(router) || router.status === 'running' || this.closed) return
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
      tokens: 0,
      engine: settings.engine,
      dispatches: new Set()
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
    const history = this.hasHistory(router)
    const state = this.needsState(router, settings.engine, history) ? this.stateOf(router) : null
    // A context that starts without this thread's history reads memory once, frozen there.
    const memory = !history || state ? this.memory.injection(router.projectId) : null
    const projects = renderProjects(this.host.projects(), router.projectId)
    // A context that gets the state reads the list there.
    const newProjects = !state && projects !== router.projectsShown ? projects : null
    router.projectsShown = projects
    this.active.set(routerId, batch)
    router.status = 'running'
    router.error = null
    this.changed(router)
    this.dispatched.set(routerId, new Map())
    const outcome = await this.runBatch(engine, router, batch, events, {
      state,
      projects: newProjects,
      memory
    })
    this.showDispatches(router, batch)
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
    this.finishItems(router, outcome.status)
    this.changed(router)
    if (this.store.events(routerId, 'pending').some((e) => !isQuietEvent(e)))
      void this.pump(routerId)
  }

  private async runBatch(
    engine: RouterEngine,
    router: Router,
    batch: ActiveBatch,
    events: InboxEvent[],
    context: { state: string | null; projects: string | null; memory: string | null }
  ): Promise<RouterBatchOutcome> {
    try {
      return await engine.run(
        {
          batchId: batch.id,
          text: renderBatch(batch.id, events, context.state, context.projects, context.memory),
          native: router.native
        },
        this.sink(router, batch)
      )
    } catch {
      const error: Failure = { code: 'native_error', message: 'The Router engine failed.' }
      return { status: 'failed', error, native: router.native ?? { engine: 'owls' } }
    }
  }

  /**
   * True when the engine starts a context that has not seen this Router's
   * history: after an engine switch, or when Claude Code has no session to
   * resume. The batch then opens with the current worker summary (RFC 12).
   */
  private needsState(router: Router, engine: RouterEngineId, history: boolean): boolean {
    const native = router.native
    if (!history) return false
    if (engine === 'owls') return native !== null && native.engine !== 'owls'
    return !(native?.engine === 'claude-code' && native.sessionId)
  }

  /** True once an engine has run for this thread or it has workers. */
  private hasHistory(router: Router): boolean {
    return (
      router.native !== null ||
      this.pool.list(router.id).length > 0 ||
      this.store.hasMessages(router.id)
    )
  }

  private engine(router: Router): RouterEngine | Failure {
    const settings = this.host.settings().router
    const memory = this.memory.enabled()
    const key = JSON.stringify([settings, memory])
    const cached = this.engines.get(router.id)
    if (cached?.key === key) return cached.engine
    const engine = this.createEngine({
      router,
      settings,
      tools: routerTools({
        dispatchTask: async (input) => {
          const result = await this.workers.dispatch({
            routerId: router.id,
            defaultProjectId: router.projectId,
            input,
            seen: this.dispatched.get(router.id)
          })
          this.active.get(router.id)?.dispatches.add(result.workerId)
          return result
        },
        messageWorker: (input) => this.workers.message(router.id, input),
        stopWorker: (workerId) => this.workers.stop(router.id, workerId),
        listWorkers: (input) => ({ workers: this.pool.describe(router.id, input.status) }),
        recall: (id) => this.recall(router.id, id),
        ...(memory ? { searchMemory: (input) => this.memory.search(input) } : {})
      }),
      history: this.store.messages(router.id),
      state: () => this.stateOf(router, true),
      persist: (batchId, messages) => this.store.appendMessages(router.id, batchId, messages)
    })
    if (!('code' in engine)) this.engines.set(router.id, { engine, key })
    return engine
  }

  /**
   * Marks where workers were dispatched in the conversation, so all three
   * engines get this without parsing their tool results. It waits for the tool
   * item because Claude Code runs a tool before it delivers the text leading
   * up to the call, and the dispatch must read after that text.
   */
  private showDispatches(router: Router, batch: ActiveBatch): void {
    for (const workerId of batch.dispatches) {
      const id = `dispatch:${workerId}`
      if (this.log(router).get(id)) continue
      this.put(router, {
        id,
        kind: 'worker',
        status: 'completed',
        text: '',
        detail: '',
        turnId: null,
        workerId
      })
    }
    batch.dispatches.clear()
  }

  private sink(router: Router, batch: ActiveBatch): RouterSink {
    return {
      item: (item: SessionItem) => {
        this.put(router, item)
        if (item.kind === 'tool') this.showDispatches(router, batch)
      },
      usage: (usage) => {
        const tokens = totalTokens(usage)
        batch.tokens += tokens
        router.tokens = (router.tokens ?? 0) + tokens
        this.recordUsage({
          ...usage,
          agent: batch.engine,
          role: 'router',
          // Threads are global; only workers belong to a project.
          projectId: null
        })
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
        project: this.pool.projectName(worker),
        permission: worker.permission,
        parent: worker.parentId,
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
          ? event.cards?.length
            ? `${event.text}\n\n${cardsText(event.cards)}`
            : event.text
          : event.kind === 'forwarded'
            ? event.text
            : event.kind === 'worker_report'
              ? event.report.summary
              : event.kind === 'worker_progress'
                ? event.summary
                : event.kind === 'worker_waiting'
                  ? event.detail
                  : null
      return {
        id: base,
        kind: event.kind,
        at: event.at,
        status,
        batchId,
        ...(event.kind === 'user_message'
          ? { workerId: event.workerId }
          : { workerId: event.workerId, goal: event.goal }),
        ...(event.kind === 'forwarded'
          ? { from: event.from, note: event.note, branch: event.branch }
          : {}),
        ...(event.kind === 'worker_report'
          ? { reportStatus: event.report.status, artifacts: event.report.artifacts }
          : event.kind === 'forwarded'
            ? { artifacts: event.artifacts }
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
  private getRouter(id: string): Router {
    const router = this.routers.get(id)
    if (!router) throw new OwlsError('task_not_found', 'Router not found.')
    return router
  }
  /** A thread whose Router runs on this device, which alone may change it. */
  private ownRouter(id: string): Router {
    const router = this.getRouter(id)
    if (!this.local(router))
      throw new OwlsError('request_unavailable', 'This thread runs on another device.')
    return router
  }
  private local(router: Router): boolean {
    return router.deviceId === this.store.deviceId
  }
  private log(router: Router): ThreadLog {
    let log = this.logs.get(router.id)
    if (!log) {
      log = new ThreadLog(this.store.items(router.id))
      this.logs.set(router.id, log)
    }
    return log
  }
  /**
   * The workers, and the projects when there are any, for a context that
   * lacks them. A context the engine trimmed also lost the memory block, so it
   * gets a line naming the categories it can still search.
   */
  private stateOf(router: Router, trimmed = false): string {
    const projects = renderProjects(this.host.projects(), router.projectId)
    const workers = renderState(this.pool.list(router.id), (worker) =>
      projects ? this.pool.projectName(worker) : null
    )
    const memory = trimmed ? this.memory.categoryLine() : null
    return [workers, projects, memory].filter(Boolean).join('\n\n')
  }
  /** Inserts or replaces an item. Streaming only reaches the UI; a finished item is saved. */
  private put(router: Router, item: SessionItem): void {
    if (this.closed) return
    const log = this.log(router)
    log.put(item)
    router.itemCount = log.length
    const changed = this.dirtyItems.get(router.id) ?? new Set()
    this.dirtyItems.set(router.id, changed.add(item.id))
    if (item.status === 'running') {
      this.flushTimer ??= setTimeout(() => this.flush(), 70)
      return
    }
    if (item.kind === 'assistant' && item.text) router.preview = item.text.slice(-PREVIEW_LIMIT)
    this.changed(router)
  }
  private finishItems(router: Router, status: RouterBatchOutcome['status']): void {
    for (const item of this.log(router).running()) this.put(router, { ...item, status })
  }
  private changed(router: Router): void {
    if (this.closed) return
    router.updatedAt = new Date().toISOString()
    this.dirty.add(router.id)
    this.flush()
  }
  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    for (const id of new Set([...this.dirty, ...this.dirtyItems.keys()])) {
      const router = this.routers.get(id)
      if (!router) continue
      const log = this.log(router)
      const changed = [...(this.dirtyItems.get(id) ?? [])]
        .flatMap((itemId) => log.get(itemId) ?? [])
        .sort((a, b) => a.position - b.position)
      const finished = changed.filter((e) => e.item.status !== 'running')
      if (this.dirty.has(id) || finished.length) {
        router.rev = this.store.saveThread(router, finished)
        for (const entry of finished) entry.rev = router.rev
        this.emit({ type: 'router', router })
      }
      if (changed.length)
        this.emit({ type: 'thread-items', routerId: id, items: changed.map((e) => ({ ...e })) })
    }
    this.dirty.clear()
    this.dirtyItems.clear()
  }
}
