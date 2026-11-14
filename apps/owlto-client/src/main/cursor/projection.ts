import type { Session, SessionItem } from '../../shared/app.js'
import { recordSchema, safeText } from '../codex/protocol.js'
import {
  contentChunkText,
  mergeToolCall,
  planEntriesSchema,
  planText,
  type ToolState,
  toolCallItem,
  updateTodosSchema
} from './normalize.js'

/**
 * Projects one turn's ACP updates onto the session's items: streamed messages
 * and thoughts, tool calls merged across their updates, and the turn's plan.
 * Each method returns whether the session changed.
 */
export class TurnView {
  readonly tools = new Map<string, ToolState>()
  /** The latest assistant message, which holds a worker's report. */
  lastText = ''
  /** The message or thought being streamed; a tool call or the other kind ends it. */
  private streaming: { id: string; kind: 'assistant' | 'reasoning' } | null = null
  private readonly todos = new Map<string, { content: string; status: string }>()

  constructor(readonly turnId: string) {}

  /** A `session/update` notification's `update`. */
  update(session: Session, update: { sessionUpdate: string } & Record<string, unknown>): boolean {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        const text = contentChunkText(update)
        if (!text) return false
        const kind = update.sessionUpdate === 'agent_message_chunk' ? 'assistant' : 'reasoning'
        const streaming = this.streaming
        let item =
          streaming?.kind === kind ? session.items.find((i) => i.id === streaming.id) : undefined
        if (!item) {
          this.endStreaming(session)
          item = {
            id: crypto.randomUUID(),
            kind,
            status: 'running',
            text: '',
            detail: '',
            turnId: this.turnId
          }
          session.items.push(item)
          this.streaming = { id: item.id, kind }
        }
        item.text += text
        if (kind === 'assistant') this.lastText = item.text
        return true
      }
      case 'tool_call':
      case 'tool_call_update': {
        const id = typeof update.toolCallId === 'string' ? update.toolCallId : ''
        const state = mergeToolCall(this.tools.get(id), update)
        if (!state) return false
        this.endStreaming(session)
        this.tools.set(state.id, state)
        upsert(session, toolCallItem(state, this.turnId))
        return true
      }
      case 'plan': {
        const entries = planEntriesSchema.safeParse(update.entries)
        if (!entries.success) return false
        this.showPlan(session, entries.data)
        return true
      }
      default:
        return false
    }
  }

  /** `cursor/update_todos`: replaces the turn's plan, or merges into it. */
  updateTodos(session: Session, params: unknown): boolean {
    const parsed = updateTodosSchema.safeParse(params)
    if (!parsed.success) return false
    if (!parsed.data.merge) this.todos.clear()
    for (const todo of parsed.data.todos)
      this.todos.set(todo.id, { content: todo.content, status: todo.status })
    this.showPlan(session, [...this.todos.values()])
    return true
  }

  /** `cursor/task`: a subagent Cursor started, shown as a tool call. */
  task(session: Session, params: unknown): boolean {
    const task = recordSchema.catch({}).parse(params ?? {})
    this.endStreaming(session)
    upsert(session, {
      id: typeof task.toolCallId === 'string' ? task.toolCallId : crypto.randomUUID(),
      kind: 'tool',
      status: 'running',
      text: safeText(task.description) || 'Task',
      detail: safeText(task.prompt).slice(0, 30_000),
      turnId: this.turnId
    })
    return true
  }

  private showPlan(session: Session, entries: { content: string; status: string }[]): void {
    this.endStreaming(session)
    upsert(session, {
      id: `${this.turnId}:plan`,
      kind: 'plan',
      status: 'completed',
      text: planText(entries),
      detail: '',
      turnId: this.turnId
    })
  }

  /** Finishes the streamed message or thought, so the next chunk starts a new item. */
  private endStreaming(session: Session): void {
    const streaming = this.streaming
    this.streaming = null
    const item = streaming ? session.items.find((i) => i.id === streaming.id) : undefined
    if (item?.status === 'running') item.status = 'completed'
  }
}

function upsert(session: Session, item: SessionItem): void {
  const index = session.items.findIndex((i) => i.id === item.id)
  if (index >= 0) session.items[index] = { ...session.items[index], ...item }
  else session.items.push(item)
}
