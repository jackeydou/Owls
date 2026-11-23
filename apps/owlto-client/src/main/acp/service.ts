import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import appPackage from '../../../package.json'
import type {
  AcpAgentConnection,
  AgentRequest,
  AppEvent,
  CreateSession,
  Failure,
  RespondRequest,
  Session
} from '../../shared/app.js'
import { type AgentUsage, unavailableUsage } from '../../shared/usage.js'
import {
  type RuntimeSend,
  type RuntimeTurn,
  type SessionPlace,
  sessionCwd,
  sessionProject,
  type WorkerUsageRecorder
} from '../app/agent-runtime.js'
import { splitAttachments, turnText, userItemFields } from '../app/attachments.js'
import { OwltoError, toFailure } from '../app/errors.js'
import type { OwltoStore } from '../app/store.js'
import { recordSchema, safeText, string } from '../app/values.js'
import { turnDiff } from '../claude/normalize.js'
import { REPORT_SERVER_NAME } from '../router/report.js'
import type { TurnProfiles } from '../router/service.js'
import type { AcpAgent } from './agent.js'
import { AcpConnection, AcpReplyError, METHOD_NOT_FOUND } from './connection.js'
import { discoverExecutable } from './discovery.js'
import {
  approvalPolicy,
  approvalRequest,
  chooseOption,
  mergeToolCall,
  permissionOptionSchema,
  workerPrompt
} from './normalize.js'
import { TurnView } from './projection.js'

const execFileAsync = promisify(execFile)
const active = (s: Session): boolean => ['starting', 'running', 'waiting'].includes(s.status)
/** The ACP version Owlto speaks. */
const PROTOCOL_VERSION = 1

const noCapabilities = {
  loadSession: false,
  mcpCapabilities: { http: false },
  sessionCapabilities: {},
  promptCapabilities: { image: false }
}
/** Keeps an inline image's base64 copy to a size agents accept. */
const ACP_IMAGE_MAX_BYTES = 3_750_000
const initializeSchema = z.object({
  protocolVersion: z.number().optional(),
  agentCapabilities: z
    .object({
      loadSession: z.boolean().catch(false).default(false),
      mcpCapabilities: z
        .object({ http: z.boolean().catch(false).default(false) })
        .loose()
        .catch({ http: false })
        .default({ http: false }),
      sessionCapabilities: z
        .object({ systemPrompt: z.unknown().optional() })
        .loose()
        .catch({})
        .default({}),
      /** Whether a prompt may carry image blocks; text and resource links always work. */
      promptCapabilities: z
        .object({ image: z.boolean().catch(false).default(false) })
        .loose()
        .catch({ image: false })
        .default({ image: false })
    })
    .loose()
    .catch(noCapabilities)
    .default(noCapabilities),
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
/** ACP's draft model picker, sent by agents that let a client choose the session's model. */
const sessionModelsSchema = z
  .object({
    currentModelId: z.string(),
    availableModels: z.array(z.object({ modelId: z.string() }).loose()).catch([])
  })
  .nullish()
  .catch(null)
const configOptionValueSchema = z.object({ value: z.string() }).loose()
/** ACP session config options; only select options are read. */
const configOptionsSchema = z
  .array(
    z
      .object({
        id: z.string(),
        category: z.string().nullish(),
        currentValue: z.unknown().optional(),
        options: z
          .array(
            z.union([
              configOptionValueSchema,
              z.object({ options: z.array(configOptionValueSchema).catch([]) }).loose()
            ])
          )
          .catch([])
          .default([])
      })
      .loose()
  )
  .nullish()
  .catch(null)
export type SessionConfigOption = NonNullable<z.infer<typeof configOptionsSchema>>[number]
const sessionResultSchema = z.object({
  sessionId: z.string().min(1).optional(),
  modes: modesSchema,
  models: sessionModelsSchema,
  configOptions: configOptionsSchema
})
type SessionResult = z.infer<typeof sessionResultSchema>

/** The values a select config option offers, flattened out of any groups. */
function optionValues(option: SessionConfigOption): string[] {
  return option.options.flatMap((entry) =>
    'value' in entry && typeof entry.value === 'string'
      ? [entry.value]
      : 'options' in entry && Array.isArray(entry.options)
        ? entry.options.map((o) => o.value)
        : []
  )
}
/** The config option a session offers for `category`, such as `model` or `thought_level`. */
export function configOption(
  options: SessionConfigOption[] | null | undefined,
  category: string
): SessionConfigOption | null {
  return options?.find((o) => o.category === category || o.id === category) ?? null
}
/** True when `value` is one of the option's choices and not already chosen. */
export function shouldSet(option: SessionConfigOption | null, value: string | null): boolean {
  if (!option || !value || option.currentValue === value) return false
  return optionValues(option).includes(value)
}
const count = z.number().nonnegative().catch(0)
const promptResultSchema = z.object({
  stopReason: z.string(),
  // ACP's draft usage field; sent only by agents that support it.
  usage: z
    .object({
      inputTokens: count,
      outputTokens: count,
      thoughtTokens: count.nullish(),
      cachedReadTokens: count.nullish(),
      cachedWriteTokens: count.nullish()
    })
    .nullish()
    .catch(null)
})
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
  /** True while `session/load` replays history that Owlto already shows. */
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
 * Runs a worker-only agent's sessions over the Agent Client Protocol, such as
 * Cursor (`agent acp`) or Antigravity (`agy acp`); `agent` holds what differs.
 * Each turn starts its own agent process, creates or loads the agent's session,
 * applies the session's model and mode, sends one prompt, and stops the process
 * when it ends.
 */
export class AcpAgentService {
  private readonly sessions = new Map<string, Session>()
  private readonly runtimes = new Map<string, Runtime>()
  private readonly requests = new Map<string, PendingRequest>()
  private readonly dirty = new Set<string>()
  /** Sessions whose worktree is being prepared, and whether the user stopped them meanwhile. */
  private readonly preparing = new Map<string, { stopped: boolean }>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private connecting: Promise<AcpAgentConnection> | null = null
  private profiles: TurnProfiles | null = null
  private recordUsage: WorkerUsageRecorder = () => {}
  private notesFolder: string | null = null
  private closed = false
  private connection: AcpAgentConnection = {
    status: 'disconnected',
    executablePath: null,
    version: null,
    account: { kind: 'unknown' },
    models: [],
    error: null
  }
  constructor(
    private readonly store: OwltoStore,
    private readonly emit: (event: AppEvent) => void,
    private readonly agent: AcpAgent
  ) {
    for (const session of store.sessions()) {
      if (session.provider !== agent.provider) continue
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
  setUsageRecorder(recorder: WorkerUsageRecorder): void {
    this.recordUsage = recorder
  }
  /** The user's notes folder, which sessions may read without asking. */
  setNotesFolder(folder: string): void {
    this.notesFolder = folder
  }
  owns(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }
  sessionList(): Session[] {
    this.flush()
    return [...this.sessions.values()]
  }
  connectionState(): AcpAgentConnection {
    return this.connection
  }
  hasActiveTasks(): boolean {
    return [...this.sessions.values()].some(active)
  }
  connect(): Promise<AcpAgentConnection> {
    if (this.connecting) return this.connecting
    if (this.hasActiveTasks())
      throw new OwltoError('busy', `Stop active tasks before reconnecting ${this.agent.label}.`)
    this.connecting = this.openConnection().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }
  /** Forgets the account until the user connects again; each turn starts its own process. */
  disconnect(): AcpAgentConnection {
    if (this.connecting || this.hasActiveTasks())
      throw new OwltoError('busy', `Stop active tasks before disconnecting ${this.agent.label}.`)
    this.connection = {
      ...this.connection,
      status: 'disconnected',
      account: { kind: 'unknown' },
      models: [],
      error: null
    }
    this.emitConnection()
    return this.connection
  }
  private async openConnection(): Promise<AcpAgentConnection> {
    this.connection = { ...this.connection, status: 'connecting', error: null }
    this.emitConnection()
    try {
      const executable = discoverExecutable(
        this.agent.executablePath(this.store.settings()),
        this.agent.search
      )
      const version = await this.run(executable, ['--version'], 10_000)
      const { account, models } = await this.agent.probe((args, timeout) =>
        this.run(executable, args, timeout)
      )
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
        error: this.failure(error, this.agent.codes.notConnected)
      }
    }
    this.emitConnection()
    return this.connection
  }
  /**
   * Cursor and Antigravity show plan usage only in their interactive terminal
   * screens; neither has a command, JSON output, or ACP method that reports it,
   * so Owlto says so instead of scraping the terminal UI.
   */
  usage(): AgentUsage {
    const { status, account } = this.connection
    const provider = this.agent.provider
    if (status !== 'ready') return unavailableUsage(provider, 'not-connected')
    if (account.kind === 'signed-out') return unavailableUsage(provider, 'signed-out')
    return unavailableUsage(provider, 'not-supported')
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
   * `place` marks a worker session in a worktree of a registered project or in
   * the workspace folder (`SessionPlace`). Effort is kept only for agents with a
   * thinking-level choice; Cursor has none.
   */
  createSession(input: CreateSession, place?: SessionPlace): Session {
    const cwd = sessionCwd(input.cwd, place, this.store.projects())
    this.validateModel(input.model)
    const now = new Date().toISOString()
    const session: Session = {
      id: crypto.randomUUID(),
      provider: this.agent.provider,
      threadId: null,
      title: '',
      cwd,
      projectPath: sessionProject(cwd, place),
      model: input.model,
      effort: this.agent.thoughtLevel ? input.effort : null,
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
  async send(input: RuntimeSend): Promise<void> {
    const session = this.getSession(input.sessionId)
    const executable = this.readyExecutable()
    if (active(session))
      throw new OwltoError('busy', 'Wait for the current task or stop it before sending.')
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
      turnId,
      ...userItemFields(input)
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
    void this.runTurn(session, runtime, executable, input)
  }
  /** ACP has no way to add a message to a running turn, so the caller queues it for the next. */
  steer(sessionId: string, _turn: RuntimeTurn): 'steered' | 'not_running' {
    this.getSession(sessionId)
    return 'not_running'
  }
  private async runTurn(
    session: Session,
    runtime: Runtime,
    executable: string,
    turn: RuntimeTurn
  ): Promise<void> {
    const connection = new AcpConnection(
      {
        notification: (method, params) => this.notification(session, runtime, method, params),
        request: (method, params) => this.agentRequest(session, runtime, method, params),
        closed: () => {}
      },
      { label: this.agent.label, disconnected: this.agent.codes.disconnected }
    )
    runtime.connection = connection
    let stopReason: string | null = null
    try {
      connection.start(executable, this.agent.args(session), session.cwd)
      const init = initializeSchema.parse(
        await connection.request(
          'initialize',
          {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false
            },
            clientInfo: { name: 'owlto', title: 'Owlto', version: appPackage.version }
          },
          30_000
        )
      )
      const authMethod = this.agent.authMethod
      if (authMethod && init.authMethods.some((m) => m.id === authMethod))
        await connection.request('authenticate', { methodId: authMethod }, 60_000)
      const profile = this.profiles?.profile(session.id) ?? null
      // ACP clients may hand an agent HTTP MCP servers only when it advertises them.
      const reportUrl =
        profile && init.agentCapabilities.mcpCapabilities.http
          ? await profile.report.endpoint()
          : null
      const instructions = profile ? workerPrompt(profile, reportUrl !== null) : null
      const systemPrompt =
        instructions && init.agentCapabilities.sessionCapabilities.systemPrompt
          ? { systemPrompt: { mode: 'append', content: [{ type: 'text', text: instructions }] } }
          : {}
      const mcpServers = reportUrl
        ? [{ type: 'http', name: REPORT_SERVER_NAME, url: reportUrl, headers: [] }]
        : []
      const opened = await this.openSession(session, runtime, connection, init, {
        mcpServers,
        ...systemPrompt
      })
      await this.configure(session, runtime, connection, opened)
      if (runtime.cancelled) return
      // An agent without image prompts reads images from disk like any other file.
      const { images, rest } = await splitAttachments(
        turn.attachments,
        init.agentCapabilities.promptCapabilities.image ? ACP_IMAGE_MAX_BYTES : null
      )
      const text = turnText(turn.text, rest)
      const prompt =
        instructions && !('systemPrompt' in systemPrompt) ? `${instructions}\n\n${text}` : text
      const result = promptResultSchema.parse(
        await connection.request(
          'session/prompt',
          {
            sessionId: runtime.acpSessionId,
            prompt: [
              ...(prompt ? [{ type: 'text', text: prompt }] : []),
              ...images.map((image) => ({
                type: 'image',
                mimeType: image.mimeType,
                data: image.data
              }))
            ]
          },
          null
        )
      )
      stopReason = result.stopReason
      if (result.usage) {
        const cacheRead = result.usage.cachedReadTokens ?? 0
        const cacheWrite = result.usage.cachedWriteTokens ?? 0
        this.recordUsage(session.id, {
          model: session.model,
          // ACP counts cached tokens inside the input total.
          input: Math.max(0, result.usage.inputTokens - cacheRead - cacheWrite),
          output: result.usage.outputTokens,
          cacheRead,
          cacheWrite,
          reasoning: result.usage.thoughtTokens ?? 0,
          costUsd: null
        })
      }
    } catch (error) {
      if (this.runtimes.get(session.id) === runtime && !runtime.cancelled) {
        const failure = this.failure(error, this.agent.codes.disconnected)
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
    options: { mcpServers: unknown[] } & Record<string, unknown>
  ): Promise<SessionResult> {
    const base = { cwd: session.cwd, ...options }
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
        return loaded
      } catch {
        // A chat the agent no longer has starts over, as a lost Claude Code session does.
        if (runtime.cancelled || !this.runtimes.has(session.id)) throw new Error('stopped')
      } finally {
        runtime.replaying = false
      }
    }
    const created = sessionResultSchema.parse(await connection.request('session/new', base, 60_000))
    if (!created.sessionId)
      throw new OwltoError('protocol_error', `${this.agent.label} did not start a session.`)
    runtime.acpSessionId = created.sessionId
    session.threadId = created.sessionId
    this.changed(session, true)
    return created
  }
  /**
   * Applies the session's permission mode, and its model and thinking level when
   * the agent lets a client choose them in the session (ACP config options, or
   * the draft model picker) rather than on its command line.
   */
  private async configure(
    session: Session,
    runtime: Runtime,
    connection: AcpConnection,
    opened: SessionResult
  ): Promise<void> {
    const sessionId = runtime.acpSessionId
    const mode = this.agent.mode(session.permission)
    const { modes, models, configOptions } = opened
    if (
      mode &&
      modes &&
      modes.currentModeId !== mode &&
      modes.availableModes.some((m) => m.id === mode)
    )
      await connection.request('session/set_mode', { sessionId, modeId: mode }, 30_000)
    const modelOption = configOption(configOptions, 'model')
    if (shouldSet(modelOption, session.model))
      await connection.request(
        'session/set_config_option',
        { sessionId, configId: modelOption?.id, value: session.model },
        30_000
      )
    else if (
      !modelOption &&
      session.model &&
      models &&
      models.currentModelId !== session.model &&
      models.availableModels.some((m) => m.modelId === session.model)
    )
      await connection.request('session/set_model', { sessionId, modelId: session.model }, 30_000)
    const level = session.effort ? (this.agent.thoughtLevel?.(session.effort) ?? null) : null
    const levelOption = configOption(configOptions, 'thought_level')
    if (shouldSet(levelOption, level))
      await connection.request(
        'session/set_config_option',
        { sessionId, configId: levelOption?.id, value: level },
        30_000
      )
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
          ? { code: 'native_error', message: `${this.agent.label} refused this request.` }
          : { code: this.agent.codes.disconnected, message: '' }
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
    } else if (this.agent.extensions)
      changed = this.agent.extensions.notification(view, session, method, params)
    if (changed) this.changed(session)
  }
  /** Answers what the agent asks of its client: approvals, and its own extensions' questions. */
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
      const readable = this.notesFolder ? [this.notesFolder] : []
      const policy = approvalPolicy(session.permission, state, session.cwd, readable)
      if (policy !== 'ask') return Promise.resolve(select(policy))
      return this.ask(session, runtime, approvalRequest(state, runtime.turnId), {
        answer: (reply) => select(reply.decision === 'accept' ? 'allow' : 'reject'),
        cancelled: cancelled
      })
    }
    // An extension's question to a turn that already ended is answered as cancelled.
    const extension = this.agent.extensions?.request(
      method,
      params,
      runtime.turnId,
      (request, handling) =>
        this.runtimes.get(session.id) === runtime && !runtime.cancelled
          ? this.ask(session, runtime, request, handling)
          : Promise.resolve(cancelled),
      cancelled
    )
    if (extension) return extension
    // Owlto offers no file system or terminal to the agent, so it runs its own tools.
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
      throw new OwltoError('request_unavailable', 'This request is no longer available.')
    if (
      input.decision === 'accept' &&
      request.kind === 'question' &&
      request.questions.some((q) => !input.answers?.[q.id]?.some((answer) => answer.trim()))
    )
      throw new OwltoError('answer_required', 'Answer each question before continuing.')
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
    if (active(session)) throw new OwltoError('busy', 'Stop the task before removing it.')
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
      throw new OwltoError(
        'model_unavailable',
        `This model is not available in the connected ${this.agent.label} account.`
      )
  }
  private readyExecutable(): string {
    if (
      this.connection.status !== 'ready' ||
      !this.connection.executablePath ||
      this.connection.account.kind === 'signed-out'
    )
      throw new OwltoError(
        this.agent.codes.notConnected,
        `Connect your local ${this.agent.label} CLI in Settings.`
      )
    return this.connection.executablePath
  }
  private getSession(id: string): Session {
    const session = this.sessions.get(id)
    if (!session) throw new OwltoError('task_not_found', 'Task not found.')
    return session
  }
  private failure(error: unknown, fallback: Failure['code']) {
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
    this.emit(this.agent.connectionEvent(this.connection))
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
