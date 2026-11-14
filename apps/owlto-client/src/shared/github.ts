import { z } from 'zod'

/** Where a user adds the Owlto GitHub App to their repositories. */
export const GITHUB_APP_INSTALL_URL = 'https://github.com/apps/owls-agents/installations/new'

/** Where to create a token for the personal access token connection. */
export const GITHUB_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

export const gitHubTokenSchema = z.string().trim().min(1).max(512)
export type GitHubAuthMethod = 'app' | 'gh-cli' | 'token'
export type GitHubSignInFailure =
  | 'denied'
  | 'expired'
  | 'network'
  | 'gh-unavailable'
  | 'invalid-token'
export type GitHubAccount =
  | { status: 'signed-out'; failure: GitHubSignInFailure | null }
  | { status: 'pending'; userCode: string; verificationUri: string; expiresAt: string }
  /** `failure` is why a switch to another connection did not happen. */
  | {
      status: 'signed-in'
      login: string
      method: GitHubAuthMethod
      failure: GitHubSignInFailure | null
    }

export type WorkerCheckState = 'success' | 'failure' | 'pending' | 'neutral'
export type WorkerCheck = { name: string; state: WorkerCheckState; url: string | null }
export type WorkerPullRequest = {
  owner: string
  name: string
  number: number
  title: string
  url: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  /** Null when the repository does not ask for a review. */
  review: 'approved' | 'changes-requested' | 'required' | null
  conflicted: boolean
  /** Null when the head commit has no checks. */
  checksState: Exclude<WorkerCheckState, 'neutral'> | null
  /** Failures first, then running checks, then by name. */
  checks: WorkerCheck[]
}
export type WorkerGitHubStatus =
  /** Nothing to show: the worker has no worktree, or its repository is not on GitHub. */
  | { kind: 'unsupported' }
  | { kind: 'signed-out' }
  | { kind: 'not-installed'; owner: string; name: string }
  /** A `gh` or personal access token connection that cannot read the repository. */
  | { kind: 'no-access'; owner: string; name: string }
  | { kind: 'not-pushed'; branch: string }
  | { kind: 'no-pull-request'; branch: string }
  | { kind: 'pull-request'; pullRequest: WorkerPullRequest }
  | { kind: 'failed'; reason: 'rate-limited' | 'unavailable' }

/** A pull request an agent opened, and the worker whose work it carries. */
export type AgentPullRequest = WorkerPullRequest & {
  workerId: string
  branch: string
  createdAt: string
  updatedAt: string
}
/** One project's agent pull requests, or why they cannot be read. */
export type ProjectPullRequestsStatus =
  /** The project's repository is not on GitHub. */
  | { kind: 'unsupported' }
  | { kind: 'not-installed'; owner: string; name: string }
  | { kind: 'no-access'; owner: string; name: string }
  | { kind: 'failed'; reason: 'rate-limited' | 'unavailable' }
  /** Newest activity first. */
  | { kind: 'ready'; owner: string; name: string; pullRequests: AgentPullRequest[] }
export type ProjectPullRequests = { projectId: string; status: ProjectPullRequestsStatus }
export type PullRequestOverview =
  | { kind: 'signed-out' }
  /** Projects in the app's order. */
  | { kind: 'ready'; projects: ProjectPullRequests[]; fetchedAt: string }
