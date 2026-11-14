import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { OwltoError } from '../app/errors.js'

export function claudeExecutableCandidates(explicit: string | null): string[] {
  if (explicit) return [explicit]
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude'
  return [
    ...(process.env.PATH ?? '')
      .split(delimiter)
      .filter(Boolean)
      .map((p) => join(p, name)),
    join(homedir(), '.local', 'bin', name),
    join(homedir(), '.claude', 'local', name),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  ]
}

/**
 * Finds the user's installed Claude Code CLI. The launcher path is kept as-is
 * instead of resolving symlinks: native installs point a stable launcher at a
 * versioned binary that the CLI's own updater replaces.
 */
export function discoverClaudeExecutable(explicit: string | null): string {
  for (const candidate of claudeExecutableCandidates(explicit)) {
    try {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) continue
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      /* Try the next installation. */
    }
  }
  throw new OwltoError(
    'claude_not_installed',
    'Claude Code CLI was not found. Select your local Claude Code executable in Settings.'
  )
}
