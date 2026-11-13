import { z } from 'zod'
import {
  type Board,
  type BoardSave,
  type Card,
  type CardCapture,
  type CardLibrary,
  type CardSave,
  cardRefSchema
} from './cards.js'
import type { GitHubAccount, PullRequestOverview, WorkerGitHubStatus } from './github.js'
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
import type { MenuCommand } from './menu.js'
import { type OpenInApp, type OpenWorkerIn, openInAppIdSchema } from './open-in.js'
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
import { type UpdateSnapshot, updateChannelSchema } from './updates.js'

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
export type Failure = z.infer<typeof failureSchema>
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
  forward: forwardOriginSchema.optional(),
  /** On a `user` item: the cards the message carried, as they were named when sent. */
  cards: z.array(cardRefSchema).optional()
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
export const appLogoSchema = z.enum([
  'duo-white',
  'duo-night',
  'duo-cream',
  'lean-white',
  'lean-night',
  'lean-cream',
  'trio-white',
  'trio-night',
  'trio-cream'
])
/** Also the artwork of the shipped bundle icon, which Finder keeps showing. */
export const defaultAppLogo = 'duo-white' satisfies z.infer<typeof appLogoSchema>
/** Width bounds, in CSS pixels, for each pane the user can drag wider or narrower. */
export const paneWidthBounds = {
  sidebar: { min: 200, max: 440, initial: 264 },
  projects: { min: 220, max: 480, initial: 304 },
  panel: { min: 360, max: 960, initial: 480 }
} as const
export type ResizablePane = keyof typeof paneWidthBounds
/**
 * Defaults that earlier builds wrote into every saved layout. A saved width equal to one of
 * them was never chosen by dragging, so it reads as "use the current default".
 */
const legacyPaneDefaults = { sidebarWidth: 224, projectsWidth: 260 } as const
/** A width the user dragged to, or null to follow the pane's current default. */
const paneWidthSchema = z.number().int().positive().nullable()
const followLegacyDefault = (legacy: number) =>
  z.preprocess((value) => (value === legacy ? null : value), paneWidthSchema)
export const layoutSettingsSchema = z.object({
  sidebarWidth: followLegacyDefault(legacyPaneDefaults.sidebarWidth),
  projectsWidth: followLegacyDefault(legacyPaneDefaults.projectsWidth),
  panelWidth: paneWidthSchema,
  /** The right-hand Projects sidebar, opened from the title bar. */
  projectsOpen: z.boolean()
})
export type LayoutSettings = z.infer<typeof layoutSettingsSchema>
export const defaultLayoutSettings: LayoutSettings = {
  sidebarWidth: null,
  projectsWidth: null,
  panelWidth: null,
  projectsOpen: false
}
export const settingsSchema = z.object({
  executablePath: z.string().nullable(),
  model: z.string().nullable(),
  effort: effortSchema.nullable(),
  permission: permissionSchema,
  theme: z.enum(['system', 'light', 'dark']),
  language: z.enum(['en', 'zh-CN']),
  /** Rows saved before the doodle owls name a logo that no longer exists; they get the default. */
  appLogo: appLogoSchema.catch(defaultAppLogo),
  sidebarCollapsed: z.boolean(),
  provider: providerSchema,
  claudeExecutablePath: z.string().nullable(),
  claudeModel: z.string().nullable(),
  claudeEffort: effortSchema.nullable(),
  router: routerSettingsSchema,
  /** Added after the first release of settings, so older rows get the defaults. */
  memory: memorySettingsSchema.default(defaultMemorySettings),
  /** Pane widths and the Projects sidebar; also added after the first release. */
  layout: layoutSettingsSchema.default(defaultLayoutSettings),
  /** Null follows the installed build: a beta build gets beta updates, a stable one stable. */
  updateChannel: updateChannelSchema.nullable().default(null),
  /** Shows the Pull requests page in the sidebar; added later, so older rows show it. */
  pullRequestsVisible: z.boolean().default(true),
  /**
   * Where workers run tasks that belong to no project. Null uses the default,
   * `~/Owls/Workspace`; added later, so older rows get it.
   */
  workspacePath: z.string().nullable().default(null),
  /** The app "Open in" uses; null picks the first installed editor. Added later. */
  openInApp: openInAppIdSchema.nullable().catch(null).default(null)
})
export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  /** Added after projects were first stored, so older rows get the defaults. */
  settings: projectSettingsSchema.default(defaultProjectSettings)
})
export const settingsUpdateSchema = settingsSchema
  .omit({ executablePath: true, claudeExecutablePath: true, workspacePath: true })
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
export type Router = z.infer<typeof routerSchema>
export type SessionItem = z.infer<typeof itemSchema>
export type ThreadItem = z.infer<typeof threadItemSchema>
export type ForwardOrigin = z.infer<typeof forwardOriginSchema>
export type AgentRequest = z.infer<typeof requestSchema>
export type Session = z.infer<typeof sessionSchema>
export type AppSettings = z.infer<typeof settingsSchema>
export type AppLogo = z.infer<typeof appLogoSchema>
export type Project = z.infer<typeof projectSchema>
export type CodexModel = z.infer<typeof modelSchema>
export type Effort = z.infer<typeof effortSchema>
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
  error: Failure | null
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
  error: Failure | null
}
export type AppSnapshot = {
  sessions: Session[]
  projects: Project[]
  settings: AppSettings
  connection: CodexConnection
  claude: ClaudeConnection
  routers: Router[]
  workers: RouterWorker[]
  github: GitHubAccount
}
export type AppEvent =
  | { type: 'connection'; connection: CodexConnection }
  | { type: 'claude-connection'; connection: ClaudeConnection }
  | { type: 'session'; session: Session }
  | { type: 'removed'; sessionId: string }
  | { type: 'router'; router: Router }
  /** Items that changed, in position order. Streaming items carry `rev: null`. */
  | { type: 'thread-items'; routerId: string; items: ThreadItem[] }
  | { type: 'worker'; worker: RouterWorker }
  | { type: 'github-account'; account: GitHubAccount }
  | { type: 'worker-github'; workerId: string; status: WorkerGitHubStatus }
export type Reply<T> = { ok: true; value: T } | { ok: false; error: Failure }
export const respondSchema = z.object({
  sessionId: z.string().uuid(),
  requestId: z.string().uuid(),
  decision: z.enum(['accept', 'decline', 'cancel']),
  answers: z.record(z.string(), z.array(z.string())).optional()
})
export type CreateSession = {
  provider: AgentProvider
  cwd: string
  model: string | null
  effort: AppSettings['effort']
  permission: AppSettings['permission']
}
export type SendMessage = { sessionId: string; commandId: string; text: string }
export type RespondRequest = z.infer<typeof respondSchema>
export interface OwlsAPI {
  snapshot(): Promise<Reply<AppSnapshot>>
  connect(): Promise<Reply<CodexConnection>>
  selectExecutable(): Promise<Reply<CodexConnection | null>>
  connectClaude(): Promise<Reply<ClaudeConnection>>
  selectClaudeExecutable(): Promise<Reply<ClaudeConnection | null>>
  signIn(): Promise<Reply<void>>
  cancelSignIn(): Promise<Reply<void>>
  saveSettings(settings: z.infer<typeof settingsUpdateSchema>): Promise<Reply<AppSettings>>
  pickProject(): Promise<Reply<Project | null>>
  /** The folder new projects go into unless the user picks another. */
  projectsFolder(): Promise<Reply<string>>
  /** Opens the system folder picker for where a new project goes; null when canceled. */
  chooseProjectsFolder(): Promise<Reply<string | null>>
  /** Where workers run tasks that belong to no project. */
  workspaceFolder(): Promise<Reply<string>>
  /** Opens the folder picker and saves the workspace folder; null when canceled. */
  selectWorkspaceFolder(): Promise<Reply<AppSettings | null>>
  /** Goes back to the default workspace folder. */
  resetWorkspaceFolder(): Promise<Reply<AppSettings>>
  cloneProject(input: CloneProject): Promise<Reply<Project>>
  createProject(input: CreateProject): Promise<Reply<Project>>
  /** Saves a project's name and settings; resolves to the saved project. */
  saveProject(input: SaveProject): Promise<Reply<Project>>
  /** The project repository's branches and remotes; null when it is not a git repository. */
  projectGitRefs(projectId: string): Promise<Reply<ProjectGitRefs | null>>
  respond(input: RespondRequest): Promise<Reply<void>>
  createThread(input: CreateThread): Promise<Reply<Router>>
  threadItems(input: ThreadItemsRequest): Promise<Reply<ThreadItem[]>>
  sendRouter(input: SendRouterMessage): Promise<Reply<void>>
  /** Resolves to the thread that received the content. */
  forward(input: ForwardMessage): Promise<Reply<Router>>
  interruptRouter(routerId: string): Promise<Reply<void>>
  resolveBatch(input: ResolveBatch): Promise<Reply<void>>
  discardWorktree(input: WorkerAction): Promise<Reply<void>>
  stopWorker(input: WorkerAction): Promise<Reply<void>>
  removeWorker(input: WorkerAction): Promise<Reply<void>>
  /** Editors, the file manager, and terminals installed on this Mac, in menu order. */
  openInApps(): Promise<Reply<OpenInApp[]>>
  /** Opens a worker's folder (its worktree, project, or workspace) in an installed app. */
  openWorkerIn(input: OpenWorkerIn): Promise<Reply<void>>
  routerProviders(): Promise<Reply<RouterProviderInfo[]>>
  setRouterKey(input: SetRouterKey): Promise<Reply<void>>
  removeRouterKey(providerId: string): Promise<Reply<void>>
  gitHubSignIn(): Promise<Reply<GitHubAccount>>
  gitHubConnectCli(): Promise<Reply<GitHubAccount>>
  gitHubConnectToken(token: string): Promise<Reply<GitHubAccount>>
  gitHubCancelSignIn(): Promise<Reply<void>>
  gitHubSignOut(): Promise<Reply<void>>
  watchWorkerGitHub(input: WorkerAction): Promise<Reply<void>>
  unwatchWorkerGitHub(input: WorkerAction): Promise<Reply<void>>
  /** Every pull request agents opened, per project, read from GitHub now. */
  pullRequests(): Promise<Reply<PullRequestOverview>>
  onEvent(listener: (event: AppEvent) => void): () => void
  /** Commands chosen in the native application menu (macOS). */
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
  memory: MemoryAPI
  cards: CardsAPI
  updates: UpdatesAPI
}
/** `window.owls.cards`: the user's knowledge cards and boards. */
export interface CardsAPI {
  library(): Promise<Reply<CardLibrary>>
  save(input: CardSave): Promise<Reply<Card>>
  /** Saves a thread message or worker result as a new card. */
  capture(input: CardCapture): Promise<Reply<Card>>
  remove(cardId: string): Promise<Reply<void>>
  saveBoard(input: BoardSave): Promise<Reply<Board>>
  removeBoard(boardId: string): Promise<Reply<void>>
  onChanged(listener: () => void): () => void
}
/** `window.owls.updates`. The channel is a setting, saved through `saveSettings`. */
export interface UpdatesAPI {
  snapshot(): Promise<Reply<UpdateSnapshot>>
  /** Resolves once the feed has been read; a newer release then keeps downloading. */
  check(): Promise<Reply<UpdateSnapshot>>
  /** Quits and installs a downloaded update, after asking about running tasks. */
  install(): Promise<Reply<void>>
  onChanged(listener: (snapshot: UpdateSnapshot) => void): () => void
}
/** `window.owls.memory` (RFC_OWLS_MEMORY 9). */
export interface MemoryAPI {
  list(input: MemoryListRequest): Promise<Reply<MemoryView[]>>
  overview(): Promise<Reply<MemoryOverview>>
  save(input: MemorySave): Promise<Reply<MemoryView>>
  remove(input: MemoryRemove): Promise<Reply<void>>
  category(input: MemoryCategoryAction): Promise<Reply<void>>
  /** Starts Dreaming over every thread with new content; resolves once it is queued. */
  runNow(): Promise<Reply<void>>
  runs(): Promise<Reply<MemoryRun[]>>
  /** Opens a save dialog; resolves to false when the user canceled it. */
  export(format: MemoryExportFormat): Promise<Reply<boolean>>
  onChanged(listener: () => void): () => void
}
