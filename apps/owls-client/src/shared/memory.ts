import { z } from 'zod'

/** Personal memory comes from Router conversations; project memory from worker results. */
export const memoryStoreSchema = z.enum(['personal', 'project'])
/** The fixed project memory kinds (RFC_OWLS_MEMORY 4.1). */
export const projectMemoryKindSchema = z.enum(['rule', 'decision', 'knowledge', 'lesson', 'status'])
export const memoryProviderSchema = z.enum(['claude-code', 'codex'])

/** Longest memory text; one self-contained fact. */
export const MEMORY_TEXT_LIMIT = 300
/** Most personal categories at once; merging frees room. */
export const MEMORY_CATEGORY_LIMIT = 24

const text = z.string().trim().min(1).max(MEMORY_TEXT_LIMIT)
const categoryName = z.string().trim().min(1).max(40)
const categoryDescription = z.string().trim().max(200)

/**
 * A personal memory category. `deleted` is a tombstone: the name and description
 * are cleared, and `mergedInto` names where its memories went, so a late write
 * that still uses the old category can be redirected.
 */
export const memoryCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(['active', 'deleted']),
  mergedInto: z.string().nullable(),
  createdBy: z.enum(['agent', 'user']),
  /** Taken from the shared change version; every change, deletion included, takes the next one. */
  rev: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const memorySourceSchema = z.object({
  threadId: z.string().nullable(),
  itemIds: z.array(z.string()),
  workerIds: z.array(z.string()),
  runId: z.string().nullable()
})

const memoryScopeSchema = z.discriminatedUnion('store', [
  z.object({
    store: z.literal('personal'),
    categoryId: z.string(),
    projectId: z.null(),
    kind: z.null()
  }),
  z.object({
    store: z.literal('project'),
    categoryId: z.null(),
    projectId: z.string(),
    kind: projectMemoryKindSchema
  })
])

const memoryBodySchema = z.object({
  id: z.string(),
  text: z.string(),
  /** `deleted` is a tombstone: only the id, rev, and times stay; text and source are cleared. */
  status: z.enum(['active', 'archived', 'deleted']),
  rev: z.number().int().nonnegative(),
  pinned: z.boolean(),
  /** A fact that stops being true, such as "traveling this week"; not injected or found after. */
  expiresAt: z.string().nullable(),
  origin: z.enum(['dreaming', 'user']),
  /** Once the user edits it, Dreaming may no longer change or archive it. */
  editedByUser: z.boolean(),
  source: memorySourceSchema,
  /** The memory that replaced this one; set when it is archived for it. */
  supersededBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export const memorySchema = z.intersection(memoryScopeSchema, memoryBodySchema)

/** Device-level memory settings; not synced (RFC_OWLS_MEMORY 11.4). */
export const memorySettingsSchema = z.object({
  /** Turn conversations into memories. */
  learn: z.boolean(),
  /** Use memories in new threads. */
  inject: z.boolean(),
  /** The agent Dreaming runs on; null follows the worker default. */
  provider: memoryProviderSchema.nullable(),
  claudeModel: z.string().trim().min(1).max(200).nullable(),
  codexModel: z.string().trim().min(1).max(200).nullable()
})
export const defaultMemorySettings: MemorySettings = {
  learn: true,
  inject: true,
  provider: null,
  claudeModel: null,
  codexModel: null
}

export const memoryRunStatusSchema = z.enum(['running', 'completed', 'failed'])
/** One Dreaming run over one thread's new content. */
export const memoryRunSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  status: memoryRunStatusSchema,
  provider: memoryProviderSchema,
  model: z.string().nullable(),
  /** What the run read: thread items after `fromItemRev`, events after `fromEventSeq`. */
  fromItemRev: z.number().int().nonnegative(),
  toItemRev: z.number().int().nonnegative(),
  fromEventSeq: z.number().int().nonnegative(),
  toEventSeq: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  added: z.array(z.string()),
  updated: z.array(z.string()),
  archived: z.array(z.string()),
  /** Staged operations the sync service or a newer edit refused; the run still counts. */
  stale: z.number().int().nonnegative(),
  createdAt: z.string(),
  finishedAt: z.string().nullable()
})

export const memoryListSchema = z.object({
  store: memoryStoreSchema,
  projectId: z.string().min(1).max(200).nullable().default(null),
  categoryId: z.string().min(1).max(64).nullable().default(null),
  kind: projectMemoryKindSchema.nullable().default(null),
  query: z.string().max(200).default(''),
  archived: z.boolean().default(false)
})

/**
 * A user write. Every change names the `baseRev` it was made against, so a later
 * sync service can refuse one that lost a race; new records carry an id the
 * caller made, so a retry cannot add twice.
 */
export const memorySaveSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    id: z.string().regex(/^m_[a-z0-9]{8}$/),
    text,
    scope: z.discriminatedUnion('store', [
      z.object({ store: z.literal('personal'), categoryId: z.string().min(1).max(64) }),
      z.object({
        store: z.literal('project'),
        projectId: z.string().min(1).max(200),
        kind: projectMemoryKindSchema
      })
    ]),
    pinned: z.boolean().default(false)
  }),
  z.object({
    action: z.literal('update'),
    id: z.string().min(1).max(64),
    baseRev: z.number().int().nonnegative(),
    text: text.optional(),
    categoryId: z.string().min(1).max(64).optional(),
    kind: projectMemoryKindSchema.optional()
  }),
  z.object({
    action: z.literal('pin'),
    id: z.string().min(1).max(64),
    baseRev: z.number().int().nonnegative(),
    pinned: z.boolean()
  })
])
export const memoryRemoveSchema = z.object({
  id: z.string().min(1).max(64),
  baseRev: z.number().int().nonnegative()
})
export const memoryCategoryActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    id: z.string().regex(/^mc_[a-z0-9]{8}$/),
    name: categoryName,
    description: categoryDescription
  }),
  z.object({
    action: z.literal('rename'),
    id: z.string().min(1).max(64),
    baseRev: z.number().int().nonnegative(),
    name: categoryName,
    description: categoryDescription
  }),
  /** Moves every memory of `id` into `into` and leaves a tombstone pointing there. */
  z.object({
    action: z.literal('merge'),
    id: z.string().min(1).max(64),
    baseRev: z.number().int().nonnegative(),
    into: z.string().min(1).max(64)
  }),
  /** Deletes the category with its memories. Moving them first is a merge. */
  z.object({
    action: z.literal('remove'),
    id: z.string().min(1).max(64),
    baseRev: z.number().int().nonnegative()
  })
])
export const memoryExportSchema = z.enum(['markdown', 'json'])

export type MemoryStore = z.infer<typeof memoryStoreSchema>
export type ProjectMemoryKind = z.infer<typeof projectMemoryKindSchema>
export type MemoryProvider = z.infer<typeof memoryProviderSchema>
export type MemoryCategory = z.infer<typeof memoryCategorySchema>
export type MemorySource = z.infer<typeof memorySourceSchema>
/** Which store a memory is in, with the fields that store uses. */
export type MemoryScope = z.infer<typeof memoryScopeSchema>
export type Memory = z.infer<typeof memorySchema>
export type MemorySettings = z.infer<typeof memorySettingsSchema>
export type MemoryRunStatus = z.infer<typeof memoryRunStatusSchema>
export type MemoryRun = z.infer<typeof memoryRunSchema>
export type MemoryListRequest = z.input<typeof memoryListSchema>
export type MemorySave = z.input<typeof memorySaveSchema>
export type MemoryRemove = z.infer<typeof memoryRemoveSchema>
export type MemoryCategoryAction = z.infer<typeof memoryCategoryActionSchema>
export type MemoryExportFormat = z.infer<typeof memoryExportSchema>
/** A personal category with how many active memories it holds. */
export type MemoryCategoryView = MemoryCategory & { count: number }
/** What the memory tab shows besides the list. */
export type MemoryOverview = {
  categories: MemoryCategoryView[]
  /** Active project memories by project and kind. */
  projects: { projectId: string; counts: Record<ProjectMemoryKind, number> }[]
  running: boolean
  lastRun: MemoryRun | null
}
/** A memory as the list shows it, with its source thread's title. */
export type MemoryView = Memory & { sourceTitle: string | null }
