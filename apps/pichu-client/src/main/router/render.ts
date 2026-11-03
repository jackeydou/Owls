import type { RouterWorker } from '../../shared/router.js'
import type { InboxEvent } from './events.js'

/** Upper bound for the Owls engine's request context, estimated in UTF-8 bytes. */
export const ROUTER_CONTEXT_BUDGET = 48_000
const USER_TEXT_LIMIT = 8000
const REPORT_TEXT_LIMIT = 600

const escapeBatch = (text: string) => text.replaceAll('</owls-batch>', '<\\/owls-batch>')
const clock = (iso: string) => iso.slice(11, 19)
const short = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit)}… (truncated)` : text

function eventText(event: InboxEvent): string {
  switch (event.kind) {
    case 'user_message':
      return `[${event.seq}] user_message · user · ${clock(event.at)}\n${escapeBatch(short(event.text, USER_TEXT_LIMIT))}`
    case 'worker_report': {
      const artifacts = event.report.artifacts.length
        ? `\nArtifacts: ${event.report.artifacts.map((a) => `${a.kind}:${a.ref}`).join(', ')}`
        : ''
      return `[${event.seq}] worker_report · ${event.workerId} · ${clock(event.at)} · ${event.report.status}\nGoal: ${escapeBatch(short(event.goal, 200))}\n${escapeBatch(short(event.report.summary, REPORT_TEXT_LIMIT))}${escapeBatch(artifacts)}`
    }
    case 'worker_waiting':
      return `[${event.seq}] worker_waiting · ${event.workerId} · ${clock(event.at)}\nGoal: ${escapeBatch(short(event.goal, 200))}\nWaiting for the user to approve: ${escapeBatch(short(event.detail, 300))}`
    case 'worker_failed':
      return `[${event.seq}] worker_failed · ${event.workerId} · ${clock(event.at)}\nGoal: ${escapeBatch(short(event.goal, 200))}\nThe worker's turn failed. The user can see the error in that task.`
    case 'worker_stopped':
      return `[${event.seq}] worker_stopped · ${event.workerId} · ${clock(event.at)}\nGoal: ${escapeBatch(short(event.goal, 200))}\nThe worker was stopped before it reported.`
    case 'worker_removed':
      return `[${event.seq}] worker_removed · ${event.workerId} · ${clock(event.at)}\nGoal: ${escapeBatch(short(event.goal, 200))}\nThe user removed this worker's task. Do not follow up on it.`
  }
}

/**
 * Renders pending events as one Router input. A batch holding a single user
 * message is sent as that message so ordinary chat reads naturally.
 */
export function renderBatch(batchId: string, events: InboxEvent[], state: string | null): string {
  const ordered = [...events].sort((a, b) => a.seq - b.seq)
  const only = ordered[0]
  if (ordered.length === 1 && only?.kind === 'user_message' && !state)
    return short(only.text, USER_TEXT_LIMIT)
  const header = `<owls-batch id="${batchId}" events="${ordered.length}">`
  const parts = [header]
  if (state) parts.push(`Current workers:\n${escapeBatch(state)}`)
  for (const event of ordered) parts.push(eventText(event))
  parts.push('</owls-batch>')
  return parts.join('\n')
}

/** Deterministic summary of a Router's workers, for new or trimmed contexts. */
export function renderState(workers: RouterWorker[]): string {
  if (!workers.length) return 'No workers yet.'
  return [...workers]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((w) => {
      const summary = w.report ? ` — ${short(w.report.summary, 200)}` : ''
      return `- ${w.id} · ${w.status} · ${short(w.goal, 200)}${summary}`
    })
    .join('\n')
}

type ContextMessage = { role: string; content?: unknown }
const size = (message: unknown) => Buffer.byteLength(JSON.stringify(message))

/**
 * Drops the oldest conversation segments until the messages fit the budget.
 * Segments start at user messages, so tool calls stay with their results. The
 * first kept user message is prefixed with `note` (the current worker state)
 * so the Router does not lose track of work it dispatched earlier.
 */
export function trimContext<T extends ContextMessage>(
  messages: T[],
  budget: number,
  note: () => string
): T[] {
  const head = messages[0]?.role === 'system' ? 1 : 0
  const fixed = messages.slice(0, head)
  const rest = messages.slice(head)
  const starts = rest.flatMap((m, i) => (m.role === 'user' ? [i] : []))
  const total = (from: number) =>
    [...fixed, ...rest.slice(from)].reduce((sum, m) => sum + size(m), 0)
  let cut = 0
  for (const start of starts) {
    if (total(cut) <= budget) break
    if (start <= cut) continue
    cut = start
  }
  if (cut === 0) return messages
  const kept = rest.slice(cut)
  const [first, ...others] = kept
  const prefix = `Earlier Router history was omitted to save space. Current workers:\n${note()}\n\n`
  const content = first.content
  const patched =
    typeof content === 'string'
      ? { ...first, content: prefix + content }
      : Array.isArray(content)
        ? { ...first, content: [{ type: 'text', text: prefix }, ...content] }
        : first
  return [...fixed, patched, ...others]
}
