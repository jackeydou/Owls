import type { GitHubAuthMethod, WorkerGitHubStatus } from '../../shared/github.js'
import type { RouterWorker, WorkerAction, WorkerPullRequestLink } from '../../shared/router.js'
import type { GitHubHttp } from '../github/auth.js'
import {
  type GitHubRepository,
  GitHubRequestError,
  lookupPullRequest,
  parseGitHubRemote
} from '../github/pull-requests.js'
import type { WorkerRemoteBranch } from './worktrees.js'

const ACTIVE_POLL_MS = 30_000
const IDLE_POLL_MS = 60_000

/** The parts of the Router that GitHub status reads and writes. */
export type WorkerGitHubRouter = {
  worker(workerId: string): RouterWorker | undefined
  remoteBranch(workerId: string): Promise<WorkerRemoteBranch | null>
  linkPullRequest(workerId: string, link: WorkerPullRequestLink): void
}
export type WorkerGitHubAuth = {
  token(): Promise<string | null>
  invalidate(): void
  method(): GitHubAuthMethod | null
}
type Target = GitHubRepository & { branch: string }
type Reading = { status: WorkerGitHubStatus; retryAt: number | null }

/** What to ask GitHub about: the worker's checkout, or its link once the worktree is gone. */
function targetOf(
  worker: RouterWorker,
  local: WorkerRemoteBranch | null
): Target | WorkerGitHubStatus {
  const link = worker.pullRequest
  if (!local) return link ?? { kind: 'unsupported' }
  const repository = parseGitHubRemote(local.remoteUrl)
  if (!repository) return { kind: 'unsupported' }
  if (local.pushed) return { ...repository, branch: local.branch }
  // A merged branch can be pruned from the remote; its link still finds the pull request.
  return link?.branch === local.branch ? link : { kind: 'not-pushed', branch: local.branch }
}
const isStatus = (value: Target | WorkerGitHubStatus): value is WorkerGitHubStatus =>
  'kind' in value

function nextPoll({ status, retryAt }: Reading): number | null {
  if (status.kind === 'unsupported' || status.kind === 'signed-out') return null
  if (status.kind === 'failed')
    return retryAt === null ? IDLE_POLL_MS : Math.max(retryAt - Date.now(), IDLE_POLL_MS)
  if (status.kind !== 'pull-request') return IDLE_POLL_MS
  const { state } = status.pullRequest
  return state === 'merged' || state === 'closed' ? null : ACTIVE_POLL_MS
}

/**
 * Pull request and CI status for the worker whose panel is open. GitHub cannot
 * push to a desktop app, so this polls, and only for that one worker.
 */
export class WorkerGitHub {
  private watched: string | null = null
  private last: WorkerGitHubStatus | null = null
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly router: WorkerGitHubRouter,
    private readonly auth: WorkerGitHubAuth,
    private readonly emit: (workerId: string, status: WorkerGitHubStatus) => void,
    private readonly http: GitHubHttp = fetch
  ) {}

  watch({ routerId, workerId }: WorkerAction): void {
    if (this.router.worker(workerId)?.routerId !== routerId) return
    this.watched = workerId
    this.last = null
    this.restart()
  }
  unwatch({ workerId }: WorkerAction): void {
    if (this.watched !== workerId) return
    this.stop()
    this.watched = null
  }
  /** Reads again now, for when something outside the poll changed, such as the sign-in. */
  refresh(): void {
    if (this.watched) this.restart()
  }
  close(): void {
    this.stop()
    this.watched = null
  }

  private stop(): void {
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
  private restart(): void {
    this.stop()
    if (this.watched) void this.tick(this.watched, this.generation)
  }

  private async tick(workerId: string, generation: number): Promise<void> {
    const worker = this.router.worker(workerId)
    if (!worker) return
    const reading = await this.read(worker)
    if (generation !== this.generation) return
    // One failed poll should not take a good answer off the screen.
    if (reading.status.kind !== 'failed' || this.last?.kind !== 'pull-request') {
      this.last = reading.status
      this.emit(workerId, reading.status)
    }
    const delay = nextPoll(reading)
    if (delay !== null) this.timer = setTimeout(() => void this.tick(workerId, generation), delay)
  }

  private async read(worker: RouterWorker): Promise<Reading> {
    try {
      return { status: await this.status(worker), retryAt: null }
    } catch (error) {
      if (error instanceof GitHubRequestError && error.reason === 'rate-limited')
        return { status: { kind: 'failed', reason: 'rate-limited' }, retryAt: error.retryAt }
      if (error instanceof GitHubRequestError && error.reason === 'unauthorized') {
        this.auth.invalidate()
        return { status: { kind: 'signed-out' }, retryAt: null }
      }
      return { status: { kind: 'failed', reason: 'unavailable' }, retryAt: null }
    }
  }

  private async status(worker: RouterWorker): Promise<WorkerGitHubStatus> {
    if (worker.workspace.kind !== 'worktree') return { kind: 'unsupported' }
    const target = targetOf(worker, await this.router.remoteBranch(worker.id))
    if (isStatus(target)) return target
    const token = await this.auth.token()
    if (!token) return { kind: 'signed-out' }
    const { branch, owner, name } = target
    const found = await lookupPullRequest(this.http, token, { owner, name }, branch)
    if (found.kind === 'no-access')
      return {
        kind: this.auth.method() === 'app' ? 'not-installed' : 'no-access',
        owner,
        name
      }
    if (found.kind === 'none') return { kind: 'no-pull-request', branch }
    const { number } = found.pullRequest
    if (worker.pullRequest?.number !== number)
      this.router.linkPullRequest(worker.id, { owner, name, branch, number })
    return { kind: 'pull-request', pullRequest: found.pullRequest }
  }
}
