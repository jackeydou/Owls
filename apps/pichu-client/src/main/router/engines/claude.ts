import type {
  McpSdkServerConfigWithInstance,
  Options,
  SDKMessage,
  SdkMcpToolDefinition
} from '@anthropic-ai/claude-agent-sdk/core'
import { z } from 'zod'
import type { CodexFailure, CodexItem } from '../../../shared/codex.js'
import { inputStream } from '../../claude/input.js'
import { toolResultText } from '../../claude/normalize.js'
import type { ClaudeSdk } from '../../claude/service.js'
import { record, recordSchema, safeText, string } from '../../codex/protocol.js'
import type { RouterBatchInput, RouterBatchOutcome, RouterEngine, RouterSink } from '../engine.js'
import { type RouterTool, toolErrorText } from '../tools.js'

/** The Agent SDK calls the Claude Code engine uses; injected so tests can replace them. */
export type ClaudeRouterSdk = ClaudeSdk & {
  createSdkMcpServer(options: {
    name: string
    version: string
    tools: SdkMcpToolDefinition[]
    alwaysLoad: boolean
  }): McpSdkServerConfigWithInstance
}

export type ClaudeEngineOptions = {
  sdk: ClaudeRouterSdk
  executable: string
  /**
   * The Router's project. Claude Code tells the model its working directory, so
   * this must be where workers run, or goals name the wrong place.
   */
  cwd: string
  model: string | null
  instructions: string
  tools: RouterTool[]
  version: string
}

const SERVER = 'owls'
const prefix = `mcp__${SERVER}__`

/** Claude Code reports a missing resume target this way; the next batch starts fresh. */
const LOST_SESSION = /no conversation found/i

type Run = {
  batchId: string
  input: ReturnType<typeof inputStream>
  abort: AbortController
  query: ReturnType<ClaudeSdk['query']> | null
  /** Streaming item ids per API message, replaced by the full message when it arrives. */
  streamed: Map<string, string[]>
  blocks: Map<number, string>
  messageId: string | null
  texts: Map<string, string>
  /** Tool names by call id, so results show the tool they belong to. */
  tools: Map<string, string>
  stopping: boolean
}

/**
 * Runs each Router batch as one Claude Code query that resumes the Router's
 * native session. Isolation comes from `tools: []`, the Owls tool allow list,
 * `settingSources: []`, and `strictMcpConfig` (RFC 4.2, F3, F16).
 */
export class ClaudeEngine implements RouterEngine {
  private run_: Run | null = null

  constructor(private readonly options: ClaudeEngineOptions) {}

  async run(input: RouterBatchInput, sink: RouterSink): Promise<RouterBatchOutcome> {
    if (this.run_) throw new Error('A Router batch is already running.')
    let sessionId = input.native?.engine === 'claude-code' ? input.native.sessionId : null
    const resumed = sessionId
    const run: Run = {
      batchId: input.batchId,
      input: inputStream(),
      abort: new AbortController(),
      query: null,
      streamed: new Map(),
      blocks: new Map(),
      messageId: null,
      texts: new Map(),
      tools: new Map(),
      stopping: false
    }
    this.run_ = run
    let outcome: Omit<RouterBatchOutcome, 'native'> = {
      status: 'failed',
      error: { code: 'claude_disconnected', message: '' }
    }
    let lost = false
    try {
      run.query = this.options.sdk.query({
        prompt: run.input.stream,
        options: this.queryOptions(resumed, run)
      })
      run.input.push({
        type: 'user',
        message: { role: 'user', content: input.text },
        parent_tool_use_id: null
      })
      for await (const message of run.query) {
        if (message.type === 'system' && message.subtype === 'init') sessionId = message.session_id
        else if (message.type === 'result') {
          // A message steered in after the model finished starts one more turn,
          // so keep reading until the CLI exits; the last result decides.
          run.input.close()
          usage(sink, message.usage)
          const succeeded = message.subtype === 'success' && !message.is_error
          const detail = message.subtype === 'success' ? message.result : message.errors.join('\n')
          lost = !succeeded && Boolean(resumed) && LOST_SESSION.test(detail)
          outcome = succeeded
            ? { status: 'completed', error: null }
            : run.stopping
              ? { status: 'interrupted', error: null }
              : { status: 'failed', error: failure(detail) }
        } else this.apply(run, message, sink)
      }
    } catch (error) {
      outcome = run.stopping
        ? { status: 'interrupted', error: null }
        : { status: 'failed', error: failure(error instanceof Error ? error.message : '') }
    } finally {
      run.input.close()
      this.run_ = null
    }
    return { ...outcome, native: { engine: 'claude-code', sessionId: lost ? null : sessionId } }
  }

  steer(text: string): 'steered' | 'not_running' {
    const run = this.run_
    if (!run || run.stopping) return 'not_running'
    run.input.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null
    })
    return 'steered'
  }

  abort(): void {
    const run = this.run_
    if (!run || run.stopping) return
    run.stopping = true
    const force = setTimeout(() => run.abort.abort(), 5000)
    const stopped = run.query?.interrupt() ?? Promise.resolve()
    void stopped.catch(() => run.abort.abort()).finally(() => clearTimeout(force))
  }

  private queryOptions(resume: string | null, run: Run): Options {
    const tools = this.options.tools
    const server = this.options.sdk.createSdkMcpServer({
      name: SERVER,
      version: this.options.version,
      // Deferred tools would hide dispatch_task behind a search step.
      alwaysLoad: true,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.schema.shape,
        handler: async (args: unknown) => {
          try {
            return { content: [{ type: 'text' as const, text: await tool.execute(args) }] }
          } catch (error) {
            return {
              content: [{ type: 'text' as const, text: toolErrorText(error) }],
              isError: true
            }
          }
        }
      }))
    })
    return {
      pathToClaudeCodeExecutable: this.options.executable,
      cwd: this.options.cwd,
      systemPrompt: this.options.instructions,
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: { [SERVER]: server },
      allowedTools: tools.map((tool) => `${prefix}${tool.name}`),
      // Anything outside the allow list is refused rather than shown as an approval.
      permissionMode: 'dontAsk',
      includePartialMessages: true,
      abortController: run.abort,
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(resume ? { resume } : {})
    }
  }

  private apply(run: Run, message: SDKMessage, sink: RouterSink): void {
    const turnId = run.batchId
    if (message.type === 'stream_event' && message.parent_tool_use_id === null) {
      const event = record(message.event)
      if (event.type === 'message_start') {
        run.messageId = string(record(event.message).id) || null
        run.blocks.clear()
        return
      }
      const index = typeof event.index === 'number' ? event.index : -1
      if (event.type === 'content_block_start' && run.messageId) {
        if (record(event.content_block).type !== 'text') return
        const id = `${run.messageId}:${index}`
        run.blocks.set(index, id)
        run.texts.set(id, '')
        const ids = run.streamed.get(run.messageId) ?? []
        ids.push(id)
        run.streamed.set(run.messageId, ids)
        return
      }
      if (event.type === 'content_block_delta') {
        const id = run.blocks.get(index)
        const delta = record(event.delta)
        if (!id || delta.type !== 'text_delta') return
        const text = (run.texts.get(id) ?? '') + safeText(delta.text)
        run.texts.set(id, text)
        sink.item({ id, kind: 'assistant', status: 'running', text, detail: '', turnId })
      }
      return
    }
    if (message.type === 'assistant' && message.parent_tool_use_id === null) {
      const raw = record(message.message)
      const messageId = string(raw.id) || crypto.randomUUID()
      const blocks = z.array(recordSchema).catch([]).parse(raw.content)
      blocks.forEach((block, position) => {
        if (block.type === 'text') {
          const pending = run.streamed.get(messageId) ?? []
          const id = pending.shift() ?? `${messageId}:final:${position}`
          const text = safeText(block.text) || run.texts.get(id) || ''
          if (text)
            sink.item({ id, kind: 'assistant', status: 'completed', text, detail: '', turnId })
        } else if (block.type === 'tool_use') {
          const item = toolItem(string(block.id), string(block.name), block.input, turnId)
          run.tools.set(item.id, item.text)
          sink.item(item)
        }
      })
      return
    }
    if (message.type === 'user' && message.parent_tool_use_id === null) {
      const content = record(message.message).content
      if (!Array.isArray(content)) return
      for (const block of z.array(recordSchema).catch([]).parse(content)) {
        if (block.type !== 'tool_result') continue
        sink.item({
          id: string(block.tool_use_id),
          kind: 'tool',
          status: block.is_error === true ? 'failed' : 'completed',
          text: run.tools.get(string(block.tool_use_id)) ?? 'tool',
          detail: toolResultText(block.content).slice(0, 4000),
          turnId
        })
      }
    }
  }
}

function toolItem(id: string, name: string, input: unknown, turnId: string): CodexItem {
  return {
    id,
    kind: 'tool',
    status: 'running',
    text: name.startsWith(prefix) ? name.slice(prefix.length) : name,
    detail: safeText(JSON.stringify(input ?? {})).slice(0, 4000),
    turnId
  }
}

function usage(sink: RouterSink, raw: unknown): void {
  const value = recordSchema.catch({}).parse(raw)
  const number = (key: string) => (typeof value[key] === 'number' ? value[key] : 0)
  sink.usage({
    input: number('input_tokens'),
    output: number('output_tokens'),
    cacheRead: number('cache_read_input_tokens'),
    cacheWrite: number('cache_creation_input_tokens')
  })
}

function failure(detail: string): CodexFailure {
  return { code: 'native_error', message: safeText(detail).slice(0, 1000) }
}
