import { z } from 'zod'

export const permissionSchema = z.enum(['read-only', 'workspace-write', 'full-access'])
export const providerSchema = z.enum(['codex', 'claude-code', 'cursor'])
export const effortSchema = z.string().min(1).max(64)
export type AgentProvider = z.infer<typeof providerSchema>
export type Permission = z.infer<typeof permissionSchema>

/** How new workers run on one coding agent. A null model or effort uses the agent's own default. */
export const agentConfigSchema = z.object({
  model: z.string().min(1).max(200).nullable(),
  effort: effortSchema.nullable(),
  permission: permissionSchema
})
export type AgentConfig = z.infer<typeof agentConfigSchema>
/** Claude Code also chooses whether its workers get Claude in Chrome (`--chrome`). */
export const claudeAgentConfigSchema = agentConfigSchema.extend({
  chrome: z.boolean().default(true)
})
export type ClaudeAgentConfig = z.infer<typeof claudeAgentConfigSchema>
/**
 * Codex and Cursor choose whether their workers get Owlto's browser tool. Claude Code uses
 * Claude in Chrome instead.
 */
export const browserAgentConfigSchema = agentConfigSchema.extend({
  browser: z.boolean().default(true)
})
export type BrowserAgentConfig = z.infer<typeof browserAgentConfigSchema>
/** Whether a worker on this agent gets Owlto's browser tool. */
export function workerBrowserEnabled(configs: AgentConfigs, provider: AgentProvider): boolean {
  if (provider === 'claude-code') return false
  return configs[provider].browser
}
/**
 * The permissions each agent offers in Settings. Cursor has no reviewer that
 * works over ACP, so it keeps only its native modes: `ask` (read only) and
 * `agent` (full access).
 */
export function agentPermissions(provider: AgentProvider): Permission[] {
  return provider === 'cursor' ? ['read-only', 'full-access'] : [...permissionSchema.options]
}
export const agentConfigsSchema = z
  .object({
    codex: browserAgentConfigSchema,
    'claude-code': claudeAgentConfigSchema,
    cursor: browserAgentConfigSchema
  })
  // Settings saved before Cursor dropped workspace access move to its agent mode.
  .transform((configs) =>
    configs.cursor.permission === 'workspace-write'
      ? { ...configs, cursor: { ...configs.cursor, permission: 'full-access' as const } }
      : configs
  )
export type AgentConfigs = z.infer<typeof agentConfigsSchema>
export const defaultAgentConfig: AgentConfig = {
  model: null,
  effort: null,
  permission: 'workspace-write'
}
export const defaultAgentConfigs: AgentConfigs = {
  codex: { ...defaultAgentConfig, browser: true },
  'claude-code': { ...defaultAgentConfig, chrome: true },
  cursor: { ...defaultAgentConfig, permission: 'full-access', browser: true }
}

/** Most models one agent's list keeps for a project. */
export const PROJECT_MODEL_LIMIT = 100
const rankedModelSchema = z.object({ id: z.string().min(1).max(200), on: z.boolean() })
const rankedModelsSchema = z
  .array(rankedModelSchema)
  .max(PROJECT_MODEL_LIMIT)
  .refine((list) => new Set(list.map((m) => m.id)).size === list.length, 'Duplicate model')
/**
 * Which coding agents and models one project's workers use, in the user's order. The agent
 * list keeps unchecked entries too, so the order the user dragged them into survives. Model
 * lists hold only picked models (see `pickedModels`): an agent such as Cursor offers more
 * models than PROJECT_MODEL_LIMIT, so saving every offered model would fail validation.
 */
export const projectAgentsSchema = z.object({
  /** Empty until the user orders the agents; only checked agents take the project's tasks. */
  order: z
    .array(z.object({ id: providerSchema, on: z.boolean() }))
    .max(providerSchema.options.length)
    .refine((list) => new Set(list.map((a) => a.id)).size === list.length, 'Duplicate agent'),
  models: z.object({
    codex: rankedModelsSchema,
    'claude-code': rankedModelsSchema,
    cursor: rankedModelsSchema
  })
})
export type ProjectAgents = z.infer<typeof projectAgentsSchema>
export type RankedModel = z.infer<typeof rankedModelSchema>
export const defaultProjectAgents: ProjectAgents = {
  order: [],
  models: { codex: [], 'claude-code': [], cursor: [] }
}

/** True when the project picks its own agents; otherwise any connected agent takes its tasks. */
export function hasAgentChoice(agents: ProjectAgents): boolean {
  return agents.order.some((a) => a.on)
}
/** The agents a project's tasks may use, most preferred first; every agent when it picks none. */
export function allowedAgents(agents: ProjectAgents): AgentProvider[] {
  return hasAgentChoice(agents)
    ? agents.order.filter((a) => a.on).map((a) => a.id)
    : [...providerSchema.options]
}
/** The models a project picked for one agent, most preferred first; empty uses the agent's default. */
export function chosenModels(agents: ProjectAgents, provider: AgentProvider): string[] {
  return agents.models[provider].filter((m) => m.on).map((m) => m.id)
}
/** The model entries a project saves for one agent: the picked ones, in the user's order. */
export function pickedModels(items: ReadonlyArray<{ id: string; on: boolean }>): RankedModel[] {
  return items.filter((m) => m.on).map((m) => ({ id: m.id, on: true }))
}

/**
 * A ranked list with every id from `available` in it: saved entries first in their order,
 * then new ids unchecked. Saved ids that are no longer available stay, so a model an
 * agent stops listing for a while keeps its place.
 */
export function rankAll<T extends string>(
  saved: ReadonlyArray<{ id: T; on: boolean }>,
  available: readonly T[]
): Array<{ id: T; on: boolean }> {
  const known = new Set(saved.map((entry) => entry.id))
  return [...saved, ...available.filter((id) => !known.has(id)).map((id) => ({ id, on: false }))]
}
