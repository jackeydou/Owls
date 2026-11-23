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
/** What a worker's browser tab waits on the user for: a hand-off, or a site rule's ask. */
export type BrowserNeedNotice = { kind: 'handoff' | 'open' | 'submit'; text: string }
/** What a worker waits on the user for in the iOS Simulator panel. */
export type SimulatorNeedNotice = {
  kind: 'device' | 'install' | 'launch' | 'open-url'
  /** The device name, app path, bundle id, or URL. */
  text: string
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
  /** Also tells paired phones, which may be away from this Mac. */
  remote?(notice: AttentionNotice): void
}

const BODY_LIMIT = 180
const AGENTS: Record<AgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  antigravity: 'Antigravity'
}
const COPY = {
  en: {
    approval: (agent: string) => `${agent} needs your OK`,
    question: (agent: string) => `${agent} has a question`,
    more: (count: number) => ` (+${count} more)`,
    files: 'Wants to change files',
    permissions: 'Wants more permissions',
    handoff: (agent: string) => `${agent} needs you in the browser`,
    open: (agent: string) => `${agent} wants to open a site`,
    openBody: (host: string) => `Allow ${host}?`,
    submit: (agent: string) => `${agent} wants to submit a form`,
    submitBody: (host: string) => `On ${host}, where you are signed in.`,
    simulator: {
      device: (agent: string) => `${agent} wants to use a simulator`,
      install: (agent: string) => `${agent} wants to install an app in the simulator`,
      launch: (agent: string) => `${agent} wants to launch an app in the simulator`,
      'open-url': (agent: string) => `${agent} wants to open a URL in the simulator`
    }
  },
  'zh-CN': {
    approval: (agent: string) => `${agent} 需要你批准`,
    question: (agent: string) => `${agent} 有个问题要问你`,
    more: (count: number) => `（还有 ${count} 个）`,
    files: '想要修改文件',
    permissions: '想要更多权限',
    handoff: (agent: string) => `${agent} 需要你在浏览器里操作`,
    open: (agent: string) => `${agent} 想打开一个网站`,
    openBody: (host: string) => `允许打开 ${host} 吗？`,
    submit: (agent: string) => `${agent} 想提交表单`,
    submitBody: (host: string) => `在你已登录的 ${host} 上。`,
    simulator: {
      device: (agent: string) => `${agent} 想使用模拟器`,
      install: (agent: string) => `${agent} 想在模拟器里安装 app`,
      launch: (agent: string) => `${agent} 想在模拟器里启动 app`,
      'open-url': (agent: string) => `${agent} 想在模拟器里打开链接`
    }
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
  /** Sessions whose worker's browser tab waits on the user, and for what. */
  private readonly browserNeeds = new Map<string, string>()
  /** Sessions whose worker waits on the user in the iOS Simulator panel, and for what. */
  private readonly simulatorNeeds = new Map<string, string>()
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
      this.browserNeeds.delete(event.sessionId)
      this.simulatorNeeds.delete(event.sessionId)
      this.closeNotice(event.sessionId)
      this.closeNotice(browserNoticeId(event.sessionId))
      this.closeNotice(simulatorNoticeId(event.sessionId))
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

  /**
   * A worker's browser tab started or stopped waiting on the user. It counts toward the badge
   * like a request, and is announced once while Owlto is not focused.
   */
  browserNeed(sessionId: string, provider: AgentProvider, need: BrowserNeedNotice | null): void {
    const id = browserNoticeId(sessionId)
    const before = this.browserNeeds.get(sessionId)
    const key = need ? `${need.kind}:${need.text}` : null
    if (!key) {
      this.browserNeeds.delete(sessionId)
      this.closeNotice(id)
      this.refreshBadge()
      return
    }
    this.browserNeeds.set(sessionId, key)
    this.refreshBadge()
    if (!need || before === key) return
    const settings = this.deps.settings()
    if (!settings.requestNotifications || this.deps.focused()) return
    const copy = COPY[settings.language] ?? COPY.en
    const agent = AGENTS[provider]
    const worker = this.deps.worker(sessionId)
    const notice: AttentionNotice = {
      title:
        need.kind === 'handoff'
          ? copy.handoff(agent)
          : need.kind === 'open'
            ? copy.open(agent)
            : copy.submit(agent),
      subtitle: clip(worker?.title ?? ''),
      body:
        need.kind === 'handoff'
          ? clip(need.text)
          : need.kind === 'open'
            ? copy.openBody(need.text)
            : copy.submitBody(need.text),
      target: { sessionId, workerId: worker?.id ?? null, routerId: worker?.routerId ?? null }
    }
    this.deps.remote?.(notice)
    this.closeNotice(id)
    const handle = this.deps.show(notice)
    if (handle) this.shown.set(id, handle)
  }

  /** Like `browserNeed`, for an ask in the iOS Simulator panel. */
  simulatorNeed(
    sessionId: string,
    provider: AgentProvider,
    need: SimulatorNeedNotice | null
  ): void {
    const id = simulatorNoticeId(sessionId)
    const before = this.simulatorNeeds.get(sessionId)
    if (!need) {
      this.simulatorNeeds.delete(sessionId)
      this.closeNotice(id)
      this.refreshBadge()
      return
    }
    const key = `${need.kind}:${need.text}`
    this.simulatorNeeds.set(sessionId, key)
    this.refreshBadge()
    if (before === key) return
    const settings = this.deps.settings()
    if (!settings.requestNotifications || this.deps.focused()) return
    const copy = COPY[settings.language] ?? COPY.en
    const worker = this.deps.worker(sessionId)
    const notice: AttentionNotice = {
      title: copy.simulator[need.kind](AGENTS[provider]),
      subtitle: clip(worker?.title ?? ''),
      body: clip(need.text),
      target: { sessionId, workerId: worker?.id ?? null, routerId: worker?.routerId ?? null }
    }
    this.deps.remote?.(notice)
    this.closeNotice(id)
    const handle = this.deps.show(notice)
    if (handle) this.shown.set(id, handle)
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
    this.deps.remote?.(notice)
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
    if (this.deps.settings().requestNotifications) {
      for (const ids of this.pending.values()) count += ids.size
      count += this.browserNeeds.size
      count += this.simulatorNeeds.size
    }
    if (count === this.badgeCount) return
    this.badgeCount = count
    this.deps.badge(count)
  }
}

function browserNoticeId(sessionId: string): string {
  return `browser:${sessionId}`
}

function simulatorNoticeId(sessionId: string): string {
  return `simulator:${sessionId}`
}

function pendingIds(session: Session): Set<string> {
  return new Set(session.requests.filter((r) => r.status === 'pending').map((r) => r.id))
}
