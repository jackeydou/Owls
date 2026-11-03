import type { AgentMessage } from '@earendil-works/pi-agent-core'
import appPackage from '../../../../package.json'
import type { CodexFailure, CodexRouter } from '../../../shared/codex.js'
import type { RouterSettings } from '../../../shared/router.js'
import type { RouterCredentials } from '../credentials.js'
import type { RouterEngine } from '../engine.js'
import { ROUTER_INSTRUCTIONS, ROUTER_PROMPT_VERSION } from '../prompt.js'
import type { RouterTool } from '../tools.js'
import { OwlsEngine } from './owls.js'
import { resolveRouterModel } from './owls-models.js'

export type EngineRequest = {
  router: CodexRouter
  settings: RouterSettings
  tools: RouterTool[]
  history: unknown[]
  state: () => string
  persist: (batchId: string, messages: AgentMessage[]) => void
}
export type EngineFactory = (request: EngineRequest) => RouterEngine | CodexFailure
/** Sent to keyless OpenAI-compatible endpoints; not a secret. */
const LOCAL_KEY = 'owls-local'

/**
 * Builds the configured Router engine, or the failure that explains why it cannot
 * run. Requests are never sent without a key Owls stored, so pi-ai's environment
 * variable fallback is never reached.
 */
export function defaultEngineFactory(credentials: RouterCredentials): EngineFactory {
  return (request) => {
    const { settings } = request
    if (settings.engine !== 'owls')
      return { code: 'router_unavailable', message: '' } satisfies CodexFailure
    const owls = settings.owls
    if (!owls) return { code: 'router_model_unconfigured', message: '' }
    const key = credentials.key(owls.provider)
    if (!key && owls.provider !== 'custom')
      return { code: 'router_model_unconfigured', message: '' }
    const resolved = resolveRouterModel(owls)
    if (!resolved) return { code: 'model_unavailable', message: '' }
    return new OwlsEngine({
      routerId: request.router.id,
      model: resolved.model,
      thinking: owls.thinking,
      streamFn: resolved.models.streamSimple.bind(resolved.models),
      // OpenAI-compatible clients require a key even when a local server ignores it.
      getApiKey: (provider) =>
        provider !== owls.provider
          ? undefined
          : (key ?? (owls.provider === 'custom' ? LOCAL_KEY : undefined)),
      instructions: ROUTER_INSTRUCTIONS,
      tools: request.tools,
      history: request.history,
      state: request.state,
      persist: request.persist,
      version: `${appPackage.version}+router.${ROUTER_PROMPT_VERSION}`
    })
  }
}
