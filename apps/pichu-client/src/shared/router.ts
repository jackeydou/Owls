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
  engine: routerEngineSchema.default('owls'),
  owls: owlsModelSchema.nullable().default(null),
  /** Model for the Claude Code engine; null uses the CLI default. */
  claudeModel: z.string().trim().min(1).max(200).nullable().default(null),
  maxPermission: z.enum(permissionValues).default('workspace-write')
})
export const defaultRouterSettings: RouterSettings = {
  engine: 'owls',
  owls: null,
  claudeModel: null,
  maxPermission: 'workspace-write'
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
export const workerSchema = z.object({
  id: z.string(),
  routerId: z.string(),
  sessionId: z.string(),
  provider: z.enum(providerValues),
  goal: z.string(),
  /** Background passed to the first turn; kept so a queued worker can start later. */
  context: z.string().nullable().default(null),
  permission: z.enum(permissionValues).default('workspace-write'),
  status: workerStatusSchema,
  report: workerReportSchema.nullable(),
  /** True when the last report did not match the schema and was rebuilt from raw text. */
  degraded: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string()
})
export const routerStatusSchema = z.enum(['idle', 'running', 'failed', 'interrupted'])
/** The engine session a Router last ran in, used to resume it or detect a switch. */
export const routerNativeSchema = z.discriminatedUnion('engine', [
  z.object({ engine: z.literal('owls') }),
  z.object({ engine: z.literal('claude-code'), sessionId: z.string().nullable() })
])
/** A batch whose delivery is unknown after a crash; the user decides whether to resend it. */
export const unknownBatchSchema = z.object({
  id: z.string(),
  events: z.number().int().nonnegative(),
  createdAt: z.string()
})

export const openRouterSchema = z.string().min(1).max(200)
export const sendRouterSchema = z.object({
  routerId: z.string().uuid(),
  commandId: z.string().uuid(),
  text: z.string().trim().min(1).max(8000)
})
export const resolveBatchSchema = z.object({
  routerId: z.string().uuid(),
  batchId: z.string().min(1).max(64),
  decision: z.enum(['retry', 'ignore'])
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
export type RouterWorker = z.infer<typeof workerSchema>
export type RouterStatus = z.infer<typeof routerStatusSchema>
export type RouterNative = z.infer<typeof routerNativeSchema>
export type UnknownBatch = z.infer<typeof unknownBatchSchema>
export type ResolveBatch = z.infer<typeof resolveBatchSchema>
export type SendRouterMessage = z.infer<typeof sendRouterSchema>
export type SetRouterKey = z.infer<typeof setRouterKeySchema>
export type RouterProviderInfo = {
  id: OwlsProviderId
  name: string
  /** Whether Owls has a stored key for this provider. `custom` endpoints may run without one. */
  configured: boolean
  models: { id: string; name: string }[]
}
