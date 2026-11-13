import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { OwlsError } from '../app/errors.js'

/**
 * Where the Cursor CLI may be installed. The installer links both `agent` and the
 * older `cursor-agent` name into `~/.local/bin`; `agent` is a generic name, so the
 * Cursor-specific name is tried first on each directory.
 */
export function cursorExecutableCandidates(explicit: string | null): string[] {
  if (explicit) return [explicit]
  const names =
    process.platform === 'win32' ? ['cursor-agent.exe', 'agent.exe'] : ['cursor-agent', 'agent']
  const folders = [
    join(homedir(), '.local', 'bin'),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ]
  return [...new Set(folders)].flatMap((folder) => names.map((name) => join(folder, name)))
}

/**
 * Finds the user's installed Cursor CLI. The launcher path is kept as-is: the
 * installer points a stable link at a versioned binary that its updater replaces.
 */
export function discoverCursorExecutable(explicit: string | null): string {
  for (const candidate of cursorExecutableCandidates(explicit)) {
    try {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) continue
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      /* Try the next installation. */
    }
  }
  throw new OwlsError(
    'cursor_not_installed',
    'Cursor CLI was not found. Select your local Cursor agent executable in Settings.'
  )
}
