import { spawn } from 'node:child_process'
import { userInfo } from 'node:os'
import { delimiter } from 'node:path'

const MARKER = '__OWLTO_PATH__'
const PROBE_TIMEOUT_MS = 5000

/** The PATH printed between the probe's markers; null when the output has none. */
export function parseShellPath(stdout: string): string | null {
  const start = stdout.indexOf(MARKER)
  const end = stdout.indexOf(MARKER, start + MARKER.length)
  if (start < 0 || end < 0) return null
  const path = stdout.slice(start + MARKER.length, end).trim()
  return path || null
}

/** Joins PATH values in order, keeping the first copy of each entry. */
export function mergePaths(...values: Array<string | null | undefined>): string {
  const entries = values.flatMap((value) => (value ?? '').split(delimiter)).filter(Boolean)
  return [...new Set(entries)].join(delimiter)
}

/**
 * Asks the user's login shell for its PATH. Interactive login mode reads the
 * same files a Terminal window does (`.zprofile` for Homebrew, `.zshrc` for
 * version managers); markers fence the value off from anything those print.
 */
export function readLoginShellPath(
  shell: string,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = ''
    let settled = false
    const done = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(shell, ['-ilc', `printf '\\n${MARKER}%s${MARKER}\\n' "$PATH"`], {
        stdio: ['ignore', 'pipe', 'ignore'],
        // Oh My Zsh would otherwise ask about updates on a terminal nobody sees.
        env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' }
      })
    } catch {
      resolve(null)
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done(null)
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.on('error', () => done(null))
    child.on('close', () => done(parseShellPath(stdout)))
  })
}

/**
 * An app opened from Finder or the Dock gets launchd's PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`), and the agent CLIs and the commands they
 * run inherit it, so Homebrew, mise, and similar tools look missing. The login
 * shell's PATH goes first; entries only Owlto had are kept after it. Never
 * rejects: without a usable shell the PATH stays as it was.
 */
export async function adoptLoginShellPath(): Promise<void> {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL || safeUserShell() || '/bin/zsh'
  const path = await readLoginShellPath(shell)
  if (path) process.env.PATH = mergePaths(path, process.env.PATH)
}

function safeUserShell(): string | null {
  try {
    return userInfo().shell
  } catch {
    return null
  }
}
