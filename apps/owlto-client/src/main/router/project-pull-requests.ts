import type { Project } from '../../shared/app.js'
import type {
  AgentPullRequest,
  ProjectPullRequestsStatus,
  PullRequestOverview
} from '../../shared/github.js'
import type { RouterWorker, WorkerPullRequestLink } from '../../shared/router.js'
import type { GitHubHttp } from '../github/auth.js'
import {
  type GitHubRepository,
  GitHubRequestError,
  type ListedPullRequest,
  lookupPullRequests,
  parseGitHubRemote
} from '../github/pull-requests.js'
import type { WorkerGitHubAuth } from './worker-github.js'
import type { WorkerRemoteBranch } from './worktrees.js'

/** The parts of the app that the project pull request list reads and writes. */
export type ProjectPullRequestsHost = {
  projects(): Project[]
  workers(): RouterWorker[]
  /** The URL of the remote a project's workers push to; null without one. */
  projectRemoteUrl(project: Project): Promise<string | null>
  remoteBranch(workerId: string): Promise<WorkerRemoteBranch | null>
  linkPullRequest(workerId: string, link: WorkerPullRequestLink): void
}

/** Where one worker's pull requests may be found. */
type WorkerAsk = {
  workerId: string
  branch: string | null
  numbers: number[]
  linked: number | null
}

const sameRepository = (a: GitHubRepository, b: GitHubRepository) =>
  a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase()

/** Pull request numbers in this repository that a worker's report links to. */
export function reportedPullRequests(worker: RouterWorker, repository: GitHubRepository): number[] {
  const report = worker.report
  if (!report) return []
  const text = [report.summary, ...report.artifacts.map((a) => a.ref)].join('\n')
  const numbers = new Set<number>()
  for (const match of text.matchAll(/https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/gi)) {
    if (sameRepository({ owner: match[1], name: match[2] }, repository))
      numbers.add(Number(match[3]))
  }
  return [...numbers].sort((a, b) => a - b)
}

/**
 * Every pull request agents opened, per project. Each worker's pull request is
 * found by its branch (Owlto names it `owlto/<workerId>`, or the branch the
 * worker switched to), by the link a previous lookup saved, and by pull
 * request links in its report. One request per project covers all its workers.
 */
export class ProjectPullRequests {
  constructor(
    private readonly host: ProjectPullRequestsHost,
    private readonly auth: WorkerGitHubAuth,
    private readonly http: GitHubHttp = fetch
  ) {}

  async read(): Promise<PullRequestOverview> {
    const token = await this.auth.token()
    if (!token) return { kind: 'signed-out' }
    const workers = this.host.workers()
    try {
      const projects = await Promise.all(
        this.host.projects().map(async (project) => ({
          projectId: project.id,
          status: await this.project(
            project,
            workers.filter((w) => w.projectId === project.id),
            token
          )
        }))
      )
      return { kind: 'ready', projects, fetchedAt: new Date().toISOString() }
    } catch (error) {
      if (!(error instanceof GitHubRequestError) || error.reason !== 'unauthorized') throw error
      this.auth.invalidate()
      return { kind: 'signed-out' }
    }
  }

  private async project(
    project: Project,
    workers: RouterWorker[],
    token: string
  ): Promise<ProjectPullRequestsStatus> {
    const remoteUrl = await this.host.projectRemoteUrl(project)
    const repository = remoteUrl ? parseGitHubRemote(remoteUrl) : null
    if (!repository) return { kind: 'unsupported' }
    const asks = await Promise.all(workers.map((w) => this.ask(w, repository)))
    try {
      const found = await lookupPullRequests(this.http, token, repository, {
        branches: asks.flatMap((a) => (a.branch ? [a.branch] : [])),
        numbers: asks.flatMap((a) => a.numbers)
      })
      if (found.kind === 'no-access')
        return {
          kind: this.auth.method() === 'app' ? 'not-installed' : 'no-access',
          ...repository
        }
      return {
        kind: 'ready',
        ...repository,
        pullRequests: this.match(asks, found.byBranch, found.byNumber, repository)
      }
    } catch (error) {
      // A revoked sign-in affects every project, so the whole read answers it.
      if (error instanceof GitHubRequestError && error.reason === 'unauthorized') throw error
      const reason =
        error instanceof GitHubRequestError && error.reason === 'rate-limited'
          ? 'rate-limited'
          : 'unavailable'
      return { kind: 'failed', reason }
    }
  }

  private async ask(worker: RouterWorker, repository: GitHubRepository): Promise<WorkerAsk> {
    const numbers = new Set(reportedPullRequests(worker, repository))
    const link = worker.pullRequest
    if (link && sameRepository(link, repository)) numbers.add(link.number)
    let branch: string | null = null
    if (worker.workspace.kind === 'worktree') {
      const local = await this.host.remoteBranch(worker.id)
      // A worktree that is gone may still have a pushed branch, or a merged one GitHub knows.
      if (!local) branch = worker.workspace.branch
      else if (local.pushed) branch = local.branch
    }
    if (link && branch === link.branch) branch = null
    return { workerId: worker.id, branch, numbers: [...numbers], linked: link?.number ?? null }
  }

  /** Each pull request once, with the worker whose branch opened it before one that links it. */
  private match(
    asks: WorkerAsk[],
    byBranch: Map<string, ListedPullRequest>,
    byNumber: Map<number, ListedPullRequest>,
    repository: GitHubRepository
  ): AgentPullRequest[] {
    const result = new Map<number, AgentPullRequest>()
    for (const ask of asks) {
      const found = ask.branch ? byBranch.get(ask.branch) : undefined
      if (!found) continue
      result.set(found.number, { ...found, workerId: ask.workerId })
      if (ask.linked !== found.number)
        this.host.linkPullRequest(ask.workerId, {
          ...repository,
          branch: found.branch,
          number: found.number
        })
    }
    for (const ask of asks) {
      for (const number of ask.numbers) {
        const found = byNumber.get(number)
        if (found && !result.has(number)) result.set(number, { ...found, workerId: ask.workerId })
      }
    }
    return [...result.values()].sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.number - a.number
    )
  }
}
