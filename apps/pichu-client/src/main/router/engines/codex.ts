import { z } from 'zod'
import type { CodexFailure, CodexItem } from '../../../shared/codex.js'
import { CodexClient } from '../../codex/client.js'
import { codexFailure } from '../../codex/errors.js'
import { type RpcFrame, record, recordSchema, safeText, string } from '../../codex/protocol.js'
import type { RouterBatchInput, RouterBatchOutcome, RouterEngine, RouterSink } from '../engine.js'
import { type RouterTool, toolErrorText, toolJsonSchema } from '../tools.js'

/**
 * Features turned off in the Router's app-server so the model has no shell,
 * browser, plugins, apps, or sub-agents. Unknown names are ignored by Codex, so
 * the list survives renames. `code_mode_host` stays on: dynamic tools need it
 * (F14). Hooks and the global AGENTS.md cannot be turned off (F13, F15).
 */
export const CODEX_ROUTER_FEATURES_OFF = [
  'apps',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'goals',
  'image_generation',
  'in_app_browser',
  'multi_agent',
  'plugins',
  'remote_plugin',
  'shell_tool',
  'skill_mcp_dependency_install',
  'skill_search',
  'sleep_tool',
  'tool_suggest',
  'unified_exec',
  'view_image',
  'workspace_dependencies'
]

/** Builds the app-server flags; MCP servers must be named one by one (F12). */
export function codexRouterArgs(mcpServers: string[]): string[] {
  return [
    ...CODEX_ROUTER_FEATURES_OFF.flatMap((name) => ['-c', `features.${name}=false`]),
    ...[...mcpServers].sort().flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]),
    '-c',
    'web_search="disabled"'
  ]
}

type Client = Pick<CodexClient, 'request' | 'respond' | 'reject' | 'stop'>
/** Starts an app-server; injected so tests can script one. */
export type CodexLauncher = (
  executable: string,
  options: { args: string[]; experimentalApi: boolean },
  onFrame: (frame: RpcFrame) => void,
  onClose: (reason: string) => void
) => Promise<Client>

export const launchCodex: CodexLauncher = async (executable, options, onFrame, onClose) => {
  const client = new CodexClient(onFrame, onClose)
  try {
    await client.start(executable, options)
  } catch (error) {
    client.stop()
    throw error
  }
  return client
}

type ThreadListener = {
  frame(frame: RpcFrame): void
  closed(reason: string): void
}

/**
 * The Router's own Codex app-server. Worker tasks keep using the user's normal
 * app-server; this one starts on first use with the flags above and serves one
 * thread per Router.
 */
export class CodexRouterServer {
  private client: Client | null = null
  private starting: Promise<Client> | null = null
  private executable: string | null = null
  private readonly threads = new Map<string, ThreadListener>()
  /** Threads resumed or started in the current process. */
  readonly loaded = new Set<string>()

  constructor(private readonly launch: CodexLauncher = launchCodex) {}

  ready(executable: string): Promise<Client> {
    if (this.client && this.executable === executable) return Promise.resolve(this.client)
    if (this.starting) return this.starting
    this.client?.stop()
    this.client = null
    this.starting = this.open(executable).finally(() => {
      this.starting = null
    })
    return this.starting
  }

  listen(threadId: string, listener: ThreadListener): () => void {
    this.threads.set(threadId, listener)
    return () => {
      if (this.threads.get(threadId) === listener) this.threads.delete(threadId)
    }
  }

  close(): void {
    this.client?.stop()
    this.client = null
    this.loaded.clear()
  }

  private async open(executable: string): Promise<Client> {
    // A plain app-server reads the configured MCP server names; the Router's own
    // process then turns each of them off.
    const probe = await this.launch(
      executable,
      { args: [], experimentalApi: true },
      () => {},
      () => {}
    )
    let servers: string[]
    try {
      const response = record(await probe.request('config/read', { includeLayers: false }))
      servers = Object.keys(recordSchema.catch({}).parse(record(response.config).mcp_servers))
    } finally {
      probe.stop()
    }
    this.loaded.clear()
    const client = await this.launch(
      executable,
      { args: codexRouterArgs(servers), experimentalApi: true },
      (frame) => this.onFrame(frame),
      (reason) => {
        if (this.client !== client) return
        this.client = null
        this.loaded.clear()
        for (const listener of this.threads.values()) listener.closed(reason)
      }
    )
    this.client = client
    this.executable = executable
    return client
  }

  private onFrame(frame: RpcFrame): void {
    const threadId = string(frame.params?.threadId)
    const listener = this.threads.get(threadId)
    if (listener) listener.frame(frame)
    else if (frame.id !== undefined) this.client?.reject(frame.id)
  }
}

export type CodexEngineOptions = {
  server: CodexRouterServer
  executable: string
  cwd: string
  model: string | null
  instructions: string
  promptVersion: number
  tools: RouterTool[]
  /** Current worker summary, for a thread that had to be started over. */
  state: () => string
}

type Turn = {
  batchId: string
  turnId: string | null
  sink: RouterSink
  texts: Map<string, string>
  stopping: boolean
  done: (outcome: Omit<RouterBatchOutcome, 'native'>) => void
}

/**
 * Runs each Router batch as one turn on the Router's Codex thread. A new thread
 * is started when there is none, when it cannot be resumed, or when the Router
 * instructions changed, since Codex fixes them at thread start.
 */
export class CodexEngine implements RouterEngine {
  private turn: Turn | null = null
  private threadId: string | null = null
  /** The thread's running token total; Codex can repeat an update, which must not count twice. */
  private total: number | null = null

  constructor(private readonly options: CodexEngineOptions) {}

  async run(input: RouterBatchInput, sink: RouterSink): Promise<RouterBatchOutcome> {
    if (this.turn) throw new Error('A Router batch is already running.')
    const { options } = this
    const previous =
      input.native?.engine === 'codex' && input.native.promptVersion === options.promptVersion
        ? input.native.threadId
        : null
    const native = (threadId: string | null) =>
      ({ engine: 'codex', threadId, promptVersion: options.promptVersion }) as const
    let release = () => {}
    try {
      const client = await options.server.ready(options.executable)
      let threadId = previous
      let text = input.text
      if (threadId && !options.server.loaded.has(threadId)) {
        try {
          await client.request('thread/resume', { ...this.policy(), threadId, excludeTurns: true })
          options.server.loaded.add(threadId)
        } catch {
          threadId = null
          // The service rendered this batch for a thread that knew the history.
          text = `Earlier Router history is not available. Current workers:\n${options.state()}\n\n${text}`
        }
      }
      if (!threadId) {
        const response = record(
          await client.request('thread/start', {
            ...this.policy(),
            ephemeral: false,
            developerInstructions: options.instructions,
            dynamicTools: options.tools.map((tool) => ({
              type: 'function',
              name: tool.name,
              description: tool.description,
              inputSchema: toolJsonSchema(tool)
            }))
          })
        )
        threadId = z.string().parse(record(response.thread).id)
        options.server.loaded.add(threadId)
      }
      this.threadId = threadId
      const outcome = new Promise<Omit<RouterBatchOutcome, 'native'>>((done) => {
        this.turn = {
          batchId: input.batchId,
          turnId: null,
          sink,
          texts: new Map(),
          stopping: false,
          done
        }
      })
      const turn = this.turn as Turn | null
      release = options.server.listen(threadId, {
        frame: (frame) => void this.onFrame(client, frame),
        closed: (reason) =>
          turn?.done({ status: 'failed', error: { code: 'disconnected', message: reason } })
      })
      const started = record(
        await client.request('turn/start', {
          threadId,
          input: [{ type: 'text', text, text_elements: [] }],
          ...(options.model ? { model: options.model } : {})
        })
      )
      if (turn) {
        turn.turnId ??= string(record(started.turn).id) || null
        if (turn.stopping) void this.interrupt(client, turn)
      }
      return { ...(await outcome), native: native(threadId) }
    } catch (error) {
      return { status: 'failed', error: failure(error), native: native(this.threadId ?? previous) }
    } finally {
      release()
      this.turn = null
    }
  }

  async steer(text: string): Promise<'steered' | 'not_running'> {
    const turn = this.turn
    if (!turn?.turnId || turn.stopping || !this.threadId) return 'not_running'
    try {
      const client = await this.options.server.ready(this.options.executable)
      await client.request('turn/steer', {
        threadId: this.threadId,
        expectedTurnId: turn.turnId,
        input: [{ type: 'text', text, text_elements: [] }]
      })
      return 'steered'
    } catch {
      return 'not_running'
    }
  }

  abort(): void {
    const turn = this.turn
    if (!turn || turn.stopping) return
    turn.stopping = true
    if (turn.turnId)
      void this.options.server.ready(this.options.executable).then((c) => this.interrupt(c, turn))
  }

  private policy() {
    return {
      cwd: this.options.cwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ...(this.options.model ? { model: this.options.model } : {})
    }
  }

  private async interrupt(client: Client, turn: Turn): Promise<void> {
    try {
      await client.request('turn/interrupt', { threadId: this.threadId, turnId: turn.turnId })
    } catch {
      turn.done({ status: 'interrupted', error: null })
    }
  }

  private async onFrame(client: Client, frame: RpcFrame): Promise<void> {
    const turn = this.turn
    if (!turn) {
      if (frame.id !== undefined) client.reject(frame.id)
      return
    }
    const params = frame.params ?? {}
    const turnId = turn.batchId
    if (frame.id !== undefined) {
      if (frame.method !== 'item/tool/call') {
        client.reject(frame.id)
        return
      }
      const tool = this.options.tools.find((t) => t.name === params.tool)
      let result: { success: boolean; text: string }
      try {
        if (!tool) throw new Error('unknown tool')
        result = { success: true, text: await tool.execute(params.arguments) }
      } catch (error) {
        result = { success: false, text: toolErrorText(error) }
      }
      client.respond(frame.id, {
        success: result.success,
        contentItems: [{ type: 'inputText', text: result.text }]
      })
      return
    }
    switch (frame.method) {
      case 'turn/started':
        turn.turnId ??= string(record(params.turn).id) || null
        if (turn.stopping) void this.interrupt(client, turn)
        return
      case 'item/agentMessage/delta': {
        const id = string(params.itemId)
        const text = (turn.texts.get(id) ?? '') + safeText(params.delta)
        turn.texts.set(id, text)
        turn.sink.item({ id, kind: 'assistant', status: 'running', text, detail: '', turnId })
        return
      }
      case 'item/started':
      case 'item/completed': {
        const item = routerItem(record(params.item), turnId, frame.method === 'item/completed')
        if (item) turn.sink.item(item)
        return
      }
      case 'thread/tokenUsage/updated': {
        const usage = record(params.tokenUsage)
        const total = recordSchema.catch({}).parse(usage.total).totalTokens
        if (typeof total === 'number') {
          if (total === this.total) return
          this.total = total
        }
        const last = recordSchema.catch({}).parse(usage.last)
        const number = (key: string) => (typeof last[key] === 'number' ? last[key] : 0)
        const cached = number('cachedInputTokens')
        turn.sink.usage({
          input: Math.max(0, number('inputTokens') - cached),
          output: number('outputTokens'),
          cacheRead: cached,
          cacheWrite: number('cacheWriteInputTokens')
        })
        return
      }
      case 'turn/completed': {
        const native = record(params.turn)
        const error = native.error ? record(native.error) : null
        turn.done(
          native.status === 'completed'
            ? { status: 'completed', error: null }
            : native.status === 'interrupted' || turn.stopping
              ? { status: 'interrupted', error: null }
              : {
                  status: 'failed',
                  error: { code: 'native_error', message: safeText(error?.message).slice(0, 1000) }
                }
        )
        return
      }
      default:
        return
    }
  }
}

/** The Router view shows replies and tool calls; reasoning and the echoed input stay out. */
function routerItem(
  item: Record<string, unknown>,
  turnId: string,
  completed: boolean
): CodexItem | null {
  const id = string(item.id)
  if (!id) return null
  if (item.type === 'agentMessage') {
    const text = safeText(item.text)
    return text
      ? {
          id,
          kind: 'assistant',
          status: completed ? 'completed' : 'running',
          text,
          detail: '',
          turnId
        }
      : null
  }
  if (item.type === 'dynamicToolCall') {
    const content = z
      .array(recordSchema)
      .catch([])
      .parse(item.contentItems ?? [])
      .map((c) => string(c.text))
      .join('')
    return {
      id,
      kind: 'tool',
      status: !completed ? 'running' : item.success === false ? 'failed' : 'completed',
      text: string(item.tool),
      detail: safeText(content || JSON.stringify(item.arguments ?? {})).slice(0, 4000),
      turnId
    }
  }
  return null
}

function failure(error: unknown): CodexFailure {
  const value = codexFailure(error)
  return value.code === 'native_error' && !value.message
    ? { code: 'disconnected', message: '' }
    : value
}
