import type { AcpAccount } from '../../shared/app.js'
import type { AcpAgent } from '../acp/agent.js'
import { recordSchema } from '../app/values.js'
import { antigravityMode, parseAntigravityModels, signedOut } from './normalize.js'

/** Why a failed CLI run failed, from its stderr and stdout when execFile kept them. */
function failureText(error: unknown): string {
  const { stderr, stdout } = recordSchema.catch({}).parse(error ?? {})
  const message = error instanceof Error ? error.message : ''
  return [stderr, stdout, message].filter((part) => typeof part === 'string').join('\n')
}

/**
 * Google's Antigravity CLI over ACP (`agy acp`, ACP version 1 over stdio). The
 * CLI has no account status command, so connecting reads `agy models`, which
 * needs a signed-in session: a list means signed in, an authentication error
 * means signed out. Signing in happens in the CLI itself (`agy`, or
 * `agy acp --login` over SSH). The session's model and thinking level are set
 * over ACP once the session is open, not on the command line.
 */
export const antigravityAgent: AcpAgent = {
  provider: 'antigravity',
  label: 'Antigravity',
  codes: { notConnected: 'antigravity_not_connected', disconnected: 'antigravity_disconnected' },
  search: {
    names: ['agy'],
    notInstalled: {
      code: 'antigravity_not_installed',
      message: 'Antigravity CLI was not found. Select your local agy executable in Settings.'
    }
  },
  executablePath: (settings) => settings.antigravityExecutablePath,
  connectionEvent: (connection) => ({ type: 'antigravity-connection', connection }),
  async probe(run) {
    try {
      const models = parseAntigravityModels(await run(['models'], 30_000))
      const account: AcpAccount = { kind: 'signed-in', email: null }
      return { account, models }
    } catch (error) {
      const text = failureText(error)
      return { account: signedOut(text) ? { kind: 'signed-out' } : { kind: 'unknown' }, models: [] }
    }
  },
  args: () => ['acp'],
  authMethod: null,
  mode: antigravityMode,
  thoughtLevel: (effort) => effort
}
