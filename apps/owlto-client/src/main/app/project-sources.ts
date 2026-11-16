import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type { Failure } from '../../shared/app.js'
import type { GitHubAuthMethod } from '../../shared/github.js'
import { type GitHubRepoRef, parseGitHubRepo } from '../../shared/projects.js'
import { OwltoError } from './errors.js'

const CLONE_TIMEOUT_MS = 10 * 60_000
const GIT_TIMEOUT_MS = 30_000
/** The child-process variable the one-off credential helper reads the token from. */
const TOKEN_VARIABLE = 'OWLTO_GITHUB_TOKEN'
/**
 * Answers git's credential `get` with the Owlto GitHub token. It runs for one clone only: the
 * token stays out of the clone's config and remote URL, and out of the process arguments.
 */
const TOKEN_HELPER = `!f() { test "$1" = get && printf 'username=x-access-token\\npassword=%s\\n' "$${TOKEN_VARIABLE}"; }; f`

type GitResult = { ok: true; stdout: string } | { ok: false; stderr: string }

/**
 * An app opened from Finder has a minimal PATH, which hides Homebrew's git and credential
 * helpers such as `gh auth git-credential`, so the usual install places are added.
 */
function gitPath(): string {
  const entries = [process.env.PATH ?? '', '/opt/homebrew/bin', '/usr/local/bin']
    .flatMap((entry) => entry.split(delimiter))
    .filter(Boolean)
  return [...new Set(entries)].join(delimiter)
}

function git(
  args: string[],
  cwd: string | null,
  timeout = GIT_TIMEOUT_MS,
  extraEnv: Record<string, string> = {}
): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      cwd ? ['-C', cwd, ...args] : args,
      {
        timeout,
        maxBuffer: 4 * 1024 * 1024,
        // Never wait on a credential prompt the user cannot see.
        env: { ...process.env, PATH: gitPath(), GIT_TERMINAL_PROMPT: '0', ...extraEnv }
      },
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
    throw new OwltoError('invalid_request', 'Choose an existing folder.')
  return realpathSync(parent)
}

/** The user's GitHub connection in Owlto; `GitHubAuth` in the app. */
export type CloneCredentials = {
  /** The connection's token, or null when the user is not connected. */
  token(): Promise<string | null>
  method(): GitHubAuthMethod | null
}

export type CloneFailureCode = Extract<
  Failure['code'],
  `project_clone_${string}` | 'project_git_missing'
>

const NETWORK_ERROR =
  /could not resolve host|failed to connect|connection (?:timed out|refused|reset)|network is unreachable|operation timed out/i
const SSH_DENIED = /permission denied \(publickey|host key verification failed/i
// GitHub answers "not found" for a private repository the credentials cannot see.
const NO_ACCESS =
  /repository not found|could not read (?:username|password)|authentication failed|terminal prompts disabled|requested url returned error: 40[134]|invalid username or (?:password|token)/i

/**
 * Why a clone failed, from git's error output, as a code the UI explains. `method` is the
 * Owlto GitHub connection the clone also tried, or null when it tried none. The output
 * itself can hold paths and credentials, so it never reaches the UI.
 */
export function cloneFailureCode(
  stderr: string,
  context: { ssh: boolean; method: GitHubAuthMethod | null }
): CloneFailureCode {
  if (stderr === 'git not found') return 'project_git_missing'
  if (NETWORK_ERROR.test(stderr)) return 'project_clone_network'
  if (context.ssh && SSH_DENIED.test(stderr)) return 'project_clone_ssh_denied'
  if (!context.ssh && NO_ACCESS.test(stderr)) {
    if (context.method === null) return 'project_clone_sign_in'
    if (context.method === 'app') return 'project_clone_app_access'
    return 'project_clone_no_access'
  }
  return 'project_clone_failed'
}

const cloneMessages: Record<CloneFailureCode, string> = {
  project_git_missing: 'git is not installed.',
  project_clone_network: 'Could not reach GitHub.',
  project_clone_ssh_denied: 'GitHub refused the SSH key.',
  project_clone_sign_in: 'The repository was not found, or it is private.',
  project_clone_app_access: 'The Owlto GitHub App cannot see this repository.',
  project_clone_no_access: 'The GitHub connection cannot see this repository.',
  project_clone_failed: 'git clone failed'
}

/**
 * Clones with the user's own git setup first, so public repositories and SSH or keychain
 * setups work as they do in a terminal. When that fails for an https URL, it tries again with
 * the Owlto GitHub connection, so a private repository clones without any git setup.
 */
async function cloneRepository(
  ref: GitHubRepoRef,
  target: string,
  credentials: CloneCredentials | null
): Promise<void> {
  const own = await git(['clone', '--', ref.cloneUrl, target], null, CLONE_TIMEOUT_MS)
  if (own.ok) return
  const ssh = !ref.cloneUrl.startsWith('https://')
  const token = ssh || !credentials ? null : await credentials.token().catch(() => null)
  let stderr = own.stderr
  if (token) {
    const withToken = await git(
      [
        // The empty helper clears the user's own helpers, so a stale keychain entry cannot win.
        '-c',
        'credential.helper=',
        '-c',
        `credential.helper=${TOKEN_HELPER}`,
        'clone',
        '--',
        ref.cloneUrl,
        target
      ],
      null,
      CLONE_TIMEOUT_MS,
      { [TOKEN_VARIABLE]: token }
    )
    if (withToken.ok) return
    stderr = withToken.stderr
  }
  const method = token ? (credentials?.method() ?? null) : null
  const code = cloneFailureCode(stderr, { ssh, method })
  throw new OwltoError(code, cloneMessages[code])
}

/**
 * Clones a GitHub repository into `<parent>/<repo>` and returns its path. A
 * folder already there that is a clone of the same repository is reused, so
 * importing twice just opens the project.
 */
export async function cloneGitHubProject(
  input: { url: string; parent: string | null },
  defaultParent: string,
  credentials: CloneCredentials | null = null
): Promise<string> {
  const ref = parseGitHubRepo(input.url)
  if (!ref) throw new OwltoError('project_url_invalid', 'Paste a GitHub repository URL.')
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
    throw new OwltoError('project_exists', `A folder named ${ref.repo} already exists.`)
  }
  await cloneRepository(ref, target, credentials)
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
    throw new OwltoError('project_exists', `A folder named ${input.name} already exists.`)
  mkdirSync(target)
  if ((await git(['init', '--quiet'], target)).ok)
    await git(['commit', '--allow-empty', '--quiet', '-m', 'Initial commit'], target)
  return target
}
