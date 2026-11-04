import {
  Agent,
  type AgentMessage,
  type AgentTool,
  type StreamFn
} from '@earendil-works/pi-agent-core'
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import type { CodexFailure, CodexItem } from '../../../shared/codex.js'
import type { OwlsThinking } from '../../../shared/router.js'
import { safeText } from '../../codex/protocol.js'
import type { RouterBatchInput, RouterBatchOutcome, RouterEngine, RouterSink } from '../engine.js'
import { ROUTER_CONTEXT_BUDGET, trimContext } from '../render.js'
import { type RouterTool, toolErrorText, toolJsonSchema } from '../tools.js'

export type OwlsEngineOptions = {
  routerId: string
  model: Model<Api>
  thinking: OwlsThinking
  streamFn: StreamFn
  /** Returns the stored key for a provider; never falls back to the environment. */
  getApiKey: (provider: string) => string | undefined
  instructions: string
  tools: RouterTool[]
  /** Persisted transcript from earlier batches. */
  history: unknown[]
  /** Current worker summary, used when old batches are trimmed from a request. */
  state: () => string
  persist: (batchId: string, messages: AgentMessage[]) => void
  version: string
  budget?: number
}

function text(content: AssistantMessage['content']): string {
  return content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
    .trim()
}
function failure(message: AssistantMessage | undefined, fallback: string): CodexFailure {
  const detail = safeText(message?.errorMessage ?? fallback).slice(0, 1000)
  return /\b(401|403)\b|unauthori[sz]ed|invalid[ _-]?api[ _-]?key|authentication/i.test(detail)
    ? { code: 'router_auth_failed', message: '' }
    : { code: 'native_error', message: detail }
}

/** The self-built Router engine: a pi Agent whose only tools are Owls tools. */
export class OwlsEngine implements RouterEngine {
  private readonly agent: Agent
  private sink: RouterSink | null = null
  private batchId = ''
  private current: { id: string; text: string } | null = null
  private running = false

  constructor(private readonly options: OwlsEngineOptions) {
    const tools: AgentTool<Record<string, unknown>>[] = options.tools.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: toolJsonSchema(tool),
      execute: async (_id, params) => {
        try {
          return { content: [{ type: 'text', text: await tool.execute(params) }], details: {} }
        } catch (error) {
          // Thrown errors reach the model as an isError tool result.
          throw new Error(toolErrorText(error))
        }
      }
    }))
    // The leading system message is rebuilt from the current prompt and tools on every start.
    const messages = options.history.filter(
      (m): m is AgentMessage =>
        Boolean(m) && typeof m === 'object' && (m as { role?: unknown }).role !== 'system'
    )
    this.agent = new Agent({
      initialState: {
        systemPrompt: options.instructions,
        model: options.model,
        thinkingLevel: options.thinking,
        tools,
        messages
      },
      streamFn: options.streamFn,
      getApiKey: (provider) => options.getApiKey(provider),
      sessionId: options.routerId,
      toolExecution: 'sequential',
      steeringMode: 'all',
      identity: { userAgent: { custom: `Owls/${options.version}` }, attribution: null },
      prepareRequest: ({ context }) => ({
        context: {
          ...context,
          messages: trimContext(
            context.messages,
            options.budget ?? ROUTER_CONTEXT_BUDGET,
            options.state
          )
        }
      })
    })
    this.agent.subscribe((event) => this.onEvent(event))
  }

  async run(
    { batchId, text: input }: RouterBatchInput,
    sink: RouterSink
  ): Promise<RouterBatchOutcome> {
    if (this.running) throw new Error('A Router batch is already running.')
    const native = { engine: 'owls' } as const
    this.running = true
    this.sink = sink
    this.batchId = batchId
    const before = this.agent.state.messages.length
    try {
      await this.agent.prompt(input)
    } catch (error) {
      return {
        status: 'failed',
        error: { code: 'native_error', message: safeText(String(error)).slice(0, 1000) },
        native
      }
    } finally {
      this.running = false
      this.sink = null
      this.current = null
    }
    const added = this.agent.state.messages.slice(before)
    const last = added.findLast((m): m is AssistantMessage => m.role === 'assistant')
    const ended = last?.stopReason === 'error' || last?.stopReason === 'aborted'
    // A failed or stopped response is not context the model should see again.
    const kept = ended ? added.filter((m) => m !== last) : added
    if (ended) this.agent.state.messages = [...this.agent.state.messages.slice(0, before), ...kept]
    this.options.persist(batchId, kept)
    if (last?.stopReason === 'aborted') return { status: 'interrupted', error: null, native }
    if (last?.stopReason === 'error' || this.agent.state.errorMessage)
      return { status: 'failed', error: failure(last, this.agent.state.errorMessage ?? ''), native }
    return { status: 'completed', error: null, native }
  }

  steer(input: string): 'steered' | 'not_running' {
    if (!this.running) return 'not_running'
    this.agent.steer({ role: 'user', content: input, timestamp: Date.now() })
    return 'steered'
  }

  abort(): void {
    this.agent.abort()
  }

  private onEvent(event: Parameters<Parameters<Agent['subscribe']>[0]>[0]): void {
    const sink = this.sink
    if (!sink) return
    const turnId = this.batchId
    switch (event.type) {
      case 'message_start':
        if (event.message.role === 'assistant') {
          this.current = { id: crypto.randomUUID(), text: '' }
        }
        return
      case 'message_update': {
        const delta = event.assistantMessageEvent
        if (!this.current || delta.type !== 'text_delta') return
        this.current.text += delta.delta
        sink.item({
          id: this.current.id,
          kind: 'assistant',
          status: 'running',
          text: this.current.text,
          detail: '',
          turnId
        })
        return
      }
      case 'message_end': {
        if (event.message.role !== 'assistant' || !this.current) return
        const message = event.message
        const body = text(message.content)
        if (body)
          sink.item({
            id: this.current.id,
            kind: 'assistant',
            status: 'completed',
            text: body,
            detail: '',
            turnId
          })
        const usage = message.usage
        if (usage)
          sink.usage({
            input: usage.input,
            output: usage.output,
            cacheRead: usage.cacheRead,
            cacheWrite: usage.cacheWrite
          })
        this.current = null
        return
      }
      case 'tool_execution_start':
        sink.item({
          id: event.toolCallId,
          kind: 'tool',
          status: 'running',
          text: event.toolName,
          detail: safeText(JSON.stringify(event.args ?? {})).slice(0, 4000),
          turnId
        })
        return
      case 'tool_execution_end': {
        const result = event.result as { content?: { type: string; text?: string }[] } | undefined
        const output = (result?.content ?? []).map((c) => c.text ?? '').join('')
        const item: CodexItem = {
          id: event.toolCallId,
          kind: 'tool',
          status: event.isError ? 'failed' : 'completed',
          text: event.toolName,
          detail: safeText(output).slice(0, 4000),
          turnId
        }
        sink.item(item)
        return
      }
      default:
        return
    }
  }
}
