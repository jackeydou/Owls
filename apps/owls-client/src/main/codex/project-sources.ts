import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { parseGitHubRepo } from '../../shared/projects.js'
import { CodexRuntimeError } from './errors.js'

const CLONE_TIMEOUT_MS = 10 * 60_000
const GIT_TIMEOUT_MS = 30_000

type GitResult = { ok: true; stdout: string } | { ok: false; stderr: string }

function git(args: string[], cwd: string | null, timeout = GIT_TIMEOUT_MS): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      cwd ? ['-C', cwd, ...args] : args,
      // Never wait on a credential prompt the user cannot see.
      { timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout, stderr) => {
        if (error && 'code' in error && error.code === 'ENOENT')
          resolve({ ok: false, stderr: 'git not found' })
        else if (error) resolve({ ok: false, stderr: String(stderr) })
        else resolve({ ok: true, stdout: String(stdout).trim() })
      }
    )
  })
}

/** The folder a new project goes into: the one the user chose, or the default (created). */
function parentFolder(parent: string | null, defaultParent: string): string {
  if (parent === null) {
    mkdirSync(defaultParent, { recursive: true })
    return realpathSync(defaultParent)
  }
  if (!isAbsolute(parent) || !existsSync(parent) || !statSync(parent).isDirectory())
    throw new CodexRuntimeError('invalid_request', 'Choose an existing folder.')
  return realpathSync(parent)
}

/**
 * Clones a GitHub repository into `<parent>/<repo>` and returns its path. A
 * folder already there that is a clone of the same repository is reused, so
 * importing twice just opens the project.
 */
export async function cloneGitHubProject(
  input: { url: string; parent: string | null },
  defaultParent: string
): Promise<string> {
  const ref = parseGitHubRepo(input.url)
  if (!ref) throw new CodexRuntimeError('project_url_invalid', 'Paste a GitHub repository URL.')
  const target = join(parentFolder(input.parent, defaultParent), ref.repo)
  if (existsSync(target)) {
    const origin = await git(['remote', 'get-url', 'origin'], target)
    const same = origin.ok && parseGitHubRepo(origin.stdout)
    if (
      same &&
      same.owner.toLowerCase() === ref.owner.toLowerCase() &&
      same.repo.toLowerCase() === ref.repo.toLowerCase()
    )
      return target
    throw new CodexRuntimeError('project_exists', `A folder named ${ref.repo} already exists.`)
  }
  const clone = await git(['clone', '--', ref.cloneUrl, target], null, CLONE_TIMEOUT_MS)
  // Raw git output can hold paths and credentials, so it never reaches the UI.
  if (!clone.ok) throw new CodexRuntimeError('project_clone_failed', 'git clone failed')
  return target
}

/**
 * Makes an empty project at `<parent>/<name>` and returns its path. It is a
 * git repository with an empty first commit when git can make one, so workers
 * can get their own worktrees; without a git identity it stays an empty
 * repository and workers run in the folder itself.
 */
export async function createQuickProject(
  input: { name: string; parent: string | null },
  defaultParent: string
): Promise<string> {
  const target = join(parentFolder(input.parent, defaultParent), input.name)
  if (existsSync(target))
    throw new CodexRuntimeError('project_exists', `A folder named ${input.name} already exists.`)
  mkdirSync(target)
  if ((await git(['init', '--quiet'], target)).ok)
    await git(['commit', '--allow-empty', '--quiet', '-m', 'Initial commit'], target)
  return target
}
