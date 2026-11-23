import { z } from 'zod'
import type { Permission } from '../../shared/agents.js'
import type { AcpAccount, AgentModel, AgentRequest } from '../../shared/app.js'
import { recordSchema, safeText } from '../app/values.js'

/** Owlto permission choices mapped onto Cursor's session modes. */
export function cursorMode(permission: Permission): 'ask' | 'agent' {
  return permission === 'read-only' ? 'ask' : 'agent'
}

/** Reads `agent status --format json`; plain text is the fallback for older CLIs. */
export function parseCursorStatus(output: string): AcpAccount {
  try {
    const status = recordSchema.parse(JSON.parse(output))
    if (status.isAuthenticated === false || status.status === 'unauthenticated')
      return { kind: 'signed-out' }
    const user = recordSchema.catch({}).parse(status.user ?? {})
    const email = [status.email, status.userEmail, user.email].find(
      (value): value is string => typeof value === 'string' && value.includes('@')
    )
    if (status.isAuthenticated === true || email)
      return { kind: 'signed-in', email: email ? safeText(email).slice(0, 200) : null }
    return { kind: 'unknown' }
  } catch {
    const text = output.trim()
    if (/not (logged|signed) in|unauthenticated/i.test(text)) return { kind: 'signed-out' }
    const email = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(text)?.[0]
    if (email) return { kind: 'signed-in', email: email.slice(0, 200) }
    return /logged in|signed in|authenticated/i.test(text)
      ? { kind: 'signed-in', email: null }
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
export function parseCursorModels(output: string): AgentModel[] {
  const models = new Map<string, AgentModel>()
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

/** `cursor/ask_question` as an Owlto question request. */
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
