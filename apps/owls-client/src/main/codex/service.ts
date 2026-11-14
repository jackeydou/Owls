import { execFile } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type {
  AgentRequest,
  AppEvent,
  AppSettings,
  AppSnapshot,
  CodexConnection,
  CreateSession,
  Failure,
  Project,
  RespondRequest,
  SendMessage,
  Session
} from '../../shared/app.js'
import { questionSchema } from '../../shared/app.js'
import { defaultProjectSettings, type SaveProject } from '../../shared/projects.js'
import { type AgentUsage, unavailableUsage } from '../../shared/usage.js'
import { type SessionPlace, sessionCwd } from '../app/agent-runtime.js'
import { OwlsError, toFailure } from '../app/errors.js'
import type { OwlsStore } from '../app/store.js'
import {
  CODEX_REPORT_TOOL_NAME,
  REPORT_TOOL_DESCRIPTION,
  REPORT_TOOL_INPUT_SCHEMA
} from '../router/report.js'
import type { TurnOutcome, TurnProfiles } from '../router/service.js'
import { CodexClient, discoverExecutable } from './client.js'
import {
  normalizeItem,
  parseModels,
  type RpcFrame,
  record,
  recordSchema,
  safeText,
  string
} from './protocol.js'
import { parseCodexRateLimits } from './usage.js'

const execFileAsync = promisify(execFile)
const active = (s: Session): boolean => ['starting', 'running', 'waiting'].includes(s.status)
const CODEX_REPORT_TOOL = {
  type: 'function',
  name: CODEX_REPORT_TOOL_NAME,
  description: REPORT_TOOL_DESCRIPTION,
  inputSchema: REPORT_TOOL_INPUT_SCHEMA
}
type PendingRequest = {
  wireId: string | number
  sessionId: string
  method: string
  params: Record<string, unknown>
}
export class CodexService {
  private readonly sessions = new Map<string, Session>()
  private readonly loaded = new Set<string>()
  private readonly requests = new Map<string, PendingRequest>()
  private readonly cancelled = new Set<string>()
  private readonly interruptions = new Map<string, Promise<void>>()
  private readonly dirty = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private client: CodexClient | null = null
  private connecting: Promise<CodexConnection> | null = null
  private loginId: string | null = null
  private profiles: TurnProfiles | null = null
  private closed = false
  private connection: CodexConnection = {
    status: 'disconnected',
    executablePath: null,
    version: null,
    account: { kind: 'signed-out' },
    models: [],
    error: null
  }
  constructor(
    private readonly store: OwlsStore,
    private readonly emit: (event: AppEvent) => void
  ) {
    for (const session of store.sessions()) {
      if (session.provider !== 'codex') continue
      if (active(session)) {
        session.status = 'interrupted'
        session.error = { code: 'interrupted', message: '' }
        session.turnId = null
      }
      for (const request of session.requests) {
        if (request.status === 'pending' || request.status === 'answering')
          request.status = 'unavailable'
      }
      for (const item of session.items) {
        if (item.status === 'running') item.status = 'interrupted'
      }
      this.sessions.set(session.id, session)
      this.store.saveSession(session)
    }
  }
  /** Lets the Router give each worker turn its instructions and report format. */
  setTurnProfiles(profiles: TurnProfiles): void {
    this.profiles = profiles
  }
  owns(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }
  snapshot(): Omit<AppSnapshot, 'claude' | 'cursor' | 'github' | 'routers' | 'workers'> {
    this.flush()
    return {
      sessions: [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      projects: this.store.projects(),
      settings: this.store.settings(),
      connection: this.connection
    }
  }
  connectionState(): CodexConnection {
    return this.connection
  }
  connect(): Promise<CodexConnection> {
    if (this.connecting) return this.connecting
    if ([...this.sessions.values()].some(active))
      throw new OwlsError('busy', 'Stop active tasks before reconnecting Codex.')
    this.connecting = this.openConnection().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }
  private async openConnection(): Promise<CodexConnection> {
    this.client?.stop()
    this.loaded.clear()
    this.connection = { ...this.connection, status: 'connecting', error: null }
    this.emitConnection()
    try {
      const executable = discoverExecutable(this.store.settings().executablePath)
      const { stdout } = await execFileAsync(executable, ['--version'], {
        timeout: 10_000,
        maxBuffer: 4096,
        windowsHide: true
      })
      const client = new CodexClient(
        (frame) => this.onFrame(frame),
        (reason) => this.disconnected(reason)
      )
      this.client = client
      // Worker threads get the report tool as a dynamic tool, which needs the experimental API (F6).
      await client.start(executable, { experimentalApi: true })
      this.connection = {
        ...this.connection,
        executablePath: executable,
        version: stdout.trim(),
        status: 'ready'
      }
      await this.refreshAccount()
      return this.connection
    } catch (error) {
      this.client?.stop()
      this.connection = {
        ...this.connection,
        status: 'error',
        account: { kind: 'signed-out' },
        models: [],
        error: this.errorText(error)
      }
      this.emitConnection()
      return this.connection
    }
  }
  saveSettings(settings: AppSettings): AppSettings {
    if (
      settings.executablePath !== this.store.settings().executablePath &&
      [...this.sessions.values()].some(active)
    ) {
      throw new OwlsError('busy', 'Stop active tasks before changing the Codex executable.')
    }
    return this.store.saveSettings(settings)
  }
  addProject(path: string) {
    const canonical = realpathSync(path)
    if (!statSync(canonical).isDirectory())
      throw new OwlsError('project_required', 'Select a project directory.')
    const existing = this.store.projects().find((p) => p.path === canonical)
    if (existing) return existing
    const project: Project = {
      id: crypto.randomUUID(),
      name: basename(canonical),
      path: canonical,
      settings: defaultProjectSettings
    }
    this.store.saveProject(project)
    return project
  }
  /** Renames a project and replaces its settings; its id and path never change. */
  saveProject(input: SaveProject): Project {
    const existing = this.store.projects().find((p) => p.id === input.id)
    if (!existing) throw new OwlsError('project_required', 'This project no longer exists.')
    const project: Project = { ...existing, name: input.name, settings: input.settings }
    this.store.saveProject(project)
    return project
  }
  /**
   * `place` marks a worker session in a worktree of a registered project or in
   * the workspace folder (`SessionPlace`).
   */
  createSession(input: CreateSession, place?: SessionPlace): Session {
    const cwd = sessionCwd(input.cwd, place, this.store.projects())
    this.validateSelection(input.model, input.effort)
    const now = new Date().toISOString()
    const session: Session = {
      id: crypto.randomUUID(),
      provider: 'codex',
      threadId: null,
      title: '',
      cwd,
      model: input.model,
      effort: input.effort,
      permission: input.permission,
      status: 'idle',
      turnId: null,
      error: null,
      items: [],
      requests: [],
      diff: '',
      tokens: null,
      createdAt: now,
      updatedAt: now
    }
    this.sessions.set(session.id, session)
    this.changed(session, true)
    return session
  }
  async send(input: SendMessage): Promise<void> {
    const session = this.getSession(input.sessionId)
    const client = this.readyClient()
    if (active(session))
      throw new OwlsError('busy', 'Wait for the current task or stop it before sending.')
    this.validateSelection(session.model, session.effort)
    if (!this.store.acceptCommand(input.commandId, session.id, input.text)) return
    const previous = session.status
    session.status = 'starting'
    // A stopped turn's id would send interrupt() to that turn instead.
    session.turnId = null
    this.changed(session, true)
    const writableRoots = await this.prepared(session, previous)
    if (!writableRoots) return
    session.error = null
    session.diff = ''
    if (!session.title) session.title = input.text.split('\n')[0].slice(0, 90)
    session.items.push({
      id: input.commandId,
      kind: 'user',
      status: 'completed',
      text: input.text,
      detail: '',
      turnId: null
    })
    this.changed(session, true)
    const profile = this.profiles?.profile(session.id) ?? null
    try {
      const policy = {
        cwd: session.cwd,
        model: session.model,
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandbox: session.permission === 'full-access' ? 'danger-full-access' : session.permission,
        // A dotted key adds to the user's `sandbox_workspace_write` settings
        // (such as network access) instead of replacing them.
        ...(session.permission === 'workspace-write' && writableRoots.length
          ? { config: { 'sandbox_workspace_write.writable_roots': writableRoots } }
          : {}),
        ...(profile ? { developerInstructions: profile.instructions } : {})
      }
      if (!session.threadId) {
        const response = record(
          await client.request('thread/start', {
            ...policy,
            ephemeral: false,
            // Stored with the thread, so later turns and resumes keep the tool (F7, F26).
            ...(profile ? { dynamicTools: [CODEX_REPORT_TOOL] } : {})
          })
        )
        const thread = record(response.thread)
        session.threadId = z.string().parse(thread.id)
        this.loaded.add(session.id)
        this.changed(session, true)
      } else if (!this.loaded.has(session.id)) {
        await client.request('thread/resume', {
          ...policy,
          threadId: session.threadId,
          excludeTurns: true
        })
        this.loaded.add(session.id)
      }
      if (this.cancelled.delete(session.id)) {
        session.status = 'interrupted'
        this.changed(session, true)
        this.reportTurn(session, 'interrupted', null)
        return
      }
      const response = record(
        await client.request('turn/start', {
          threadId: session.threadId,
          clientUserMessageId: input.commandId,
          input: [{ type: 'text', text: input.text, text_elements: [] }],
          ...(session.model ? { model: session.model } : {}),
          ...(session.effort ? { effort: session.effort } : {})
        })
      )
      const turn = record(response.turn)
      if (active(session)) {
        session.turnId = z.string().parse(turn.id)
        if (session.status === 'starting') session.status = 'running'
      }
      if (this.cancelled.has(session.id) && session.turnId) {
        await this.interrupt(session.id)
      }
      this.changed(session, true)
    } catch (error) {
      session.status = 'failed'
      session.error = this.errorText(error)
      this.settle(session, 'failed')
      this.changed(session, true)
      this.reportTurn(session, 'failed', null)
      throw new OwlsError(session.error.code, session.error.message)
    }
  }
  /** Adds a message to the running turn with `turn/steer`; not_running when there is none. */
  async steer(sessionId: string, text: string): Promise<'steered' | 'not_running'> {
    const session = this.getSession(sessionId)
    if (!active(session) || !session.threadId || !session.turnId || this.cancelled.has(sessionId))
      return 'not_running'
    try {
      await this.readyClient().request('turn/steer', {
        threadId: session.threadId,
        expectedTurnId: session.turnId,
        input: [{ type: 'text', text, text_elements: [] }]
      })
    } catch {
      // A stale turn id or a finished turn: the caller starts a new turn instead.
      return 'not_running'
    }
    return 'steered'
  }
  async interrupt(id: string): Promise<void> {
    const session = this.getSession(id)
    if (!active(session)) return
    this.cancelled.add(id)
    if (session.threadId && session.turnId) {
      const existing = this.interruptions.get(id)
      if (existing) return existing
      const pending = this.readyClient()
        .request('turn/interrupt', {
          threadId: session.threadId,
          turnId: session.turnId
        })
        .then(() => {
          this.cancelled.delete(id)
        })
        .finally(() => {
          this.interruptions.delete(id)
        })
      this.interruptions.set(id, pending)
      await pending
    }
  }
  respond(input: RespondRequest): void {
    const session = this.getSession(input.sessionId)
    const pending = this.requests.get(input.requestId)
    const request = session.requests.find((r) => r.id === input.requestId)
    if (!pending || pending.sessionId !== session.id || request?.status !== 'pending') {
      throw new OwlsError('request_unavailable', 'This request is no longer available.')
    }
    let result: unknown
    if (request.kind === 'question') {
      const answers = input.answers ?? {}
      if (input.decision === 'accept') {
        for (const question of request.questions) {
          if (!answers[question.id]?.some((answer) => answer.trim()))
            throw new OwlsError('answer_required', 'Answer each question before continuing.')
        }
      }
      result = {
        answers: Object.fromEntries(
          Object.entries(answers).map(([id, values]) => [id, { answers: values }])
        )
      }
    } else if (request.kind === 'permissions') {
      result = {
        permissions: input.decision === 'accept' ? pending.params.permissions : {},
        scope: 'turn'
      }
    } else result = { decision: input.decision }
    this.readyClient().respond(pending.wireId, result)
    request.status = 'answering'
    this.changed(session, true)
    if (input.decision === 'cancel') void this.interrupt(session.id).catch(() => {})
  }
  archive(id: string): void {
    const session = this.getSession(id)
    if (active(session)) throw new OwlsError('busy', 'Stop the task before removing it.')
    this.store.removeSession(id)
    this.sessions.delete(id)
    this.loaded.delete(id)
    this.emit({ type: 'removed', sessionId: id })
  }
  async signIn(): Promise<string> {
    const response = record(
      await this.readyClient().request('account/login/start', { type: 'chatgpt' })
    )
    this.loginId = z.string().parse(response.loginId)
    const url = new URL(z.string().parse(response.authUrl))
    if (url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com'].includes(url.hostname)) {
      throw new OwlsError('unsupported_login', 'Codex returned an unsupported sign-in URL.')
    }
    return url.href
  }
  async cancelSignIn(): Promise<void> {
    if (this.loginId)
      await this.readyClient().request('account/login/cancel', { loginId: this.loginId })
    this.loginId = null
  }
  /**
   * The ChatGPT plan's rate-limit windows and credits from the app-server.
   * API-key accounts bill per request and have no windows.
   */
  async usage(): Promise<AgentUsage> {
    const { status, account } = this.connection
    if (status !== 'ready' || !this.client) return unavailableUsage('codex', 'not-connected')
    if (account.kind === 'signed-out') return unavailableUsage('codex', 'signed-out')
    if (account.kind === 'api-key') return unavailableUsage('codex', 'api-key')
    if (account.kind === 'external') return unavailableUsage('codex', 'no-plan-limits')
    try {
      return parseCodexRateLimits(
        // The method takes no params; the app-server rejects `{}` for a unit request.
        await this.client.request('account/rateLimits/read', null),
        account.plan
      )
    } catch {
      return unavailableUsage('codex', 'failed', account.plan)
    }
  }
  private async refreshAccount(): Promise<void> {
    const client = this.client
    if (!client) return
    const response = record(await client.request('account/read', { refreshToken: false }))
    const account = response.account === null ? null : record(response.account)
    this.connection.account = !account
      ? response.requiresOpenaiAuth === false
        ? { kind: 'external' }
        : { kind: 'signed-out' }
      : account.type === 'chatgpt'
        ? {
            kind: 'chatgpt',
            email: string(account.email) || null,
            plan: string(account.planType) || null
          }
        : account.type === 'apiKey'
          ? { kind: 'api-key' }
          : { kind: 'external' }
    if (this.connection.account.kind !== 'signed-out') {
      this.connection.models = parseModels(
        await client.request('model/list', { limit: 100, includeHidden: false })
      )
    } else this.connection.models = []
    this.emitConnection()
  }
  private onFrame(frame: RpcFrame): void {
    const params = frame.params ?? {}
    if (frame.method === 'account/updated' || frame.method === 'account/login/completed') {
      if (frame.method === 'account/login/completed') this.loginId = null
      void this.refreshAccount().catch((error) => {
        this.connection.error = this.errorText(error)
        this.emitConnection()
      })
      return
    }
    const session = [...this.sessions.values()].find((s) => s.threadId === params.threadId)
    if (!session) {
      if (frame.id !== undefined) this.client?.reject(frame.id)
      return
    }
    if (frame.id !== undefined) {
      if (frame.method === 'item/tool/call') this.callTool(session, frame)
      else this.openRequest(session, frame)
      return
    }
    const turnId = string(params.turnId, session.turnId ?? '')
    switch (frame.method) {
      case 'turn/started': {
        const turn = record(params.turn)
        session.turnId = z.string().parse(turn.id)
        session.status = 'running'
        if (this.cancelled.has(session.id)) void this.interrupt(session.id).catch(() => {})
        break
      }
      case 'item/started':
      case 'item/completed': {
        const native = record(params.item)
        const item = normalizeItem(native, turnId || null, frame.method === 'item/completed')
        if (item.kind === 'user' && typeof native.clientId === 'string') {
          session.items = session.items.filter((i) => i.id !== native.clientId || i.id === item.id)
        }
        const existing = session.items.findIndex((i) => i.id === item.id)
        if (existing >= 0) {
          const previous = session.items[existing]
          session.items[existing] = {
            ...item,
            text: item.text || previous.text,
            detail: item.detail || previous.detail
          }
        } else session.items.push(item)
        break
      }
      case 'item/agentMessage/delta':
      case 'item/reasoning/summaryTextDelta':
      case 'item/plan/delta':
      case 'item/commandExecution/outputDelta': {
        const id = z.string().parse(params.itemId)
        let item = session.items.find((i) => i.id === id)
        if (!item) {
          item = {
            id,
            kind: frame.method.includes('reasoning')
              ? 'reasoning'
              : frame.method.includes('commandExecution')
                ? 'command'
                : frame.method.includes('plan')
                  ? 'plan'
                  : 'assistant',
            status: 'running',
            text: '',
            detail: '',
            turnId: turnId || null
          }
          session.items.push(item)
        }
        const delta = safeText(params.delta)
        if (item.kind === 'command') item.detail = (item.detail + delta).slice(-100_000)
        else item.text += delta
        break
      }
      case 'turn/plan/updated': {
        const steps = z.array(recordSchema).parse(params.plan)
        const item = {
          id: `plan-${turnId}`,
          kind: 'plan' as const,
          status: 'running' as const,
          text: steps
            .map((step) => (step.status === 'completed' ? '✓ ' : '• ') + string(step.step))
            .join('\n'),
          detail: safeText(params.explanation),
          turnId: turnId || null
        }
        const existing = session.items.findIndex((i) => i.id === item.id)
        if (existing >= 0) session.items[existing] = item
        else session.items.push(item)
        break
      }
      case 'turn/diff/updated':
        session.diff = safeText(params.diff).slice(0, 500_000)
        break
      case 'thread/tokenUsage/updated': {
        const usage = record(params.tokenUsage)
        const total = record(usage.total)
        session.tokens = z.number().parse(total.totalTokens)
        break
      }
      case 'turn/completed': {
        const turn = record(params.turn)
        const completedTurn = string(turn.id, turnId)
        session.status =
          turn.status === 'failed'
            ? 'failed'
            : turn.status === 'interrupted'
              ? 'interrupted'
              : 'idle'
        session.error = turn.error
          ? { code: 'native_error', message: safeText(record(turn.error).message) }
          : null
        this.settle(
          session,
          session.status === 'failed'
            ? 'failed'
            : session.status === 'interrupted'
              ? 'interrupted'
              : 'completed'
        )
        session.turnId = null
        this.cancelled.delete(session.id)
        this.changed(session, true)
        this.reportTurn(
          session,
          session.status === 'failed'
            ? 'failed'
            : session.status === 'interrupted'
              ? 'interrupted'
              : 'completed',
          completedTurn
        )
        return
      }
      case 'serverRequest/resolved': {
        for (const [id, pending] of this.requests) {
          if (pending.wireId === params.requestId) {
            const request = session.requests.find((r) => r.id === id)
            if (request) request.status = 'resolved'
            this.requests.delete(id)
          }
        }
        if (
          session.status === 'waiting' &&
          !session.requests.some((r) => r.status === 'pending' || r.status === 'answering')
        )
          session.status = 'running'
        break
      }
      case 'error':
        session.error = { code: 'native_error', message: safeText(record(params.error).message) }
        break
      default:
        return
    }
    this.changed(session)
  }
  /** Answers a dynamic tool call; the worker report tool is the only one Owls registers. */
  private callTool(session: Session, frame: RpcFrame): void {
    if (frame.id === undefined) return
    const params = frame.params ?? {}
    const profile = this.profiles?.profile(session.id) ?? null
    const result =
      profile && params.tool === CODEX_REPORT_TOOL_NAME
        ? profile.report.call(params.arguments)
        : { ok: false, text: 'This tool is not available.' }
    this.client?.respond(frame.id, {
      success: result.ok,
      contentItems: [{ type: 'inputText', text: result.text }]
    })
  }
  private openRequest(session: Session, frame: RpcFrame): void {
    if (frame.id === undefined || !frame.method) return
    const params = frame.params ?? {}
    const kind =
      frame.method === 'item/commandExecution/requestApproval'
        ? 'command'
        : frame.method === 'item/fileChange/requestApproval'
          ? 'files'
          : frame.method === 'item/permissions/requestApproval'
            ? 'permissions'
            : frame.method === 'item/tool/requestUserInput'
              ? 'question'
              : null
    if (!kind) {
      this.client?.reject(frame.id)
      return
    }
    const id = crypto.randomUUID()
    const request: AgentRequest = {
      id,
      kind,
      title: safeText(params.command ?? params.reason),
      detail:
        kind === 'permissions'
          ? safeText(JSON.stringify(params.permissions))
          : safeText(params.reason),
      questions: kind === 'question' ? z.array(questionSchema).parse(params.questions) : [],
      status: 'pending',
      turnId: z.string().parse(params.turnId)
    }
    this.requests.set(id, { wireId: frame.id, sessionId: session.id, method: frame.method, params })
    session.requests.push(request)
    if (kind !== 'question' || params.isBlocking !== false) session.status = 'waiting'
    this.changed(session, true)
  }
  private settle(session: Session, status: 'completed' | 'failed' | 'interrupted'): void {
    for (const item of session.items) if (item.status === 'running') item.status = status
    for (const request of session.requests) {
      if (request.status === 'pending' || request.status === 'answering')
        request.status = 'unavailable'
      this.requests.delete(request.id)
    }
  }
  private disconnected(reason: string): void {
    this.loaded.clear()
    this.requests.clear()
    for (const session of this.sessions.values()) {
      if (!active(session)) continue
      session.status = 'interrupted'
      session.error = { code: 'disconnected', message: reason }
      session.turnId = null
      this.settle(session, 'interrupted')
      this.changed(session, true)
      this.reportTurn(session, 'interrupted', null)
    }
    this.connection = {
      ...this.connection,
      status: 'disconnected',
      error: { code: 'disconnected', message: reason }
    }
    this.emitConnection()
  }
  /**
   * Creates a Router worker's worktree before the agent starts in it. The session
   * is already starting, so it can be stopped but not removed meanwhile.
   * Returns the directories outside `cwd` the agent may also write, or null
   * when it was stopped or lost its connection and the turn must not start.
   */
  private async prepared(session: Session, previous: Session['status']): Promise<string[] | null> {
    let writableRoots: string[]
    try {
      writableRoots = (await this.profiles?.prepare(session.id)) ?? []
    } catch (error) {
      this.cancelled.delete(session.id)
      if (session.status === 'starting') {
        session.status = previous
        this.changed(session, true)
      }
      throw error
    }
    const stopped = this.cancelled.delete(session.id)
    // disconnected() already ended and reported it.
    if (session.status !== 'starting') return null
    if (!stopped) return writableRoots
    session.status = 'interrupted'
    this.changed(session, true)
    this.reportTurn(session, 'interrupted', null)
    return null
  }
  /** Tells the Router how a worker's turn ended; the report is the turn's final message. */
  private reportTurn(session: Session, status: TurnOutcome['status'], turnId: string | null): void {
    if (!this.profiles || this.closed) return
    const text =
      session.items.findLast((i) => i.kind === 'assistant' && (!turnId || i.turnId === turnId))
        ?.text ?? ''
    this.profiles.settled(session.id, { status, structured: null, text })
  }
  private validateSelection(model: string | null, effort: Session['effort']): void {
    if (!model && effort)
      throw new OwlsError(
        'effort_unavailable',
        'Choose a model before selecting its reasoning effort.'
      )
    if (!model) return
    const entry = this.connection.models.find((m) => m.id === model)
    if (!entry)
      throw new OwlsError(
        'model_unavailable',
        'This model is not available in the connected Codex account.'
      )
    if (effort && !entry.efforts.includes(effort))
      throw new OwlsError(
        'effort_unavailable',
        'This reasoning effort is not supported by the selected model.'
      )
  }
  private readyClient(): CodexClient {
    if (!this.client || this.connection.status !== 'ready')
      throw new OwlsError('not_connected', 'Connect your local Codex installation in Settings.')
    return this.client
  }
  private getSession(id: string): Session {
    const session = this.sessions.get(id)
    if (!session) throw new OwlsError('task_not_found', 'Task not found.')
    return session
  }
  private changed(session: Session, immediate = false): void {
    if (this.closed) return
    session.updatedAt = new Date().toISOString()
    this.dirty.add(session.id)
    if (immediate) this.flush()
    else if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 70)
  }
  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    for (const id of this.dirty) {
      const session = this.sessions.get(id)
      if (!session) continue
      this.store.saveSession(session)
      this.emit({ type: 'session', session })
    }
    this.dirty.clear()
  }
  private emitConnection(): void {
    this.emit({ type: 'connection', connection: this.connection })
  }
  private errorText(error: unknown): Failure {
    return toFailure(error)
  }
  hasActiveTasks(): boolean {
    return [...this.sessions.values()].some(active)
  }
  close(): void {
    if (this.closed) return
    this.client?.stop()
    this.flush()
    this.closed = true
    this.store.close()
  }
}
