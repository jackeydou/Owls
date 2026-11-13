import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { promisify } from 'node:util'
import { z } from 'zod'
import appPackage from '../../../package.json'
import type {
  AgentRequest,
  AppEvent,
  CreateSession,
  CursorConnection,
  RespondRequest,
  SendMessage,
  Session
} from '../../shared/app.js'
import { OwlsError, toFailure } from '../app/errors.js'
import type { OwlsStore } from '../app/store.js'
import { turnDiff } from '../claude/normalize.js'
import { recordSchema, safeText, string } from '../codex/protocol.js'
import type { TurnProfiles } from '../router/service.js'
import { AcpConnection, AcpReplyError, METHOD_NOT_FOUND } from './acp.js'
import { discoverCursorExecutable } from './discovery.js'
import {
  type AskQuestion,
  approvalPolicy,
  approvalRequest,
  askQuestionSchema,
  chooseOption,
  createPlanSchema,
  cursorMode,
  mergeToolCall,
  parseCursorModels,
  parseCursorStatus,
  permissionOptionSchema,
  planRequest,
  questionRequest,
  questionResponse,
  workerPrompt
} from './normalize.js'
import { TurnView } from './projection.js'

const execFileAsync = promisify(execFile)
const active = (s: Session): boolean => ['starting', 'running', 'waiting'].includes(s.status)
/** The ACP version Owls speaks. */
const PROTOCOL_VERSION = 1

const initializeSchema = z.object({
  protocolVersion: z.number().optional(),
  agentCapabilities: z
    .object({
      loadSession: z.boolean().catch(false).default(false),
      sessionCapabilities: z
        .object({ systemPrompt: z.unknown().optional() })
        .loose()
        .catch({})
        .default({})
    })
    .loose()
    .catch({ loadSession: false, sessionCapabilities: {} })
    .default({ loadSession: false, sessionCapabilities: {} }),
  authMethods: z
    .array(z.object({ id: z.string() }).loose())
    .catch([])
    .default([])
})
const modesSchema = z
  .object({
    currentModeId: z.string(),
    availableModes: z.array(z.object({ id: z.string() }).loose()).catch([])
  })
  .nullish()
  .catch(null)
const sessionResultSchema = z.object({
  sessionId: z.string().min(1).optional(),
  modes: modesSchema
})
const promptResultSchema = z.object({ stopReason: z.string() })
const notificationSchema = z.object({
  sessionId: z.string(),
  update: z.object({ sessionUpdate: z.string() }).loose()
})
const permissionSchema = z.object({
  sessionId: z.string(),
  toolCall: z.unknown(),
  options: z.array(permissionOptionSchema)
})

type Runtime = {
  turnId: string
  connection: AcpConnection | null
  /** The agent's session id once the session is created or loaded. */
  acpSessionId: string | null
  /** True while `session/load` replays history that Owls already shows. */
  replaying: boolean
  cancelled: boolean
  stopTimer: ReturnType<typeof setTimeout> | null
  view: TurnView
}
/** A request the agent is waiting on; `answer` turns the user's decision into its result. */
type PendingRequest = {
  sessionId: string
  runtime: Runtime
  resolve: (result: unknown) => void
  answer: (input: RespondRequest) => unknown
  cancelled: unknown
}

/**
 * Runs Cursor agent sessions over the Agent Client Protocol (`agent acp`). Each
 * turn starts its own agent process with the session's model, creates or loads
 * the agent's session, sends one prompt, and stops the process when it ends.
 */
export class CursorService {
  private readonly sessions = new Map<string, Session>()
  private readonly runtimes = new Map<string, Runtime>()
  private readonly requests = new Map<string, PendingRequest>()
  private readonly dirty = new Set<string>()
  /** Sessions whose worktree is being prepared, and whether the user stopped them meanwhile. */
  private readonly preparing = new Map<string, { stopped: boolean }>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private connecting: Promise<CursorConnection> | null = null
  private profiles: TurnProfiles | null = null
  private closed = false
  private connection: CursorConnection = {
    status: 'disconnected',
    executablePath: null,
    version: null,
    account: { kind: 'unknown' },
    models: [],
    error: null
  }
  constructor(
    private readonly store: OwlsStore,
    private readonly emit: (event: AppEvent) => void
  ) {
    for (const session of store.sessions()) {
      if (session.provider !== 'cursor') continue
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
  sessionList(): Session[] {
    this.flush()
    return [...this.sessions.values()]
  }
  connectionState(): CursorConnection {
    return this.connection
  }
  hasActiveTasks(): boolean {
    return [...this.sessions.values()].some(active)
  }
  connect(): Promise<CursorConnection> {
    if (this.connecting) return this.connecting
    if (this.hasActiveTasks())
      throw new OwlsError('busy', 'Stop active tasks before reconnecting Cursor.')
    this.connecting = this.openConnection().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }
  private async openConnection(): Promise<CursorConnection> {
    this.connection = { ...this.connection, status: 'connecting', error: null }
    this.emitConnection()
    try {
      const executable = discoverCursorExecutable(this.store.settings().cursorExecutablePath)
      const version = await this.run(executable, ['--version'], 10_000)
      const account = parseCursorStatus(
        await this.run(executable, ['status', '--format', 'json'], 20_000).catch(() =>
          this.run(executable, ['status'], 20_000)
        )
      )
      // The catalog needs a signed-in account; without one only the default is offered.
      const models =
        account.kind === 'signed-out'
          ? []
          : parseCursorModels(await this.run(executable, ['models'], 30_000).catch(() => ''))
      this.connection = {
        status: 'ready',
        executablePath: executable,
        version: safeText(version.trim().split('\n')[0] ?? '').slice(0, 200),
        account,
        models,
        error: null
      }
    } catch (error) {
      this.connection = {
        ...this.connection,
        status: 'error',
        account: { kind: 'unknown' },
        models: [],
        error: this.failure(error, 'cursor_not_connected')
      }
    }
    this.emitConnection()
    return this.connection
  }
  private async run(executable: string, args: string[], timeout: number): Promise<string> {
    const { stdout } = await execFileAsync(executable, args, {
      timeout,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    })
    return stdout
  }
  /**
   * `worker` marks a session in a worker's worktree of a registered project,
   * which may not exist yet. Cursor has no reasoning effort setting.
   */
  createSession(input: CreateSession, worker?: { projectPath: string }): Session {
    const cwd = worker ? input.cwd : realpathSync(input.cwd)
    const projectPath = worker?.projectPath ?? cwd
    if (!this.store.projects().some((p) => p.path === projectPath))
      throw new OwlsError('project_required', 'Choose a project before starting a task.')
    this.validateModel(input.model)
    const now = new Date().toISOString()
    const session: Session = {
      id: crypto.randomUUID(),
      provider: 'cursor',
      threadId: null,
      title: '',
      cwd,
      model: input.model,
      effort: null,
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
    const executable = this.readyExecutable()
    if (active(session))
      throw new OwlsError('busy', 'Wait for the current task or stop it before sending.')
    this.validateModel(session.model)
    if (!this.store.acceptCommand(input.commandId, session.id, input.text)) return
    const previous = session.status
    session.status = 'starting'
    this.changed(session, true)
    if (!(await this.prepared(session, previous))) return
    const turnId = crypto.randomUUID()
    session.error = null
    session.diff = ''
    session.turnId = turnId
    if (!session.title) session.title = input.text.split('\n')[0].slice(0, 90)
    session.items.push({
      id: input.commandId,
      kind: 'user',
      status: 'completed',
      text: input.text,
      detail: '',
      turnId
    })
    const runtime: Runtime = {
      turnId,
      connection: null,
      acpSessionId: null,
      replaying: false,
      cancelled: false,
      stopTimer: null,
      view: new TurnView(turnId)
    }
    this.runtimes.set(session.id, runtime)
    session.status = 'running'
    this.changed(session, true)
    void this.runTurn(session, runtime, executable, input.text)
  }
  /** ACP has no way to add a message to a running turn, so the caller queues it for the next. */
  steer(sessionId: string, _text: string): 'steered' | 'not_running' {
    this.getSession(sessionId)
    return 'not_running'
  }
  private async runTurn(
    session: Session,
    runtime: Runtime,
    executable: string,
    text: string
  ): Promise<void> {
    const connection = new AcpConnection({
      notification: (method, params) => this.notification(session, runtime, method, params),
      request: (method, params) => this.agentRequest(session, runtime, method, params),
      closed: () => {}
    })
    runtime.connection = connection
    let stopReason: string | null = null
    try {
      connection.start(
        executable,
        [...(session.model ? ['--model', session.model] : []), 'acp'],
        session.cwd
      )
      const init = initializeSchema.parse(
        await connection.request(
          'initialize',
          {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false
            },
            clientInfo: { name: 'owls', title: 'Owls', version: appPackage.version }
          },
          30_000
        )
      )
      if (init.authMethods.some((m) => m.id === 'cursor_login'))
        await connection.request('authenticate', { methodId: 'cursor_login' }, 60_000)
      const profile = this.profiles?.profile(session.id) ?? null
      const instructions = profile ? workerPrompt(profile) : null
      const systemPrompt =
        instructions && init.agentCapabilities.sessionCapabilities.systemPrompt
          ? { systemPrompt: { mode: 'append', content: [{ type: 'text', text: instructions }] } }
          : {}
      const modes = await this.openSession(session, runtime, connection, init, systemPrompt)
      const mode = cursorMode(session.permission)
      if (modes && modes.currentModeId !== mode && modes.availableModes.some((m) => m.id === mode))
        await connection.request(
          'session/set_mode',
          { sessionId: runtime.acpSessionId, modeId: mode },
          30_000
        )
      if (runtime.cancelled) return
      const prompt =
        instructions && !('systemPrompt' in systemPrompt) ? `${instructions}\n\n${text}` : text
      stopReason = promptResultSchema.parse(
        await connection.request(
          'session/prompt',
          { sessionId: runtime.acpSessionId, prompt: [{ type: 'text', text: prompt }] },
          null
        )
      ).stopReason
    } catch (error) {
      if (this.runtimes.get(session.id) === runtime && !runtime.cancelled) {
        const failure = this.failure(error, 'cursor_disconnected')
        const detail = connection.diagnostics()
        session.error = {
          code: failure.code,
          message: [failure.message, detail].filter(Boolean).join('\n').slice(-1000)
        }
      }
    } finally {
      if (runtime.stopTimer) clearTimeout(runtime.stopTimer)
      connection.close()
      if (this.runtimes.get(session.id) === runtime) this.release(session, runtime, stopReason)
    }
  }
  /** Loads the session's earlier conversation, or starts one when there is none to load. */
  private async openSession(
    session: Session,
    runtime: Runtime,
    connection: AcpConnection,
    init: z.infer<typeof initializeSchema>,
    systemPrompt: Record<string, unknown>
  ): Promise<z.infer<typeof modesSchema>> {
    const base = { cwd: session.cwd, mcpServers: [], ...systemPrompt }
    if (session.threadId && init.agentCapabilities.loadSession) {
      runtime.replaying = true
      try {
        const loaded = sessionResultSchema.parse(
          await connection.request(
            'session/load',
            { ...base, sessionId: session.threadId },
            120_000
          )
        )
        runtime.acpSessionId = session.threadId
        return loaded.modes
      } catch {
        // A chat Cursor no longer has starts over, as a lost Claude Code session does.
        if (runtime.cancelled || !this.runtimes.has(session.id)) throw new Error('stopped')
      } finally {
        runtime.replaying = false
      }
    }
    const created = sessionResultSchema.parse(await connection.request('session/new', base, 60_000))
    if (!created.sessionId) throw new OwlsError('protocol_error', 'Cursor did not start a session.')
    runtime.acpSessionId = created.sessionId
    session.threadId = created.sessionId
    this.changed(session, true)
    return created.modes
  }
  /** Ends the session's ownership by this turn. */
  private release(session: Session, runtime: Runtime, stopReason: string | null): void {
    this.runtimes.delete(session.id)
    this.expireRequests(session)
    const outcome: 'completed' | 'failed' | 'interrupted' =
      runtime.cancelled || stopReason === 'cancelled'
        ? 'interrupted'
        : stopReason === null || stopReason === 'refusal'
          ? 'failed'
          : 'completed'
    if (outcome === 'failed' && !session.error)
      session.error =
        stopReason === 'refusal'
          ? { code: 'native_error', message: 'Cursor refused this request.' }
          : { code: 'cursor_disconnected', message: '' }
    if (outcome === 'interrupted') session.error = null
    for (const item of session.items) if (item.status === 'running') item.status = outcome
    session.diff = turnDiff(session.items, runtime.turnId)
    session.status = outcome === 'completed' ? 'idle' : outcome
    session.turnId = null
    this.changed(session, true)
    if (!this.closed)
      this.profiles?.settled(session.id, {
        status: outcome,
        structured: null,
        text: outcome === 'completed' ? runtime.view.lastText : ''
      })
  }
  private notification(session: Session, runtime: Runtime, method: string, params: unknown): void {
    if (this.runtimes.get(session.id) !== runtime || runtime.replaying) return
    const { view } = runtime
    let changed = false
    if (method === 'session/update') {
      const parsed = notificationSchema.safeParse(params)
      if (parsed.success && parsed.data.sessionId === runtime.acpSessionId)
        changed = view.update(session, parsed.data.update)
    } else if (method === 'cursor/update_todos') changed = view.updateTodos(session, params)
    else if (method === 'cursor/task') changed = view.task(session, params)
    if (changed) this.changed(session)
  }
  /** Answers what the agent asks of its client: approvals, questions, and plans. */
  private agentRequest(
    session: Session,
    runtime: Runtime,
    method: string,
    params: unknown
  ): Promise<unknown> {
    const cancelled = { outcome: { outcome: 'cancelled' } }
    if (method === 'session/request_permission') {
      const input = permissionSchema.parse(params)
      if (this.runtimes.get(session.id) !== runtime || runtime.cancelled)
        return Promise.resolve(cancelled)
      const callId = string(recordSchema.catch({}).parse(input.toolCall ?? {}).toolCallId)
      const state = mergeToolCall(runtime.view.tools.get(callId), input.toolCall)
      if (!state) return Promise.resolve(cancelled)
      runtime.view.tools.set(state.id, state)
      const select = (decision: 'allow' | 'reject') => {
        const optionId = chooseOption(input.options, decision)
        return optionId ? { outcome: { outcome: 'selected', optionId } } : cancelled
      }
      const policy = approvalPolicy(session.permission, state, session.cwd)
      if (policy !== 'ask') return Promise.resolve(select(policy))
      return this.ask(session, runtime, approvalRequest(state, runtime.turnId), {
        answer: (reply) => select(reply.decision === 'accept' ? 'allow' : 'reject'),
        cancelled: cancelled
      })
    }
    if (method === 'cursor/ask_question') {
      const input: AskQuestion = askQuestionSchema.parse(params)
      if (this.runtimes.get(session.id) !== runtime || runtime.cancelled)
        return Promise.resolve(cancelled)
      return this.ask(session, runtime, questionRequest(input, runtime.turnId), {
        answer: (reply) =>
          reply.decision === 'accept'
            ? questionResponse(input, reply.answers ?? {})
            : { outcome: { outcome: 'skipped', reason: 'The user declined to answer.' } },
        cancelled
      })
    }
    if (method === 'cursor/create_plan') {
      const input = createPlanSchema.parse(params)
      if (this.runtimes.get(session.id) !== runtime || runtime.cancelled)
        return Promise.resolve(cancelled)
      return this.ask(session, runtime, planRequest(input, runtime.turnId), {
        answer: (reply) =>
          reply.decision === 'accept'
            ? { outcome: { outcome: 'accepted' } }
            : { outcome: { outcome: 'rejected', reason: 'The user rejected the plan.' } },
        cancelled
      })
    }
    // Owls offers no file system or terminal to the agent, so it runs its own tools.
    return Promise.reject(new AcpReplyError(METHOD_NOT_FOUND, `${method} is not supported.`))
  }
  private ask(
    session: Session,
    runtime: Runtime,
    request: AgentRequest,
    handling: Pick<PendingRequest, 'answer' | 'cancelled'>
  ): Promise<unknown> {
    return new Promise((resolve) => {
      this.requests.set(request.id, { sessionId: session.id, runtime, resolve, ...handling })
      session.requests.push(request)
      session.status = 'waiting'
      this.changed(session, true)
    })
  }
  respond(input: RespondRequest): void {
    const session = this.getSession(input.sessionId)
    const pending = this.requests.get(input.requestId)
    const request = session.requests.find((r) => r.id === input.requestId)
    if (!pending || pending.sessionId !== session.id || request?.status !== 'pending')
      throw new OwlsError('request_unavailable', 'This request is no longer available.')
    if (
      input.decision === 'accept' &&
      request.kind === 'question' &&
      request.questions.some((q) => !input.answers?.[q.id]?.some((answer) => answer.trim()))
    )
      throw new OwlsError('answer_required', 'Answer each question before continuing.')
    this.requests.delete(input.requestId)
    request.status = 'resolved'
    pending.resolve(input.decision === 'cancel' ? pending.cancelled : pending.answer(input))
    this.refreshWaiting(session)
    this.changed(session, true)
    if (input.decision === 'cancel') void this.interrupt(session.id).catch(() => {})
  }
  async interrupt(id: string): Promise<void> {
    const session = this.getSession(id)
    const preparing = this.preparing.get(id)
    if (preparing) {
      preparing.stopped = true
      return
    }
    const runtime = this.runtimes.get(id)
    if (!active(session) || !runtime || runtime.cancelled) return
    runtime.cancelled = true
    this.expireRequests(session)
    this.changed(session, true)
    const connection = runtime.connection
    if (!connection) return
    if (!runtime.acpSessionId) {
      connection.close()
      return
    }
    connection.notify('session/cancel', { sessionId: runtime.acpSessionId })
    // Stop the process if the agent does not end the turn after the cancel notification.
    runtime.stopTimer = setTimeout(() => connection.close(), 15_000)
  }
  archive(id: string): void {
    const session = this.getSession(id)
    if (active(session)) throw new OwlsError('busy', 'Stop the task before removing it.')
    this.store.removeSession(id)
    this.sessions.delete(id)
    this.emit({ type: 'removed', sessionId: id })
  }
  /**
   * Creates a Router worker's worktree before the agent starts in it. False when
   * it was stopped meanwhile and the turn must not start.
   */
  private async prepared(session: Session, previous: Session['status']): Promise<boolean> {
    const preparing = { stopped: false }
    this.preparing.set(session.id, preparing)
    try {
      await this.profiles?.prepare(session.id)
    } catch (error) {
      session.status = previous
      this.changed(session, true)
      throw error
    } finally {
      this.preparing.delete(session.id)
    }
    if (!preparing.stopped) return true
    session.status = 'interrupted'
    this.changed(session, true)
    this.profiles?.settled(session.id, { status: 'interrupted', structured: null, text: '' })
    return false
  }
  private expireRequests(session: Session): void {
    for (const request of session.requests) {
      const pending = this.requests.get(request.id)
      if (pending) {
        this.requests.delete(request.id)
        pending.resolve(pending.cancelled)
      }
      if (request.status === 'pending' || request.status === 'answering')
        request.status = 'unavailable'
    }
    this.refreshWaiting(session)
  }
  private refreshWaiting(session: Session): void {
    if (session.status === 'waiting' && !session.requests.some((r) => r.status === 'pending'))
      session.status = 'running'
  }
  private validateModel(model: string | null): void {
    if (!model || !this.connection.models.length) return
    if (!this.connection.models.some((m) => m.id === model))
      throw new OwlsError(
        'model_unavailable',
        'This model is not available in the connected Cursor account.'
      )
  }
  private readyExecutable(): string {
    if (
      this.connection.status !== 'ready' ||
      !this.connection.executablePath ||
      this.connection.account.kind === 'signed-out'
    )
      throw new OwlsError('cursor_not_connected', 'Connect your local Cursor CLI in Settings.')
    return this.connection.executablePath
  }
  private getSession(id: string): Session {
    const session = this.sessions.get(id)
    if (!session) throw new OwlsError('task_not_found', 'Task not found.')
    return session
  }
  private failure(error: unknown, fallback: 'cursor_not_connected' | 'cursor_disconnected') {
    const failure = toFailure(error)
    return failure.code === 'native_error' && !failure.message
      ? { code: fallback, message: '' }
      : failure
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
    this.emit({ type: 'cursor-connection', connection: this.connection })
  }
  /** Stops owned agent processes. The shared store is closed by the host. */
  close(): void {
    if (this.closed) return
    for (const runtime of this.runtimes.values()) {
      runtime.cancelled = true
      runtime.connection?.close()
    }
    this.flush()
    this.closed = true
  }
}
