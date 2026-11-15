import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { z } from 'zod'
import type {
  AgentConnection,
  AgentProvider,
  AppSettings,
  AppSnapshot,
  ClaudeConnection,
  CodexConnection,
  CursorConnection,
  Project,
  RespondRequest,
  Router,
  SendMessage,
  Session,
  ThreadItem,
  TurnInput
} from '../../shared/app.js'
import type { Attachment, StageAttachment } from '../../shared/attachments.js'
import type { Automation, AutomationEnable, AutomationSave } from '../../shared/automations.js'
import type {
  Board,
  boardSaveSchema,
  Card,
  CardLibrary,
  cardCaptureSchema,
  cardSaveSchema
} from '../../shared/cards.js'
import type { FeedbackDiagnostics, FeedbackInput, FeedbackResult } from '../../shared/feedback.js'
import type { GitHubAccount, PullRequestOverview } from '../../shared/github.js'
import type {
  MemoryCategoryAction,
  MemoryExportFormat,
  MemoryListRequest,
  MemoryOverview,
  MemoryRemove,
  MemoryRun,
  MemorySave,
  MemoryView
} from '../../shared/memory.js'
import type {
  CloneProject,
  CreateProject,
  ProjectGitRefs,
  SaveProject
} from '../../shared/projects.js'
import type {
  ArchiveThread,
  CreateThread,
  ForwardMessage,
  ResolveBatch,
  RouterProviderInfo,
  SendRouterMessage,
  SetRouterKey,
  ThreadItemsRequest,
  WorkerAction
} from '../../shared/router.js'
import { type UsageOverview, unavailableUsage } from '../../shared/usage.js'
import type { UsageStats, UsageStatsRequest } from '../../shared/usage-stats.js'
import { isInPlay } from '../../shared/worker-map.js'
import { type WorkspaceListing, workerHome } from '../../shared/workspace.js'
import type { PullRequestWatcher } from '../automations/pull-request-events.js'
import type { AutomationService } from '../automations/service.js'
import type { CardService } from '../cards/service.js'
import type { ClaudeService } from '../claude/service.js'
import type { CodexService } from '../codex/service.js'
import type { CursorService } from '../cursor/service.js'
import type { GitHubAuth } from '../github/auth.js'
import type { FeedbackSender } from '../github/feedback.js'
import type { DreamingRunner } from '../memory/dreaming.js'
import type { MemoryService } from '../memory/service.js'
import type { MemorySweeper } from '../memory/sweep.js'
import type { DreamingTriggers } from '../memory/triggers.js'
import type { ProjectPullRequests } from '../router/project-pull-requests.js'
import type { RouterService, WorkerHost } from '../router/service.js'
import type { WorkerGitHub } from '../router/worker-github.js'
import type { UsageLedger } from '../usage/ledger.js'
import type { AgentRuntime } from './agent-runtime.js'
import { AttachmentStore } from './attachments.js'
import { OwltoError } from './errors.js'
import type { UserProfile } from './profile.js'
import { cloneGitHubProject, createQuickProject } from './project-sources.js'
import {
  isWorkspaceProject,
  listWorkspaceFolders,
  realWorkspace,
  workspaceChild
} from './workspace-folders.js'

const USAGE_TTL_MS = 60_000
const USAGE_ORDER: AgentProvider[] = ['claude-code', 'codex', 'cursor']

type CardSaveInput = z.infer<typeof cardSaveSchema>
type CardCaptureInput = z.infer<typeof cardCaptureSchema>
type BoardSaveInput = z.infer<typeof boardSaveSchema>

/**
 * Owns the desktop workspace and routes each worker session to the runtime that
 * created it. Sessions never switch runtimes after creation.
 */
export class OwltoHost {
  private router: RouterService | null = null
  private github: {
    auth: GitHubAuth
    workers: WorkerGitHub
    pullRequests: ProjectPullRequests
    feedback: FeedbackSender
    /** Turns changes on agent pull requests into follow-ups. */
    watcher: PullRequestWatcher
  } | null = null
  private memory: {
    service: MemoryService
    dreaming: DreamingRunner
    triggers: DreamingTriggers
    sweeper: MemorySweeper
  } | null = null
  private cards: CardService | null = null
  private automations: AutomationService | null = null
  private profile: UserProfile | null = null
  private ledger: UsageLedger | null = null
  private readonly runtimes: Record<AgentProvider, AgentRuntime>
  private readonly attachments: AttachmentStore
  private usageCache: { at: number; value: Promise<UsageOverview>; pending: boolean } | null = null
  constructor(
    private readonly codex: CodexService,
    private readonly claude: ClaudeService,
    private readonly cursor: CursorService,
    private readonly threadHome: string,
    private readonly projectsHome: string,
    /** The workspace folder used while the user has not picked one. */
    private readonly workspaceHome: string,
    /** Where attached files are kept; next to the Router thread folders by default. */
    attachmentsRoot = join(dirname(threadHome), 'attachments')
  ) {
    this.runtimes = { codex, 'claude-code': claude, cursor }
    this.attachments = new AttachmentStore(attachmentsRoot)
  }
  /** Connects the Routers, which start every session of this host. */
  attachRouter(router: RouterService): void {
    this.router = router
    for (const runtime of Object.values(this.runtimes)) runtime.setTurnProfiles(router)
  }
  /** Records every worker turn's token usage, with the project its worker runs in. */
  attachUsage(ledger: UsageLedger): void {
    this.ledger = ledger
    for (const [provider, runtime] of Object.entries(this.runtimes) as [
      AgentProvider,
      AgentRuntime
    ][])
      runtime.setUsageRecorder((sessionId, usage) => {
        const worker = this.router?.snapshot().workers.find((w) => w.sessionId === sessionId)
        ledger.record({
          ...usage,
          agent: provider,
          role: 'worker',
          projectId: worker?.projectId ?? null,
          workerId: worker?.id ?? null
        })
      })
  }
  usageStats({ range, agent }: UsageStatsRequest): UsageStats {
    if (!this.ledger) throw new OwltoError('request_unavailable', 'Usage stats are not available.')
    const workers = new Map(this.router?.snapshot().workers.map((w) => [w.id, w]))
    const { projects } = this.codex.snapshot()
    const workspace = realWorkspace(this.workspaceFolder())
    return this.ledger.stats(range, agent, (workerId) => {
      const worker = workers.get(workerId)
      return worker ? workerHome(worker, projects, workspace) : null
    })
  }
  attachGitHub(github: NonNullable<OwltoHost['github']>): void {
    this.github = github
  }
  attachMemory(memory: NonNullable<OwltoHost['memory']>): void {
    this.memory = memory
  }
  attachCards(cards: CardService): void {
    this.cards = cards
  }
  attachAutomations(automations: AutomationService): void {
    this.automations = automations
  }
  automationList(): Automation[] {
    return this.requireAutomations().list()
  }
  automationSave(input: AutomationSave): Automation {
    const projectId = input.projectId
    if (projectId && !this.codex.snapshot().projects.some((p) => p.id === projectId))
      throw new OwltoError('project_required', 'This project no longer exists.')
    return this.requireAutomations().save(input)
  }
  automationEnable(input: AutomationEnable): Automation {
    return this.requireAutomations().setEnabled(input.id, input.enabled)
  }
  automationRemove(id: string): void {
    this.requireAutomations().remove(id)
  }
  automationRun(id: string): Promise<Automation> {
    return this.requireAutomations().runNow(id)
  }
  private requireAutomations(): AutomationService {
    if (!this.automations)
      throw new OwltoError('router_unavailable', 'Automations are not available.')
    return this.automations
  }
  attachProfile(profile: UserProfile): void {
    this.profile = profile
  }
  saveProfile(input: unknown): AppSettings {
    return this.requireProfile().update(input)
  }
  applyGitHubAvatar(): Promise<AppSettings> {
    return this.requireProfile().applyGitHubAvatar()
  }
  /** A worker session's items, from whichever runtime owns it. */
  sessionItems(sessionId: string): Session['items'] {
    return this.snapshot().sessions.find((s) => s.id === sessionId)?.items ?? []
  }
  /** The narrow view of this host that Routers use to start workers. */
  workerHost(): WorkerHost {
    return {
      projects: () => this.codex.snapshot().projects,
      threadHome: () => {
        mkdirSync(this.threadHome, { recursive: true })
        return this.threadHome
      },
      workspace: () => {
        const folder = this.workspaceFolder()
        mkdirSync(folder, { recursive: true })
        return folder
      },
      settings: () => this.codex.snapshot().settings,
      providerReady: (provider: AgentProvider) => {
        const connection = this.runtimes[provider].connectionState()
        return connection.status === 'ready' && connection.account.kind !== 'signed-out'
      },
      agentModels: (provider: AgentProvider) => this.runtimes[provider].connectionState().models,
      createSession: (input, worker) => this.runtimes[input.provider].createSession(input, worker),
      remove: (sessionId) => this.archive(sessionId),
      send: (input) => this.send(input),
      steer: (sessionId, input) => this.steer(sessionId, input),
      interrupt: (sessionId) => this.interrupt(sessionId),
      respond: (input) => this.respond(input)
    }
  }
  snapshot(): AppSnapshot {
    const codex = this.codex.snapshot()
    const router = this.router?.snapshot() ?? { routers: [], workers: [] }
    return {
      ...codex,
      sessions: [
        ...codex.sessions,
        ...this.claude.sessionList(),
        ...this.cursor.sessionList()
      ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      claude: this.claude.connectionState(),
      cursor: this.cursor.connectionState(),
      github: this.github?.auth.account() ?? { status: 'signed-out', failure: null },
      ...router
    }
  }
  codexConnection(): CodexConnection {
    return this.codex.connectionState()
  }
  claudeConnection(): ClaudeConnection {
    return this.claude.connectionState()
  }
  cursorConnection(): CursorConnection {
    return this.cursor.connectionState()
  }
  connect(): Promise<CodexConnection> {
    const connection = this.codex.connect()
    this.rememberDisconnected('codex', false)
    return connection
  }
  connectClaude(): Promise<ClaudeConnection> {
    const connection = this.claude.connect()
    this.rememberDisconnected('claude-code', false)
    return connection
  }
  connectCursor(): Promise<CursorConnection> {
    const connection = this.cursor.connect()
    this.rememberDisconnected('cursor', false)
    return connection
  }
  /** Connects every agent the user has not disconnected. */
  connectAtStartup(): void {
    const disconnected = new Set(this.codex.snapshot().settings.disconnectedAgents)
    if (!disconnected.has('codex')) void this.codex.connect()
    if (!disconnected.has('claude-code')) void this.claude.connect()
    if (!disconnected.has('cursor')) void this.cursor.connect()
  }
  disconnectAgent(provider: AgentProvider): AgentConnection {
    const connection = this.runtimes[provider].disconnect()
    this.rememberDisconnected(provider, true)
    return connection
  }
  private rememberDisconnected(provider: AgentProvider, disconnected: boolean): void {
    const settings = this.codex.snapshot().settings
    if (settings.disconnectedAgents.includes(provider) === disconnected) return
    const rest = settings.disconnectedAgents.filter((p) => p !== provider)
    const disconnectedAgents = (disconnected ? [...rest, provider] : rest).sort()
    this.codex.saveSettings({ ...settings, disconnectedAgents })
  }
  saveSettings(settings: AppSettings): AppSettings {
    const previous = this.codex.snapshot().settings
    if (
      settings.claudeExecutablePath !== previous.claudeExecutablePath &&
      this.claude.hasActiveTasks()
    ) {
      throw new OwltoError('busy', 'Stop active tasks before changing the Claude Code executable.')
    }
    if (
      settings.cursorExecutablePath !== previous.cursorExecutablePath &&
      this.cursor.hasActiveTasks()
    ) {
      throw new OwltoError('busy', 'Stop active tasks before changing the Cursor executable.')
    }
    const routerChanged = JSON.stringify(settings.router) !== JSON.stringify(previous.router)
    if (routerChanged && this.router?.isRunning())
      throw new OwltoError('busy', 'Wait for the Router to finish before changing it.')
    const saved = this.codex.saveSettings(settings)
    if (routerChanged) this.router?.settingsChanged()
    return saved
  }
  createThread(input: CreateThread): Router {
    return this.requireRouter().createThread(input)
  }
  threadItems(input: ThreadItemsRequest): ThreadItem[] {
    return this.requireRouter().items(input.routerId, input.after)
  }
  /** Freezes the attached cards first, so a missing card refuses the whole message. */
  async sendRouter(input: SendRouterMessage): Promise<void> {
    const cards = input.cardIds.length ? this.requireCards().attach(input.cardIds) : []
    // A missing file refuses the message before anything reaches the worker.
    if (input.attachments.length) await this.attachments.files(input.attachments)
    return this.requireRouter().send(input, cards)
  }
  forward(input: ForwardMessage): Router {
    return this.requireRouter().forward(input)
  }
  interruptRouter(routerId: string): void {
    this.requireRouter().interrupt(routerId)
  }
  deleteThread(routerId: string): void {
    this.requireRouter().deleteThread(routerId)
  }
  archiveThread(input: ArchiveThread): void {
    this.requireRouter().archive(input)
  }
  resolveBatch(input: ResolveBatch): void {
    this.requireRouter().resolveBatch(input)
  }
  discardWorktree(input: WorkerAction): Promise<void> {
    return this.requireRouter().discardWorktree(input)
  }
  stopWorker(input: WorkerAction): Promise<void> {
    return this.requireRouter().stopWorker(input)
  }
  removeWorker(input: WorkerAction): void {
    this.requireRouter().removeWorker(input)
  }
  /** The folder a worker works in: its worktree, or its project or the workspace folder. */
  workerFolder(input: WorkerAction): string {
    const sessionId = this.requireRouter().workerSession(input)
    const session = this.snapshot().sessions.find((s) => s.id === sessionId)
    if (!session) throw new OwltoError('request_unavailable', 'This worker no longer exists.')
    return session.cwd
  }
  routerProviders(): RouterProviderInfo[] {
    return this.requireRouter().providers()
  }
  setRouterKey(input: SetRouterKey): Promise<void> {
    return this.requireRouter().setKey(input)
  }
  removeRouterKey(providerId: SetRouterKey['providerId']): void {
    this.requireRouter().removeKey(providerId)
  }
  gitHubSignIn(): Promise<GitHubAccount> {
    return this.requireGitHub().auth.signIn()
  }
  gitHubConnectCli(): Promise<GitHubAccount> {
    return this.requireGitHub().auth.connectGhCli()
  }
  gitHubConnectToken(token: string): Promise<GitHubAccount> {
    return this.requireGitHub().auth.connectToken(token)
  }
  gitHubCancelSignIn(): void {
    this.requireGitHub().auth.cancelSignIn()
  }
  gitHubSignOut(): void {
    this.requireGitHub().auth.signOut()
  }
  watchWorkerGitHub(input: WorkerAction): void {
    this.requireGitHub().workers.watch(input)
  }
  unwatchWorkerGitHub(input: WorkerAction): void {
    this.requireGitHub().workers.unwatch(input)
  }
  /**
   * Every worker agent's plan usage. Answers are kept for a minute so opening
   * the panel again does not restart the Claude Code CLI; `refresh` reads again.
   */
  usage(refresh: boolean): Promise<UsageOverview> {
    const cached = this.usageCache
    if (cached && (cached.pending || (!refresh && Date.now() - cached.at < USAGE_TTL_MS)))
      return cached.value
    const value = Promise.all(
      USAGE_ORDER.map(async (provider) => {
        try {
          return await this.runtimes[provider].usage()
        } catch {
          return unavailableUsage(provider, 'failed')
        }
      })
    ).then((agents) => ({ agents }))
    const entry = { at: Date.now(), value, pending: true }
    this.usageCache = entry
    void value.finally(() => {
      entry.pending = false
      entry.at = Date.now()
    })
    return value
  }
  pullRequests(): Promise<PullRequestOverview> {
    return this.requireGitHub().pullRequests.read()
  }
  feedbackDiagnostics(): FeedbackDiagnostics {
    return this.requireGitHub().feedback.diagnostics()
  }
  sendFeedback(input: FeedbackInput): Promise<FeedbackResult> {
    return this.requireGitHub().feedback.send(input)
  }
  memoryList(input: MemoryListRequest): MemoryView[] {
    return this.requireMemory().service.list(input)
  }
  memoryOverview(): MemoryOverview {
    const { service, dreaming } = this.requireMemory()
    return service.overview(dreaming.running, dreaming.activeThreadId)
  }
  memorySave(input: MemorySave): MemoryView {
    return this.requireMemory().service.save(input)
  }
  memoryRemove(input: MemoryRemove): void {
    this.requireMemory().service.remove(input)
  }
  memoryCategory(input: MemoryCategoryAction): void {
    this.requireMemory().service.category(input)
  }
  /** Queues Dreaming for every thread with new content without waiting for it. */
  memoryRunNow(): void {
    void this.requireMemory()
      .dreaming.runNow()
      .catch(() => {})
  }
  /** Dreams over one thread now, for the manual Dreaming experiment. */
  memoryDreamThread(threadId: string): Promise<MemoryRun | null> {
    if (!this.snapshot().settings.experiments.manualDreaming)
      throw new OwltoError('request_unavailable', 'Manual Dreaming is turned off.')
    return this.requireMemory().dreaming.dreamThread(threadId)
  }
  memoryRuns(): MemoryRun[] {
    return this.requireMemory().service.runs()
  }
  memoryExport(format: MemoryExportFormat): string {
    return this.requireMemory().service.export(format)
  }
  cardLibrary(): CardLibrary {
    return this.requireCards().library()
  }
  cardSave(input: CardSaveInput): Card {
    return this.requireCards().save(input)
  }
  cardCapture(input: CardCaptureInput): Card {
    return this.requireCards().capture(input)
  }
  cardRemove(id: string): void {
    this.requireCards().remove(id)
  }
  boardSave(input: BoardSaveInput): Board {
    return this.requireCards().saveBoard(input)
  }
  boardRemove(id: string): void {
    this.requireCards().removeBoard(id)
  }
  private requireCards(): CardService {
    if (!this.cards) throw new OwltoError('router_unavailable', 'Cards are not available.')
    return this.cards
  }
  private requireMemory(): NonNullable<OwltoHost['memory']> {
    if (!this.memory) throw new OwltoError('router_unavailable', 'Memory is not available.')
    return this.memory
  }
  private requireProfile(): UserProfile {
    if (!this.profile) throw new OwltoError('request_unavailable', 'The profile is not available.')
    return this.profile
  }
  private requireGitHub(): NonNullable<OwltoHost['github']> {
    if (!this.github) throw new OwltoError('github_unavailable', 'GitHub is not available.')
    return this.github
  }
  private requireRouter(): RouterService {
    if (!this.router) throw new OwltoError('router_unavailable', 'The Router is not available.')
    return this.router
  }
  addProject(path: string): Project {
    return this.codex.addProject(path)
  }
  saveProject(input: SaveProject): Project {
    return this.codex.saveProject(input)
  }
  /** Null when the project is not a git repository, or no Router can read it yet. */
  async projectGitRefs(projectId: string): Promise<ProjectGitRefs | null> {
    const project = this.codex.snapshot().projects.find((p) => p.id === projectId)
    if (!project) throw new OwltoError('project_required', 'This project no longer exists.')
    return this.router ? this.router.gitRefs(project.path) : null
  }
  projectsFolder(): string {
    return this.projectsHome
  }
  /** Where workers run tasks that belong to no project: the user's pick, else the default. */
  workspaceFolder(): string {
    return this.codex.snapshot().settings.workspacePath ?? this.workspaceHome
  }
  /** Saves the workspace folder; null goes back to the default. */
  setWorkspaceFolder(path: string | null): AppSettings {
    return this.saveSettings({ ...this.codex.snapshot().settings, workspacePath: path })
  }
  /** The workspace's top-level folders, for the Workspace page and the promote prompt. */
  async workspaceListing(): Promise<WorkspaceListing> {
    const { projects, settings } = this.codex.snapshot()
    const workspace = this.workspaceFolder()
    return {
      root: realWorkspace(workspace),
      folders: await listWorkspaceFolders(workspace, projects, settings.workspaceDismissed)
    }
  }
  /** Registers a top-level workspace folder as its own project. */
  async promoteWorkspaceFolder(path: string): Promise<Project> {
    return this.addProject(await workspaceChild(this.workspaceFolder(), path))
  }
  /** Stops offering to make a workspace repository a project. */
  async dismissWorkspaceFolder(path: string): Promise<AppSettings> {
    const folder = await workspaceChild(this.workspaceFolder(), path)
    const settings = this.codex.snapshot().settings
    const dismissed = [...new Set([...settings.workspaceDismissed, folder])].sort()
    return this.saveSettings({ ...settings, workspaceDismissed: dismissed })
  }
  /**
   * Forgets a project inside the workspace, so its folder and work count under
   * the workspace again. Refused while any of its workers is still in play.
   */
  mergeIntoWorkspace(projectId: string): void {
    const project = this.codex.snapshot().projects.find((p) => p.id === projectId)
    if (!project) throw new OwltoError('project_required', 'This project no longer exists.')
    if (!isWorkspaceProject(this.workspaceFolder(), project))
      throw new OwltoError(
        'project_required',
        'Only projects inside the workspace can be merged back.'
      )
    const workers = this.router?.snapshot().workers ?? []
    if (workers.some((w) => w.projectId === projectId && isInPlay(w)))
      throw new OwltoError('busy', 'Wait for the tasks in this project to finish first.')
    this.codex.removeProject(projectId)
  }
  async cloneProject(input: CloneProject): Promise<Project> {
    return this.addProject(await cloneGitHubProject(input, this.projectsHome))
  }
  async createProject(input: CreateProject): Promise<Project> {
    return this.addProject(await createQuickProject(input, this.projectsHome))
  }
  /** The runtime that owns a session; Codex answers for unknown ones with its own error. */
  private runtimeOf(sessionId: string): AgentRuntime {
    return Object.values(this.runtimes).find((r) => r.owns(sessionId)) ?? this.codex
  }
  private async send(input: SendMessage): Promise<void> {
    const attachments = input.attachments?.length
      ? await this.attachments.files(input.attachments)
      : undefined
    return this.runtimeOf(input.sessionId).send({ ...input, attachments })
  }
  private async steer(sessionId: string, input: TurnInput): Promise<'steered' | 'not_running'> {
    const attachments = input.attachments?.length
      ? await this.attachments.files(input.attachments)
      : undefined
    return this.runtimeOf(sessionId).steer(sessionId, { ...input, attachments })
  }
  stageAttachment(input: StageAttachment): Promise<Attachment> {
    return this.attachments.stage(input)
  }
  attachmentPreview(attachment: Attachment): Promise<string | null> {
    return this.attachments.preview(attachment)
  }
  /** The path of a sent attachment, for opening it; refuses one that is gone. */
  async attachmentPath(attachment: Attachment): Promise<string> {
    const [file] = await this.attachments.files([attachment])
    return file.path
  }
  private interrupt(sessionId: string): Promise<void> {
    return this.runtimeOf(sessionId).interrupt(sessionId)
  }
  respond(input: RespondRequest): void {
    this.runtimeOf(input.sessionId).respond(input)
  }
  private archive(sessionId: string): void {
    this.runtimeOf(sessionId).archive(sessionId)
  }
  signIn(): Promise<string> {
    return this.codex.signIn()
  }
  cancelSignIn(): Promise<void> {
    return this.codex.cancelSignIn()
  }
  hasActiveTasks(): boolean {
    return (
      Object.values(this.runtimes).some((r) => r.hasActiveTasks()) ||
      Boolean(this.router?.isRunning())
    )
  }
  close(): void {
    this.automations?.close()
    this.memory?.sweeper.close()
    this.memory?.triggers.close()
    this.memory?.dreaming.close()
    this.github?.watcher.close()
    this.github?.workers.close()
    this.github?.auth.close()
    this.router?.close()
    this.claude.close()
    this.cursor.close()
    // The Codex service closes the shared store last.
    this.codex.close()
  }
}
