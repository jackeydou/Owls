import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { Failure } from '../../shared/app.js'
import { OwltoError } from '../app/errors.js'

/** How to find one agent's CLI: its executable names, most specific first. */
export type ExecutableSearch = {
  names: string[]
  notInstalled: { code: Failure['code']; message: string }
}

/**
 * Where an agent CLI may be installed: `~/.local/bin`, where the Cursor and
 * Antigravity installers link their launchers, then PATH and Homebrew. Each
 * folder tries every name in order, so a specific name wins over a generic one.
 */
export function executableCandidates(explicit: string | null, names: string[]): string[] {
  if (explicit) return [explicit]
  const platformNames = process.platform === 'win32' ? names.map((name) => `${name}.exe`) : names
  const folders = [
    join(homedir(), '.local', 'bin'),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ]
  return [...new Set(folders)].flatMap((folder) => platformNames.map((name) => join(folder, name)))
}

/**
 * Finds the user's installed agent CLI. The launcher path is kept as-is: the
 * installers point a stable link at a versioned binary that their updater replaces.
 */
export function discoverExecutable(explicit: string | null, search: ExecutableSearch): string {
  for (const candidate of executableCandidates(explicit, search.names)) {
    try {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) continue
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      /* Try the next installation. */
    }
  }
  throw new OwltoError(search.notInstalled.code, search.notInstalled.message)
}
