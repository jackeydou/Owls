import type { AgentPullRequest, PullRequestOverview } from '../../shared/github.js'

/** How often agent pull requests are read for changes. One GraphQL request per project. */
export const PULL_REQUEST_POLL_MS = 120_000
/** Follow-up turns one pull request may start per local day, so a loop stays contained. */
export const DAILY_FOLLOW_UP_LIMIT = 8
const DETAIL_LIMIT = 600

export type PullRequestEventKind =
  | 'checks_failed'
  | 'checks_passed'
  | 'changes_requested'
  | 'approved'
  | 'conflicted'
  | 'commented'
  | 'merged'
  | 'closed'
export type PullRequestEvent = { kind: PullRequestEventKind; detail: string; url: string | null }
/** Events the worker that opened the pull request should act on; the rest only inform the Router. */
export const actionableEvent = (event: PullRequestEvent) =>
  event.kind === 'checks_failed' ||
  event.kind === 'changes_requested' ||
  event.kind === 'conflicted' ||
  event.kind === 'commented'

/** What a poll remembers about one pull request. */
export type PullRequestSeen = {
  state: AgentPullRequest['state']
  checksState: AgentPullRequest['checksState']
  review: AgentPullRequest['review']
  conflicted: boolean
  activity: Set<string>
}

export function seenOf(pr: AgentPullRequest): PullRequestSeen {
  return {
    state: pr.state,
    checksState: pr.checksState,
    review: pr.review,
    conflicted: pr.conflicted,
    activity: new Set(pr.activity.map((a) => a.id))
  }
}

const clip = (text: string) =>
  text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}…` : text
const open = (state: AgentPullRequest['state']) => state === 'open' || state === 'draft'

/**
 * What changed on a pull request since the last poll. The first sighting only
 * sets the baseline. `ownComment` says whether a new comment came from the
 * worker itself, which must not wake it again.
 */
export function pullRequestChanges(
  previous: PullRequestSeen | undefined,
  next: AgentPullRequest,
  ownComment: (author: string | null) => boolean
): PullRequestEvent[] {
  if (!previous) return []
  const events: PullRequestEvent[] = []
  if (open(previous.state) && next.state === 'merged')
    events.push({ kind: 'merged', detail: 'The pull request was merged.', url: next.url })
  if (open(previous.state) && next.state === 'closed')
    events.push({
      kind: 'closed',
      detail: 'The pull request was closed without merging.',
      url: next.url
    })
  if (!open(next.state)) return events
  if (next.checksState === 'failure' && previous.checksState !== 'failure') {
    const failing = next.checks.filter((c) => c.state === 'failure')
    events.push({
      kind: 'checks_failed',
      detail: `Failing checks: ${failing.map((c) => c.name).join(', ') || 'unknown'}.`,
      url: failing.find((c) => c.url)?.url ?? next.url
    })
  }
  if (
    next.checksState === 'success' &&
    (previous.checksState === 'pending' || previous.checksState === 'failure')
  )
    events.push({ kind: 'checks_passed', detail: 'All checks passed.', url: next.url })
  if (next.review === 'changes-requested' && previous.review !== 'changes-requested')
    events.push({
      kind: 'changes_requested',
      detail: 'A reviewer requested changes.',
      url: next.url
    })
  if (next.review === 'approved' && previous.review !== 'approved')
    events.push({ kind: 'approved', detail: 'The pull request was approved.', url: next.url })
  if (next.conflicted && !previous.conflicted)
    events.push({
      kind: 'conflicted',
      detail: 'The pull request now conflicts with its base branch.',
      url: next.url
    })
  for (const item of next.activity) {
    if (previous.activity.has(item.id) || !item.trusted || ownComment(item.author)) continue
    const body = item.body.trim()
    // An approval or change request without text is already covered by the review state.
    if (!body) continue
    const what =
      item.kind === 'review' ? `review (${item.state?.toLowerCase() ?? 'comment'})` : 'comment'
    events.push({
      kind: 'commented',
      detail: `${item.author ?? 'someone'} left a ${what}: ${clip(body)}`,
      url: item.url
    })
  }
  return events
}

export type PullRequestWatcherDeps = {
  read(): Promise<PullRequestOverview>
  /** The user's switch for follow-ups. */
  enabled(): boolean
  /** The signed-in GitHub login; workers push and comment as this user. */
  viewer(): string | null
  workerActive(workerId: string): boolean
  /** `followUp` false means the daily limit is reached: the Router only hears about it. */
  deliver(pr: AgentPullRequest, events: PullRequestEvent[], followUp: boolean): Promise<void>
  now?: () => Date
}

/**
 * Polls agent pull requests and turns changes into follow-ups (RFC: hybrid
 * routing). GitHub cannot push to a desktop app, so this reads every two
 * minutes while follow-ups are on. Baselines live in memory: after a restart
 * the first read only learns the current state.
 */
export class PullRequestWatcher {
  private readonly seen = new Map<string, PullRequestSeen>()
  /** Workers that were running at the last poll, whose comments since then are their own. */
  private activeBefore = new Set<string>()
  private readonly turns = new Map<string, { day: string; count: number }>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private running = false

  constructor(private readonly deps: PullRequestWatcherDeps) {}

  start(): void {
    if (this.closed || this.timer) return
    this.timer = setTimeout(() => void this.loop(), 0)
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async loop(): Promise<void> {
    await this.tick().catch(() => {})
    if (!this.closed) this.timer = setTimeout(() => void this.loop(), PULL_REQUEST_POLL_MS)
  }

  /** One poll. Public for tests. */
  async tick(): Promise<void> {
    if (this.running || this.closed) return
    if (!this.deps.enabled()) {
      // Turning follow-ups back on must not replay what happened while they were off.
      this.seen.clear()
      return
    }
    this.running = true
    try {
      const overview = await this.deps.read()
      if (overview.kind !== 'ready') return
      const viewer = this.deps.viewer()?.toLowerCase() ?? null
      const activeNow = new Set<string>()
      for (const { status } of overview.projects) {
        if (status.kind !== 'ready') continue
        for (const pr of status.pullRequests) {
          const key = `${pr.owner}/${pr.name}#${pr.number}`.toLowerCase()
          const active = this.deps.workerActive(pr.workerId) || this.activeBefore.has(pr.workerId)
          if (this.deps.workerActive(pr.workerId)) activeNow.add(pr.workerId)
          const events = pullRequestChanges(
            this.seen.get(key),
            pr,
            (author) => active && viewer !== null && author?.toLowerCase() === viewer
          )
          this.seen.set(key, seenOf(pr))
          if (!events.length) continue
          const followUp = events.some(actionableEvent) && this.take(key)
          await this.deps.deliver(pr, events, followUp).catch(() => {})
        }
      }
      this.activeBefore = activeNow
    } finally {
      this.running = false
    }
  }

  /** Counts a follow-up turn for today; false once the pull request used up its turns. */
  private take(key: string): boolean {
    const now = this.deps.now?.() ?? new Date()
    const day = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
    const current = this.turns.get(key)
    const count = current?.day === day ? current.count : 0
    if (count >= DAILY_FOLLOW_UP_LIMIT) return false
    this.turns.set(key, { day, count: count + 1 })
    return true
  }
}
