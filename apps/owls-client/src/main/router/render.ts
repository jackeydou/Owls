import type { CodexProject } from '../../shared/codex.js'
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
/** Like `short`, but points the Router at the event that holds the full text. */
const clip = (text: string, limit: number, seq: number) =>
  text.length > limit ? `${text.slice(0, limit)}… (truncated, recall: ev_${seq})` : text

function eventText(event: InboxEvent): string {
  switch (event.kind) {
    case 'user_message':
      return `[${event.seq}] user_message · user · ${clock(event.at)}${event.workerId ? ` · to ${event.workerId}` : ''}\n${escapeBatch(clip(event.text, USER_TEXT_LIMIT, event.seq))}`
    case 'worker_report': {
      const artifacts = event.report.artifacts.length
        ? `\nArtifacts: ${event.report.artifacts.map((a) => `${a.kind}:${a.ref}`).join(', ')}`
        : ''
      return `[${event.seq}] worker_report · ${event.workerId} · ${clock(event.at)} · ${event.report.status}\nGoal: ${escapeBatch(short(event.goal, 200))}\n${escapeBatch(clip(event.report.summary, REPORT_TEXT_LIMIT, event.seq))}${escapeBatch(artifacts)}`
    }
    case 'worker_waiting':
      return `[${event.seq}] worker_waiting · ${event.workerId} · ${clock(event.at)}\nGoal: ${escapeBatch(short(event.goal, 200))}\nWaiting for the user to approve: ${escapeBatch(short(event.detail, 300))}`
    case 'worker_failed':
      return `[${event.seq}] worker_failed · ${event.workerId} · ${clock(event.at)}\nGoal: ${escapeBatch(short(event.goal, 200))}\nThe worker's turn failed. The user can see the error in that worker's details.`
    case 'worker_stopped':
      return `[${event.seq}] worker_stopped · ${event.workerId} · ${clock(event.at)}\nGoal: ${escapeBatch(short(event.goal, 200))}\nThe worker was stopped before it reported.`
    case 'worker_removed':
      return `[${event.seq}] worker_removed · ${event.workerId} · ${clock(event.at)}\nGoal: ${escapeBatch(short(event.goal, 200))}\nThe user removed this worker. Do not follow up on it.${event.branch ? ` Its unmerged work stays on branch ${escapeBatch(event.branch)}.` : ''}`
    case 'forwarded':
      return forwardedText(event)
  }
}

function forwardedText(event: Extract<InboxEvent, { kind: 'forwarded' }>): string {
  const from = event.from ? ` · from ${escapeBatch(short(event.from, 80))}` : ''
  const lines = [`[${event.seq}] forwarded · user · ${clock(event.at)}${from}`]
  lines.push(
    event.note
      ? `The user's note: ${escapeBatch(clip(event.note, USER_TEXT_LIMIT, event.seq))}`
      : 'The user added no note.'
  )
  if (event.workerId) {
    const branch = event.branch ? ` · branch ${escapeBatch(event.branch)}` : ''
    lines.push(`Result of worker ${event.workerId}${branch}`)
  }
  if (event.goal) lines.push(`Goal: ${escapeBatch(short(event.goal, 200))}`)
  lines.push(`Forwarded content:\n${escapeBatch(clip(event.text, USER_TEXT_LIMIT, event.seq))}`)
  if (event.artifacts.length)
    lines.push(
      escapeBatch(`Artifacts: ${event.artifacts.map((a) => `${a.kind}:${a.ref}`).join(', ')}`)
    )
  return lines.join('\n')
}

/**
 * Renders pending events as one Router input. A batch holding a single user
 * message is sent as that message so ordinary chat reads naturally.
 */
export function renderBatch(
  batchId: string,
  events: InboxEvent[],
  state: string | null,
  projects: string | null = null,
  memory: string | null = null
): string {
  const ordered = [...events].sort((a, b) => a.seq - b.seq)
  const only = ordered[0]
  if (
    ordered.length === 1 &&
    only?.kind === 'user_message' &&
    !only.workerId &&
    !state &&
    !projects &&
    !memory
  )
    return clip(only.text, USER_TEXT_LIMIT, only.seq)
  const header = `<owls-batch id="${batchId}" events="${ordered.length}">`
  const parts = [header]
  if (state) parts.push(`Current workers:\n${escapeBatch(state)}`)
  if (projects) parts.push(escapeBatch(projects))
  if (memory) parts.push(escapeBatch(memory))
  for (const event of ordered) parts.push(eventText(event))
  parts.push('</owls-batch>')
  return parts.join('\n')
}

/**
 * The projects a Router can dispatch to, sorted so the text only changes when
 * they do. Null with a single project, which every dispatch uses without naming it.
 */
export function renderProjects(projects: CodexProject[], defaultId: string | null): string | null {
  if (projects.length < 2) return null
  const lines = [...projects]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((p) => {
      const about = p.settings?.description.replace(/\s+/g, ' ').trim()
      const description = about ? ` — ${short(about, 200)}` : ''
      return escapeBatch(
        `- ${p.name} · ${p.id}${p.id === defaultId ? ' · default' : ''}${description}`
      )
    })
  return `Projects:\n${lines.join('\n')}`
}

/**
 * Deterministic summary of a Router's workers, for new or trimmed contexts.
 * `projectName` adds each worker's project when there is more than one.
 */
export function renderState(
  workers: RouterWorker[],
  projectName: (worker: RouterWorker) => string | null = () => null
): string {
  if (!workers.length) return 'No workers yet.'
  return [...workers]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((w) => {
      const summary = w.report ? ` — ${short(w.report.summary, 200)}` : ''
      const branch = w.workspace.kind === 'worktree' ? ` · branch ${w.workspace.branch}` : ''
      const parent = w.parentId ? ` · parent ${w.parentId}` : ''
      const name = projectName(w)
      const project = name ? ` · project ${name}` : ''
      return `- ${w.id} · ${w.status}${project}${parent}${branch} · ${short(w.goal, 200)}${summary}`
    })
    .join('\n')
}

type ContextMessage = { role: string; content?: unknown }
const size = (message: unknown) => Buffer.byteLength(JSON.stringify(message))
/** Share of the budget a new cut trims down to, so several batches fit before the next cut. */
const TRIM_TO = 0.6

/** Where the Owls engine last cut its context: the first kept message and its note. */
export type ContextWindow = { cut: number; note: string }

/**
 * Drops the oldest conversation segments once the messages outgrow `budget`,
 * down to `TRIM_TO` of it. Segments start at user messages, so tool calls stay
 * with their results. The first kept user message is prefixed with `note` (the
 * current worker state) so the Router does not lose track of work it
 * dispatched earlier.
 *
 * `previous` is the last cut. It is kept, note included, while the messages
 * after it still fit, so consecutive requests share their prefix and the
 * provider's prompt cache keeps working between cuts. Messages are only ever
 * appended, so a cut index stays valid for one engine's lifetime.
 */
export function trimContext<T extends ContextMessage>(
  messages: T[],
  budget: number,
  note: () => string,
  previous: ContextWindow | null = null
): { messages: T[]; window: ContextWindow | null } {
  const head = messages[0]?.role === 'system' ? 1 : 0
  const fixed = messages.slice(0, head)
  const rest = messages.slice(head)
  const tail = new Array<number>(rest.length + 1).fill(0)
  for (let i = rest.length - 1; i >= 0; i--) tail[i] = tail[i + 1] + size(rest[i])
  const base = fixed.reduce((sum, m) => sum + size(m), 0)
  const total = (from: number) => base + tail[from]
  let window =
    previous &&
    previous.cut > 0 &&
    rest[previous.cut]?.role === 'user' &&
    total(previous.cut) <= budget
      ? previous
      : null
  if (!window) {
    if (total(0) <= budget) return { messages, window: null }
    const target = Math.floor(budget * TRIM_TO)
    let cut = 0
    for (let i = 1; i < rest.length; i++) {
      if (rest[i].role !== 'user') continue
      cut = i
      if (total(i) <= target) break
    }
    if (cut === 0) return { messages, window: null }
    window = { cut, note: note() }
  }
  const [first, ...others] = rest.slice(window.cut)
  const prefix = `Earlier Router history was omitted to save space. Current workers:\n${window.note}\n\n`
  const content = first.content
  const patched =
    typeof content === 'string'
      ? { ...first, content: prefix + content }
      : Array.isArray(content)
        ? { ...first, content: [{ type: 'text', text: prefix }, ...content] }
        : first
  return { messages: [...fixed, patched, ...others], window }
}
