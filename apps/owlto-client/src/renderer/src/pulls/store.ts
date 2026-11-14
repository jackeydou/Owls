import { create } from 'zustand'
import type { PullRequestOverview } from '../../../shared/github'
import type {
  PullRequestFilter,
  PullRequestRow,
  PullRequestSort
} from '../../../shared/pull-request-list'

/** How often the open list asks GitHub again; one request per project. */
const REFRESH_MS = 60_000

type State = PullRequestFilter & {
  sort: PullRequestSort
  /** Null until the first read answers. */
  overview: PullRequestOverview | null
  loading: boolean
  /** True when the last read failed outright; the previous answer stays on screen. */
  failed: boolean
  setFilter(filter: Partial<PullRequestFilter>): void
  setSort(sort: PullRequestSort): void
  refresh(): Promise<void>
}

/** Newer reads win, so a slow reply cannot replace a newer one. */
let generation = 0

export const usePullRequestsStore = create<State>((set) => ({
  state: 'open',
  checks: 'all',
  projectId: null,
  sort: 'attention',
  overview: null,
  loading: false,
  failed: false,
  setFilter: (filter) => set(filter),
  setSort: (sort) => set({ sort }),
  refresh: async () => {
    const current = ++generation
    set({ loading: true })
    const reply = await window.owlto.pullRequests().catch(() => null)
    if (current !== generation) return
    if (reply?.ok) set({ overview: reply.value, loading: false, failed: false })
    else set({ loading: false, failed: true })
  }
}))

/** Reads now and then every minute while the list is open; the return stops it. */
export function watchPullRequests(): () => void {
  const { refresh } = usePullRequestsStore.getState()
  void refresh()
  const timer = setInterval(() => void refresh(), REFRESH_MS)
  return () => {
    clearInterval(timer)
    generation++
    usePullRequestsStore.setState({ loading: false })
  }
}

export function pullRequestRows(overview: PullRequestOverview | null): PullRequestRow[] {
  if (overview?.kind !== 'ready') return []
  return overview.projects.flatMap(({ projectId, status }) =>
    status.kind === 'ready' ? status.pullRequests.map((pr) => ({ ...pr, projectId })) : []
  )
}
