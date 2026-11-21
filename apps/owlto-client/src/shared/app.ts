import { z } from 'zod'
import {
  type AgentProvider,
  agentConfigsSchema,
  defaultAgentConfigs,
  effortSchema,
  permissionSchema,
  providerSchema
} from './agents.js'
import type { FeatureFlagKey, FeatureFlagValue } from './analytics.js'
import {
  type Attachment,
  type AttachmentPreview,
  attachmentSchema,
  type StageAttachment
} from './attachments.js'
import type { Automation, AutomationEnable, AutomationSave } from './automations.js'
import {
  type Board,
  type BoardSave,
  type Card,
  type CardCapture,
  type CardLibrary,
  type CardSave,
  cardRefSchema
} from './cards.js'
import type { FeedbackDiagnostics, FeedbackInput, FeedbackResult } from './feedback.js'
import type { FilePreviewResult, FileTarget, OpenFileIn } from './file-preview.js'
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
import { defaultProfile, type Profile, type ProfileUpdate, profileSchema } from './profile.js'
import {
  type CloneProject,
  type CreateProject,
  defaultProjectSettings,
  type ProjectGitRefs,
  projectSettingsSchema,
  type SaveProject
} from './projects.js'
import type { RemoteAPI } from './remote.js'
import {
  type ArchiveThread,
  type CreateThread,
  type ForwardMessage,
  type PendingMessageAction,
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
import type { UsageOverview } from './usage.js'
import type { UsageStats, UsageStatsRequest } from './usage-stats.js'
import type { WorkspaceListing } from './workspace.js'

export type { AgentProvider }
export { effortSchema, permissionSchema, providerSchema }
/** A device id: `dv_` and eight hex digits, made on the device's first start. */
export const deviceIdSchema = z.string().regex(/^dv_[0-9a-f]{8}$/)
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
    'cursor_not_installed',
    'cursor_not_connected',
    'cursor_disconnected',
    'router_model_unconfigured',
    'router_auth_failed',
    'router_unavailable',
    'secure_storage_unavailable',
    'github_unavailable',
    'worktree_failed',
    'project_url_invalid',
    'project_exists',
    'project_clone_failed',
    'project_clone_network',
    'project_clone_ssh_denied',
    'project_clone_sign_in',
    'project_clone_app_access',
    'project_clone_no_access',
    'project_git_missing',
    'avatar_unavailable',
    'thread_busy',
    /** Remote Router: the other device is not connected. */
    'remote_offline',
    'remote_timeout',
    /** Nothing answered at the address the user typed. */
    'remote_unreachable',
    /** A wrong or expired pairing code, or the other device is not pairing. */
    'remote_pairing_failed',
    /** A paired device answered with a different key, or forgot this one. */
    'remote_identity_changed',
    /** The other device runs a version of Owlto that speaks another remote protocol. */
    'remote_version',
    /** This action only works on the device itself. */
    'remote_unsupported',
    /** The relay needs this Mac to sign in, or its sign-in ended. */
    'remote_relay_login'
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
  cards: z.array(cardRefSchema).optional(),
  /** On a `user` item: the automation whose scheduled run it is. */
  automation: z.object({ id: z.string(), name: z.string() }).optional(),
  /** On a `user` item: the pull request whose GitHub activity it carries. */
  github: z.object({ url: z.string(), label: z.string() }).optional(),
  /** On a `user` item: the files the message carried. */
  attachments: z.array(attachmentSchema).optional(),
  /**
   * On a worker session's `user` item: `user` when the user wrote it in the worker
   * panel. Without it, the Router sent the message.
   */
  author: z.literal('user').optional()
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
  /** The registered project the session works for; null in the workspace folder. */
  projectPath: z.string().nullable().default(null),
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
export const defaultAppLogo = 'lean-cream' satisfies z.infer<typeof appLogoSchema>
/** Width bounds, in CSS pixels, for each pane the user can drag wider or narrower. */
export const paneWidthBounds = {
  sidebar: { min: 200, max: 440, initial: 264 },
  projects: { min: 220, max: 480, initial: 304 },
  panel: { min: 360, max: 960, initial: 480 },
  card: { min: 340, max: 960, initial: 460 },
  /** The right sidebar while it shows the file viewer, which wants room for code. */
  files: { min: 320, max: 960, initial: 520 }
} as const
export type ResizablePane = keyof typeof paneWidthBounds
/** A width the user dragged to, or null to follow the pane's current default. */
const paneWidthSchema = z.number().int().positive().nullable()
export const rightPanelSchema = z.enum(['projects', 'cards', 'files'])
export type RightPanel = z.infer<typeof rightPanelSchema>
export const layoutSettingsSchema = z.object({
  sidebarWidth: paneWidthSchema,
  projectsWidth: paneWidthSchema,
  panelWidth: paneWidthSchema,
  /** The open card's editor on the Cards page; added later, so older rows follow the default. */
  cardWidth: paneWidthSchema.catch(null),
  /** The right sidebar on its file viewer tab; added later, so older rows follow the default. */
  filesWidth: paneWidthSchema.catch(null),
  /** Whether the right-hand sidebar is open; named for its first and once only content. */
  projectsOpen: z.boolean(),
  /** Which list the right-hand sidebar shows; added later, so older rows show projects. */
  rightPanel: rightPanelSchema.catch('projects')
})
export type LayoutSettings = z.infer<typeof layoutSettingsSchema>
/** Features still being tried out; each is off until the user turns it on. */
export const experimentsSettingsSchema = z.object({
  /** A thread bar button that starts Dreaming on that thread right away. */
  manualDreaming: z.boolean().catch(false)
})
export type ExperimentsSettings = z.infer<typeof experimentsSettingsSchema>
export const defaultExperimentsSettings: ExperimentsSettings = { manualDreaming: false }
export const defaultLayoutSettings: LayoutSettings = {
  sidebarWidth: null,
  projectsWidth: null,
  panelWidth: null,
  cardWidth: null,
  filesWidth: null,
  projectsOpen: false,
  rightPanel: 'projects'
}
/**
 * The app's look: `standard`, or `doodle`, the hand-drawn style of the Owlto website.
 * A skin changes only colors, borders, shadows, and fonts, never the layout.
 */
export const skinSchema = z.enum(['standard', 'doodle'])
export type Skin = z.infer<typeof skinSchema>
/**
 * Where the user stands with first-run onboarding: not seen yet, skipped (the thread page
 * offers it again), or done. It becomes `done` once anything it asks for is configured.
 */
export const onboardingStateSchema = z.enum(['pending', 'skipped', 'done'])
export type OnboardingState = z.infer<typeof onboardingStateSchema>
export const settingsSchema = z.object({
  executablePath: z.string().nullable(),
  /** How new workers run on each coding agent; rows from before it start from the defaults. */
  agents: agentConfigsSchema.default(defaultAgentConfigs),
  theme: z.enum(['system', 'light', 'dark']),
  /** Added later, so older rows get `standard`. */
  skin: skinSchema.catch('standard').default('standard'),
  language: z.enum(['en', 'zh-CN']),
  /** Rows saved before the doodle owls name a logo that no longer exists; they get the default. */
  appLogo: appLogoSchema.catch(defaultAppLogo),
  sidebarCollapsed: z.boolean(),
  claudeExecutablePath: z.string().nullable(),
  /** Added with the Cursor agent, so older rows auto-detect it. */
  cursorExecutablePath: z.string().nullable().default(null),
  router: routerSettingsSchema,
  /** Added after the first release of settings, so older rows get the defaults. */
  memory: memorySettingsSchema.default(defaultMemorySettings),
  /** Pane widths and the Projects sidebar; also added after the first release. */
  layout: layoutSettingsSchema.default(defaultLayoutSettings),
  /** Experimental features; added later, so older rows have them all off. */
  experiments: experimentsSettingsSchema.default(defaultExperimentsSettings),
  /** Null means the default channel, stable, whichever build is installed. */
  updateChannel: updateChannelSchema.nullable().default(null),
  /** Shows the Pull requests page in the sidebar; added later, so older rows show it. */
  pullRequestsVisible: z.boolean().default(true),
  /**
   * Sends GitHub events on an agent's pull request (failing CI, requested changes,
   * new comments) to the worker that opened it; added later, so older rows have it on.
   */
  pullRequestFollowUps: z.boolean().catch(true).default(true),
  /**
   * Notifies the user and badges the dock icon when a worker waits for an approval
   * or an answer while Owlto is in the background; added later, so older rows have it on.
   */
  requestNotifications: z.boolean().catch(true).default(true),
  /**
   * Sends anonymous usage data (installs, launches, feature use, no content) in release
   * builds that carry analytics; added later, so older rows have it on. Builds without
   * analytics ignore it.
   */
  usageData: z.boolean().catch(true).default(true),
  /**
   * Where workers run tasks that belong to no project. Null uses the default,
   * `~/Owlto/Workspace`; added later, so older rows get it.
   */
  workspacePath: z.string().nullable().default(null),
  /**
   * Workspace folders whose "make this repository a project" prompt the user
   * dismissed, by path; added later. Saved only through `dismissWorkspaceFolder`.
   */
  workspaceDismissed: z.array(z.string()).catch([]).default([]),
  /**
   * Agents the user connected. Only these connect at startup: Owlto never connects
   * an agent the user did not pick. Saved only through connecting and disconnecting;
   * rows from before it are migrated in the main-process store.
   */
  connectedAgents: z.array(providerSchema).catch([]).default([]),
  /** The app "Open in" uses; null picks the first installed editor. Added later. */
  openInApp: openInAppIdSchema.nullable().catch(null).default(null),
  /** The user's name and avatar; added later, and saved only through `saveProfile`. */
  profile: profileSchema.catch(defaultProfile),
  /** Added later; older rows start `pending`, and a configured app retires it at once. */
  onboarding: onboardingStateSchema.catch('pending').default('pending'),
  /**
   * Lets paired devices drive this device's Router (Remote Router); added later, so
   * older rows have it off. Saved only through the remote settings.
   */
  remoteAccess: z.boolean().catch(false).default(false),
  /**
   * Lets paired devices reach this device through the Owlto relay when they are not on its
   * network; needs `remoteAccess`. Added later, so older rows have it off.
   */
  remoteRelay: z.boolean().catch(false).default(false),
  /**
   * Keeps this Mac from sleeping while remote access is on and it runs on power, so paired
   * devices can still reach it. Added later, so older rows have it off.
   */
  remoteKeepAwake: z.boolean().catch(false).default(false)
})
/**
 * Rows from before `connectedAgents` remembered the opposite, the agents the user
 * disconnected, and connected every other one at startup. Those users keep the agents
 * they had: every agent they had not disconnected. New installs start with none.
 */
export function migrateConnectedAgents(value: unknown): unknown {
  if (!value || typeof value !== 'object' || 'connectedAgents' in value) return value
  const { disconnectedAgents, ...rest } = value as Record<string, unknown>
  const disconnected = Array.isArray(disconnectedAgents) ? disconnectedAgents : []
  const connectedAgents = providerSchema.options.filter((p) => !disconnected.includes(p)).sort()
  return { ...rest, connectedAgents }
}
export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  /** Added after projects were first stored, so older rows get the defaults. */
  settings: projectSettingsSchema.default(defaultProjectSettings)
})
export const settingsUpdateSchema = settingsSchema
  .omit({
    executablePath: true,
    claudeExecutablePath: true,
    cursorExecutablePath: true,
    workspacePath: true,
    workspaceDismissed: true,
    connectedAgents: true,
    profile: true,
    remoteAccess: true,
    remoteRelay: true,
    remoteKeepAwake: true
  })
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
  /** When the user archived it, or null. Archived threads leave the sidebar but keep their items. */
  archivedAt: z.string().nullable().default(null),
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
export type AgentModel = z.infer<typeof modelSchema>
export type Effort = z.infer<typeof effortSchema>
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
  models: AgentModel[]
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
  models: AgentModel[]
  error: Failure | null
}
export type CursorAccount =
  | { kind: 'cursor'; email: string | null }
  | { kind: 'signed-out' }
  | { kind: 'unknown' }
export type CursorConnection = {
  status: CodexConnection['status']
  executablePath: string | null
  version: string | null
  account: CursorAccount
  models: AgentModel[]
  error: Failure | null
}
/** Any worker provider's connection; each provider keeps its own account shape. */
export type AgentConnection = CodexConnection | ClaudeConnection | CursorConnection
export type AppSnapshot = {
  sessions: Session[]
  projects: Project[]
  settings: AppSettings
  connection: CodexConnection
  claude: ClaudeConnection
  cursor: CursorConnection
  routers: Router[]
  workers: RouterWorker[]
  github: GitHubAccount
}
export type AppEvent =
  | { type: 'connection'; connection: CodexConnection }
  | { type: 'claude-connection'; connection: ClaudeConnection }
  | { type: 'cursor-connection'; connection: CursorConnection }
  | { type: 'session'; session: Session }
  | { type: 'removed'; sessionId: string }
  | { type: 'router'; router: Router }
  /** A thread the user deleted, with the workers that went with it. */
  | { type: 'thread-removed'; routerId: string; workerIds: string[] }
  /** Items that changed, in position order. Streaming items carry `rev: null`. */
  | { type: 'thread-items'; routerId: string; items: ThreadItem[] }
  | { type: 'worker'; worker: RouterWorker }
  | { type: 'github-account'; account: GitHubAccount }
  | { type: 'worker-github'; workerId: string; status: WorkerGitHubStatus }
  /** The profile changed outside the settings page, e.g. to the GitHub avatar. */
  | { type: 'profile'; profile: Profile }
/** A worker a notification points at; `routerId` is null for a session that is not a worker. */
export type OpenWorkerTarget = {
  sessionId: string
  workerId: string | null
  routerId: string | null
}
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
  effort: Effort | null
  permission: z.infer<typeof permissionSchema>
}
/** What a turn says. `text` may be empty when the message carries files. */
export type TurnInput = { text: string; attachments?: Attachment[]; author?: 'user' }
export type SendMessage = { sessionId: string; commandId: string } & TurnInput
export type RespondRequest = z.infer<typeof respondSchema>
/** Where each agent's CLI was found on this Mac, or null when it was not found. */
export type AgentDetection = Record<AgentProvider, { path: string | null }>
export interface OwltoAPI {
  snapshot(): Promise<Reply<AppSnapshot>>
  connect(): Promise<Reply<CodexConnection>>
  selectExecutable(): Promise<Reply<CodexConnection | null>>
  connectClaude(): Promise<Reply<ClaudeConnection>>
  selectClaudeExecutable(): Promise<Reply<ClaudeConnection | null>>
  connectCursor(): Promise<Reply<CursorConnection>>
  selectCursorExecutable(): Promise<Reply<CursorConnection | null>>
  /** Disconnects one agent; it stays disconnected, across restarts, until connected again. */
  disconnectAgent(provider: AgentProvider): Promise<Reply<AgentConnection>>
  /** Looks for each agent's CLI on this Mac without starting or connecting it. */
  detectAgents(): Promise<Reply<AgentDetection>>
  signIn(): Promise<Reply<void>>
  cancelSignIn(): Promise<Reply<void>>
  saveSettings(settings: z.infer<typeof settingsUpdateSchema>): Promise<Reply<AppSettings>>
  /** Saves the user's name or avatar choice. */
  saveProfile(update: ProfileUpdate): Promise<Reply<AppSettings>>
  /** Replaces the avatar with the connected GitHub account's avatar. */
  applyGitHubAvatar(): Promise<Reply<AppSettings>>
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
  /** The workspace's real path and top-level folders. */
  workspaceListing(): Promise<Reply<WorkspaceListing>>
  /** Registers a top-level workspace folder as its own project. */
  promoteWorkspaceFolder(path: string): Promise<Reply<Project>>
  /** Stops offering to make a workspace repository a project. */
  dismissWorkspaceFolder(path: string): Promise<Reply<AppSettings>>
  /** Forgets a project inside the workspace, so its work counts under the workspace again. */
  mergeIntoWorkspace(projectId: string): Promise<Reply<void>>
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
  /** Keeps a copy of a pasted or picked file, ready to send with a worker message. */
  stageAttachment(input: StageAttachment): Promise<Reply<Attachment>>
  /** An image as a data URL, or a text file's first lines, for a thumbnail; null otherwise. */
  attachmentPreview(attachment: Attachment): Promise<Reply<AttachmentPreview>>
  /** Opens a sent attachment in the system's default app. */
  openAttachment(attachment: Attachment): Promise<Reply<void>>
  /** Resolves to the thread that received the content. */
  forward(input: ForwardMessage): Promise<Reply<Router>>
  interruptRouter(routerId: string): Promise<Reply<void>>
  archiveThread(input: ArchiveThread): Promise<Reply<void>>
  /** Asks the user to confirm, then deletes the thread; resolves true once it is gone. */
  deleteThread(routerId: string): Promise<Reply<boolean>>
  resolveBatch(input: ResolveBatch): Promise<Reply<void>>
  discardWorktree(input: WorkerAction): Promise<Reply<void>>
  stopWorker(input: WorkerAction): Promise<Reply<void>>
  /** Marks a failed or blocked worker as handled, so it no longer waits on the user. */
  resolveWorker(input: WorkerAction): Promise<Reply<void>>
  /** Sends a message the user lined up while the worker was busy, without waiting for the turn to end. */
  steerPendingMessage(input: PendingMessageAction): Promise<Reply<void>>
  dropPendingMessage(input: PendingMessageAction): Promise<Reply<void>>
  removeWorker(input: WorkerAction): Promise<Reply<void>>
  /** Editors, the file manager, and terminals installed on this Mac, in menu order. */
  openInApps(): Promise<Reply<OpenInApp[]>>
  /** Opens a worker's folder (its worktree, project, or workspace) in an installed app. */
  openWorkerIn(input: OpenWorkerIn): Promise<Reply<void>>
  /** Reads a file a message points at for the right sidebar's file viewer. */
  previewFile(input: FileTarget): Promise<Reply<FilePreviewResult>>
  /** Opens a previewed file in an installed app; Finder reveals it in its folder. */
  openFileIn(input: OpenFileIn): Promise<Reply<void>>
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
  /** The app and system facts feedback can attach, for the dialog's preview. */
  feedbackDiagnostics(): Promise<Reply<FeedbackDiagnostics>>
  /** Files feedback as a GitHub issue, as the user or through their browser. */
  sendFeedback(input: FeedbackInput): Promise<Reply<FeedbackResult>>
  /** Each worker agent's plan usage; `refresh` skips the answer kept from the last minute. */
  agentUsage(refresh: boolean): Promise<Reply<UsageOverview>>
  /** Token usage recorded on this device over a range, for one agent or all, summed for the usage page. */
  usageStats(request: UsageStatsRequest): Promise<Reply<UsageStats>>
  /** This device's id (`dv_…`), shown in Settings → Updates for support. */
  deviceId(): Promise<Reply<string>>
  /** A PostHog feature flag for A/B tests; null in builds without analytics or with usage data off. */
  featureFlag(key: FeatureFlagKey): Promise<Reply<FeatureFlagValue>>
  onEvent(listener: (event: AppEvent) => void): () => void
  /** Commands chosen in the native application menu (macOS). */
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
  /** The user clicked a worker's request notification; open that worker. */
  onOpenWorker(listener: (target: OpenWorkerTarget) => void): () => void
  memory: MemoryAPI
  cards: CardsAPI
  automations: AutomationsAPI
  updates: UpdatesAPI
  remote: RemoteAPI
}
/** `window.owlto.automations`: tasks that wake the Router or a worker on a schedule. */
export interface AutomationsAPI {
  list(): Promise<Reply<Automation[]>>
  /** Creates an automation (no `id`) or edits one. */
  save(input: AutomationSave): Promise<Reply<Automation>>
  setEnabled(input: AutomationEnable): Promise<Reply<Automation>>
  remove(id: string): Promise<Reply<void>>
  /** Runs it now, off its schedule; resolves once the run reached its thread. */
  runNow(id: string): Promise<Reply<Automation>>
  onChanged(listener: () => void): () => void
}
/** `window.owlto.cards`: the user's notes, one Markdown file each, and boards. */
export interface CardsAPI {
  library(): Promise<Reply<CardLibrary>>
  save(input: CardSave): Promise<Reply<Card>>
  /** Saves a thread message or worker result as a new card. */
  capture(input: CardCapture): Promise<Reply<Card>>
  remove(cardId: string): Promise<Reply<void>>
  saveBoard(input: BoardSave): Promise<Reply<Board>>
  removeBoard(boardId: string): Promise<Reply<void>>
  /** Shows a note's Markdown file in Finder. */
  reveal(cardId: string): Promise<Reply<void>>
  onChanged(listener: () => void): () => void
}
/** `window.owlto.updates`. The channel is a setting, saved through `saveSettings`. */
export interface UpdatesAPI {
  snapshot(): Promise<Reply<UpdateSnapshot>>
  /** Resolves once the feed has been read; a newer release then keeps downloading. */
  check(): Promise<Reply<UpdateSnapshot>>
  /** Quits and installs a downloaded update, after asking about running tasks. */
  install(): Promise<Reply<void>>
  onChanged(listener: (snapshot: UpdateSnapshot) => void): () => void
}
/** `window.owlto.memory` (RFC_OWLTO_MEMORY 9). */
export interface MemoryAPI {
  list(input: MemoryListRequest): Promise<Reply<MemoryView[]>>
  overview(): Promise<Reply<MemoryOverview>>
  save(input: MemorySave): Promise<Reply<MemoryView>>
  remove(input: MemoryRemove): Promise<Reply<void>>
  category(input: MemoryCategoryAction): Promise<Reply<void>>
  /** Starts Dreaming over every thread with new content; resolves once it is queued. */
  runNow(): Promise<Reply<void>>
  /**
   * Dreams over one thread now and resolves when that run ends: the run, or null when the
   * thread has nothing Dreaming has not read. Needs the manual Dreaming experiment.
   */
  dreamThread(threadId: string): Promise<Reply<MemoryRun | null>>
  runs(): Promise<Reply<MemoryRun[]>>
  /** Opens a save dialog; resolves to false when the user canceled it. */
  export(format: MemoryExportFormat): Promise<Reply<boolean>>
  onChanged(listener: () => void): () => void
}
