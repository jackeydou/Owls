import type { AgentMessage } from '@earendil-works/pi-agent-core'
import appPackage from '../../../../package.json'
import type {
  ClaudeConnection,
  CodexConnection,
  CodexFailure,
  CodexRouter
} from '../../../shared/codex.js'
import type { RouterSettings } from '../../../shared/router.js'
import type { RouterCredentials } from '../credentials.js'
import type { RouterEngine } from '../engine.js'
import { ROUTER_INSTRUCTIONS, ROUTER_PROMPT_VERSION } from '../prompt.js'
import type { RouterTool } from '../tools.js'
import { ClaudeEngine, type ClaudeRouterSdk } from './claude.js'
import { CodexEngine, type CodexRouterServer } from './codex.js'
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
/** What the CLI-backed engines need from the app. */
export type EngineDeps = {
  credentials: RouterCredentials
  claude: {
    sdk: ClaudeRouterSdk
    connection: () => ClaudeConnection
  }
  codex: {
    /** The Router's own app-server, shared by all Routers. */
    server: CodexRouterServer
    connection: () => CodexConnection
  }
}
/** Sent to keyless OpenAI-compatible endpoints; not a secret. */
const LOCAL_KEY = 'owls-local'
const version = `${appPackage.version}+router.${ROUTER_PROMPT_VERSION}`

/**
 * Builds the configured Router engine, or the failure that explains why it cannot
 * run. Owls engine requests are never sent without a key Owls stored, so pi-ai's
 * environment variable fallback is never reached.
 */
export function defaultEngineFactory(deps: EngineDeps): EngineFactory {
  return (request) => {
    const { settings } = request
    if (settings.engine === 'claude-code') {
      const connection = deps.claude.connection()
      if (connection.status !== 'ready' || !connection.executablePath)
        return { code: 'claude_not_connected', message: '' } satisfies CodexFailure
      return new ClaudeEngine({
        sdk: deps.claude.sdk,
        executable: connection.executablePath,
        cwd: request.router.cwd,
        model: settings.claudeModel,
        instructions: ROUTER_INSTRUCTIONS,
        tools: request.tools,
        version
      })
    }
    if (settings.engine === 'codex') {
      const connection = deps.codex.connection()
      if (
        connection.status !== 'ready' ||
        !connection.executablePath ||
        connection.account.kind === 'signed-out'
      )
        return { code: 'not_connected', message: '' }
      return new CodexEngine({
        server: deps.codex.server,
        executable: connection.executablePath,
        cwd: request.router.cwd,
        model: settings.codexModel,
        instructions: ROUTER_INSTRUCTIONS,
        promptVersion: ROUTER_PROMPT_VERSION,
        tools: request.tools,
        state: request.state
      })
    }
    const owls = settings.owls
    if (!owls) return { code: 'router_model_unconfigured', message: '' }
    const key = deps.credentials.key(owls.provider)
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
      version
    })
  }
}
