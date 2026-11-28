import {
  type AgentConfigs,
  type AgentProvider,
  allowedAgents,
  chosenModels,
  type Permission,
  type ProjectAgents
} from '../../shared/agents.js'
import type { AgentModel, Effort } from '../../shared/app.js'
import { RouterToolError } from './tools.js'

/** What a worker runs on: the agent, its model and effort (null for the agent's own), and access. */
export type AgentChoice = {
  provider: AgentProvider
  model: string | null
  effort: Effort | null
  permission: Permission
}

export type AgentChoiceRequest = {
  provider?: AgentProvider
  model?: string
  permission?: Permission
  /** Model and effort a sender already chose, as another device's command carries them. */
  selection?: { model: string | null; effort: Effort | null }
}

export type AgentChoiceContext = {
  /** The agent and model order of the project, or of the Workspace for tasks in no project. */
  project: ProjectAgents
  agents: AgentConfigs
  ready(provider: AgentProvider): boolean
  /** The models the agent offers now; empty while unknown. */
  models(provider: AgentProvider): AgentModel[]
}

/**
 * Picks the agent and model for a new worker. The agent is the one asked for, or the
 * project's first connected agent; the model is the one asked for, or the project's first
 * listed model the agent still offers, or the agent's own setting.
 */
export function chooseAgent(request: AgentChoiceRequest, context: AgentChoiceContext): AgentChoice {
  const { project } = context
  const allowed = allowedAgents(project)
  if (request.provider && !allowed.includes(request.provider))
    throw new RouterToolError(
      'provider_unavailable',
      `This project does not use ${request.provider}. Use one of: ${allowed.join(', ')}.`
    )
  const provider = request.provider ?? allowed.find((p) => context.ready(p))
  if (!provider)
    throw new RouterToolError(
      'provider_unavailable',
      `No coding agent for this project is connected (${allowed.join(', ')}).`
    )
  if (!context.ready(provider))
    throw new RouterToolError('provider_unavailable', `${provider} is not connected.`)
  const config = context.agents[provider]
  const permission = request.permission ?? config.permission
  if (request.selection) return { provider, permission, ...request.selection }
  const offered = context.models(provider)
  const offers = (id: string) => !offered.length || offered.some((m) => m.id === id)
  const listed = chosenModels(project, provider)
  if (request.model) {
    const allowedModel = listed.length ? listed.includes(request.model) : offers(request.model)
    if (!allowedModel || !offers(request.model))
      throw new RouterToolError(
        'invalid_request',
        `${provider} cannot use model ${request.model} here.${
          listed.length ? ` Use one of: ${listed.join(', ')}.` : ''
        }`
      )
  }
  const model = request.model ?? listed.find(offers) ?? config.model
  // The agent's effort setting carries over only to a model that supports it.
  const efforts = offered.find((m) => m.id === model)?.efforts
  const effort =
    model === config.model || (config.effort && efforts?.includes(config.effort))
      ? config.effort
      : null
  return { provider, permission, model, effort }
}
