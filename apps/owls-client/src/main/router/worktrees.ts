import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import {
  DEFAULT_REMOTE,
  defaultProjectSettings,
  type ProjectGitRefs,
  type ProjectGitSettings
} from '../../shared/projects.js'
import type { WorkerWorkspace, WorktreeBase } from '../../shared/router.js'

export type WorktreeWorkspace = Extract<WorkerWorkspace, { kind: 'worktree' }>
/** A project that can give writers their own worktrees: its repository and its place in it. */
export type WorktreeRepo = { repo: string; subdir: string }
export type ReleaseResult = { worktree: 'removed' | 'kept'; branch: 'deleted' | 'kept' }
/** The branch a worktree has checked out and where it would be pushed. */
export type WorkerRemoteBranch = { remoteUrl: string; branch: string; pushed: boolean }

/** Git worktrees for Router workers (RFC 11.1). WorkerPool depends only on this interface. */
export interface WorkerWorkspaces {
  /** The project's repository, or null when the project cannot have worktrees. */
  inspect(projectPath: string): Promise<WorktreeRepo | null>
  /** The worktree a worker would get; deterministic from the repository and worker ID. */
  plan(repo: WorktreeRepo, workerId: string, base: WorktreeBase): WorktreeWorkspace
  /**
   * Makes sure the worktree exists, creating or re-attaching it. Returns its base commit.
   * `git` is the project's worktree settings, which choose the base of a new worktree.
   */
  ensure(workspace: WorktreeWorkspace, git?: ProjectGitSettings): Promise<string>
  /**
   * Removes a clean worktree (or any, with `force`) and a branch that holds no new work,
   * or, when the project's settings allow it, one whose work is all on the remote.
   */
  release(
    workspace: WorktreeWorkspace,
    force: boolean,
    git?: ProjectGitSettings
  ): Promise<ReleaseResult>
  /** Clears registrations of worktrees whose directories are gone. */
  prune(repo: string): Promise<void>
  /**
   * Directories outside the worktree that a commit on its branch writes to;
   * empty when they cannot be found.
   */
  commitPaths(workspace: WorktreeWorkspace): Promise<string[]>
  /** Null when the worktree is gone, HEAD is detached, or the branch has no remote. */
  remoteBranch(
    workspace: WorktreeWorkspace,
    git?: ProjectGitSettings
  ): Promise<WorkerRemoteBranch | null>
  /** A repository's branches and remotes, for the project settings; null for no repository. */
  refs(projectPath: string): Promise<ProjectGitRefs | null>
  /** The URL of the remote a project's workers push to; null without a repository or remote. */
  remoteUrl(projectPath: string, git?: ProjectGitSettings): Promise<string | null>
}

/** For hosts without git worktrees: every worker runs in the project checkout. */
export const checkoutOnly: WorkerWorkspaces = {
  inspect: async () => null,
  plan: () => {
    throw new Error('Worktrees are not available.')
  },
  ensure: async () => {
    throw new Error('Worktrees are not available.')
  },
  release: async () => ({ worktree: 'removed', branch: 'deleted' }),
  prune: async () => {},
  commitPaths: async () => [],
  remoteBranch: async () => null,
  refs: async () => null,
  remoteUrl: async () => null
}

/** Owls' own branch for a worker; the deliverable the user merges. */
export const workerBranch = (workerId: string) => `owls/${workerId}`
const FETCH_TIMEOUT_MS = 15_000
const GIT_TIMEOUT_MS = 120_000

function git(cwd: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      // Never wait on a credential prompt the user cannot see.
      {
        timeout,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      },
      (error, stdout) => {
        // Raw git output can hold paths and remote URLs, so callers only see the command.
        if (error) reject(new Error(`git ${args[0]} failed`))
        else resolve(stdout.trim())
      }
    )
  })
}
const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
const succeeds = (cwd: string, args: string[]) =>
  git(cwd, args).then(
    () => true,
    () => false
  )

/**
 * Worker worktrees under `root` (from owls-paths), one directory per
 * repository and worker. Git writes to one repository run one at a time, so
 * concurrent workers never race for `.git` lock files.
 */
export class GitWorkspaces implements WorkerWorkspaces {
  private readonly root: string
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(root: string) {
    mkdirSync(root, { recursive: true })
    this.root = realpathSync(root)
  }

  async inspect(projectPath: string): Promise<WorktreeRepo | null> {
    try {
      const repo = realpathSync(await git(projectPath, ['rev-parse', '--show-toplevel']))
      // An empty repository has no commit to branch from.
      if (!(await succeeds(repo, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])))
        return null
      const subdir = relative(repo, realpathSync(projectPath))
      if (subdir.startsWith('..') || isAbsolute(subdir)) return null
      return { repo, subdir }
    } catch {
      return null
    }
  }

  plan(repo: WorktreeRepo, workerId: string, base: WorktreeBase): WorktreeWorkspace {
    const key = `${basename(repo.repo)}-${createHash('sha256').update(repo.repo).digest('hex').slice(0, 8)}`
    const path = join(this.root, key, workerId)
    return {
      kind: 'worktree',
      repo: repo.repo,
      path,
      cwd: repo.subdir ? join(path, repo.subdir) : path,
      branch: workerBranch(workerId),
      base,
      baseBranch: null,
      baseCommit: null,
      state: 'active'
    }
  }

  ensure(
    workspace: WorktreeWorkspace,
    settings: ProjectGitSettings = defaultProjectSettings.git
  ): Promise<string> {
    // Already checked out: the common case for every turn after the first.
    if (
      existsSync(join(workspace.path, '.git')) &&
      existsSync(workspace.cwd) &&
      workspace.baseCommit
    )
      return Promise.resolve(workspace.baseCommit)
    return this.serial(workspace.repo, async () => {
      const { repo, path, branch } = workspace
      if (existsSync(join(path, '.git'))) {
        if (!existsSync(workspace.cwd))
          throw new Error('The project directory is not in the worktree.')
        return workspace.baseCommit ?? (await git(path, ['rev-parse', 'HEAD']))
      }
      // A worktree directory deleted by hand is still registered until pruned.
      await git(repo, ['worktree', 'prune'])
      mkdirSync(join(path, '..'), { recursive: true })
      const ref = `refs/heads/${branch}`
      let baseCommit = workspace.baseCommit
      if (await succeeds(repo, ['rev-parse', '--verify', '--quiet', ref])) {
        await git(repo, ['worktree', 'add', path, branch])
      } else {
        baseCommit = await this.baseCommit(repo, workspace, settings)
        await git(repo, ['worktree', 'add', '-b', branch, path, baseCommit])
      }
      if (!existsSync(workspace.cwd))
        throw new Error('The project directory is not in the worktree.')
      return baseCommit ?? (await git(path, ['rev-parse', 'HEAD']))
    })
  }

  release(
    workspace: WorktreeWorkspace,
    force: boolean,
    settings: ProjectGitSettings = defaultProjectSettings.git
  ): Promise<ReleaseResult> {
    return this.serial(workspace.repo, async () => {
      const { repo, path, branch } = workspace
      if (existsSync(path)) {
        const status = await git(path, ['status', '--porcelain', '--untracked-files=all'])
        if (status && !force) return { worktree: 'kept', branch: 'kept' }
        await git(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), path])
      } else await git(repo, ['worktree', 'prune'])
      const ref = `refs/heads/${branch}`
      if (!(await succeeds(repo, ['rev-parse', '--verify', '--quiet', ref])))
        return { worktree: 'removed', branch: 'deleted' }
      const tip = await git(repo, ['rev-parse', ref])
      // Keep a branch with commits the user's checkout does not have yet.
      const merged =
        tip === workspace.baseCommit ||
        (await succeeds(repo, ['merge-base', '--is-ancestor', tip, 'HEAD']))
      if (
        !merged &&
        !(settings.deletePushedBranches && (await this.pushed(repo, branch, tip, settings)))
      )
        return { worktree: 'removed', branch: 'kept' }
      await git(repo, ['branch', '-D', branch])
      return { worktree: 'removed', branch: 'deleted' }
    })
  }

  prune(repo: string): Promise<void> {
    return this.serial(repo, async () => {
      if (existsSync(repo)) await git(repo, ['worktree', 'prune']).catch(() => {})
    })
  }

  /**
   * The worktree's own git directory (index, HEAD), the shared object store,
   * and the ref and reflog directories of the worker's branch. A sandboxed
   * agent gets these and nothing else of the repository's metadata: hooks and
   * config stay read-only, so it cannot plant code that git later runs outside
   * the sandbox. Other branches and tags stay read-only too.
   */
  async commitPaths(workspace: WorktreeWorkspace): Promise<string[]> {
    if (!existsSync(workspace.path)) return []
    const refs = join('refs/heads', dirname(workspace.branch))
    const out = await git(workspace.path, [
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
      '--git-common-dir',
      '--git-path',
      'objects',
      '--git-path',
      refs,
      '--git-path',
      join('logs', refs)
    ]).catch(() => null)
    const [gitDir, commonDir, ...shared] = out?.split('\n') ?? []
    // Not a linked worktree: its git directory would be the repository's whole `.git`.
    if (!gitDir || !commonDir || gitDir === commonDir || shared.length !== 3) return []
    const [, refDir, logDir] = shared
    // `git pack-refs` removes emptied ref directories, and git cannot recreate
    // them from inside the sandbox.
    for (const dir of [refDir, logDir]) {
      try {
        mkdirSync(dir, { recursive: true })
      } catch {
        // A reftable repository has no loose ref directories; commits ask for approval.
      }
    }
    return [gitDir, ...shared].filter(isDirectory).map((p) => realpathSync(p))
  }

  /**
   * Reads HEAD rather than `workspace.branch` because a worker may switch to a
   * branch of its own. The upstream is no guide to the name: `git switch -c x
   * origin/main` tracks main, while the branch is pushed as x.
   */
  async remoteBranch(
    workspace: WorktreeWorkspace,
    settings: ProjectGitSettings = defaultProjectSettings.git
  ): Promise<WorkerRemoteBranch | null> {
    const { path } = workspace
    if (!existsSync(path)) return null
    const branch = await git(path, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => null)
    if (!branch) return null
    const tracked = await git(path, ['config', `branch.${branch}.remote`]).catch(() => null)
    const remote = tracked && tracked !== '.' ? tracked : (settings.remote ?? DEFAULT_REMOTE)
    const remoteUrl = await git(path, ['remote', 'get-url', remote]).catch(() => null)
    if (!remoteUrl) return null
    const ref = `refs/remotes/${remote}/${branch}`
    const pushed = await succeeds(path, ['rev-parse', '--verify', '--quiet', ref])
    return { remoteUrl, branch, pushed }
  }

  async remoteUrl(
    projectPath: string,
    settings: ProjectGitSettings = defaultProjectSettings.git
  ): Promise<string | null> {
    if (!existsSync(projectPath)) return null
    const remote = settings.remote ?? DEFAULT_REMOTE
    return git(projectPath, ['remote', 'get-url', remote], FETCH_TIMEOUT_MS).catch(() => null)
  }

  async refs(projectPath: string): Promise<ProjectGitRefs | null> {
    const repo = await git(projectPath, ['rev-parse', '--show-toplevel']).catch(() => null)
    if (!repo) return null
    const list = async (args: string[]) =>
      (await git(repo, args).catch(() => ''))
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    const [branches, remoteRefs, remotes] = await Promise.all([
      list(['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
      list(['for-each-ref', '--format=%(refname:short)', 'refs/remotes']),
      list(['remote'])
    ])
    // `origin/HEAD` is a pointer, not a branch to start from.
    const remoteBranches = remoteRefs.filter((ref) => !ref.endsWith('/HEAD') && ref.includes('/'))
    return { branches, remoteBranches, remotes }
  }

  /**
   * The parent's branch, the project's base branch (fetched first when it is a
   * remote-tracking branch), the remote default branch after a best-effort fetch,
   * or HEAD. Falls back to HEAD: a parent's branch that is gone held nothing HEAD
   * lacks, and a base branch that no longer exists should not stop the worker.
   */
  private async baseCommit(
    repo: string,
    workspace: WorktreeWorkspace,
    settings: ProjectGitSettings
  ): Promise<string> {
    if (workspace.baseBranch) {
      const commit = await git(repo, [
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/heads/${workspace.baseBranch}^{commit}`
      ]).catch(() => null)
      if (commit) return commit
    }
    if (workspace.base === 'head' && settings.baseBranch) {
      const commit = await this.configuredBase(repo, settings.baseBranch)
      if (commit) return commit
    }
    if (workspace.base === 'default-branch') {
      const remote = settings.remote ?? DEFAULT_REMOTE
      const head = await git(repo, [
        'symbolic-ref',
        '--quiet',
        `refs/remotes/${remote}/HEAD`
      ]).catch(() => null)
      const prefix = `refs/remotes/${remote}/`
      const name = head?.startsWith(prefix) ? head.slice(prefix.length) : null
      if (name) {
        await git(repo, ['fetch', '--quiet', remote, name], FETCH_TIMEOUT_MS).catch(() => {})
        const commit = await git(repo, [
          'rev-parse',
          '--verify',
          '--quiet',
          `${prefix}${name}^{commit}`
        ]).catch(() => null)
        if (commit) return commit
      }
    }
    return git(repo, ['rev-parse', '--verify', 'HEAD^{commit}'])
  }

  /**
   * The commit of a project's base branch. A remote-tracking name such as
   * `origin/main` is fetched first, best effort, so new work starts from the
   * remote's latest commit; any other name is a local branch.
   */
  private async configuredBase(repo: string, name: string): Promise<string | null> {
    const verify = (ref: string) =>
      git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => null)
    const slash = name.indexOf('/')
    if (slash > 0) {
      const remote = name.slice(0, slash)
      const remotes = (await git(repo, ['remote']).catch(() => '')).split('\n')
      if (remotes.includes(remote)) {
        await git(
          repo,
          ['fetch', '--quiet', remote, name.slice(slash + 1)],
          FETCH_TIMEOUT_MS
        ).catch(() => {})
        const commit = await verify(`refs/remotes/${name}`)
        if (commit) return commit
      }
    }
    return verify(`refs/heads/${name}`)
  }

  /** Whether every commit up to `tip` is on the project's remote copy of `branch`. */
  private async pushed(
    repo: string,
    branch: string,
    tip: string,
    settings: ProjectGitSettings
  ): Promise<boolean> {
    const remote = settings.remote ?? DEFAULT_REMOTE
    const ref = `refs/remotes/${remote}/${branch}`
    if (!(await succeeds(repo, ['rev-parse', '--verify', '--quiet', ref]))) return false
    return succeeds(repo, ['merge-base', '--is-ancestor', tip, ref])
  }

  private serial<T>(repo: string, run: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(repo) ?? Promise.resolve()
    const next = previous.then(run, run)
    const tail = next.catch(() => {})
    this.queues.set(repo, tail)
    void tail.then(() => {
      if (this.queues.get(repo) === tail) this.queues.delete(repo)
    })
    return next
  }
}
