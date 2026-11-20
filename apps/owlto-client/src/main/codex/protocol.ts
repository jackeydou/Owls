import { z } from 'zod'
import type { Permission } from '../../shared/agents.js'
import type { AgentModel, CodexAccount, SessionItem } from '../../shared/app.js'
import { effortSchema } from '../../shared/app.js'
import { record, recordSchema, safeText, string } from '../app/values.js'

export const frameSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: recordSchema.optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional()
})
export type RpcFrame = z.infer<typeof frameSchema>
/**
 * Maps an Owlto permission onto a Codex worker's sandbox and approvals. Once
 * the sandbox may write, escalations (network, paths outside the writable
 * roots) go to Codex's auto-review agent first, so only the requests it cannot
 * settle reach the user. Read only keeps the user as the reviewer, so nothing
 * can approve its way out of that sandbox.
 */
export function approvalOptions(permission: Permission): {
  approvalPolicy: 'on-request'
  approvalsReviewer: 'user' | 'auto_review'
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
} {
  return {
    approvalPolicy: 'on-request',
    approvalsReviewer: permission === 'read-only' ? 'user' : 'auto_review',
    sandbox: permission === 'full-access' ? 'danger-full-access' : permission
  }
}

export function parseAccount(value: unknown): CodexAccount {
  const response = record(value)
  if (response.account === null)
    return response.requiresOpenaiAuth === false ? { kind: 'external' } : { kind: 'signed-out' }
  const account = record(response.account)
  if (account.type === 'chatgpt')
    return {
      kind: 'chatgpt',
      email: string(account.email) || null,
      plan: string(account.planType) || null
    }
  return account.type === 'apiKey' ? { kind: 'api-key' } : { kind: 'external' }
}

export function parseModels(value: unknown): AgentModel[] {
  const response = z
    .object({
      data: z.array(
        z.object({
          model: z.string(),
          displayName: z.string(),
          description: z.string().default(''),
          isDefault: z.boolean(),
          hidden: z.boolean().default(false),
          defaultReasoningEffort: effortSchema,
          supportedReasoningEfforts: z.array(z.object({ reasoningEffort: effortSchema }))
        })
      )
    })
    .parse(value)
  return response.data
    .filter((m) => !m.hidden)
    .map((m) => ({
      id: m.model,
      name: m.displayName,
      description: m.description,
      isDefault: m.isDefault,
      defaultEffort: m.defaultReasoningEffort,
      efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort),
      autoMode: false
    }))
}
export function normalizeItem(
  value: unknown,
  turnId: string | null,
  completed: boolean
): SessionItem {
  const item = record(value)
  const id = z.string().parse(item.id)
  const type = z.string().parse(item.type)
  const status: SessionItem['status'] =
    item.status === 'failed' || item.status === 'declined'
      ? 'failed'
      : completed
        ? 'completed'
        : 'running'
  const base = { id, turnId, status, detail: '' }
  switch (type) {
    case 'userMessage': {
      const content = z.array(recordSchema).parse(item.content)
      return {
        ...base,
        kind: 'user',
        status: 'completed',
        text: content
          .map((p) => string(p.text))
          .filter(Boolean)
          .join('\n')
      }
    }
    case 'agentMessage':
      return { ...base, kind: 'assistant', text: safeText(item.text) }
    case 'reasoning':
      return {
        ...base,
        kind: 'reasoning',
        text: z.array(z.string()).catch([]).parse(item.summary).map(safeText).join('\n')
      }
    case 'plan':
      return { ...base, kind: 'plan', text: safeText(item.text) }
    case 'commandExecution':
      return {
        ...base,
        kind: 'command',
        text: safeText(item.command),
        detail: safeText(item.aggregatedOutput).slice(-100_000)
      }
    case 'fileChange': {
      const changes = z.array(recordSchema).parse(item.changes)
      return {
        ...base,
        kind: 'files',
        text: changes.map((c) => string(c.path)).join('\n'),
        detail: changes
          .map((c) => safeText(c.diff))
          .join('\n')
          .slice(-200_000)
      }
    }
    case 'mcpToolCall':
      return {
        ...base,
        kind: 'tool',
        text: `${string(item.server)} / ${string(item.tool)}`,
        detail: safeText(JSON.stringify(item.error ?? item.result ?? item.arguments ?? null)).slice(
          0,
          30_000
        )
      }
    case 'dynamicToolCall':
      return {
        ...base,
        kind: 'tool',
        text: string(item.tool),
        detail: safeText(JSON.stringify(item.arguments ?? null)).slice(0, 30_000)
      }
    case 'collabAgentToolCall':
      return { ...base, kind: 'tool', text: string(item.tool), detail: safeText(item.prompt) }
    case 'webSearch':
      return { ...base, kind: 'tool', text: 'webSearch', detail: safeText(item.query) }
    default:
      return { ...base, kind: 'tool', text: type }
  }
}
