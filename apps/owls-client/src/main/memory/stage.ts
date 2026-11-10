import { z } from 'zod'
import type { Project } from '../../shared/app.js'
import {
  MEMORY_CATEGORY_LIMIT,
  MEMORY_TEXT_LIMIT,
  type Memory,
  type MemoryCategory,
  type MemoryRun,
  type MemoryScope,
  projectMemoryKindSchema
} from '../../shared/memory.js'
import type { MemoryWrite } from './records.js'
import { looksSecret } from './render.js'

const DAY_MS = 24 * 60 * 60 * 1000
/** `status` memories without an expiry from Dreaming last this long. */
const STATUS_LIFETIME_MS = 14 * DAY_MS
/** Knowledge and lessons untouched this long come up for review (RFC_OWLS_MEMORY 4.1). */
export const MEMORY_REVIEW_AGE_MS = 90 * DAY_MS
const REVIEWED_KINDS = new Set(['knowledge', 'lesson'])

/**
 * True for a knowledge or lesson memory Dreaming should confirm, supersede, or
 * archive: active, not owned by the user, and neither changed nor confirmed for
 * the review age.
 */
export function dueForReview(memory: Memory, now: Date): boolean {
  if (memory.store !== 'project' || memory.status !== 'active' || memory.editedByUser) return false
  if (!REVIEWED_KINDS.has(memory.kind)) return false
  const seen =
    memory.reviewedAt && memory.reviewedAt > memory.updatedAt ? memory.reviewedAt : memory.updatedAt
  return seen <= new Date(now.getTime() - MEMORY_REVIEW_AGE_MS).toISOString()
}
const text = z.string().trim().min(1).max(MEMORY_TEXT_LIMIT)
const ref = z.string().trim().min(1).max(64)

/** One change Dreaming stages (RFC_OWLS_MEMORY 5.4). Model-facing, so kept small and flat. */
export const memoryOpSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('create_category'),
      name: z.string().trim().min(1).max(40).describe("Short name in the user's language."),
      description: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe('One sentence: what belongs here and what does not.')
    })
    .strict(),
  z
    .object({
      op: z.literal('add'),
      ref: ref
        .optional()
        .describe('A temporary name for this new memory, so supersede can point to it.'),
      store: z.enum(['personal', 'project']),
      category: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .optional()
        .describe('Personal only: an existing category name or ID, or one created in this run.'),
      project: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional()
        .describe('Project only: the project name or ID.'),
      kind: projectMemoryKindSchema.optional().describe('Project only.'),
      text: text.describe("One self-contained fact in the user's language."),
      expiresAt: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('ISO time after which the fact no longer holds.'),
      sources: z
        .array(z.string().trim().min(1).max(200))
        .max(20)
        .default([])
        .describe('IDs of the conversation items and workers (w_…) the fact came from.')
    })
    .strict(),
  z
    .object({
      op: z.literal('update'),
      id: z.string().trim().min(1).max(64),
      text: text.optional(),
      category: z.string().trim().min(1).max(64).optional(),
      kind: projectMemoryKindSchema.optional()
    })
    .strict(),
  z
    .object({
      op: z.literal('supersede'),
      id: z.string().trim().min(1).max(64).describe('The memory that no longer holds.'),
      by: ref.describe('The ref of the memory added in this run that replaces it.')
    })
    .strict(),
  z
    .object({
      op: z.literal('archive'),
      id: z.string().trim().min(1).max(64),
      reason: z.string().trim().min(1).max(300)
    })
    .strict(),
  z
    .object({
      op: z.literal('confirm'),
      id: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .describe('A knowledge or lesson memory due for review that still holds.')
    })
    .strict(),
  z
    .object({
      op: z.literal('merge_category'),
      from: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .describe('The narrower personal category, by name or ID; its memories move.'),
      into: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .describe('The broader personal category that keeps them, by name or ID.')
    })
    .strict()
])
export const stageInput = z.object({ changes: z.array(memoryOpSchema).min(1).max(40) }).strict()
export type MemoryOp = z.infer<typeof memoryOpSchema>

export type StageErrorCode =
  | 'user_owned'
  | 'category_limit'
  | 'category_exists'
  | 'category_not_found'
  | 'invalid_scope'
  | 'secret_detected'
  | 'project_not_found'
  | 'not_found'
  | 'not_due'
export type StageResult =
  | { index: number; ok: true; id: string }
  | { index: number; ok: false; error: StageErrorCode; message: string }

class StageError extends Error {
  constructor(
    readonly code: StageErrorCode,
    message: string
  ) {
    super(message)
  }
}

export const newMemoryId = () => `m_${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`
export const newCategoryId = () => `mc_${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * What one Dreaming run has staged, checked against a working copy of the
 * memories so later changes in the run see earlier ones. Nothing is written
 * until the run succeeds; `writes()` then turns the touched records into
 * writes against the versions the run started from.
 */
export class DreamingStage {
  private readonly memories: Map<string, Memory>
  private readonly categories: Map<string, MemoryCategory>
  private readonly base = new Map<string, number | null>()
  private readonly touched = new Set<string>()
  private readonly refs = new Map<string, string>()
  readonly added: string[] = []
  readonly updated: string[] = []
  readonly archived: string[] = []
  readonly reviewed: string[] = []
  readonly merged: string[] = []

  constructor(
    memories: Memory[],
    categories: MemoryCategory[],
    private readonly context: {
      runId: string
      threadId: string
      projects: Project[]
      now: Date
    }
  ) {
    this.memories = new Map(memories.map((m) => [m.id, structuredClone(m)]))
    this.categories = new Map(categories.map((c) => [c.id, structuredClone(c)]))
  }

  get empty(): boolean {
    return this.touched.size === 0
  }

  /** Applies each change that passes its checks and reports every one. */
  stage(ops: MemoryOp[]): StageResult[] {
    return ops.map((op, index) => {
      try {
        return { index, ok: true, id: this.apply(op) }
      } catch (error) {
        if (!(error instanceof StageError)) throw error
        return { index, ok: false, error: error.code, message: error.message }
      }
    })
  }

  /**
   * The touched records as writes. A category the run created but left empty
   * is dropped: the agent often creates one, then finds the fact already saved.
   */
  writes(): MemoryWrite[] {
    const used = new Set(
      [...this.memories.values()].flatMap((m) =>
        m.store === 'personal' && m.status === 'active' ? [m.categoryId] : []
      )
    )
    return [...this.touched].sort().flatMap((key): MemoryWrite[] => {
      const [kind, id] = key.split(':') as ['memory' | 'category', string]
      const baseRev = this.base.get(key) ?? null
      if (kind === 'memory') {
        const value = this.memories.get(id)
        return value ? [{ kind, baseRev, value }] : []
      }
      const value = this.categories.get(id)
      if (!value || (baseRev === null && !used.has(id))) return []
      return [{ kind, baseRev, value }]
    })
  }

  /** The run's counts for its record. */
  summary(): Pick<MemoryRun, 'added' | 'updated' | 'archived' | 'reviewed' | 'merged'> {
    return {
      added: [...this.added],
      updated: [...this.updated],
      archived: [...this.archived],
      reviewed: [...this.reviewed],
      merged: [...this.merged]
    }
  }

  private apply(op: MemoryOp): string {
    const now = this.context.now.toISOString()
    switch (op.op) {
      case 'create_category': {
        const active = [...this.categories.values()].filter((c) => c.status === 'active')
        const existing = active.find((c) => sameName(c.name, op.name))
        if (existing)
          throw new StageError(
            'category_exists',
            `A category named ${existing.name} already exists (${existing.id}).`
          )
        if (active.length >= MEMORY_CATEGORY_LIMIT)
          throw new StageError(
            'category_limit',
            `There are already ${MEMORY_CATEGORY_LIMIT} categories; reuse one, or merge two that overlap first.`
          )
        this.assertClean(`${op.name} ${op.description}`)
        const category: MemoryCategory = {
          id: newCategoryId(),
          name: op.name,
          description: op.description,
          status: 'active',
          mergedInto: null,
          createdBy: 'agent',
          rev: 0,
          createdAt: now,
          updatedAt: now
        }
        this.touch('category', category.id, null)
        this.categories.set(category.id, category)
        return category.id
      }
      case 'add': {
        this.assertClean(op.text)
        const scope = this.scopeOf(op)
        const id = newMemoryId()
        const memory: Memory = {
          ...scope,
          id,
          text: op.text,
          status: 'active',
          rev: 0,
          pinned: false,
          expiresAt:
            op.expiresAt ??
            (scope.kind === 'status'
              ? new Date(this.context.now.getTime() + STATUS_LIFETIME_MS).toISOString()
              : null),
          origin: 'dreaming',
          editedByUser: false,
          source: {
            threadId: this.context.threadId,
            itemIds: op.sources.filter((s) => !s.startsWith('w_')).sort(),
            workerIds: op.sources.filter((s) => s.startsWith('w_')).sort(),
            runId: this.context.runId
          },
          supersededBy: null,
          reviewedAt: null,
          createdAt: now,
          updatedAt: now
        }
        this.touch('memory', id, null)
        this.memories.set(id, memory)
        this.added.push(id)
        if (op.ref) this.refs.set(op.ref, id)
        return id
      }
      case 'update': {
        const memory = this.editable(op.id)
        if (op.text !== undefined) {
          this.assertClean(op.text)
          memory.text = op.text
        }
        if (op.category !== undefined) {
          if (memory.store !== 'personal')
            throw new StageError('invalid_scope', 'Only personal memories have a category.')
          memory.categoryId = this.category(op.category).id
        }
        if (op.kind !== undefined) {
          if (memory.store !== 'project')
            throw new StageError('invalid_scope', 'Only project memories have a kind.')
          memory.kind = op.kind
        }
        memory.updatedAt = now
        this.put(memory)
        this.markUpdated(memory.id)
        return memory.id
      }
      case 'supersede': {
        const memory = this.editable(op.id)
        const by = this.refs.get(op.by) ?? op.by
        const replacement = this.memories.get(by)
        if (!replacement || !this.added.includes(by))
          throw new StageError('not_found', `No memory added in this run is named ${op.by}.`)
        if (replacement.store !== memory.store)
          throw new StageError('invalid_scope', 'A memory can only replace one in the same store.')
        memory.status = 'archived'
        memory.supersededBy = by
        memory.updatedAt = now
        this.put(memory)
        this.markArchived(memory.id)
        return memory.id
      }
      case 'archive': {
        const memory = this.editable(op.id)
        memory.status = 'archived'
        memory.updatedAt = now
        this.put(memory)
        this.markArchived(memory.id)
        return memory.id
      }
      case 'confirm': {
        const memory = this.editable(op.id)
        if (!dueForReview(memory, this.context.now))
          throw new StageError(
            'not_due',
            'Only knowledge and lesson memories listed as due for review can be confirmed.'
          )
        memory.reviewedAt = now
        this.put(memory)
        if (!this.reviewed.includes(memory.id)) this.reviewed.push(memory.id)
        return memory.id
      }
      case 'merge_category': {
        const from = this.category(op.from)
        const into = this.category(op.into)
        if (from.id === into.id)
          throw new StageError('invalid_scope', 'A category cannot merge into itself.')
        if (from.createdBy === 'user')
          throw new StageError('user_owned', 'The user created this category, so it stays.')
        const members = [...this.memories.values()].filter(
          (m): m is Extract<Memory, { store: 'personal' }> =>
            m.store === 'personal' && m.categoryId === from.id && m.status !== 'deleted'
        )
        if (members.some((m) => m.editedByUser))
          throw new StageError(
            'user_owned',
            'The user edited a memory in this category, so the category stays.'
          )
        for (const memory of members) this.put({ ...memory, categoryId: into.id, updatedAt: now })
        this.touch('category', from.id, from.rev)
        this.categories.set(from.id, {
          ...from,
          name: '',
          description: '',
          status: 'deleted',
          mergedInto: into.id,
          updatedAt: now
        })
        this.merged.push(from.id)
        return into.id
      }
    }
  }

  private scopeOf(op: Extract<MemoryOp, { op: 'add' }>): MemoryScope {
    if (op.store === 'personal') {
      if (op.project !== undefined || op.kind !== undefined || op.category === undefined)
        throw new StageError(
          'invalid_scope',
          'A personal memory takes a category, not a project or kind.'
        )
      return {
        store: 'personal',
        categoryId: this.category(op.category).id,
        projectId: null,
        kind: null
      }
    }
    if (op.category !== undefined || op.kind === undefined)
      throw new StageError('invalid_scope', 'A project memory takes a project and kind.')
    if (op.project === undefined)
      throw new StageError('project_not_found', 'Name the project this memory belongs to.')
    const project = this.context.projects.find(
      (p) => p.id === op.project || sameName(p.name, op.project ?? '')
    )
    if (!project) throw new StageError('project_not_found', `No project is named ${op.project}.`)
    return { store: 'project', categoryId: null, projectId: project.id, kind: op.kind }
  }

  /** An active category by ID or name, following a merge tombstone to where it went. */
  private category(name: string): MemoryCategory {
    let found =
      this.categories.get(name) ??
      [...this.categories.values()].find((c) => c.status === 'active' && sameName(c.name, name))
    for (let hops = 0; found?.status === 'deleted' && found.mergedInto && hops < 8; hops++)
      found = this.categories.get(found.mergedInto)
    if (!found || found.status !== 'active')
      throw new StageError(
        'category_not_found',
        `No category is named ${name}. Reuse one or create it first.`
      )
    return found
  }

  /**
   * A copy of an active memory the agent may change. The change reaches the
   * working set only through `put`, after every check in the op has passed, so
   * a rejected op leaves nothing behind.
   */
  private editable(id: string): Memory {
    const memory = this.memories.get(id)
    if (!memory || memory.status !== 'active')
      throw new StageError('not_found', `No active memory has ID ${id}.`)
    if (memory.editedByUser)
      throw new StageError('user_owned', 'The user edited this memory, so it stays as it is.')
    return { ...memory }
  }

  private put(memory: Memory): void {
    this.touch('memory', memory.id, memory.rev)
    this.memories.set(memory.id, memory)
  }

  private assertClean(value: string): void {
    if (looksSecret(value))
      throw new StageError(
        'secret_detected',
        'This text looks like it holds a key, token, or password. Never save those.'
      )
  }

  private touch(kind: 'memory' | 'category', id: string, rev: number | null): void {
    const key = `${kind}:${id}`
    if (!this.touched.has(key)) this.base.set(key, rev)
    this.touched.add(key)
  }
  private markUpdated(id: string): void {
    if (!this.added.includes(id) && !this.updated.includes(id)) this.updated.push(id)
  }
  private markArchived(id: string): void {
    const index = this.updated.indexOf(id)
    if (index >= 0) this.updated.splice(index, 1)
    const reviewed = this.reviewed.indexOf(id)
    if (reviewed >= 0) this.reviewed.splice(reviewed, 1)
    if (this.added.includes(id)) return
    if (!this.archived.includes(id)) this.archived.push(id)
  }
}
