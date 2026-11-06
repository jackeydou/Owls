import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, join, relative } from 'node:path'
import type { WorkerWorkspace, WorktreeBase } from '../../shared/router.js'

export type WorktreeWorkspace = Extract<WorkerWorkspace, { kind: 'worktree' }>
/** A project that can give writers their own worktrees: its repository and its place in it. */
export type WorktreeRepo = { repo: string; subdir: string }
export type ReleaseResult = { worktree: 'removed' | 'kept'; branch: 'deleted' | 'kept' }

/** Git worktrees for Router workers (RFC 11.1). WorkerPool depends only on this interface. */
export interface WorkerWorkspaces {
  /** The project's repository, or null when the project cannot have worktrees. */
  inspect(projectPath: string): Promise<WorktreeRepo | null>
  /** The worktree a worker would get; deterministic from the repository and worker ID. */
  plan(repo: WorktreeRepo, workerId: string, base: WorktreeBase): WorktreeWorkspace
  /** Makes sure the worktree exists, creating or re-attaching it. Returns its base commit. */
  ensure(workspace: WorktreeWorkspace): Promise<string>
  /** Removes a clean worktree (or any, with `force`) and a branch that holds no new work. */
  release(workspace: WorktreeWorkspace, force: boolean): Promise<ReleaseResult>
  /** Clears registrations of worktrees whose directories are gone. */
  prune(repo: string): Promise<void>
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
  prune: async () => {}
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

  ensure(workspace: WorktreeWorkspace): Promise<string> {
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
        baseCommit = await this.baseCommit(repo, workspace)
        await git(repo, ['worktree', 'add', '-b', branch, path, baseCommit])
      }
      if (!existsSync(workspace.cwd))
        throw new Error('The project directory is not in the worktree.')
      return baseCommit ?? (await git(path, ['rev-parse', 'HEAD']))
    })
  }

  release(workspace: WorktreeWorkspace, force: boolean): Promise<ReleaseResult> {
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
      if (!merged) return { worktree: 'removed', branch: 'kept' }
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
   * HEAD, the parent's branch, or the remote default branch after a best-effort
   * fetch. Falls back to HEAD: a parent's branch that is gone held nothing HEAD lacks.
   */
  private async baseCommit(repo: string, workspace: WorktreeWorkspace): Promise<string> {
    if (workspace.baseBranch) {
      const commit = await git(repo, [
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/heads/${workspace.baseBranch}^{commit}`
      ]).catch(() => null)
      if (commit) return commit
    }
    if (workspace.base === 'default-branch') {
      const remote = await git(repo, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']).catch(
        () => null
      )
      const name = remote?.replace(/^refs\/remotes\/origin\//, '')
      if (name && name !== remote) {
        await git(repo, ['fetch', '--quiet', 'origin', name], FETCH_TIMEOUT_MS).catch(() => {})
        const commit = await git(repo, [
          'rev-parse',
          '--verify',
          '--quiet',
          `refs/remotes/origin/${name}^{commit}`
        ]).catch(() => null)
        if (commit) return commit
      }
    }
    return git(repo, ['rev-parse', '--verify', 'HEAD^{commit}'])
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
