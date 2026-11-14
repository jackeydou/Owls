import { z } from 'zod'
import type { CodexModel, SessionItem } from '../../shared/app.js'
import { effortSchema } from '../../shared/app.js'

export const recordSchema = z.record(z.string(), z.unknown())
export const frameSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: recordSchema.optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional()
})
export type RpcFrame = z.infer<typeof frameSchema>
export function record(value: unknown): Record<string, unknown> {
  return recordSchema.parse(value)
}
export function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}
export function safeText(value: unknown): string {
  return string(value)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(sk-[a-zA-Z0-9_-]{12,}|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_.-]+)/g, '[redacted]')
}
export function parseModels(value: unknown): CodexModel[] {
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
