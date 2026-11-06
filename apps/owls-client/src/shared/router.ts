import { z } from 'zod'

const permissionValues = ['read-only', 'workspace-write', 'full-access'] as const
const providerValues = ['codex', 'claude-code'] as const

export const routerEngineSchema = z.enum(['owls', 'claude-code', 'codex'])
/** Model providers the Owls engine accepts. `custom` is any OpenAI-compatible endpoint. */
export const owlsProviderSchema = z.enum([
  'anthropic',
  'custom',
  'deepseek',
  'google',
  'openai',
  'openrouter'
])
export const owlsThinkingSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high'])
export const owlsModelSchema = z.object({
  provider: owlsProviderSchema,
  model: z.string().trim().min(1).max(200),
  thinking: owlsThinkingSchema.default('low'),
  baseUrl: z
    .string()
    .url()
    .max(2048)
    .refine((url) => /^https?:\/\//i.test(url), 'Use an http or https URL.')
    .nullable()
    .default(null)
})
export const routerSettingsSchema = z.object({
  engine: routerEngineSchema,
  owls: owlsModelSchema.nullable(),
  /** Model for the Claude Code engine; null uses the CLI default. */
  claudeModel: z.string().trim().min(1).max(200).nullable(),
  /** Model for the Codex engine; null uses the Codex default. */
  codexModel: z.string().trim().min(1).max(200).nullable(),
  maxPermission: z.enum(permissionValues),
  /** Workers that can write run in their own git worktree when the project is a repository. */
  worktrees: z.boolean()
})
export const defaultRouterSettings: RouterSettings = {
  engine: 'owls',
  owls: null,
  claudeModel: null,
  codexModel: null,
  maxPermission: 'workspace-write',
  worktrees: true
}

export const workerReportSchema = z.object({
  status: z.enum(['done', 'blocked', 'needs_input', 'progress']),
  summary: z.string().max(1000),
  artifacts: z
    .array(z.object({ kind: z.enum(['file', 'url', 'note']), ref: z.string().max(2000) }))
    .max(20)
    .default([])
})
export const workerStatusSchema = z.enum([
  'queued',
  'starting',
  'running',
  'waiting',
  'reported',
  'idle',
  'stopped',
  'failed',
  'removed'
])
/** Where a worker's worktree starts: the checkout HEAD, the remote default, or its parent's branch. */
export const worktreeBaseSchema = z.enum(['head', 'default-branch', 'parent'])
/**
 * Where a worker runs. `checkout` is the project directory itself; a
 * `worktree` is a linked git worktree Owls created for this worker (RFC 11.1).
 * `active` worktrees belong to a live worker; after removal one is `released`,
 * or `kept` because it still has uncommitted changes.
 */
export const workerWorkspaceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('checkout') }),
  z.object({
    kind: z.literal('worktree'),
    /** Top level of the project's repository, where git commands for this worktree run. */
    repo: z.string(),
    path: z.string(),
    /** The worker's working directory: `path` plus the project's subdirectory in the repository. */
    cwd: z.string(),
    branch: z.string(),
    base: worktreeBaseSchema,
    /** The parent worker's branch when `base` is `parent`. */
    baseBranch: z.string().nullable(),
    /** The commit the branch started from; null until the worktree exists. */
    baseCommit: z.string().nullable(),
    state: z.enum(['active', 'kept', 'released'])
  })
])
export const workerSchema = z.object({
  id: z.string(),
  routerId: z.string(),
  /** The project this worker runs in. Threads are global, so it is set per dispatch. */
  projectId: z.string(),
  sessionId: z.string(),
  provider: z.enum(providerValues),
  goal: z.string(),
  /** Short label for the map and references; null falls back to the goal's first line. */
  title: z.string().nullable(),
  /** The worker whose result led the Router to dispatch this one; null hangs off the Router. */
  parentId: z.string().nullable(),
  /** Background passed to the first turn; kept so a queued worker can start later. */
  context: z.string().nullable(),
  permission: z.enum(permissionValues),
  /** The message a queued worker sends when it starts: its first turn or a Router follow-up. */
  next: z.string().nullable(),
  status: workerStatusSchema,
  workspace: workerWorkspaceSchema,
  report: workerReportSchema.nullable(),
  /** True when the last report did not match the schema and was rebuilt from raw text. */
  degraded: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export const routerStatusSchema = z.enum(['idle', 'running', 'failed', 'interrupted'])
/** The engine session a Router last ran in, used to resume it or detect a switch. */
export const routerNativeSchema = z.discriminatedUnion('engine', [
  z.object({ engine: z.literal('owls') }),
  z.object({ engine: z.literal('claude-code'), sessionId: z.string().nullable() }),
  /** Codex threads are tied to the instructions they started with, so the version is kept. */
  z.object({
    engine: z.literal('codex'),
    threadId: z.string().nullable(),
    promptVersion: z.number().int()
  })
])
/** A batch whose delivery is unknown after a crash; the user decides whether to resend it. */
export const unknownBatchSchema = z.object({
  id: z.string(),
  events: z.number().int().nonnegative(),
  createdAt: z.string()
})

export const createThreadSchema = z.object({
  /** Where workers run by default; null leaves the Router to name a project per dispatch. */
  projectId: z.string().min(1).max(200).nullable()
})
export const threadItemsSchema = z.object({
  routerId: z.string().uuid(),
  /** Returns items changed after this version; 0 for the whole thread. */
  after: z.number().int().nonnegative().default(0)
})
export const sendRouterSchema = z.object({
  routerId: z.string().uuid(),
  commandId: z.string().uuid(),
  text: z.string().trim().min(1).max(8000),
  /** Delivers the message straight to this worker instead of the Router's model. */
  workerId: z.string().min(1).max(64).optional()
})
export const forwardSchema = z.object({
  commandId: z.string().uuid(),
  source: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('item'),
      routerId: z.string().uuid(),
      itemId: z.string().min(1).max(200)
    }),
    z.object({
      kind: z.literal('worker'),
      routerId: z.string().uuid(),
      workerId: z.string().min(1).max(64)
    })
  ]),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('thread'), routerId: z.string().uuid() }),
    z.object({ kind: z.literal('new'), projectId: z.string().min(1).max(200).nullable() })
  ]),
  /** What the user wants done with it; the only part the Router takes as an instruction. */
  note: z.string().trim().max(8000).nullable().default(null)
})
export const resolveBatchSchema = z.object({
  routerId: z.string().uuid(),
  batchId: z.string().min(1).max(64),
  decision: z.enum(['retry', 'ignore'])
})
export const workerActionSchema = z.object({
  routerId: z.string().uuid(),
  workerId: z.string().min(1).max(64)
})
export const setRouterKeySchema = z.object({
  providerId: owlsProviderSchema,
  key: z.string().trim().min(1).max(4096)
})

export type RouterEngineId = z.infer<typeof routerEngineSchema>
export type OwlsProviderId = z.infer<typeof owlsProviderSchema>
export type OwlsThinking = z.infer<typeof owlsThinkingSchema>
export type OwlsModelSettings = z.infer<typeof owlsModelSchema>
export type RouterSettings = z.infer<typeof routerSettingsSchema>
export type WorkerReport = z.infer<typeof workerReportSchema>
export type WorkerStatus = z.infer<typeof workerStatusSchema>
export type WorktreeBase = z.infer<typeof worktreeBaseSchema>
export type WorkerWorkspace = z.infer<typeof workerWorkspaceSchema>
export type WorkerAction = z.infer<typeof workerActionSchema>
export type RouterWorker = z.infer<typeof workerSchema>
export type RouterStatus = z.infer<typeof routerStatusSchema>
export type RouterNative = z.infer<typeof routerNativeSchema>
export type UnknownBatch = z.infer<typeof unknownBatchSchema>
export type ResolveBatch = z.infer<typeof resolveBatchSchema>
export type SendRouterMessage = z.infer<typeof sendRouterSchema>
export type CreateThread = z.infer<typeof createThreadSchema>
export type ThreadItemsRequest = z.input<typeof threadItemsSchema>
export type ForwardMessage = z.input<typeof forwardSchema>
export type SetRouterKey = z.infer<typeof setRouterKeySchema>
export type RouterProviderInfo = {
  id: OwlsProviderId
  name: string
  /** Whether Owls has a stored key for this provider. `custom` endpoints may run without one. */
  configured: boolean
  models: { id: string; name: string }[]
}
