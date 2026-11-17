import type {
  AgentProvider,
  AgentRequest,
  AppEvent,
  AppSettings,
  Session
} from '../../shared/app.js'

/** Where clicking a notice takes the user: the worker's thread and panel, when it is a worker. */
export type AttentionTarget = {
  sessionId: string
  workerId: string | null
  routerId: string | null
}
export type AttentionNotice = {
  title: string
  /** Shown under the title on macOS; folded into the body elsewhere by the adapter. */
  subtitle: string
  body: string
  target: AttentionTarget
}
/** A shown notice, closed once its requests are answered so Notification Center does not keep it. */
export type NoticeHandle = { close(): void }
export type AttentionDeps = {
  settings(): Pick<AppSettings, 'language' | 'requestNotifications'>
  /** True while the user is looking at Owlto, where the request tray already shows the request. */
  focused(): boolean
  worker(sessionId: string): { id: string; routerId: string; title: string } | null
  show(notice: AttentionNotice): NoticeHandle | null
  /** Pending requests across all sessions; 0 clears the badge. */
  badge(count: number): void
}

const BODY_LIMIT = 180
const AGENTS: Record<AgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor'
}
const COPY = {
  en: {
    approval: (agent: string) => `${agent} needs your OK`,
    question: (agent: string) => `${agent} has a question`,
    more: (count: number) => ` (+${count} more)`,
    files: 'Wants to change files',
    permissions: 'Wants more permissions'
  },
  'zh-CN': {
    approval: (agent: string) => `${agent} 需要你批准`,
    question: (agent: string) => `${agent} 有个问题要问你`,
    more: (count: number) => `（还有 ${count} 个）`,
    files: '想要修改文件',
    permissions: '想要更多权限'
  }
} as const

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > BODY_LIMIT ? `${line.slice(0, BODY_LIMIT - 1)}…` : line
}
function describe(request: AgentRequest, copy: (typeof COPY)[keyof typeof COPY]): string {
  if (request.kind === 'question') {
    const [first] = request.questions
    return clip(first?.question || first?.header || request.title)
  }
  const text = clip(request.title || request.detail)
  if (text) return text
  return request.kind === 'files'
    ? copy.files
    : request.kind === 'permissions'
      ? copy.permissions
      : ''
}

/**
 * Tells the user, with a system notification and the dock badge, when a worker
 * stops to ask for an approval or an answer. Each request is announced once,
 * only while Owlto is not focused, and its notice closes once nothing in that
 * session waits anymore.
 */
export class WorkerAttention {
  /** Pending request ids per session, as last seen. */
  private readonly pending = new Map<string, Set<string>>()
  private readonly shown = new Map<string, NoticeHandle>()
  private badgeCount = -1

  /** `sessions` are the ones already loaded, whose waiting requests were there before this run. */
  constructor(
    private readonly deps: AttentionDeps,
    sessions: Session[]
  ) {
    for (const session of sessions) this.pending.set(session.id, pendingIds(session))
    this.refreshBadge()
  }

  observe(event: AppEvent): void {
    if (event.type === 'removed') {
      this.pending.delete(event.sessionId)
      this.closeNotice(event.sessionId)
      this.refreshBadge()
      return
    }
    if (event.type !== 'session') return
    const session = event.session
    const before = this.pending.get(session.id) ?? new Set<string>()
    const now = pendingIds(session)
    this.pending.set(session.id, now)
    const fresh = session.requests.filter((r) => r.status === 'pending' && !before.has(r.id))
    if (now.size === 0) this.closeNotice(session.id)
    this.refreshBadge()
    if (fresh.length > 0) this.announce(session, fresh, now.size)
  }

  /** Settings changed: a turned-off switch clears the badge and closes open notices. */
  settingsChanged(): void {
    if (!this.deps.settings().requestNotifications)
      for (const id of [...this.shown.keys()]) this.closeNotice(id)
    this.refreshBadge()
  }

  close(): void {
    for (const id of [...this.shown.keys()]) this.closeNotice(id)
    this.deps.badge(0)
  }

  private announce(session: Session, fresh: AgentRequest[], waiting: number): void {
    const settings = this.deps.settings()
    if (!settings.requestNotifications || this.deps.focused()) return
    const copy = COPY[settings.language] ?? COPY.en
    const agent = AGENTS[session.provider]
    const request = fresh[fresh.length - 1]
    if (!request) return
    const worker = this.deps.worker(session.id)
    const more = waiting > 1 ? copy.more(waiting - 1) : ''
    const notice: AttentionNotice = {
      title: request.kind === 'question' ? copy.question(agent) : copy.approval(agent),
      subtitle: clip(worker?.title || session.title),
      body: `${describe(request, copy)}${more}`,
      target: {
        sessionId: session.id,
        workerId: worker?.id ?? null,
        routerId: worker?.routerId ?? null
      }
    }
    // One notice per session: a newer request replaces the one still on screen.
    this.closeNotice(session.id)
    const handle = this.deps.show(notice)
    if (handle) this.shown.set(session.id, handle)
  }

  private closeNotice(sessionId: string): void {
    const handle = this.shown.get(sessionId)
    if (!handle) return
    this.shown.delete(sessionId)
    handle.close()
  }

  private refreshBadge(): void {
    let count = 0
    if (this.deps.settings().requestNotifications)
      for (const ids of this.pending.values()) count += ids.size
    if (count === this.badgeCount) return
    this.badgeCount = count
    this.deps.badge(count)
  }
}

function pendingIds(session: Session): Set<string> {
  return new Set(session.requests.filter((r) => r.status === 'pending').map((r) => r.id))
}
