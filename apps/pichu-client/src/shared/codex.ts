import { z } from 'zod'
import {
  type RouterProviderInfo,
  type RouterWorker,
  routerSettingsSchema,
  routerStatusSchema,
  type SendRouterMessage,
  type SetRouterKey
} from './router.js'

export const permissionSchema = z.enum(['read-only', 'workspace-write', 'full-access'])
export const providerSchema = z.enum(['codex', 'claude-code'])
export const effortSchema = z.string().min(1).max(64)
export const failureSchema = z.object({
  code: z.enum([
    'not_installed',
    'not_connected',
    'busy',
    'invalid_request',
    'project_required',
    'model_unavailable',
    'effort_unavailable',
    'request_unavailable',
    'answer_required',
    'task_not_found',
    'unsupported_login',
    'protocol_error',
    'native_error',
    'unknown_result',
    'storage_error',
    'disconnected',
    'interrupted',
    'claude_not_installed',
    'claude_not_connected',
    'claude_disconnected',
    'router_model_unconfigured',
    'router_auth_failed',
    'router_unavailable',
    'secure_storage_unavailable'
  ]),
  message: z.string()
})
export type CodexFailure = z.infer<typeof failureSchema>
export const itemSchema = z.object({
  id: z.string(),
  kind: z.enum(['user', 'assistant', 'reasoning', 'command', 'files', 'plan', 'tool', 'notice']),
  status: z.enum(['running', 'completed', 'failed', 'interrupted']),
  text: z.string(),
  detail: z.string().default(''),
  turnId: z.string().nullable()
})
export const questionSchema = z.object({
  id: z.string(),
  header: z.string(),
  question: z.string(),
  isSecret: z.boolean().default(false),
  options: z.array(z.object({ label: z.string(), description: z.string() })).nullable()
})
export const requestSchema = z.object({
  id: z.string(),
  kind: z.enum(['command', 'files', 'permissions', 'question']),
  title: z.string(),
  detail: z.string(),
  questions: z.array(questionSchema),
  status: z.enum(['pending', 'answering', 'resolved', 'unavailable']),
  turnId: z.string()
})
export const sessionSchema = z.object({
  id: z.string(),
  provider: providerSchema.default('codex'),
  threadId: z.string().nullable(),
  title: z.string(),
  cwd: z.string(),
  model: z.string().nullable(),
  effort: effortSchema.nullable(),
  permission: permissionSchema,
  status: z.enum(['idle', 'starting', 'running', 'waiting', 'interrupted', 'failed']),
  turnId: z.string().nullable(),
  error: failureSchema.nullable(),
  items: z.array(itemSchema),
  requests: z.array(requestSchema),
  diff: z.string(),
  tokens: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export const settingsSchema = z.object({
  executablePath: z.string().nullable(),
  model: z.string().nullable(),
  effort: effortSchema.nullable(),
  permission: permissionSchema,
  theme: z.enum(['system', 'light', 'dark']),
  language: z.enum(['en', 'zh-CN']),
  provider: providerSchema.default('codex'),
  claudeExecutablePath: z.string().nullable().default(null),
  claudeModel: z.string().nullable().default(null),
  claudeEffort: effortSchema.nullable().default(null),
  router: routerSettingsSchema.default(routerSettingsSchema.parse({})),
  /** Agent for Router workers when `dispatch_task` names none; null follows `provider`. */
  workerProvider: providerSchema.nullable().default(null)
})
export const projectSchema = z.object({ id: z.string(), name: z.string(), path: z.string() })
export const settingsUpdateSchema = settingsSchema
  .omit({ executablePath: true, claudeExecutablePath: true })
  .strict()
export const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  isDefault: z.boolean(),
  efforts: z.array(effortSchema),
  defaultEffort: effortSchema.nullable(),
  autoMode: z.boolean().default(false)
})
/** A project's Router: the conversation shown in the Router view and its run state. */
export const routerSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  cwd: z.string(),
  status: routerStatusSchema,
  items: z.array(itemSchema),
  error: failureSchema.nullable(),
  tokens: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type CodexRouter = z.infer<typeof routerSchema>
export type CodexItem = z.infer<typeof itemSchema>
export type CodexRequest = z.infer<typeof requestSchema>
export type CodexSession = z.infer<typeof sessionSchema>
export type CodexSettings = z.infer<typeof settingsSchema>
export type CodexProject = z.infer<typeof projectSchema>
export type CodexModel = z.infer<typeof modelSchema>
export type CodexEffort = z.infer<typeof effortSchema>
export type AgentProvider = z.infer<typeof providerSchema>
export type CodexAccount =
  | { kind: 'chatgpt'; email: string | null; plan: string | null }
  | { kind: 'api-key' }
  | { kind: 'external' }
  | { kind: 'signed-out' }
export type CodexConnection = {
  status: 'disconnected' | 'connecting' | 'ready' | 'error'
  executablePath: string | null
  version: string | null
  account: CodexAccount
  models: CodexModel[]
  error: CodexFailure | null
}
export type ClaudeAccount =
  | { kind: 'claude'; email: string | null; plan: string | null }
  | { kind: 'api-key' }
  | { kind: 'external' }
  | { kind: 'unknown' }
export type ClaudeConnection = {
  status: CodexConnection['status']
  executablePath: string | null
  version: string | null
  account: ClaudeAccount
  models: CodexModel[]
  error: CodexFailure | null
}
export type CodexSnapshot = {
  sessions: CodexSession[]
  projects: CodexProject[]
  settings: CodexSettings
  connection: CodexConnection
  claude: ClaudeConnection
  routers: CodexRouter[]
  workers: RouterWorker[]
}
export type CodexEvent =
  | { type: 'connection'; connection: CodexConnection }
  | { type: 'claude-connection'; connection: ClaudeConnection }
  | { type: 'session'; session: CodexSession }
  | { type: 'removed'; sessionId: string }
  | { type: 'router'; router: CodexRouter }
  | { type: 'worker'; worker: RouterWorker }
export type CodexReply<T> = { ok: true; value: T } | { ok: false; error: CodexFailure }
export const createSessionSchema = z.object({
  provider: providerSchema,
  cwd: z.string().min(1).max(4096),
  model: z.string().min(1).nullable(),
  effort: effortSchema.nullable(),
  permission: permissionSchema
})
export const sendSchema = z.object({
  sessionId: z.string().uuid(),
  commandId: z.string().uuid(),
  text: z.string().trim().min(1).max(200_000)
})
export const respondSchema = z.object({
  sessionId: z.string().uuid(),
  requestId: z.string().uuid(),
  decision: z.enum(['accept', 'decline', 'cancel']),
  answers: z.record(z.string(), z.array(z.string())).optional()
})
export type CreateCodexSession = z.infer<typeof createSessionSchema>
export type SendCodexMessage = z.infer<typeof sendSchema>
export type RespondCodexRequest = z.infer<typeof respondSchema>
export interface CodexAPI {
  snapshot(): Promise<CodexReply<CodexSnapshot>>
  connect(): Promise<CodexReply<CodexConnection>>
  selectExecutable(): Promise<CodexReply<CodexConnection | null>>
  connectClaude(): Promise<CodexReply<ClaudeConnection>>
  selectClaudeExecutable(): Promise<CodexReply<ClaudeConnection | null>>
  signIn(): Promise<CodexReply<void>>
  cancelSignIn(): Promise<CodexReply<void>>
  saveSettings(settings: z.infer<typeof settingsUpdateSchema>): Promise<CodexReply<CodexSettings>>
  pickProject(): Promise<CodexReply<CodexProject | null>>
  createSession(input: CreateCodexSession): Promise<CodexReply<CodexSession>>
  send(input: SendCodexMessage): Promise<CodexReply<void>>
  interrupt(sessionId: string): Promise<CodexReply<void>>
  respond(input: RespondCodexRequest): Promise<CodexReply<void>>
  archive(sessionId: string): Promise<CodexReply<void>>
  openRouter(projectId: string): Promise<CodexReply<CodexRouter>>
  sendRouter(input: SendRouterMessage): Promise<CodexReply<void>>
  interruptRouter(routerId: string): Promise<CodexReply<void>>
  routerProviders(): Promise<CodexReply<RouterProviderInfo[]>>
  setRouterKey(input: SetRouterKey): Promise<CodexReply<void>>
  removeRouterKey(providerId: string): Promise<CodexReply<void>>
  onEvent(listener: (event: CodexEvent) => void): () => void
}
