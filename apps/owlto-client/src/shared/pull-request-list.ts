import type { AgentPullRequest, WorkerPullRequest } from './github.js'

/** A row of the pull request list: one agent pull request and its project. */
export type PullRequestRow = AgentPullRequest & { projectId: string }

export const pullRequestStateFilters = ['all', 'open', 'draft', 'merged', 'closed'] as const
export type PullRequestStateFilter = (typeof pullRequestStateFilters)[number]
export const pullRequestChecksFilters = ['all', 'failure', 'pending', 'success', 'none'] as const
export type PullRequestChecksFilter = (typeof pullRequestChecksFilters)[number]
export const pullRequestSorts = ['updated', 'newest', 'oldest', 'attention'] as const
export type PullRequestSort = (typeof pullRequestSorts)[number]

export type PullRequestFilter = {
  state: PullRequestStateFilter
  checks: PullRequestChecksFilter
  /** Null shows every project. */
  projectId: string | null
}

const checksOf = (row: Pick<WorkerPullRequest, 'checksState'>) => row.checksState ?? 'none'

export function matchesPullRequest(
  row: PullRequestRow,
  filter: PullRequestFilter,
  skip: keyof PullRequestFilter | null = null
): boolean {
  if (skip !== 'projectId' && filter.projectId !== null && row.projectId !== filter.projectId)
    return false
  if (skip !== 'state' && filter.state !== 'all' && row.state !== filter.state) return false
  return skip === 'checks' || filter.checks === 'all' || checksOf(row) === filter.checks
}

/**
 * How many rows each choice of one filter would show, with the other filters
 * applied, so a count never promises rows the list will not show.
 */
export function countPullRequests<K extends 'state' | 'checks'>(
  rows: PullRequestRow[],
  filter: PullRequestFilter,
  key: K
): Record<PullRequestFilter[K], number> {
  const values = key === 'state' ? pullRequestStateFilters : pullRequestChecksFilters
  const counts = Object.fromEntries(values.map((v) => [v, 0])) as Record<string, number>
  for (const row of rows) {
    if (!matchesPullRequest(row, filter, key)) continue
    counts.all++
    counts[key === 'state' ? row.state : checksOf(row)]++
  }
  return counts as Record<PullRequestFilter[K], number>
}

/**
 * Open work that needs a person first: failing checks or conflicts, then changes
 * requested, running checks, waiting for review, and the rest; finished last.
 */
function attentionRank(row: PullRequestRow): number {
  if (row.state === 'merged' || row.state === 'closed') return 6
  if (row.checksState === 'failure' || row.conflicted) return 0
  if (row.review === 'changes-requested') return 1
  if (row.checksState === 'pending') return 2
  if (row.review === 'required') return 3
  return row.state === 'draft' ? 5 : 4
}

const byRecent = (a: PullRequestRow, b: PullRequestRow) => b.updatedAt.localeCompare(a.updatedAt)
/** Ties fall back to the repository and number, so the order never depends on input order. */
const byIdentity = (a: PullRequestRow, b: PullRequestRow) =>
  a.projectId.localeCompare(b.projectId) || b.number - a.number

export function sortPullRequests(rows: PullRequestRow[], sort: PullRequestSort): PullRequestRow[] {
  const compare: Record<PullRequestSort, (a: PullRequestRow, b: PullRequestRow) => number> = {
    updated: byRecent,
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
    attention: (a, b) => attentionRank(a) - attentionRank(b) || byRecent(a, b)
  }
  return [...rows].sort((a, b) => compare[sort](a, b) || byIdentity(a, b))
}

export function listPullRequests(
  rows: PullRequestRow[],
  filter: PullRequestFilter,
  sort: PullRequestSort
): PullRequestRow[] {
  return sortPullRequests(
    rows.filter((row) => matchesPullRequest(row, filter)),
    sort
  )
}
