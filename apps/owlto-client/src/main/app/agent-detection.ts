import type { AgentDetection, AgentProvider, AppSettings } from '../../shared/app.js'
import { discoverClaudeExecutable } from '../claude/discovery.js'
import { discoverExecutable } from '../codex/client.js'
import { discoverCursorExecutable } from '../cursor/discovery.js'

const DISCOVER: Record<AgentProvider, (settings: AppSettings) => string> = {
  'claude-code': (s) => discoverClaudeExecutable(s.claudeExecutablePath),
  codex: (s) => discoverExecutable(s.executablePath),
  cursor: (s) => discoverCursorExecutable(s.cursorExecutablePath)
}

/**
 * Finds each agent's CLI the same way connecting does, but only checks the file: nothing
 * is started, so no account is touched and no hook runs. A path the user picked wins.
 */
export function detectAgents(settings: AppSettings): AgentDetection {
  const find = (provider: AgentProvider) => {
    try {
      return { path: DISCOVER[provider](settings) }
    } catch {
      return { path: null }
    }
  }
  return { 'claude-code': find('claude-code'), codex: find('codex'), cursor: find('cursor') }
}
