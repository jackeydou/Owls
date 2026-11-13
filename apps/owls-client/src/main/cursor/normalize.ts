import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import type {
  AgentRequest,
  AppSettings,
  CodexModel,
  CursorAccount,
  SessionItem
} from '../../shared/app.js'
import { fileDiff } from '../claude/normalize.js'
import { recordSchema, safeText, string } from '../codex/protocol.js'
import type { TurnProfile } from '../router/service.js'

/** Owls permission choices mapped onto Cursor's session modes. */
export function cursorMode(permission: AppSettings['permission']): 'ask' | 'agent' {
  return permission === 'read-only' ? 'ask' : 'agent'
}

/** Reads `agent status --format json`; plain text is the fallback for older CLIs. */
export function parseCursorStatus(output: string): CursorAccount {
  try {
    const status = recordSchema.parse(JSON.parse(output))
    if (status.isAuthenticated === false || status.status === 'unauthenticated')
      return { kind: 'signed-out' }
    const user = recordSchema.catch({}).parse(status.user ?? {})
    const email = [status.email, status.userEmail, user.email].find(
      (value): value is string => typeof value === 'string' && value.includes('@')
    )
    if (status.isAuthenticated === true || email)
      return { kind: 'cursor', email: email ? safeText(email).slice(0, 200) : null }
    return { kind: 'unknown' }
  } catch {
    const text = output.trim()
    if (/not (logged|signed) in|unauthenticated/i.test(text)) return { kind: 'signed-out' }
    const email = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(text)?.[0]
    if (email) return { kind: 'cursor', email: email.slice(0, 200) }
    return /logged in|signed in|authenticated/i.test(text)
      ? { kind: 'cursor', email: null }
      : { kind: 'unknown' }
  }
}

const MODEL_LINE = /^\s*(?:[-*•]\s+)?([A-Za-z0-9][\w.:/-]*)\s+-\s+(.+?)\s*$/
const MARKERS = /\s*\((current|default)(,\s*(current|default))?\)\s*/gi

/**
 * Reads the model list `agent models` prints, one `id - Name` line per model.
 * Lines in any other shape are skipped; an empty result leaves only the CLI's
 * default model to choose.
 */
export function parseCursorModels(output: string): CodexModel[] {
  const models = new Map<string, CodexModel>()
  for (const line of output.split(/\r?\n/)) {
    const match = MODEL_LINE.exec(line)
    if (!match) continue
    const [, id, label] = match
    if (models.has(id)) continue
    models.set(id, {
      id,
      name: safeText(label.replace(MARKERS, ' ').trim()).slice(0, 120) || id,
      description: '',
      isDefault: /\(([^)]*\b)?default\b/i.test(label),
      efforts: [],
      defaultEffort: null,
      autoMode: false
    })
  }
  return [...models.values()]
}

/**
 * The worker profile as plain text for the first prompt of a turn. With the
 * report tool attached the instructions suffice; otherwise, since ACP has no
 * output schema, the report format is spelled out for the model instead.
 */
export function workerPrompt(
  profile: Pick<TurnProfile, 'instructions' | 'reportSchema'>,
  reportTool = false
): string {
  if (reportTool) return profile.instructions
  return [
    profile.instructions,
    'Owls reads your final message as JSON. When you finish, your final message must be only a JSON object that matches this JSON Schema, with no Markdown fence and no other text:',
    JSON.stringify(profile.reportSchema)
  ].join('\n\n')
}

const toolKindSchema = z
  .enum(['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode'])
  .or(z.literal('other'))
  .catch('other')
const toolStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed'])
export type ToolKind = z.infer<typeof toolKindSchema>

/** The parts of an ACP tool call Owls shows, merged across its updates. */
export type ToolState = {
  id: string
  kind: ToolKind
  title: string
  status: z.infer<typeof toolStatusSchema>
  input: Record<string, unknown>
  paths: string[]
  diffs: { path: string; oldText: string; newText: string }[]
  output: string
}

const toolUpdateSchema = z.object({
  toolCallId: z.string().min(1),
  title: z.string().nullish(),
  kind: z.unknown().optional(),
  status: toolStatusSchema.nullish().catch(null),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
  locations: z
    .array(z.object({ path: z.string() }).loose())
    .nullish()
    .catch(null),
  content: z.array(recordSchema).nullish().catch(null)
})

function contentText(block: Record<string, unknown>): string {
  const inner = recordSchema.catch({}).parse(block.content ?? {})
  return inner.type === 'text' ? safeText(inner.text) : ''
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return safeText(value)
  const output = recordSchema.catch({}).parse(value ?? {})
  const text = [output.output, output.stdout, output.stderr, output.content, output.result].find(
    (part): part is string => typeof part === 'string' && part.length > 0
  )
  return text ? safeText(text) : ''
}

/** Applies a `tool_call` or `tool_call_update`; null when it names no tool call. */
export function mergeToolCall(previous: ToolState | undefined, raw: unknown): ToolState | null {
  const parsed = toolUpdateSchema.safeParse(raw)
  if (!parsed.success) return null
  const update = parsed.data
  const state: ToolState = previous
    ? { ...previous, paths: [...previous.paths], diffs: [...previous.diffs] }
    : {
        id: update.toolCallId,
        kind: 'other',
        title: '',
        status: 'pending',
        input: {},
        paths: [],
        diffs: [],
        output: ''
      }
  if (update.kind !== undefined && update.kind !== null)
    state.kind = toolKindSchema.parse(update.kind)
  if (update.title) state.title = safeText(update.title).slice(0, 500)
  if (update.status) state.status = update.status
  if (update.rawInput !== undefined)
    state.input = recordSchema.catch({}).parse(update.rawInput ?? {})
  if (update.locations) state.paths = update.locations.map((l) => safeText(l.path))
  if (update.content) {
    const texts: string[] = []
    const diffs: ToolState['diffs'] = []
    for (const block of update.content) {
      if (block.type === 'diff' && typeof block.path === 'string')
        diffs.push({
          path: safeText(block.path),
          oldText: string(block.oldText),
          newText: string(block.newText)
        })
      else if (block.type === 'content') texts.push(contentText(block))
    }
    if (diffs.length) state.diffs = diffs
    const text = texts.filter(Boolean).join('\n')
    if (text) state.output = text
  }
  if (update.rawOutput !== undefined) {
    const text = outputText(update.rawOutput)
    if (text) state.output = text
  }
  return state
}

function commandText(state: ToolState): string {
  const command = state.input.command
  if (Array.isArray(command))
    return safeText(command.filter((c) => typeof c === 'string').join(' '))
  return safeText(command) || state.title
}

function filePaths(state: ToolState): string[] {
  const paths = state.diffs.length ? state.diffs.map((d) => d.path) : state.paths
  return [...new Set(paths)]
}

/** The session item a tool call shows as. */
export function toolCallItem(state: ToolState, turnId: string): SessionItem {
  const status =
    state.status === 'completed' ? 'completed' : state.status === 'failed' ? 'failed' : 'running'
  const base = { id: state.id, turnId, status } as const
  if (state.kind === 'execute')
    return {
      ...base,
      kind: 'command',
      text: commandText(state),
      detail: state.output.slice(-100_000)
    }
  if (state.kind === 'edit' || state.kind === 'delete' || state.kind === 'move') {
    const diff = state.diffs.map((d) => fileDiff(d.path, d.oldText, d.newText)).join('\n')
    return {
      ...base,
      kind: 'files',
      text: filePaths(state).join(', ') || state.title,
      detail: (status === 'failed' && state.output ? `${diff}\n${state.output}` : diff).slice(
        0,
        200_000
      )
    }
  }
  const detail =
    state.output || (Object.keys(state.input).length ? JSON.stringify(state.input) : '')
  return {
    ...base,
    kind: 'tool',
    text: state.title || state.kind,
    detail: safeText(detail).slice(0, 30_000)
  }
}

function inside(cwd: string, path: string): boolean {
  const target = relative(resolve(cwd), resolve(cwd, path))
  return target === '' || (!target.startsWith('..') && !isAbsolute(target))
}

/**
 * What Owls does with a tool approval before asking the user. Workspace write
 * accepts reads and edits inside the session's folder and asks for commands,
 * like Claude Code's accept-edits mode; read-only also refuses edits outright.
 */
export function approvalPolicy(
  permission: AppSettings['permission'],
  state: ToolState,
  cwd: string
): 'allow' | 'reject' | 'ask' {
  if (permission === 'full-access') return 'allow'
  const local = filePaths(state).every((path) => inside(cwd, path))
  const editing = state.kind === 'edit' || state.kind === 'delete' || state.kind === 'move'
  if (editing) return permission === 'read-only' ? 'reject' : local ? 'allow' : 'ask'
  if (state.kind === 'read' || state.kind === 'search' || state.kind === 'think')
    return local ? 'allow' : 'ask'
  return 'ask'
}

export const permissionOptionSchema = z.object({
  optionId: z.string().min(1),
  name: z.string().default(''),
  kind: z.string()
})
export type PermissionOption = z.infer<typeof permissionOptionSchema>

/** The option to send for a decision, by kind; once-only options win over always ones. */
export function chooseOption(
  options: PermissionOption[],
  decision: 'allow' | 'reject'
): string | null {
  const order =
    decision === 'allow' ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always']
  for (const kind of order) {
    const option = options.find((o) => o.kind === kind)
    if (option) return option.optionId
  }
  return null
}

/** A tool approval the user answers in Owls. */
export function approvalRequest(state: ToolState, turnId: string): AgentRequest {
  const item = toolCallItem(state, turnId)
  const kind = item.kind === 'command' ? 'command' : item.kind === 'files' ? 'files' : 'permissions'
  return {
    id: crypto.randomUUID(),
    kind,
    title: kind === 'permissions' ? state.title || item.text : item.text,
    detail: kind === 'command' ? '' : item.detail.slice(0, 4000),
    questions: [],
    status: 'pending',
    turnId
  }
}

export const askQuestionSchema = z.object({
  title: z.string().nullish(),
  questions: z
    .array(
      z.object({
        id: z.string().min(1),
        prompt: z.string(),
        options: z.array(z.object({ id: z.string().min(1), label: z.string() })).default([]),
        allowMultiple: z.boolean().default(false)
      })
    )
    .min(1)
})
export type AskQuestion = z.infer<typeof askQuestionSchema>

/** `cursor/ask_question` as an Owls question request. */
export function questionRequest(input: AskQuestion, turnId: string): AgentRequest {
  return {
    id: crypto.randomUUID(),
    kind: 'question',
    title: safeText(input.title ?? ''),
    detail: '',
    questions: input.questions.map((q) => ({
      id: q.id,
      header: '',
      question: safeText(q.prompt),
      isSecret: false,
      options: q.options.length
        ? q.options.map((o) => ({ label: safeText(o.label), description: '' }))
        : null
    })),
    status: 'pending',
    turnId
  }
}

/**
 * The user's answers as Cursor's response. Answers name options by label; typed
 * text that matches no option is passed on as the reason for skipping.
 */
export function questionResponse(
  input: AskQuestion,
  answers: Record<string, string[]>
): Record<string, unknown> {
  const typed: string[] = []
  const selected = input.questions.map((q) => {
    const given = (answers[q.id] ?? []).map((a) => a.trim()).filter(Boolean)
    const ids = given.flatMap((answer) => {
      const option = q.options.find((o) => o.label === answer || o.id === answer)
      if (!option) typed.push(answer)
      return option ? [option.id] : []
    })
    return { questionId: q.id, selectedOptionIds: q.allowMultiple ? ids : ids.slice(0, 1) }
  })
  if (typed.length && selected.every((s) => !s.selectedOptionIds.length))
    return { outcome: { outcome: 'skipped', reason: `The user answered: ${typed.join('; ')}` } }
  return { outcome: { outcome: 'answered', answers: selected } }
}

export const createPlanSchema = z.object({
  name: z.string().nullish(),
  overview: z.string().nullish(),
  plan: z.string().nullish()
})

/** `cursor/create_plan` as an approval of the plan. */
export function planRequest(input: z.infer<typeof createPlanSchema>, turnId: string): AgentRequest {
  return {
    id: crypto.randomUUID(),
    kind: 'permissions',
    title: safeText(input.name ?? '') || 'Plan',
    detail: [input.overview, input.plan]
      .map((part) => safeText(part ?? ''))
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 4000),
    questions: [],
    status: 'pending',
    turnId
  }
}

const todoSchema = z.object({ id: z.string(), content: z.string(), status: z.string() })
export const planEntriesSchema = z.array(
  z.object({ content: z.string(), status: z.string() }).loose()
)
export const updateTodosSchema = z.object({
  todos: z.array(todoSchema),
  merge: z.boolean().default(false)
})

/** Plan entries or todos as the text of a `plan` item. */
export function planText(entries: { content: string; status: string }[]): string {
  return entries
    .map((entry) => (entry.status === 'completed' ? '✓ ' : '• ') + safeText(entry.content))
    .join('\n')
}

/** The text of a message or thought chunk; images and other content are not shown. */
export function contentChunkText(raw: unknown): string {
  const content = recordSchema
    .catch({})
    .parse(recordSchema.catch({}).parse(raw ?? {}).content ?? {})
  return content.type === 'text' ? safeText(content.text) : ''
}
