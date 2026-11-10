import { z } from 'zod'
import type { GitHubAccount, WorkerGitHubStatus } from './github.js'
import {
  defaultMemorySettings,
  type MemoryCategoryAction,
  type MemoryExportFormat,
  type MemoryListRequest,
  type MemoryOverview,
  type MemoryRemove,
  type MemoryRun,
  type MemorySave,
  type MemoryView,
  memorySettingsSchema
} from './memory.js'
import {
  type CloneProject,
  type CreateProject,
  defaultProjectSettings,
  type ProjectGitRefs,
  projectSettingsSchema,
  type SaveProject
} from './projects.js'
import {
  type CreateThread,
  type ForwardMessage,
  type ResolveBatch,
  type RouterProviderInfo,
  type RouterWorker,
  routerNativeSchema,
  routerSettingsSchema,
  routerStatusSchema,
  type SendRouterMessage,
  type SetRouterKey,
  type ThreadItemsRequest,
  unknownBatchSchema,
  type WorkerAction
} from './router.js'

export const permissionSchema = z.enum(['read-only', 'workspace-write', 'full-access'])
export const providerSchema = z.enum(['codex', 'claude-code'])
/** A device id: `dv_` and eight hex digits, made on the device's first start. */
export const deviceIdSchema = z.string().regex(/^dv_[0-9a-f]{8}$/)
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
    'secure_storage_unavailable',
    'github_unavailable',
    'worktree_failed',
    'project_url_invalid',
    'project_exists',
    'project_clone_failed'
  ]),
  message: z.string()
})
export type CodexFailure = z.infer<typeof failureSchema>
/** Where forwarded content came from. A record of its origin, not a live link to it. */
export const forwardOriginSchema = z.object({
  routerId: z.string(),
  /** The source thread's title when it was forwarded. */
  title: z.string().nullable(),
  workerId: z.string().nullable(),
  /** The forwarded worker's branch, which holds its commits. */
  branch: z.string().nullable()
})
export const itemSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'user',
    'assistant',
    'reasoning',
    'command',
    'files',
    'plan',
    'tool',
    'notice',
    'worker',
    'forward'
  ]),
  status: z.enum(['running', 'completed', 'failed', 'interrupted']),
  text: z.string(),
  detail: z.string(),
  turnId: z.string().nullable(),
  /** On a `worker` item, the worker dispatched; on a `user` item, the worker addressed. */
  workerId: z.string().optional(),
  /** On a `forward` item: where its frozen `text` came from. `detail` holds the user's note. */
  forward: forwardOriginSchema.optional()
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
  provider: providerSchema,
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
/** One conversation item in its thread. `rev` is null while it streams and is unsaved. */
export const threadItemSchema = z.object({
  item: itemSchema,
  position: z.number().int().nonnegative(),
  rev: z.number().int().nonnegative().nullable()
})
export const appLogoSchema = z.enum(['line', 'solid', 'brow'])
/** Width bounds, in CSS pixels, for each pane the user can drag wider or narrower. */
export const paneWidthBounds = {
  sidebar: { min: 180, max: 420, initial: 224 },
  projects: { min: 200, max: 440, initial: 260 },
  panel: { min: 360, max: 960, initial: 480 }
} as const
export type ResizablePane = keyof typeof paneWidthBounds
export const layoutSettingsSchema = z.object({
  sidebarWidth: z.number().int().positive(),
  projectsWidth: z.number().int().positive(),
  panelWidth: z.number().int().positive(),
  /** The right-hand Projects sidebar, opened from the title bar. */
  projectsOpen: z.boolean()
})
export type LayoutSettings = z.infer<typeof layoutSettingsSchema>
export const defaultLayoutSettings: LayoutSettings = {
  sidebarWidth: paneWidthBounds.sidebar.initial,
  projectsWidth: paneWidthBounds.projects.initial,
  panelWidth: paneWidthBounds.panel.initial,
  projectsOpen: false
}
export const settingsSchema = z.object({
  executablePath: z.string().nullable(),
  model: z.string().nullable(),
  effort: effortSchema.nullable(),
  permission: permissionSchema,
  theme: z.enum(['system', 'light', 'dark']),
  language: z.enum(['en', 'zh-CN']),
  appLogo: appLogoSchema,
  sidebarCollapsed: z.boolean(),
  provider: providerSchema,
  claudeExecutablePath: z.string().nullable(),
  claudeModel: z.string().nullable(),
  claudeEffort: effortSchema.nullable(),
  router: routerSettingsSchema,
  /** Added after the first release of settings, so older rows get the defaults. */
  memory: memorySettingsSchema.default(defaultMemorySettings),
  /** Pane widths and the Projects sidebar; also added after the first release. */
  layout: layoutSettingsSchema.default(defaultLayoutSettings)
})
export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  /** Added after projects were first stored, so older rows get the defaults. */
  settings: projectSettingsSchema.default(defaultProjectSettings)
})
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
  autoMode: z.boolean()
})
/**
 * One thread: a conversation with its own Router, and its run state. Threads are
 * global. `projectId` is only where workers run when a dispatch names no project.
 * Its items are stored and sent separately (`threadItemSchema`).
 */
export const routerSchema = z.object({
  id: z.string(),
  /** The device that runs this thread's Router; set at creation and never changed. */
  deviceId: deviceIdSchema,
  /** From the first message; null until there is one. */
  title: z.string().nullable(),
  projectId: z.string().nullable(),
  /** The engine's working directory. Fixed for life: native sessions resume from it. */
  cwd: z.string(),
  status: routerStatusSchema,
  /** Change version of this record; see `saveThread` in the Router store. */
  rev: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  /** The end of the latest Router reply, for views that do not load the items. */
  preview: z.string().nullable(),
  /** The project list this Router last read, so a batch repeats it only after a change. */
  projectsShown: z.string().nullable(),
  error: failureSchema.nullable(),
  tokens: z.number().nullable(),
  native: routerNativeSchema.nullable(),
  unknownBatches: z.array(unknownBatchSchema),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type CodexRouter = z.infer<typeof routerSchema>
export type CodexItem = z.infer<typeof itemSchema>
export type ThreadItem = z.infer<typeof threadItemSchema>
export type ForwardOrigin = z.infer<typeof forwardOriginSchema>
export type CodexRequest = z.infer<typeof requestSchema>
export type CodexSession = z.infer<typeof sessionSchema>
export type CodexSettings = z.infer<typeof settingsSchema>
export type AppLogo = z.infer<typeof appLogoSchema>
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
  github: GitHubAccount
}
export type CodexEvent =
  | { type: 'connection'; connection: CodexConnection }
  | { type: 'claude-connection'; connection: ClaudeConnection }
  | { type: 'session'; session: CodexSession }
  | { type: 'removed'; sessionId: string }
  | { type: 'router'; router: CodexRouter }
  /** Items that changed, in position order. Streaming items carry `rev: null`. */
  | { type: 'thread-items'; routerId: string; items: ThreadItem[] }
  | { type: 'worker'; worker: RouterWorker }
  | { type: 'github-account'; account: GitHubAccount }
  | { type: 'worker-github'; workerId: string; status: WorkerGitHubStatus }
export type CodexReply<T> = { ok: true; value: T } | { ok: false; error: CodexFailure }
export const respondSchema = z.object({
  sessionId: z.string().uuid(),
  requestId: z.string().uuid(),
  decision: z.enum(['accept', 'decline', 'cancel']),
  answers: z.record(z.string(), z.array(z.string())).optional()
})
export type CreateCodexSession = {
  provider: AgentProvider
  cwd: string
  model: string | null
  effort: CodexSettings['effort']
  permission: CodexSettings['permission']
}
export type SendCodexMessage = { sessionId: string; commandId: string; text: string }
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
  /** The folder new projects go into unless the user picks another. */
  projectsFolder(): Promise<CodexReply<string>>
  /** Opens the system folder picker for where a new project goes; null when canceled. */
  chooseProjectsFolder(): Promise<CodexReply<string | null>>
  cloneProject(input: CloneProject): Promise<CodexReply<CodexProject>>
  createProject(input: CreateProject): Promise<CodexReply<CodexProject>>
  /** Saves a project's name and settings; resolves to the saved project. */
  saveProject(input: SaveProject): Promise<CodexReply<CodexProject>>
  /** The project repository's branches and remotes; null when it is not a git repository. */
  projectGitRefs(projectId: string): Promise<CodexReply<ProjectGitRefs | null>>
  respond(input: RespondCodexRequest): Promise<CodexReply<void>>
  createThread(input: CreateThread): Promise<CodexReply<CodexRouter>>
  threadItems(input: ThreadItemsRequest): Promise<CodexReply<ThreadItem[]>>
  sendRouter(input: SendRouterMessage): Promise<CodexReply<void>>
  /** Resolves to the thread that received the content. */
  forward(input: ForwardMessage): Promise<CodexReply<CodexRouter>>
  interruptRouter(routerId: string): Promise<CodexReply<void>>
  resolveBatch(input: ResolveBatch): Promise<CodexReply<void>>
  discardWorktree(input: WorkerAction): Promise<CodexReply<void>>
  stopWorker(input: WorkerAction): Promise<CodexReply<void>>
  removeWorker(input: WorkerAction): Promise<CodexReply<void>>
  routerProviders(): Promise<CodexReply<RouterProviderInfo[]>>
  setRouterKey(input: SetRouterKey): Promise<CodexReply<void>>
  removeRouterKey(providerId: string): Promise<CodexReply<void>>
  gitHubSignIn(): Promise<CodexReply<GitHubAccount>>
  gitHubConnectCli(): Promise<CodexReply<GitHubAccount>>
  gitHubConnectToken(token: string): Promise<CodexReply<GitHubAccount>>
  gitHubCancelSignIn(): Promise<CodexReply<void>>
  gitHubSignOut(): Promise<CodexReply<void>>
  watchWorkerGitHub(input: WorkerAction): Promise<CodexReply<void>>
  unwatchWorkerGitHub(input: WorkerAction): Promise<CodexReply<void>>
  onEvent(listener: (event: CodexEvent) => void): () => void
  memory: MemoryAPI
}
/** `window.codex.memory` (RFC_OWLS_MEMORY 9). */
export interface MemoryAPI {
  list(input: MemoryListRequest): Promise<CodexReply<MemoryView[]>>
  overview(): Promise<CodexReply<MemoryOverview>>
  save(input: MemorySave): Promise<CodexReply<MemoryView>>
  remove(input: MemoryRemove): Promise<CodexReply<void>>
  category(input: MemoryCategoryAction): Promise<CodexReply<void>>
  /** Starts Dreaming over every thread with new content; resolves once it is queued. */
  runNow(): Promise<CodexReply<void>>
  runs(): Promise<CodexReply<MemoryRun[]>>
  /** Opens a save dialog; resolves to false when the user canceled it. */
  export(format: MemoryExportFormat): Promise<CodexReply<boolean>>
  onChanged(listener: () => void): () => void
}
