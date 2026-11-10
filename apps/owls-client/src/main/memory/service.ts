import type { AppSettings, Project } from '../../shared/app.js'
import {
  MEMORY_CATEGORY_LIMIT,
  type Memory,
  type MemoryCategory,
  type MemoryCategoryAction,
  type MemoryExportFormat,
  type MemoryListRequest,
  type MemoryOverview,
  type MemoryRemove,
  type MemoryRun,
  type MemorySave,
  type MemoryView,
  memoryListSchema,
  type ProjectMemoryKind,
  projectMemoryKindSchema
} from '../../shared/memory.js'
import { OwlsError } from '../app/errors.js'
import { RouterToolError } from '../router/tools.js'
import type { MemoryRecords, MemoryWrite } from './records.js'
import {
  byRecent,
  isLive,
  kindLabel,
  looksSecret,
  renderCategoryLine,
  renderInjection,
  renderMarkdown,
  searchMemories
} from './render.js'
import type { SearchMemoryInput } from './search-input.js'

/** How many runs the memory tab lists. */
const RUN_HISTORY = 20
/** Tombstones outlive the longest a device may stay offline and still sync (RFC_OWLS_MEMORY 4). */
export const MEMORY_TOMBSTONE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000

export type MemoryDeps = {
  records: MemoryRecords
  projects: () => Project[]
  settings: () => AppSettings
  /** A thread's title, for the memory tab and search results. */
  threadTitle: (threadId: string) => string | null
  /** Tells the renderer the memories changed. */
  changed: () => void
  now?: () => Date
}

/** What the Router reads from memory: its first-batch block, search, and a reminder line. */
export interface RouterMemory {
  /** Null when memory is off or empty. */
  injection(projectId: string | null): string | null
  categoryLine(): string | null
  search(input: SearchMemoryInput): unknown
  enabled(): boolean
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Memories on this device: what the memory tab lists and edits, what the
 * Router reads, and the record writes Dreaming commits. Every write names the
 * version it was made against, so a sync service can later take the same
 * calls (RFC_OWLS_MEMORY 11.5).
 */
export class MemoryService implements RouterMemory {
  private readonly now: () => Date

  constructor(private readonly deps: MemoryDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  get records(): MemoryRecords {
    return this.deps.records
  }

  enabled(): boolean {
    return this.deps.settings().memory.inject
  }

  list(request: MemoryListRequest): MemoryView[] {
    const input = memoryListSchema.parse(request)
    const categories = this.deps.records.categories()
    const names = new Map(categories.map((c) => [c.id, c.name]))
    const visible = this.deps.records
      .memories()
      .filter((m) => m.status === 'active' || (input.archived && m.status === 'archived'))
    return searchMemories(
      visible,
      {
        store: input.store,
        categoryId: input.store === 'personal' ? input.categoryId : null,
        projectId: input.store === 'project' ? input.projectId : null,
        kind: input.store === 'project' ? input.kind : null,
        query: input.query
      },
      (m) => `${m.text} ${m.categoryId ? (names.get(m.categoryId) ?? '') : ''}`
    )
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || byRecent(a, b))
      .map((m) => this.view(m))
  }

  overview(running: boolean): MemoryOverview {
    const memories = this.deps.records.memories().filter((m) => m.status === 'active')
    const categories = this.deps.records
      .categories()
      .filter((c) => c.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((c) => ({
        ...c,
        count: memories.filter((m) => m.store === 'personal' && m.categoryId === c.id).length
      }))
    const projectIds = [
      ...new Set(memories.flatMap((m) => (m.store === 'project' ? [m.projectId] : [])))
    ].sort()
    const projects = projectIds.map((projectId) => {
      const counts = Object.fromEntries(
        projectMemoryKindSchema.options.map((kind) => [
          kind,
          memories.filter(
            (m) => m.store === 'project' && m.projectId === projectId && m.kind === kind
          ).length
        ])
      ) as Record<ProjectMemoryKind, number>
      return { projectId, counts }
    })
    return { categories, projects, running, lastRun: this.deps.records.runs(1)[0] ?? null }
  }

  runs(): MemoryRun[] {
    return this.deps.records.runs(RUN_HISTORY)
  }

  /** Adds, edits, or pins one memory for the user. */
  save(input: MemorySave): MemoryView {
    const now = this.now().toISOString()
    if (input.action === 'add') {
      this.assertClean(input.text)
      const scope =
        input.scope.store === 'personal'
          ? {
              store: 'personal' as const,
              categoryId: this.activeCategory(input.scope.categoryId).id,
              projectId: null,
              kind: null
            }
          : {
              store: 'project' as const,
              categoryId: null,
              projectId: this.project(input.scope.projectId).id,
              kind: input.scope.kind
            }
      const memory: Memory = {
        ...scope,
        id: input.id,
        text: input.text,
        status: 'active',
        rev: 0,
        pinned: input.pinned ?? false,
        expiresAt: null,
        origin: 'user',
        editedByUser: true,
        source: { threadId: null, itemIds: [], workerIds: [], runId: null },
        supersededBy: null,
        reviewedAt: null,
        createdAt: now,
        updatedAt: now
      }
      return this.view(this.write({ kind: 'memory', baseRev: null, value: memory }))
    }
    const current = this.activeMemory(input.id)
    const next: Memory = structuredClone(current)
    if (input.action === 'pin') next.pinned = input.pinned
    else {
      if (input.text !== undefined) {
        this.assertClean(input.text)
        next.text = input.text
      }
      if (input.categoryId !== undefined) {
        if (next.store !== 'personal')
          throw new OwlsError('invalid_request', 'Project memories have no category.')
        next.categoryId = this.activeCategory(input.categoryId).id
      }
      if (input.kind !== undefined) {
        if (next.store !== 'project')
          throw new OwlsError('invalid_request', 'Personal memories have no kind.')
        next.kind = input.kind
      }
      next.editedByUser = true
    }
    next.updatedAt = now
    return this.view(this.write({ kind: 'memory', baseRev: input.baseRev, value: next }))
  }

  /** Deletes a memory: the row stays as a tombstone without its text or source. */
  remove(input: MemoryRemove): void {
    const current = this.deps.records.memories().find((m) => m.id === input.id)
    if (!current || current.status === 'deleted')
      throw new OwlsError('request_unavailable', 'This memory no longer exists.')
    this.write({ kind: 'memory', baseRev: input.baseRev, value: this.tombstone(current) })
  }

  category(input: MemoryCategoryAction): void {
    const now = this.now().toISOString()
    const categories = this.deps.records.categories()
    const active = categories.filter((c) => c.status === 'active')
    if (input.action === 'add') {
      if (active.some((c) => sameName(c.name, input.name)))
        throw new OwlsError('invalid_request', 'A category with this name already exists.')
      if (active.length >= MEMORY_CATEGORY_LIMIT)
        throw new OwlsError('invalid_request', 'There are too many categories.')
      this.commit([
        {
          kind: 'category',
          baseRev: null,
          value: {
            id: input.id,
            name: input.name,
            description: input.description,
            status: 'active',
            mergedInto: null,
            createdBy: 'user',
            rev: 0,
            createdAt: now,
            updatedAt: now
          }
        }
      ])
      return
    }
    const current = this.activeCategory(input.id)
    if (input.action === 'rename') {
      if (active.some((c) => c.id !== current.id && sameName(c.name, input.name)))
        throw new OwlsError('invalid_request', 'A category with this name already exists.')
      this.commit([
        {
          kind: 'category',
          baseRev: input.baseRev,
          value: { ...current, name: input.name, description: input.description, updatedAt: now }
        }
      ])
      return
    }
    const members = this.deps.records
      .memories()
      .filter(
        (m): m is Extract<Memory, { store: 'personal' }> =>
          m.store === 'personal' && m.categoryId === current.id && m.status !== 'deleted'
      )
    const writes: MemoryWrite[] = []
    if (input.action === 'merge') {
      const into = this.activeCategory(input.into)
      if (into.id === current.id)
        throw new OwlsError('invalid_request', 'A category cannot merge into itself.')
      for (const memory of members)
        writes.push({
          kind: 'memory',
          baseRev: memory.rev,
          value: { ...memory, categoryId: into.id, updatedAt: now }
        })
    } else {
      for (const memory of members)
        writes.push({ kind: 'memory', baseRev: memory.rev, value: this.tombstone(memory) })
    }
    writes.push({
      kind: 'category',
      baseRev: input.baseRev,
      value: {
        ...current,
        name: '',
        description: '',
        status: 'deleted',
        mergedInto: input.action === 'merge' ? input.into : null,
        updatedAt: now
      }
    })
    this.commit(writes)
  }

  export(format: MemoryExportFormat): string {
    const memories = this.deps.records.memories().filter((m) => m.status === 'active')
    const categories = this.deps.records.categories().filter((c) => c.status === 'active')
    if (format === 'json')
      return `${JSON.stringify(
        {
          categories: [...categories].sort((a, b) => a.id.localeCompare(b.id)),
          memories: [...memories].sort((a, b) => a.id.localeCompare(b.id))
        },
        null,
        2
      )}\n`
    return renderMarkdown(memories, categories, this.deps.projects(), this.deps.settings().language)
  }

  /**
   * Housekeeping without a model (RFC_OWLS_MEMORY 4): archives active memories
   * past their expiry and removes tombstones older than the sync window. Each
   * archive names the version it read, so one the user edited meanwhile stays.
   */
  sweep(): { archived: number; purged: number } {
    const now = this.now()
    const at = now.toISOString()
    const writes: MemoryWrite[] = this.deps.records
      .memories()
      .filter((m) => m.status === 'active' && m.expiresAt !== null && m.expiresAt <= at)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({
        kind: 'memory',
        baseRev: m.rev,
        value: { ...m, status: 'archived', updatedAt: at }
      }))
    const archived = writes.length
      ? this.deps.records.commit({ writes, mode: 'each' }).filter((r) => r.ok).length
      : 0
    const purged = this.deps.records.purge(
      new Date(now.getTime() - MEMORY_TOMBSTONE_LIFETIME_MS).toISOString()
    )
    if (archived || purged) this.deps.changed()
    return { archived, purged }
  }

  injection(projectId: string | null): string | null {
    if (!this.enabled()) return null
    return renderInjection({
      memories: this.deps.records.memories(),
      categories: this.deps.records.categories(),
      project: projectId ? (this.deps.projects().find((p) => p.id === projectId) ?? null) : null,
      language: this.deps.settings().language,
      now: this.now()
    })
  }

  categoryLine(): string | null {
    return this.enabled() ? renderCategoryLine(this.deps.records.categories()) : null
  }

  /** search_memory: active, unexpired memories, keyword-ranked. Throws model-facing errors. */
  search(input: SearchMemoryInput): unknown {
    const categories = this.deps.records.categories()
    const projects = this.deps.projects()
    const now = this.now()
    let categoryId: string | null = null
    if (input.category) {
      const category =
        categories.find((c) => c.id === input.category && c.status === 'active') ??
        categories.find((c) => c.status === 'active' && sameName(c.name, input.category ?? ''))
      if (!category)
        throw new RouterToolError('not_found', `No memory category is named ${input.category}.`)
      categoryId = category.id
    }
    let projectId: string | null = null
    if (input.project) {
      const project = projects.find(
        (p) => p.id === input.project || sameName(p.name, input.project ?? '')
      )
      if (!project) throw new RouterToolError('not_found', `No project is named ${input.project}.`)
      projectId = project.id
    }
    const store =
      input.store ?? (categoryId ? 'personal' : projectId || input.kind ? 'project' : null)
    const names = new Map(categories.map((c) => [c.id, c.name]))
    const projectNames = new Map(projects.map((p) => [p.id, p.name]))
    const language = this.deps.settings().language
    const found = searchMemories(
      this.deps.records.memories().filter((m) => isLive(m, now)),
      { store, categoryId, projectId, kind: input.kind ?? null, query: input.query ?? '' },
      (m) =>
        m.store === 'personal'
          ? `${m.text} ${names.get(m.categoryId) ?? ''}`
          : `${m.text} ${m.kind} ${projectNames.get(m.projectId) ?? ''}`
    )
    const limit = input.limit ?? 10
    return {
      memories: found.slice(0, limit).map((m) => ({
        id: m.id,
        store: m.store,
        ...(m.store === 'personal'
          ? { category: names.get(m.categoryId) ?? m.categoryId }
          : {
              project: projectNames.get(m.projectId) ?? m.projectId,
              kind: kindLabel(m.kind, language)
            }),
        text: m.text,
        date: m.updatedAt.slice(0, 10),
        ...(m.expiresAt ? { expires: m.expiresAt.slice(0, 10) } : {}),
        from: m.source.threadId ? this.deps.threadTitle(m.source.threadId) : null
      })),
      ...(found.length > limit ? { more: found.length - limit } : {})
    }
  }

  private view(memory: Memory): MemoryView {
    return {
      ...memory,
      sourceTitle: memory.source.threadId ? this.deps.threadTitle(memory.source.threadId) : null
    }
  }

  private tombstone(memory: Memory): Memory {
    return {
      ...memory,
      text: '',
      status: 'deleted',
      pinned: false,
      source: { threadId: null, itemIds: [], workerIds: [], runId: null },
      supersededBy: null,
      updatedAt: this.now().toISOString()
    }
  }

  private write(write: Extract<MemoryWrite, { kind: 'memory' }>): Memory {
    const [result] = this.commit([write])
    return { ...write.value, rev: result ?? write.value.rev }
  }

  /** Commits user writes all or nothing: any stale one fails the call. */
  private commit(writes: MemoryWrite[]): number[] {
    const results = this.deps.records.commit({ writes, mode: 'all' })
    this.deps.changed()
    if (results.some((r) => !r.ok))
      throw new OwlsError(
        'request_unavailable',
        'This memory changed meanwhile. Reload it and try again.'
      )
    return results.flatMap((r) => (r.ok ? [r.rev] : []))
  }

  private activeMemory(id: string): Memory {
    const memory = this.deps.records.memories().find((m) => m.id === id)
    if (!memory || memory.status === 'deleted')
      throw new OwlsError('request_unavailable', 'This memory no longer exists.')
    return memory
  }

  private activeCategory(id: string): MemoryCategory {
    const category = this.deps.records.categories().find((c) => c.id === id)
    if (!category || category.status !== 'active')
      throw new OwlsError('request_unavailable', 'This category no longer exists.')
    return category
  }

  private project(id: string): Project {
    const project = this.deps.projects().find((p) => p.id === id)
    if (!project) throw new OwlsError('project_required', 'This project no longer exists.')
    return project
  }

  private assertClean(text: string): void {
    if (looksSecret(text))
      throw new OwlsError(
        'invalid_request',
        'This looks like a key, token, or password. Owls does not save those as memories.'
      )
  }
}
