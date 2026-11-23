import type { Permission } from '../../shared/agents.js'
import type { AgentModel } from '../../shared/app.js'
import { recordSchema, safeText } from '../app/values.js'

/**
 * Owlto permission choices mapped onto Antigravity's session modes: `plan` only
 * plans, `accept-edits` edits without asking. Commands still come to Owlto as
 * permission requests, which full access accepts.
 */
export function antigravityMode(permission: Permission): 'plan' | 'default' | 'accept-edits' {
  if (permission === 'read-only') return 'plan'
  return permission === 'full-access' ? 'accept-edits' : 'default'
}

/** Antigravity's thinking levels, lowest first, as its model picker names them. */
export const ANTIGRAVITY_EFFORTS = ['low', 'medium', 'high', 'extra', 'max'] as const

const MODEL_LINE = /^\s*(?:[-*•>]\s+)?([A-Za-z0-9][\w.:/-]*)(?:\s+(?:-|—|–|\|)\s+|\s{2,})(.+?)\s*$/
const BARE_MODEL_LINE =
  /^\s*(?:[-*•>]\s+)?([a-z0-9][a-z0-9.:/-]*[0-9][a-z0-9.:/-]*)\s*(\((?:current|default)\))?\s*$/i
const MARKERS = /\s*[([](current|default|selected)(,\s*(current|default|selected))*[)\]]\s*/gi

function model(id: string, label: string, isDefault: boolean): AgentModel {
  return {
    id,
    name: safeText(label.replace(MARKERS, ' ').trim()).slice(0, 120) || id,
    description: '',
    isDefault,
    efforts: [...ANTIGRAVITY_EFFORTS],
    defaultEffort: null,
    autoMode: false
  }
}

/** A JSON model list: an array, or an object holding one under `models`. */
function jsonModels(output: string): AgentModel[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    return null
  }
  const list = Array.isArray(parsed) ? parsed : recordSchema.catch({}).parse(parsed).models
  if (!Array.isArray(list)) return null
  const models = new Map<string, AgentModel>()
  for (const raw of list) {
    const entry = recordSchema.catch({}).parse(raw ?? {})
    const id = [entry.id, entry.modelId, entry.slug, entry.name].find(
      (value): value is string => typeof value === 'string' && value.length > 0
    )
    if (!id || models.has(id)) continue
    const label = [entry.displayName, entry.label, entry.name].find(
      (value): value is string => typeof value === 'string' && value.length > 0
    )
    models.set(id, model(id, label ?? id, entry.default === true || entry.isDefault === true))
  }
  return [...models.values()]
}

/**
 * Reads the model list `agy models` prints: JSON when the CLI gives it, else one
 * model per line as `id - Name`, `id  Name`, or a bare id. Other lines, such as
 * headings, are skipped; an empty result leaves only the CLI's default model.
 */
export function parseAntigravityModels(output: string): AgentModel[] {
  const fromJson = jsonModels(output.trim())
  if (fromJson) return fromJson
  const models = new Map<string, AgentModel>()
  for (const line of output.split(/\r?\n/)) {
    const match = MODEL_LINE.exec(line) ?? BARE_MODEL_LINE.exec(line)
    if (!match) continue
    const [, id, label = ''] = match
    if (models.has(id) || /^(available|models?|usage|error)$/i.test(id)) continue
    models.set(id, model(id, label || id, /\b(current|default)\b/i.test(label)))
  }
  return [...models.values()]
}

/** True when the CLI's output says no account is signed in. */
export function signedOut(output: string): boolean {
  return /authentication required|not (logged|signed) in|sign in|log ?in required|unauthenticated/i.test(
    output
  )
}
