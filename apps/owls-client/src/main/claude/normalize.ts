import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk/core'
import { z } from 'zod'
import type {
  AgentRequest,
  AppSettings,
  ClaudeAccount,
  CodexModel,
  SessionItem
} from '../../shared/app.js'
import { effortSchema } from '../../shared/app.js'
import { recordSchema, safeText, string } from '../codex/protocol.js'

export const claudeEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

export function parseClaudeModels(value: unknown): CodexModel[] {
  return z
    .array(
      z.object({
        value: z.string().min(1),
        displayName: z.string().default(''),
        description: z.string().default(''),
        supportedEffortLevels: z.array(effortSchema).optional(),
        supportsAutoMode: z.boolean().optional()
      })
    )
    .parse(value)
    .map((m) => ({
      id: m.value,
      name: m.displayName || m.value,
      description: m.description,
      isDefault: m.value === 'default',
      efforts: m.supportedEffortLevels ?? [],
      defaultEffort: null,
      autoMode: m.supportsAutoMode === true
    }))
}

export function parseClaudeAccount(value: unknown): ClaudeAccount {
  const account = z
    .object({
      email: z.string().optional(),
      subscriptionType: z.string().optional(),
      apiKeySource: z.string().optional(),
      apiProvider: z.string().optional()
    })
    .catch({})
    .parse(value ?? {})
  if (account.apiProvider && account.apiProvider !== 'firstParty') return { kind: 'external' }
  if (account.email || account.subscriptionType)
    return { kind: 'claude', email: account.email ?? null, plan: account.subscriptionType ?? null }
  if (account.apiKeySource && account.apiKeySource !== 'none') return { kind: 'api-key' }
  return { kind: 'unknown' }
}

/**
 * Maps Owls permission choices onto Claude Code's native permission modes.
 * Claude Code has no OS sandbox by default, so read-only removes the editing
 * tools and keeps every other action behind an approval prompt. Full access
 * uses auto mode only when the model reports support for it; approvals the
 * classifier cannot decide are still routed to the user.
 */
export function permissionOptions(
  permission: AppSettings['permission'],
  autoMode: boolean
): { permissionMode: PermissionMode; disallowedTools?: string[] } {
  if (permission === 'read-only')
    return { permissionMode: 'default', disallowedTools: [...WRITE_TOOLS].sort() }
  if (permission === 'full-access' && autoMode) return { permissionMode: 'auto' }
  return { permissionMode: 'acceptEdits' }
}

function toolLabel(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
  return mcp ? `${mcp[1]} / ${mcp[2]}` : name
}

export function fileDiff(path: string, before: string, after: string): string {
  const lines = [`--- ${path}`, `+++ ${path}`]
  if (before) lines.push(...before.split('\n').map((line) => `-${line}`))
  if (after) lines.push(...after.split('\n').map((line) => `+${line}`))
  return safeText(lines.join('\n')).slice(0, 200_000)
}

export function toolItem(
  id: string,
  name: string,
  rawInput: unknown,
  turnId: string | null
): SessionItem {
  const input = recordSchema.catch({}).parse(rawInput)
  const base = { id, turnId, status: 'running' as const }
  if (COMMAND_TOOLS.has(name))
    return { ...base, kind: 'command', text: safeText(input.command), detail: '' }
  if (name === 'Edit') {
    const path = string(input.file_path)
    return {
      ...base,
      kind: 'files',
      text: path,
      detail: fileDiff(path, string(input.old_string), string(input.new_string))
    }
  }
  if (name === 'Write' || name === 'NotebookEdit') {
    const path = string(name === 'Write' ? input.file_path : input.notebook_path)
    const content = string(name === 'Write' ? input.content : input.new_source)
    return { ...base, kind: 'files', text: path, detail: fileDiff(path, '', content) }
  }
  if (name === 'TodoWrite') {
    const todos = z.array(recordSchema).catch([]).parse(input.todos)
    return {
      ...base,
      kind: 'plan',
      text: todos
        .map((todo) => (todo.status === 'completed' ? '✓ ' : '• ') + safeText(todo.content))
        .join('\n'),
      detail: ''
    }
  }
  return {
    ...base,
    kind: 'tool',
    text: toolLabel(name),
    detail: safeText(JSON.stringify(input)).slice(0, 30_000)
  }
}

export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return safeText(content)
  return z
    .array(recordSchema)
    .catch([])
    .parse(content)
    .filter((block) => block.type === 'text')
    .map((block) => safeText(block.text))
    .join('\n')
}

export function completeToolItem(item: SessionItem, output: string, isError: boolean): SessionItem {
  const status = isError ? 'failed' : 'completed'
  if (item.kind === 'command') return { ...item, status, detail: output.slice(-100_000) }
  if (item.kind === 'files')
    return { ...item, status, detail: isError ? `${item.detail}\n${output}` : item.detail }
  if (item.kind === 'tool' && output) return { ...item, status, detail: output.slice(0, 30_000) }
  return { ...item, status }
}

export function turnDiff(items: SessionItem[], turnId: string): string {
  return items
    .filter((item) => item.turnId === turnId && item.kind === 'files' && item.status !== 'failed')
    .map((item) => item.detail)
    .join('\n')
    .slice(0, 500_000)
}

const questionsSchema = z.array(
  z.object({
    question: z.string(),
    header: z.string().default(''),
    options: z
      .array(z.object({ label: z.string(), description: z.string().default('') }))
      .default([])
  })
)

export function permissionRequest(
  toolName: string,
  rawInput: Record<string, unknown>,
  context: { title?: string; decisionReason?: string; blockedPath?: string },
  turnId: string
): AgentRequest {
  const id = crypto.randomUUID()
  if (toolName === 'AskUserQuestion') {
    return {
      id,
      kind: 'question',
      title: '',
      detail: '',
      questions: questionsSchema.parse(rawInput.questions).map((q, index) => ({
        id: `q${index}`,
        header: safeText(q.header),
        question: safeText(q.question),
        isSecret: false,
        options: q.options.length
          ? q.options.map((o) => ({
              label: safeText(o.label),
              description: safeText(o.description)
            }))
          : null
      })),
      status: 'pending',
      turnId
    }
  }
  const item = toolItem(id, toolName, rawInput, turnId)
  const kind = COMMAND_TOOLS.has(toolName)
    ? 'command'
    : WRITE_TOOLS.has(toolName)
      ? 'files'
      : 'permissions'
  const reason = [context.decisionReason, context.blockedPath]
    .map((part) => safeText(part))
    .filter(Boolean)
  const description = safeText(rawInput.description)
  return {
    id,
    kind,
    title: kind === 'permissions' ? safeText(context.title) || item.text : item.text,
    detail:
      kind === 'permissions'
        ? [...reason, item.detail.slice(0, 4000)].filter(Boolean).join('\n')
        : [description, ...reason].filter(Boolean).join('\n'),
    questions: [],
    status: 'pending',
    turnId
  }
}

/** Builds AskUserQuestion answers keyed by the original question text. */
export function questionAnswers(
  rawInput: Record<string, unknown>,
  request: AgentRequest,
  answers: Record<string, string[]>
): Record<string, string> {
  const questions = questionsSchema.parse(rawInput.questions)
  return Object.fromEntries(
    request.questions.map((question, index) => [
      questions[index]?.question ?? question.question,
      (answers[question.id] ?? [])
        .map((answer) => answer.trim())
        .filter(Boolean)
        .join(', ')
    ])
  )
}
