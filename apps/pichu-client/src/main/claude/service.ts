import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type {
  CanUseTool,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk/core'
import { z } from 'zod'
import type {
  ClaudeConnection,
  CodexEvent,
  CodexItem,
  CodexSession,
  CreateCodexSession,
  RespondCodexRequest,
  SendCodexMessage
} from '../../shared/codex.js'
import { CodexRuntimeError, codexFailure } from '../codex/errors.js'
import { record, recordSchema, safeText, string } from '../codex/protocol.js'
import type { CodexStore } from '../codex/store.js'
import type { TurnProfiles } from '../router/service.js'
import { discoverClaudeExecutable } from './discovery.js'
import { type InputStream, inputStream } from './input.js'
import {
  claudeEffortSchema,
  completeToolItem,
  parseClaudeAccount,
  parseClaudeModels,
  permissionOptions,
  permissionRequest,
  questionAnswers,
  toolItem,
  toolResultText,
  turnDiff
} from './normalize.js'

const execFileAsync = promisify(execFile)
const active = (s: CodexSession): boolean => ['starting', 'running', 'waiting'].includes(s.status)

/** The subset of the Agent SDK this service uses; injected so tests can replace it. */
export type ClaudeSdk = {
  query(params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }): Query
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CodexRuntimeError('claude_disconnected', message)), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

type Runtime = {
  turnId: string
  input: InputStream
  abort: AbortController
  query: Query | null
  cancelled: boolean
  stderr: string
  /** Streaming item ids per API message, waiting to be finalized by the full message. */
  streamed: Map<string, string[]>
  blocks: Map<number, string>
  messageId: string | null
  stopTimer: ReturnType<typeof setTimeout> | null
  /** The result's structured output and text, reported to the Router for worker tasks. */
  structured: unknown
  resultText: string
}
type PendingPermission = {
  sessionId: string
  input: Record<string, unknown>
  resolve: (result: PermissionResult) => void
}

export class ClaudeService {
  private readonly sessions = new Map<string, CodexSession>()
  private readonly runtimes = new Map<string, Runtime>()
  private readonly permissions = new Map<string, PendingPermission>()
  private readonly dirty = new Set<string>()
  /** Sessions whose worktree is being prepared, and whether the user stopped them meanwhile. */
  private readonly preparing = new Map<string, { stopped: boolean }>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private connecting: Promise<ClaudeConnection> | null = null
  private profiles: TurnProfiles | null = null
  private closed = false
  private connection: ClaudeConnection = {
    status: 'disconnected',
    executablePath: null,
    version: null,
    account: { kind: 'unknown' },
    models: [],
    error: null
  }
  constructor(
    private readonly store: CodexStore,
    private readonly emit: (event: CodexEvent) => void,
    private readonly sdk: ClaudeSdk
  ) {
    for (const session of store.sessions()) {
      if (session.provider !== 'claude-code') continue
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
  sessionList(): CodexSession[] {
    this.flush()
    return [...this.sessions.values()]
  }
  connectionState(): ClaudeConnection {
    return this.connection
  }
  hasActiveTasks(): boolean {
    return [...this.sessions.values()].some(active)
  }
  connect(): Promise<ClaudeConnection> {
    if (this.connecting) return this.connecting
    if (this.hasActiveTasks())
      throw new CodexRuntimeError('busy', 'Stop active tasks before reconnecting Claude Code.')
    this.connecting = this.openConnection().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }
  private async openConnection(): Promise<ClaudeConnection> {
    this.connection = { ...this.connection, status: 'connecting', error: null }
    this.emitConnection()
    try {
      const executable = discoverClaudeExecutable(this.store.settings().claudeExecutablePath)
      const { stdout } = await execFileAsync(executable, ['--version'], {
        timeout: 10_000,
        maxBuffer: 4096,
        windowsHide: true
      })
      const init = record(await this.probe(executable))
      this.connection = {
        status: 'ready',
        executablePath: executable,
        version: safeText(stdout.trim()).slice(0, 200),
        account: parseClaudeAccount(init.account),
        models: parseClaudeModels(init.models),
        error: null
      }
    } catch (error) {
      this.connection = {
        ...this.connection,
        status: 'error',
        account: { kind: 'unknown' },
        models: [],
        error: this.failure(error, 'claude_not_connected')
      }
    }
    this.emitConnection()
    return this.connection
  }
  /**
   * Starts the CLI without a prompt to read its model catalog and account.
   * No model request is sent, but user-level session hooks may run.
   */
  private async probe(executable: string): Promise<unknown> {
    const input = inputStream()
    const query = this.sdk.query({
      prompt: input.stream,
      options: { ...this.baseOptions(executable, tmpdir()), persistSession: false }
    })
    void (async () => {
      try {
        for await (const _ of query) {
          /* Drain until the probe closes. */
        }
      } catch {
        /* The probe result is reported through initializationResult. */
      }
    })()
    try {
      return await withTimeout(
        query.initializationResult(),
        30_000,
        'Claude Code did not finish starting.'
      )
    } finally {
      input.close()
      query.close()
    }
  }
  /**
   * `worker` marks a session in a worker's worktree of a registered project,
   * which may not exist yet.
   */
  createSession(input: CreateCodexSession, worker?: { projectPath: string }): CodexSession {
    const cwd = worker ? input.cwd : realpathSync(input.cwd)
    const projectPath = worker?.projectPath ?? cwd
    if (!this.store.projects().some((p) => p.path === projectPath))
      throw new CodexRuntimeError('project_required', 'Choose a project before starting a task.')
    this.validateSelection(input.model, input.effort)
    const now = new Date().toISOString()
    const session: CodexSession = {
      id: crypto.randomUUID(),
      provider: 'claude-code',
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
  async send(input: SendCodexMessage): Promise<void> {
    const session = this.getSession(input.sessionId)
    const executable = this.readyExecutable()
    if (active(session))
      throw new CodexRuntimeError('busy', 'Wait for the current task or stop it before sending.')
    this.validateSelection(session.model, session.effort)
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
      input: inputStream(),
      abort: new AbortController(),
      query: null,
      cancelled: false,
      stderr: '',
      streamed: new Map(),
      blocks: new Map(),
      messageId: null,
      stopTimer: null,
      structured: null,
      resultText: ''
    }
    this.runtimes.set(session.id, runtime)
    this.changed(session, true)
    const canUseTool: CanUseTool = (toolName, toolInput, context) =>
      this.requestPermission(session.id, runtime, toolName, toolInput, context)
    const model = this.connection.models.find((m) =>
      session.model ? m.id === session.model : m.isDefault
    )
    const profile = this.profiles?.profile(session.id) ?? null
    try {
      runtime.query = this.sdk.query({
        prompt: runtime.input.stream,
        options: {
          ...this.baseOptions(executable, session.cwd, runtime),
          ...(profile
            ? {
                systemPrompt: {
                  type: 'preset' as const,
                  preset: 'claude_code' as const,
                  append: profile.instructions
                },
                outputFormat: { type: 'json_schema' as const, schema: profile.reportSchema }
              }
            : {}),
          ...permissionOptions(session.permission, model?.autoMode === true),
          ...(session.model ? { model: session.model } : {}),
          ...(session.effort ? { effort: claudeEffortSchema.parse(session.effort) } : {}),
          ...(session.threadId ? { resume: session.threadId } : {}),
          abortController: runtime.abort,
          includePartialMessages: true,
          canUseTool
        }
      })
    } catch (error) {
      this.runtimes.delete(session.id)
      session.status = 'failed'
      session.turnId = null
      session.error = this.failure(error, 'claude_disconnected')
      this.changed(session, true)
      this.profiles?.settled(session.id, { status: 'failed', structured: null, text: '' })
      throw new CodexRuntimeError(session.error.code, session.error.message)
    }
    runtime.input.push({
      type: 'user',
      message: { role: 'user', content: input.text },
      parent_tool_use_id: null
    })
    session.status = 'running'
    this.changed(session, true)
    void this.consume(session, runtime, runtime.query)
  }
  /**
   * Adds a message to the running turn; Claude Code folds it into the same turn
   * (F9). Returns not_running when no turn can take it.
   */
  steer(sessionId: string, text: string): 'steered' | 'not_running' {
    const session = this.getSession(sessionId)
    const runtime = this.runtimes.get(sessionId)
    if (!runtime || runtime.cancelled || !active(session)) return 'not_running'
    session.items.push({
      id: crypto.randomUUID(),
      kind: 'user',
      status: 'completed',
      text,
      detail: '',
      turnId: runtime.turnId
    })
    runtime.input.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null
    })
    this.changed(session, true)
    return 'steered'
  }
  private async consume(session: CodexSession, runtime: Runtime, query: Query): Promise<void> {
    try {
      for await (const message of query) {
        if (this.runtimes.get(session.id) !== runtime) break
        this.apply(session, runtime, message)
      }
    } catch (error) {
      if (this.runtimes.get(session.id) === runtime && !runtime.cancelled && active(session))
        session.error = this.failure(error, 'claude_disconnected')
    } finally {
      if (runtime.stopTimer) clearTimeout(runtime.stopTimer)
      runtime.input.close()
      // A finished turn releases the session at its result; a later turn may own it now.
      if (this.runtimes.get(session.id) === runtime) this.release(session, runtime)
    }
  }
  /** Ends the session's ownership by this turn; a turn that ended without a result failed. */
  private release(session: CodexSession, runtime: Runtime): void {
    this.runtimes.delete(session.id)
    this.expirePermissions(session)
    if (active(session)) {
      session.status = runtime.cancelled ? 'interrupted' : 'failed'
      if (session.status === 'failed' && !session.error)
        session.error = {
          code: 'claude_disconnected',
          message: safeText(runtime.stderr.trim()).slice(-1000)
        }
      this.settle(session, session.status === 'failed' ? 'failed' : 'interrupted')
    }
    session.turnId = null
    this.changed(session, true)
    if (!this.closed)
      this.profiles?.settled(session.id, {
        status:
          session.status === 'failed'
            ? 'failed'
            : session.status === 'interrupted'
              ? 'interrupted'
              : 'completed',
        structured: runtime.structured,
        text: runtime.resultText
      })
  }
  private apply(session: CodexSession, runtime: Runtime, message: SDKMessage): void {
    switch (message.type) {
      case 'system':
        if (message.subtype === 'init' && session.threadId !== message.session_id) {
          session.threadId = message.session_id
          this.changed(session, true)
        }
        return
      case 'stream_event':
        if (message.parent_tool_use_id === null) this.applyStream(session, runtime, message.event)
        return
      case 'assistant':
        if (message.parent_tool_use_id === null)
          this.applyAssistant(session, runtime, message.message)
        return
      case 'user':
        if (message.parent_tool_use_id === null) this.applyToolResults(session, message.message)
        return
      case 'result': {
        const usage = record(message.usage)
        const tokens = [
          'input_tokens',
          'output_tokens',
          'cache_read_input_tokens',
          'cache_creation_input_tokens'
        ]
          .map((key) => (typeof usage[key] === 'number' ? usage[key] : 0))
          .reduce((sum, value) => sum + value, 0)
        session.tokens = (session.tokens ?? 0) + tokens
        const succeeded = message.subtype === 'success' && !message.is_error
        const status = succeeded ? 'idle' : runtime.cancelled ? 'interrupted' : 'failed'
        if (message.subtype === 'success') {
          runtime.structured = message.structured_output ?? null
          runtime.resultText = message.result
        }
        if (status === 'failed') {
          const detail = message.subtype === 'success' ? message.result : message.errors.join('\n')
          session.error = { code: 'native_error', message: safeText(detail).slice(0, 1000) }
        }
        this.settle(
          session,
          status === 'idle' ? 'completed' : status === 'failed' ? 'failed' : 'interrupted'
        )
        session.diff = turnDiff(session.items, runtime.turnId)
        session.status = status
        runtime.input.close()
        this.release(session, runtime)
        return
      }
      default:
        return
    }
  }
  private applyStream(session: CodexSession, runtime: Runtime, raw: unknown): void {
    const event = record(raw)
    if (event.type === 'message_start') {
      runtime.messageId = string(record(event.message).id) || null
      runtime.blocks.clear()
      return
    }
    const index = typeof event.index === 'number' ? event.index : -1
    if (event.type === 'content_block_start' && runtime.messageId) {
      const blockType = record(event.content_block).type
      if (blockType !== 'text' && blockType !== 'thinking') return
      const id = `${runtime.messageId}:${index}`
      session.items.push({
        id,
        kind: blockType === 'text' ? 'assistant' : 'reasoning',
        status: 'running',
        text: '',
        detail: '',
        turnId: runtime.turnId
      })
      runtime.blocks.set(index, id)
      const ids = runtime.streamed.get(runtime.messageId) ?? []
      ids.push(id)
      runtime.streamed.set(runtime.messageId, ids)
      this.changed(session)
      return
    }
    if (event.type === 'content_block_delta') {
      const item = session.items.find((i) => i.id === runtime.blocks.get(index))
      const delta = record(event.delta)
      const text =
        delta.type === 'text_delta'
          ? string(delta.text)
          : delta.type === 'thinking_delta'
            ? string(delta.thinking)
            : ''
      if (!item || !text) return
      item.text += safeText(text)
      this.changed(session)
    }
  }
  private applyAssistant(session: CodexSession, runtime: Runtime, raw: unknown): void {
    const message = record(raw)
    const messageId = string(message.id) || crypto.randomUUID()
    const blocks = z.array(recordSchema).catch([]).parse(message.content)
    blocks.forEach((block, position) => {
      if (block.type === 'text' || block.type === 'thinking') {
        const kind = block.type === 'text' ? 'assistant' : 'reasoning'
        const text = safeText(block.type === 'text' ? block.text : block.thinking)
        const pending = runtime.streamed.get(messageId) ?? []
        const index = pending.findIndex(
          (id) => session.items.find((i) => i.id === id)?.kind === kind
        )
        const id = index >= 0 ? pending.splice(index, 1)[0] : `${messageId}:final:${position}`
        this.upsert(session, {
          id,
          kind,
          status: 'completed',
          text: text || session.items.find((i) => i.id === id)?.text || '',
          detail: '',
          turnId: runtime.turnId
        })
      } else if (block.type === 'tool_use') {
        this.upsert(
          session,
          toolItem(string(block.id), string(block.name), block.input, runtime.turnId)
        )
      }
    })
    this.changed(session)
  }
  private applyToolResults(session: CodexSession, raw: unknown): void {
    const content = record(raw).content
    if (!Array.isArray(content)) return
    for (const block of z.array(recordSchema).catch([]).parse(content)) {
      if (block.type !== 'tool_result') continue
      const index = session.items.findIndex((i) => i.id === block.tool_use_id)
      if (index < 0) continue
      session.items[index] = completeToolItem(
        session.items[index],
        toolResultText(block.content),
        block.is_error === true
      )
    }
    this.changed(session)
  }
  private upsert(session: CodexSession, item: CodexItem): void {
    const index = session.items.findIndex((i) => i.id === item.id)
    if (index >= 0) session.items[index] = { ...session.items[index], ...item }
    else session.items.push(item)
  }
  private requestPermission(
    sessionId: string,
    runtime: Runtime,
    toolName: string,
    input: Record<string, unknown>,
    context: Parameters<CanUseTool>[2]
  ): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const session = this.sessions.get(sessionId)
      if (!session || this.runtimes.get(sessionId) !== runtime || runtime.cancelled) {
        resolve({ behavior: 'deny', message: 'This task is no longer active.' })
        return
      }
      let request: ReturnType<typeof permissionRequest>
      try {
        request = permissionRequest(toolName, input, context, runtime.turnId)
      } catch {
        resolve({ behavior: 'deny', message: 'Owls could not display this request.' })
        return
      }
      this.permissions.set(request.id, { sessionId, input, resolve })
      session.requests.push(request)
      session.status = 'waiting'
      this.changed(session, true)
      context.signal.addEventListener(
        'abort',
        () => {
          if (!this.permissions.delete(request.id)) return
          request.status = 'unavailable'
          resolve({ behavior: 'deny', message: 'The request was cancelled.' })
          this.refreshWaiting(session)
          this.changed(session, true)
        },
        { once: true }
      )
    })
  }
  respond(input: RespondCodexRequest): void {
    const session = this.getSession(input.sessionId)
    const pending = this.permissions.get(input.requestId)
    const request = session.requests.find((r) => r.id === input.requestId)
    if (!pending || pending.sessionId !== session.id || request?.status !== 'pending') {
      throw new CodexRuntimeError('request_unavailable', 'This request is no longer available.')
    }
    let result: PermissionResult
    if (input.decision !== 'accept') {
      result = {
        behavior: 'deny',
        message:
          input.decision === 'cancel'
            ? 'The user stopped the task.'
            : 'The user declined this action.',
        ...(input.decision === 'cancel' ? { interrupt: true } : {})
      }
    } else if (request.kind === 'question') {
      const answers = input.answers ?? {}
      if (request.questions.some((q) => !answers[q.id]?.some((answer) => answer.trim())))
        throw new CodexRuntimeError('answer_required', 'Answer each question before continuing.')
      result = {
        behavior: 'allow',
        updatedInput: {
          ...pending.input,
          answers: questionAnswers(pending.input, request, answers)
        }
      }
    } else result = { behavior: 'allow', updatedInput: pending.input }
    this.permissions.delete(input.requestId)
    request.status = 'resolved'
    pending.resolve(result)
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
    this.expirePermissions(session)
    this.changed(session, true)
    // Abort the process if the CLI does not end the turn after a graceful interrupt.
    runtime.stopTimer = setTimeout(() => {
      if (this.runtimes.get(id) === runtime) runtime.abort.abort()
    }, 15_000)
    try {
      if (runtime.query)
        await withTimeout(runtime.query.interrupt(), 10_000, 'Claude Code did not stop.')
    } catch {
      runtime.abort.abort()
    }
  }
  archive(id: string): void {
    const session = this.getSession(id)
    if (active(session)) throw new CodexRuntimeError('busy', 'Stop the task before removing it.')
    this.store.removeSession(id)
    this.sessions.delete(id)
    this.emit({ type: 'removed', sessionId: id })
  }
  /**
   * Creates a Router worker's worktree before the agent starts in it. The session
   * is already starting, so it can be stopped but not removed meanwhile. False
   * when it was stopped and the turn must not start.
   */
  private async prepared(
    session: CodexSession,
    previous: CodexSession['status']
  ): Promise<boolean> {
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
  private expirePermissions(session: CodexSession): void {
    for (const request of session.requests) {
      const pending = this.permissions.get(request.id)
      if (pending) {
        this.permissions.delete(request.id)
        pending.resolve({ behavior: 'deny', message: 'The task was stopped.' })
      }
      if (request.status === 'pending' || request.status === 'answering')
        request.status = 'unavailable'
    }
    this.refreshWaiting(session)
  }
  private refreshWaiting(session: CodexSession): void {
    if (session.status === 'waiting' && !session.requests.some((r) => r.status === 'pending'))
      session.status = 'running'
  }
  private settle(session: CodexSession, status: 'completed' | 'failed' | 'interrupted'): void {
    for (const item of session.items) if (item.status === 'running') item.status = status
    this.expirePermissions(session)
  }
  private baseOptions(executable: string, cwd: string, runtime?: Runtime): Options {
    return {
      pathToClaudeCodeExecutable: executable,
      cwd,
      // Load the same settings, CLAUDE.md, hooks, and MCP servers as the CLI.
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      stderr: (data) => {
        if (runtime) runtime.stderr = (runtime.stderr + data).slice(-4000)
      }
    }
  }
  private validateSelection(model: string | null, effort: CodexSession['effort']): void {
    if (!model && effort)
      throw new CodexRuntimeError(
        'effort_unavailable',
        'Choose a model before selecting its reasoning effort.'
      )
    if (!model) return
    const entry = this.connection.models.find((m) => m.id === model)
    if (!entry)
      throw new CodexRuntimeError(
        'model_unavailable',
        'This model is not available in the connected Claude Code account.'
      )
    if (effort && !entry.efforts.includes(effort))
      throw new CodexRuntimeError(
        'effort_unavailable',
        'This reasoning effort is not supported by the selected model.'
      )
  }
  private readyExecutable(): string {
    if (this.connection.status !== 'ready' || !this.connection.executablePath)
      throw new CodexRuntimeError(
        'claude_not_connected',
        'Connect your local Claude Code installation in Settings.'
      )
    return this.connection.executablePath
  }
  private getSession(id: string): CodexSession {
    const session = this.sessions.get(id)
    if (!session) throw new CodexRuntimeError('task_not_found', 'Task not found.')
    return session
  }
  private failure(error: unknown, fallback: 'claude_not_connected' | 'claude_disconnected') {
    const failure = codexFailure(error)
    return failure.code === 'native_error' && !failure.message
      ? { code: fallback, message: '' }
      : failure
  }
  private changed(session: CodexSession, immediate = false): void {
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
    this.emit({ type: 'claude-connection', connection: this.connection })
  }
  /** Stops owned CLI processes. The shared store is closed by the host. */
  close(): void {
    if (this.closed) return
    for (const session of this.sessions.values()) {
      const runtime = this.runtimes.get(session.id)
      if (!runtime) continue
      runtime.cancelled = true
      runtime.input.close()
      runtime.abort.abort()
    }
    this.flush()
    this.closed = true
  }
}
