import { z } from 'zod'
import type { WorkerCheck, WorkerCheckState, WorkerPullRequest } from '../../shared/github.js'
import type { GitHubHttp } from './auth.js'

const GRAPHQL_URL = 'https://api.github.com/graphql'
const REQUEST_TIMEOUT_MS = 15_000
/** The fields every pull request query reads, so one mapping serves them all. */
const PULL_REQUEST_FIELDS = `number title url state isDraft isCrossRepository mergeable reviewDecision
  headRefName createdAt updatedAt
  commits(last: 1) { nodes { commit { statusCheckRollup {
    state
    contexts(first: 100) { nodes {
      __typename
      ... on CheckRun { name status conclusion detailsUrl }
      ... on StatusContext { context state targetUrl }
    } }
  } } } }`
/** One query, so a poll costs a single point of GitHub's rate limit. */
const QUERY = `query($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, first: 10, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { ...PullRequestFields }
    }
  }
}
fragment PullRequestFields on PullRequest { ${PULL_REQUEST_FIELDS} }`

const contextSchema = z.object({
  __typename: z.string(),
  name: z.string().optional(),
  status: z.string().optional(),
  conclusion: z.string().nullable().optional(),
  detailsUrl: z.string().nullable().optional(),
  context: z.string().optional(),
  state: z.string().optional(),
  targetUrl: z.string().nullable().optional()
})
type CheckContext = z.infer<typeof contextSchema>
const pullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string().url(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  isCrossRepository: z.boolean(),
  mergeable: z.string(),
  reviewDecision: z.string().nullable(),
  headRefName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          statusCheckRollup: z
            .object({
              state: z.string(),
              contexts: z.object({ nodes: z.array(contextSchema) })
            })
            .nullable()
        })
      })
    )
  })
})
type PullRequestNode = z.infer<typeof pullRequestSchema>
const replySchema = z.object({
  data: z
    .object({
      repository: z
        .object({ pullRequests: z.object({ nodes: z.array(pullRequestSchema) }) })
        .nullable()
    })
    .nullable()
    .optional(),
  errors: z.array(z.object({ type: z.string().optional() })).optional()
})

export type GitHubRepository = { owner: string; name: string }
export type PullRequestLookup =
  | { kind: 'found'; pullRequest: WorkerPullRequest }
  | { kind: 'none' }
  /** The App is not installed on the repository, or the user cannot see it. */
  | { kind: 'no-access' }

export class GitHubRequestError extends Error {
  constructor(
    readonly reason: 'unauthorized' | 'rate-limited' | 'unavailable',
    /** When a rate limit lifts, in epoch milliseconds, if GitHub said. */
    readonly retryAt: number | null = null
  ) {
    super(`GitHub request failed: ${reason}.`)
  }
}

/** The repository behind a remote URL; null for anything not on github.com. */
export function parseGitHubRemote(remoteUrl: string): GitHubRepository | null {
  const match =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
      remoteUrl.trim()
    )
  return match ? { owner: match[1], name: match[2] } : null
}

function contextState(context: CheckContext): WorkerCheckState {
  if (context.__typename === 'StatusContext') {
    if (context.state === 'SUCCESS') return 'success'
    return context.state === 'FAILURE' || context.state === 'ERROR' ? 'failure' : 'pending'
  }
  if (context.status !== 'COMPLETED') return 'pending'
  if (context.conclusion === 'SUCCESS') return 'success'
  return context.conclusion === 'NEUTRAL' ||
    context.conclusion === 'SKIPPED' ||
    context.conclusion === 'STALE'
    ? 'neutral'
    : 'failure'
}
const CHECK_ORDER: Record<WorkerCheckState, number> = {
  failure: 0,
  pending: 1,
  success: 2,
  neutral: 3
}
function toCheck(context: CheckContext): WorkerCheck {
  return {
    name: context.name ?? context.context ?? '',
    state: contextState(context),
    url: context.detailsUrl ?? context.targetUrl ?? null
  }
}
function checksState(state: string | undefined): WorkerPullRequest['checksState'] {
  if (state === undefined) return null
  if (state === 'SUCCESS') return 'success'
  return state === 'FAILURE' || state === 'ERROR' ? 'failure' : 'pending'
}
function reviewState(decision: string | null): WorkerPullRequest['review'] {
  if (decision === 'APPROVED') return 'approved'
  if (decision === 'CHANGES_REQUESTED') return 'changes-requested'
  return decision === 'REVIEW_REQUIRED' ? 'required' : null
}
function pullRequestState(node: PullRequestNode): WorkerPullRequest['state'] {
  if (node.state === 'MERGED') return 'merged'
  if (node.state === 'CLOSED') return 'closed'
  return node.isDraft ? 'draft' : 'open'
}
function toPullRequest(repository: GitHubRepository, node: PullRequestNode): WorkerPullRequest {
  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup ?? null
  return {
    ...repository,
    number: node.number,
    title: node.title,
    url: node.url,
    state: pullRequestState(node),
    review: reviewState(node.reviewDecision),
    conflicted: node.mergeable === 'CONFLICTING',
    checksState: checksState(rollup?.state),
    checks: (rollup?.contexts.nodes ?? [])
      .map(toCheck)
      .sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || a.name.localeCompare(b.name))
  }
}

function retryTime(response: Response): number | null {
  const after = Number(response.headers.get('retry-after'))
  if (after > 0) return Date.now() + after * 1000
  if (response.headers.get('x-ratelimit-remaining') !== '0') return null
  const reset = Number(response.headers.get('x-ratelimit-reset'))
  return reset > 0 ? reset * 1000 : null
}

type GraphQLReply = { data?: unknown; errors?: Array<{ type?: string }> }
type GraphQLRequest = { query: string; variables: Record<string, unknown> }
const graphQLReplySchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ type: z.string().optional() })).optional()
})

/**
 * Posts one GraphQL query. Transport, auth, and rate-limit failures throw a
 * `GitHubRequestError`; GraphQL errors come back for the caller to read.
 */
async function postGraphQL(
  http: GitHubHttp,
  token: string,
  request: GraphQLRequest
): Promise<GraphQLReply> {
  const response = await http(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (response.status === 401) throw new GitHubRequestError('unauthorized')
  if (response.status === 403 || response.status === 429) {
    const retryAt = retryTime(response)
    throw new GitHubRequestError(
      retryAt === null && response.status === 403 ? 'unavailable' : 'rate-limited',
      retryAt
    )
  }
  if (!response.ok) throw new GitHubRequestError('unavailable')
  const reply = graphQLReplySchema.parse(await response.json())
  if ((reply.errors ?? []).some((error) => error.type === 'RATE_LIMITED'))
    throw new GitHubRequestError('rate-limited')
  return reply
}
const lacksAccess = (reply: GraphQLReply) =>
  (reply.errors ?? []).some((error) => error.type === 'NOT_FOUND' || error.type === 'FORBIDDEN')

/** Finds the pull request a repository's own branch opened, preferring one still open. */
export async function lookupPullRequest(
  http: GitHubHttp,
  token: string,
  repository: GitHubRepository,
  branch: string
): Promise<PullRequestLookup> {
  const raw = await postGraphQL(http, token, {
    query: QUERY,
    variables: { ...repository, branch }
  })
  if (lacksAccess(raw)) return { kind: 'no-access' }
  const reply = replySchema.parse(raw)
  if (reply.errors?.length || !reply.data) throw new GitHubRequestError('unavailable')
  if (!reply.data.repository) return { kind: 'no-access' }
  // A fork's branch can share this name, but it is not this worker's work.
  const nodes = reply.data.repository.pullRequests.nodes.filter((n) => !n.isCrossRepository)
  const node = pickPullRequest(nodes)
  return node ? { kind: 'found', pullRequest: toPullRequest(repository, node) } : { kind: 'none' }
}

const pickPullRequest = (nodes: PullRequestNode[]) =>
  nodes.find((n) => n.state === 'OPEN') ?? nodes[0]

/** What to look up in one repository: pull requests by head branch, and by number. */
export type PullRequestQuery = { branches: string[]; numbers: number[] }
/** One repository's answers, keyed by the branch or number asked for. */
export type PullRequestBatch =
  | { kind: 'no-access' }
  | {
      kind: 'found'
      byBranch: Map<string, ListedPullRequest>
      byNumber: Map<number, ListedPullRequest>
    }
export type ListedPullRequest = WorkerPullRequest & {
  branch: string
  createdAt: string
  updatedAt: string
}
/** Aliases per request, which keeps one query well under GitHub's node limit. */
const BATCH_SIZE = 50

function batchQuery(branches: string[], numbers: number[]): string {
  const byBranch = branches.map(
    (_, i) =>
      `b${i}: pullRequests(headRefName: $b${i}, first: 5, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ...PullRequestFields } }`
  )
  const byNumber = numbers.map(
    (n, i) => `n${i}: pullRequest(number: ${n}) { ...PullRequestFields }`
  )
  const params = ['$owner: String!', '$name: String!', ...branches.map((_, i) => `$b${i}: String!`)]
  return `query(${params.join(', ')}) {
  repository(owner: $owner, name: $name) {
    ${[...byBranch, ...byNumber].join('\n    ')}
  }
}
fragment PullRequestFields on PullRequest { ${PULL_REQUEST_FIELDS} }`
}
const listedSchema = z.object({ nodes: z.array(pullRequestSchema) })
const batchReplySchema = z.object({
  data: z
    .object({ repository: z.record(z.string(), z.unknown()).nullable() })
    .nullable()
    .optional()
})

function toListed(repository: GitHubRepository, node: PullRequestNode): ListedPullRequest {
  return {
    ...toPullRequest(repository, node),
    branch: node.headRefName,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt
  }
}

/**
 * Looks up many branches and pull request numbers in one repository with as
 * few requests as it can. A number that names no pull request is left out.
 */
export async function lookupPullRequests(
  http: GitHubHttp,
  token: string,
  repository: GitHubRepository,
  query: PullRequestQuery
): Promise<PullRequestBatch> {
  const branches = [...new Set(query.branches)].sort()
  const numbers = [...new Set(query.numbers)]
    .filter((n) => Number.isSafeInteger(n) && n > 0)
    .sort((a, b) => a - b)
  const byBranch = new Map<string, ListedPullRequest>()
  const byNumber = new Map<number, ListedPullRequest>()
  const asks = [
    ...branches.map((branch) => ({ kind: 'branch' as const, branch })),
    ...numbers.map((number) => ({ kind: 'number' as const, number }))
  ]
  for (let start = 0; start < asks.length; start += BATCH_SIZE) {
    const chunk = asks.slice(start, start + BATCH_SIZE)
    const chunkBranches = chunk.flatMap((a) => (a.kind === 'branch' ? [a.branch] : []))
    const chunkNumbers = chunk.flatMap((a) => (a.kind === 'number' ? [a.number] : []))
    const variables: Record<string, unknown> = { ...repository }
    chunkBranches.forEach((branch, i) => {
      variables[`b${i}`] = branch
    })
    const raw = await postGraphQL(http, token, {
      query: batchQuery(chunkBranches, chunkNumbers),
      variables
    })
    const found = batchReplySchema.parse(raw).data?.repository
    if (!found) {
      if (found === null || lacksAccess(raw)) return { kind: 'no-access' }
      throw new GitHubRequestError('unavailable')
    }
    // A number with no pull request is NOT_FOUND on its own alias; the rest still answer.
    if ((raw.errors ?? []).some((e) => e.type !== 'NOT_FOUND'))
      throw new GitHubRequestError('unavailable')
    chunkBranches.forEach((branch, i) => {
      // A fork's branch can share this name, but it is not this worker's work.
      const nodes = listedSchema.parse(found[`b${i}`]).nodes.filter((n) => !n.isCrossRepository)
      const node = pickPullRequest(nodes)
      if (node) byBranch.set(branch, toListed(repository, node))
    })
    chunkNumbers.forEach((number, i) => {
      const value = found[`n${i}`]
      if (value) byNumber.set(number, toListed(repository, pullRequestSchema.parse(value)))
    })
  }
  return { kind: 'found', byBranch, byNumber }
}
