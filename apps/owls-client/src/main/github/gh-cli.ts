import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

const GH_TIMEOUT_MS = 10_000

/** An app opened from Finder has a minimal PATH, so the usual install places are tried too. */
function ghCandidates(): string[] {
  const name = process.platform === 'win32' ? 'gh.exe' : 'gh'
  return [
    ...(process.env.PATH ?? '')
      .split(delimiter)
      .filter(Boolean)
      .map((path) => join(path, name)),
    '/opt/homebrew/bin/gh',
    '/usr/local/bin/gh',
    join(homedir(), '.local', 'bin', name)
  ]
}
function ghExecutable(): string | null {
  for (const candidate of ghCandidates()) {
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      /* Try the next installation. */
    }
  }
  return null
}

/** The token `gh` holds for github.com, or null when `gh` is missing or signed out. */
export function readGhToken(): Promise<string | null> {
  const executable = ghExecutable()
  if (!executable) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      executable,
      ['auth', 'token', '--hostname', 'github.com'],
      { timeout: GH_TIMEOUT_MS },
      (error, stdout) => resolve(error ? null : stdout.trim() || null)
    )
  })
}
