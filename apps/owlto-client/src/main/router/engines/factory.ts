import { createHash } from 'node:crypto'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import appPackage from '../../../../package.json'
import type { ClaudeConnection, CodexConnection, Failure, Router } from '../../../shared/app.js'
import type { RouterSettings } from '../../../shared/router.js'
import { ROUTER_INSTRUCTIONS } from '../../../shared/router-instructions.js'
import type { DreamingEngineFactory } from '../../memory/dreaming.js'
import { DREAMING_INSTRUCTIONS, DREAMING_PROMPT_VERSION } from '../../memory/prompt.js'
import type { RouterCredentials } from '../credentials.js'
import type { RouterEngine } from '../engine.js'
import { ROUTER_PROMPT_VERSION } from '../prompt.js'
import type { RouterTool } from '../tools.js'
import { ClaudeEngine, type ClaudeRouterSdk } from './claude.js'
import { CodexEngine, type CodexRouterServer } from './codex.js'
import { OwltoEngine } from './owlto.js'
import { resolveRouterModel } from './owlto-models.js'

export type EngineRequest = {
  router: Router
  settings: RouterSettings
  tools: RouterTool[]
  history: unknown[]
  state: () => string
  persist: (batchId: string, messages: AgentMessage[]) => void
}
export type EngineFactory = (request: EngineRequest) => RouterEngine | Failure
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
const LOCAL_KEY = 'owlto-local'
const version = `${appPackage.version}+router.${ROUTER_PROMPT_VERSION}`

/**
 * The instructions a Router runs with: the user's own text from Settings, or the
 * defaults. `custom` identifies the user's text, so an engine that fixes its
 * instructions at session start can tell when they changed; it is null for the defaults.
 */
export function routerInstructions(settings: RouterSettings): {
  text: string
  custom: string | null
} {
  // Blank text never saves; a missing field means settings that skipped the schema.
  if (!settings.instructions) return { text: ROUTER_INSTRUCTIONS, custom: null }
  const custom = createHash('sha256').update(settings.instructions).digest('hex').slice(0, 16)
  return { text: settings.instructions, custom }
}

/**
 * Builds the configured Router engine, or the failure that explains why it cannot
 * run. Owlto engine requests are never sent without a key Owlto stored, so pi-ai's
 * environment variable fallback is never reached.
 */
export function defaultEngineFactory(deps: EngineDeps): EngineFactory {
  return (request) => {
    const { settings } = request
    const instructions = routerInstructions(settings)
    if (settings.engine === 'claude-code') {
      const connection = deps.claude.connection()
      if (connection.status !== 'ready' || !connection.executablePath)
        return { code: 'claude_not_connected', message: '' } satisfies Failure
      return new ClaudeEngine({
        sdk: deps.claude.sdk,
        executable: connection.executablePath,
        cwd: request.router.cwd,
        model: settings.claudeModel,
        instructions: instructions.text,
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
        instructions: instructions.text,
        promptVersion: ROUTER_PROMPT_VERSION,
        customInstructions: instructions.custom,
        tools: request.tools,
        state: request.state
      })
    }
    const owlto = settings.owlto
    if (!owlto) return { code: 'router_model_unconfigured', message: '' }
    const keyed = deps.credentials.has(owlto.provider)
    if (!keyed && owlto.provider !== 'custom')
      return { code: 'router_model_unconfigured', message: '' }
    const resolved = resolveRouterModel(owlto)
    if (!resolved) return { code: 'model_unavailable', message: '' }
    return new OwltoEngine({
      routerId: request.router.id,
      model: resolved.model,
      thinking: owlto.thinking,
      streamFn: resolved.models.streamSimple.bind(resolved.models),
      // The key is decrypted for each request. OpenAI-compatible clients require a key even
      // when a local server ignores it.
      getApiKey: async (provider) => {
        if (provider !== owlto.provider) return undefined
        const key = keyed ? await deps.credentials.key(owlto.provider) : null
        return key ?? (owlto.provider === 'custom' ? LOCAL_KEY : undefined)
      },
      instructions: instructions.text,
      tools: request.tools,
      history: request.history,
      state: request.state,
      persist: request.persist,
      version
    })
  }
}

/**
 * Builds the engine a Dreaming run uses: the user's Claude Code or Codex with
 * the Dreaming instructions and memory tools only, in a session that is not
 * kept, so it never shows up in the user's own history. A provider that is not
 * connected fails the run instead of falling back to the other account.
 */
export function dreamingEngineFactory(
  deps: EngineDeps & { cwd: () => string }
): DreamingEngineFactory {
  const dreamingVersion = `${appPackage.version}+dreaming.${DREAMING_PROMPT_VERSION}`
  return (request) => {
    if (request.provider === 'claude-code') {
      const connection = deps.claude.connection()
      if (connection.status !== 'ready' || !connection.executablePath)
        return { code: 'claude_not_connected', message: '' } satisfies Failure
      return new ClaudeEngine({
        sdk: deps.claude.sdk,
        executable: connection.executablePath,
        cwd: deps.cwd(),
        model: request.model,
        instructions: DREAMING_INSTRUCTIONS,
        tools: request.tools,
        version: dreamingVersion,
        ephemeral: true
      })
    }
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
      cwd: deps.cwd(),
      model: request.model,
      instructions: DREAMING_INSTRUCTIONS,
      promptVersion: DREAMING_PROMPT_VERSION,
      tools: request.tools,
      state: () => '',
      ephemeral: true
    })
  }
}
