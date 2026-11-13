import type {
  AppSettings,
  Failure,
  Project,
  Router,
  SessionItem,
  ThreadItem
} from '../../shared/app.js'
import type { MemoryProvider, MemoryRun } from '../../shared/memory.js'
import { dreamingProvider, projectMemoryKindSchema } from '../../shared/memory.js'
import type { RouterWorker } from '../../shared/router.js'
import { OwlsError } from '../app/errors.js'
import type { RouterEngine } from '../router/engine.js'
import type { InboxEvent } from '../router/events.js'
import { defineTool, type RouterTool } from '../router/tools.js'
import { byRecent, kindLabel } from './render.js'
import { searchMemoryInput } from './search-input.js'
import type { MemoryService } from './service.js'
import { DreamingStage, dueForReview, stageInput } from './stage.js'

/** Most UTF-8 bytes of conversation and reports one run reads; the rest waits for the next run. */
export const DREAMING_INPUT_BYTES = 40_000
const ITEM_TEXT_LIMIT = 4000
const REPORT_TEXT_LIMIT = 1000
/** The worker's own last words, since a report summary alone is short. */
const SESSION_TAIL = 3
const SESSION_TEXT_LIMIT = 1500
const CATALOG_RECENT = 10
/** Old knowledge and lessons one run reviews per project, oldest first. */
const REVIEW_PER_PROJECT = 5
/** Thread items Dreaming reads: what the user and the Router said, and forwarded content. */
const READ_KINDS = new Set<SessionItem['kind']>(['user', 'assistant', 'forward'])

export type DreamingEngineRequest = {
  provider: MemoryProvider
  model: string | null
  tools: RouterTool[]
}
export type DreamingEngineFactory = (request: DreamingEngineRequest) => RouterEngine | Failure

export type DreamingDeps = {
  memory: MemoryService
  threads: () => Router[]
  /** A thread's saved items. */
  items: (threadId: string) => ThreadItem[]
  /** A thread's worker reports after an Inbox `seq`, oldest first. */
  reports: (threadId: string, after: number) => InboxEvent[]
  worker: (workerId: string) => RouterWorker | undefined
  /** A worker session's items, for the worker's last messages. */
  sessionItems: (sessionId: string) => SessionItem[]
  projects: () => Project[]
  settings: () => AppSettings
  engine: DreamingEngineFactory
  /** Called when a run starts or ends, so the memory tab can follow. */
  changed: () => void
  now?: () => Date
}

type Slice = {
  items: ThreadItem[]
  reports: Extract<InboxEvent, { kind: 'worker_report' }>[]
  toItemRev: number
  toEventSeq: number
}

const escapeInput = (text: string) =>
  text.replaceAll('</owls-dreaming-input>', '<\\/owls-dreaming-input>')
const cut = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit)}… (truncated)` : text
const bytes = (text: string) => Buffer.byteLength(text)

/**
 * Runs Dreaming one thread at a time, never two at once, so there is a single
 * writer. A run reads what came after the thread's cursor, lets the agent
 * stage changes, and on success commits them together with the new cursor and
 * the run record. A failed run keeps the cursor, so the content is read again.
 */
export class DreamingRunner {
  private readonly queue: string[] = []
  private active: { threadId: string; engine: RouterEngine | null } | null = null
  private draining: Promise<void> | null = null
  private closed = false
  private readonly now: () => Date

  constructor(private readonly deps: DreamingDeps) {
    this.now = deps.now ?? (() => new Date())
    // A run still marked running did not finish before the app stopped; nothing it staged was kept.
    for (const run of deps.memory.records.runs(50))
      if (run.status === 'running')
        deps.memory.records.saveRun({
          ...run,
          status: 'failed',
          error: { code: 'interrupted', message: '' },
          finishedAt: run.createdAt
        })
  }

  get running(): boolean {
    return this.active !== null || this.queue.length > 0
  }

  /** Queues every idle thread with content after its cursor; resolves once the queue drains. */
  runNow(): Promise<void> {
    if (!this.deps.settings().memory.learn)
      throw new OwlsError('request_unavailable', 'Learning from threads is turned off.')
    for (const thread of this.deps.threads())
      if (thread.status !== 'running' && this.pending(thread.id)) this.enqueue(thread.id)
    return this.drain()
  }

  /** Queues one thread, as the idle and startup triggers do. */
  schedule(threadId: string): void {
    if (!this.deps.settings().memory.learn || !this.pending(threadId)) return
    this.enqueue(threadId)
    void this.drain()
  }

  /** True when the thread has items or worker reports Dreaming has not read. */
  pending(threadId: string): boolean {
    const cursor = this.deps.memory.records.cursor(threadId)
    const slice = this.slice(threadId, cursor?.itemRev ?? 0, cursor?.eventSeq ?? 0)
    return slice.items.length > 0 || slice.reports.length > 0
  }

  close(): void {
    this.closed = true
    this.queue.length = 0
    this.active?.engine?.abort()
  }

  private enqueue(threadId: string): void {
    if (this.active?.threadId === threadId || this.queue.includes(threadId)) return
    this.queue.push(threadId)
    this.deps.changed()
  }

  private drain(): Promise<void> {
    // `.finally` runs as a microtask, so the reset always lands after the
    // assignment, even when the loop finishes without awaiting anything.
    this.draining ??= this.loop().finally(() => {
      this.draining = null
      if (this.queue.length && !this.closed) void this.drain()
    })
    return this.draining
  }

  private async loop(): Promise<void> {
    while (!this.closed) {
      // Turning learning off stops the queue, not just new enqueues.
      if (!this.deps.settings().memory.learn) {
        if (this.queue.length) {
          this.queue.length = 0
          this.deps.changed()
        }
        return
      }
      const threadId = this.queue.shift()
      if (!threadId) return
      this.active = { threadId, engine: null }
      let more = false
      try {
        more = await this.run(threadId)
      } finally {
        this.active = null
        this.deps.changed()
      }
      // A slice cut at the input limit leaves the rest for another run.
      if (more && !this.closed) this.enqueue(threadId)
    }
  }

  /** One run over one thread; true when it succeeded and content is still unread. */
  private async run(threadId: string): Promise<boolean> {
    const { memory } = this.deps
    const thread = this.deps.threads().find((t) => t.id === threadId)
    if (!thread) return false
    const cursor = memory.records.cursor(threadId) ?? { threadId, itemRev: 0, eventSeq: 0 }
    const slice = this.slice(threadId, cursor.itemRev, cursor.eventSeq)
    if (!slice.items.length && !slice.reports.length) return false
    const settings = this.deps.settings()
    const provider: MemoryProvider = dreamingProvider(settings.memory.provider, settings.provider)
    const model =
      provider === 'claude-code' ? settings.memory.claudeModel : settings.memory.codexModel
    const runId = `mr_${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`
    const createdAt = this.now().toISOString()
    let run: MemoryRun = {
      id: runId,
      threadId,
      status: 'running',
      provider,
      model,
      fromItemRev: cursor.itemRev,
      toItemRev: slice.toItemRev,
      fromEventSeq: cursor.eventSeq,
      toEventSeq: slice.toEventSeq,
      tokens: 0,
      error: null,
      added: [],
      updated: [],
      archived: [],
      reviewed: [],
      merged: [],
      stale: 0,
      createdAt,
      finishedAt: null
    }
    memory.records.saveRun(run)
    this.deps.changed()
    const stage = new DreamingStage(memory.records.memories(), memory.records.categories(), {
      runId,
      threadId,
      projects: this.deps.projects(),
      now: this.now()
    })
    const tools = [
      defineTool(
        'search_memory',
        'Search memory',
        'Search the memories that already exist, to avoid duplicates and find the ones a change replaces. Returns active memories, best keyword match first.',
        searchMemoryInput,
        (input) => memory.search(input)
      ),
      defineTool(
        'stage_memory_changes',
        'Stage memory changes',
        'Stage memory changes: create_category, merge_category, add, update, supersede, archive, confirm. Each change is checked and reported on its own; accepted changes are saved when you finish.',
        stageInput,
        (input) => ({ results: stage.stage(input.changes) })
      )
    ]
    const engine = this.deps.engine({ provider, model, tools })
    const fail = (error: { code: string; message: string }) => {
      run = { ...run, status: 'failed', error, finishedAt: this.now().toISOString() }
      memory.records.saveRun(run)
      return false
    }
    if ('code' in engine) return fail(engine)
    if (this.active) this.active.engine = engine
    const text = this.render(thread, slice)
    let outcome: Awaited<ReturnType<RouterEngine['run']>>
    try {
      outcome = await engine.run(
        { batchId: runId, text, native: null },
        {
          item: () => {},
          usage: (usage) => {
            run.tokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite
          }
        }
      )
    } catch {
      return fail({ code: 'native_error', message: 'The Dreaming engine failed.' })
    }
    if (outcome.status !== 'completed' || this.closed)
      return fail(outcome.error ?? { code: 'interrupted', message: '' })
    const finished: MemoryRun = {
      ...run,
      ...stage.summary(),
      status: 'completed',
      finishedAt: this.now().toISOString()
    }
    const results = memory.records.commit({
      writes: stage.writes(),
      mode: 'each',
      cursor: { threadId, itemRev: slice.toItemRev, eventSeq: slice.toEventSeq },
      run: finished
    })
    // Refused writes still advance the cursor (RFC_OWLS_MEMORY 11.1); the record counts them.
    const stale = results.filter((r) => !r.ok).length
    if (stale) memory.records.saveRun({ ...finished, stale })
    this.deps.changed()
    return this.pending(threadId)
  }

  /**
   * What one run reads: saved items after `itemRev`, then worker reports after
   * `eventSeq`, until the input limit. Items that saved together share a rev,
   * so a cut falls between revs and the cursor never splits one save.
   */
  private slice(threadId: string, itemRev: number, eventSeq: number): Slice {
    const items = this.deps
      .items(threadId)
      .filter(
        (e) =>
          e.rev !== null &&
          e.rev > itemRev &&
          READ_KINDS.has(e.item.kind) &&
          e.item.status !== 'running' &&
          e.item.text.trim()
      )
      .sort((a, b) => (a.rev ?? 0) - (b.rev ?? 0) || a.position - b.position)
    const reports = this.deps
      .reports(threadId, eventSeq)
      .filter((e): e is Slice['reports'][number] => e.kind === 'worker_report')
    const slice: Slice = { items: [], reports: [], toItemRev: itemRev, toEventSeq: eventSeq }
    let used = 0
    for (let i = 0; i < items.length; ) {
      const rev = items[i]?.rev ?? 0
      const group: ThreadItem[] = []
      while (i < items.length && items[i]?.rev === rev) group.push(items[i++] as ThreadItem)
      const size = group.reduce((sum, e) => sum + bytes(this.itemText(e)), 0)
      if (slice.items.length && used + size > DREAMING_INPUT_BYTES) return slice
      slice.items.push(...group)
      slice.toItemRev = rev
      used += size
    }
    for (const report of reports) {
      const size = bytes(this.reportText(report))
      if ((slice.items.length || slice.reports.length) && used + size > DREAMING_INPUT_BYTES)
        return slice
      slice.reports.push(report)
      slice.toEventSeq = report.seq
      used += size
    }
    return slice
  }

  private itemText(entry: ThreadItem): string {
    const { item } = entry
    const who =
      item.kind === 'user'
        ? `user${item.workerId ? ` · to ${item.workerId}` : ''}`
        : item.kind === 'assistant'
          ? 'router'
          : `forwarded content${item.forward?.title ? ` · from ${cut(item.forward.title, 80)}` : ''}`
    const note =
      item.kind === 'forward' && item.detail ? `\nUser's note: ${cut(item.detail, 2000)}` : ''
    return `[${item.id}] ${who}${note}\n${cut(item.text, ITEM_TEXT_LIMIT)}`
  }

  private reportText(event: Extract<InboxEvent, { kind: 'worker_report' }>): string {
    const worker = this.deps.worker(event.workerId)
    const project = worker
      ? (this.deps.projects().find((p) => p.id === worker.projectId)?.name ?? worker.projectId)
      : null
    const branch = worker?.workspace.kind === 'worktree' ? worker.workspace.branch : null
    const lines = [
      `[${event.workerId}] worker report · ${event.report.status}${project ? ` · project ${project}` : ''}${branch ? ` · branch ${branch}` : ''}`,
      `Goal: ${cut(event.goal, 500)}`,
      `Summary: ${cut(event.report.summary, REPORT_TEXT_LIMIT)}`
    ]
    if (event.report.artifacts.length)
      lines.push(`Artifacts: ${event.report.artifacts.map((a) => `${a.kind}:${a.ref}`).join(', ')}`)
    const tail = worker
      ? this.deps
          .sessionItems(worker.sessionId)
          .filter((i) => i.kind === 'assistant' && i.status === 'completed' && i.text.trim())
          .slice(-SESSION_TAIL)
      : []
    if (tail.length)
      lines.push(
        "Worker's last messages:",
        ...tail.map((i) => `- ${cut(i.text.replace(/\s+/g, ' '), SESSION_TEXT_LIMIT)}`)
      )
    return lines.join('\n')
  }

  private render(thread: Router, slice: Slice): string {
    const projects = this.deps.projects()
    const language = this.deps.settings().language
    const parts = [
      `<owls-dreaming-input thread="${thread.id}">`,
      `Thread: ${cut(thread.title ?? 'Untitled', 80)}`,
      `User language setting: ${language}`
    ]
    const defaultProject = projects.find((p) => p.id === thread.projectId)
    if (defaultProject) parts.push(`Default project: ${defaultProject.name} · ${defaultProject.id}`)
    if (projects.length)
      parts.push(
        `Projects:\n${[...projects]
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
          .map((p) => `- ${p.name} · ${p.id}`)
          .join('\n')}`
      )
    parts.push(this.catalog(slice, thread.projectId))
    if (slice.items.length)
      parts.push(
        `New conversation:\n${slice.items.map((e) => escapeInput(this.itemText(e))).join('\n\n')}`
      )
    if (slice.reports.length)
      parts.push(
        `Worker reports:\n${slice.reports.map((e) => escapeInput(this.reportText(e))).join('\n\n')}`
      )
    parts.push('</owls-dreaming-input>')
    return parts.join('\n\n')
  }

  /** The categories, and for each project in play its kind counts and latest memories. */
  private catalog(slice: Slice, defaultProjectId: string | null): string {
    const { records } = this.deps.memory
    const language = this.deps.settings().language
    const now = this.now()
    const memories = records.memories().filter((m) => m.status === 'active')
    const categories = records
      .categories()
      .filter((c) => c.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    const lines = ['Existing memory:']
    lines.push(
      categories.length
        ? `Personal categories:\n${categories
            .map((c) => {
              const count = memories.filter(
                (m) => m.store === 'personal' && m.categoryId === c.id
              ).length
              const owner = c.createdBy === 'user' ? ' · created by the user' : ''
              return `- ${c.name} · ${c.id} · ${count} · ${c.description}${owner}`
            })
            .join('\n')}`
        : 'Personal categories: none yet.'
    )
    const projectIds = new Set<string>()
    if (defaultProjectId) projectIds.add(defaultProjectId)
    for (const report of slice.reports) {
      const worker = this.deps.worker(report.workerId)
      if (worker?.projectId) projectIds.add(worker.projectId)
    }
    const projects = this.deps.projects()
    for (const projectId of [...projectIds].sort()) {
      const name = projects.find((p) => p.id === projectId)?.name ?? projectId
      const own = memories.filter((m) => m.store === 'project' && m.projectId === projectId)
      const counts = projectMemoryKindSchema.options
        .map((kind) => `${kindLabel(kind, language)} ${own.filter((m) => m.kind === kind).length}`)
        .join(' · ')
      lines.push(`Project memory (${name}): ${counts}`)
      for (const m of [...own].sort(byRecent).slice(0, CATALOG_RECENT))
        lines.push(`- ${m.id} · ${m.store === 'project' ? m.kind : ''} · ${cut(m.text, 200)}`)
      const due = own
        .filter((m) => dueForReview(m, now))
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
        .slice(0, REVIEW_PER_PROJECT)
      if (due.length)
        lines.push(
          `Due for review in ${name} (unchanged for 90 days; confirm, supersede, or archive each):`,
          ...due.map(
            (m) =>
              `- ${m.id} · ${m.store === 'project' ? m.kind : ''} · ${m.updatedAt.slice(0, 10)} · ${cut(m.text, 200)}`
          )
        )
    }
    return escapeInput(lines.join('\n'))
  }
}
