import { randomUUID } from 'node:crypto'
import type { FeatureFlagKey, FeatureFlagValue } from '../../shared/analytics.js'
import type { AppEvent, AppSettings } from '../../shared/app.js'
import type { AnalyticsSink, EventProperties, FlagSnapshot } from './posthog.js'

/**
 * Every event Owlto sends. Properties are counts, flags, and enum values only: never message
 * text, code, file names, paths, project names, or anything else the user typed.
 */
export type AnalyticsEvent =
  | 'app_installed'
  | 'app_opened'
  | 'onboarding_finished'
  | 'thread_created'
  | 'message_sent'
  | 'message_forwarded'
  | 'worker_started'
  | 'project_added'
  | 'agent_connected'
  | 'automation_saved'
  | 'note_saved'
  | 'feedback_sent'

/** What successful IPC calls count as, by channel. Unlisted channels send nothing. */
const IPC_EVENTS: Record<
  string,
  { event: AnalyticsEvent; properties?: EventProperties; needsValue?: boolean }
> = {
  'router-create': { event: 'thread_created' },
  'router-send': { event: 'message_sent' },
  'router-forward': { event: 'message_forwarded' },
  'pick-project': { event: 'project_added', properties: { method: 'pick' }, needsValue: true },
  'clone-project': { event: 'project_added', properties: { method: 'clone' } },
  'create-project': { event: 'project_added', properties: { method: 'create' } },
  'promote-workspace-folder': { event: 'project_added', properties: { method: 'workspace' } },
  'automations-save': { event: 'automation_saved' },
  'cards-save': { event: 'note_saved', properties: { method: 'edit' } },
  'cards-capture': { event: 'note_saved', properties: { method: 'capture' } },
  'feedback-send': { event: 'feedback_sent' }
}
const CONNECT_CHANNELS: Record<string, string> = {
  connect: 'codex',
  'connect-claude': 'claude-code',
  'connect-cursor': 'cursor'
}
/** Flags are read once per launch and again after this long. */
const FLAGS_TTL_MS = 60 * 60_000

/** The anonymous install id, kept in the data root; it is not tied to any account. */
export type AnalyticsIdentity = { distinctId: string; firstSeenAt: string }
export type AnalyticsDeps = {
  sink: AnalyticsSink
  settings: () => Pick<AppSettings, 'usageData' | 'language' | 'connectedAgents'>
  /** Reads the saved identity; null when there is none yet or it is unreadable. */
  loadIdentity: () => AnalyticsIdentity | null
  saveIdentity: (identity: AnalyticsIdentity) => void
  /** Sent with every event: app version, OS, and architecture. */
  context: { appVersion: string; os: string; osVersion: string; arch: string }
  now?: () => Date
}

/**
 * Anonymous install and usage analytics with PostHog feature flags for A/B tests. It exists
 * only in builds that carry a PostHog key, and sends nothing while the user has usage data off.
 * The PostHog SDK batches, retries, and reports flag exposure; this class decides what to send.
 */
export class Analytics {
  private identity: AnalyticsIdentity | null = null
  private readonly startedAt: Date
  /** Workers already seen, so a worker counts as started once. */
  private readonly workers = new Set<string>()
  private flagSnapshot: { flags: FlagSnapshot; at: number } | null = null
  private flagRead: Promise<FlagSnapshot | null> | null = null
  private closed = false
  constructor(private readonly deps: AnalyticsDeps) {
    this.startedAt = this.now()
  }
  /** Records the launch, and the install on the first launch. */
  start(): void {
    if (!this.enabled()) {
      void this.deps.sink.pause()
      return
    }
    this.begin()
    this.capture('app_opened', {
      connected_agents: [...this.deps.settings().connectedAgents].sort().join(',')
    })
  }
  private begin(): void {
    if (this.identity) return
    const saved = this.deps.loadIdentity()
    if (saved) {
      this.identity = saved
      return
    }
    this.identity = { distinctId: randomUUID(), firstSeenAt: this.now().toISOString() }
    this.deps.saveIdentity(this.identity)
    this.capture('app_installed')
  }
  private enabled(): boolean {
    return !this.closed && this.deps.settings().usageData
  }
  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }
  capture(event: AnalyticsEvent, properties: EventProperties = {}): void {
    if (!this.enabled() || !this.identity) return
    const { context } = this.deps
    this.deps.sink.capture({
      distinctId: this.identity.distinctId,
      event,
      timestamp: this.now(),
      properties: {
        ...properties,
        $app_version: context.appVersion,
        $os: context.os,
        $os_version: context.osVersion,
        arch: context.arch,
        release_channel: context.appVersion.includes('-beta.') ? 'beta' : 'stable',
        language: this.deps.settings().language
      }
    })
  }
  /** Counts a successful IPC call when its channel is one Owlto tracks. */
  ipcSucceeded(channel: string, value: unknown): void {
    const agent = CONNECT_CHANNELS[channel]
    if (agent) {
      if (isRecord(value) && value.status === 'ready') this.capture('agent_connected', { agent })
      return
    }
    const tracked = IPC_EVENTS[channel]
    if (!tracked || (tracked.needsValue && value == null)) return
    this.capture(tracked.event, tracked.properties)
  }
  /** Counts workers dispatched after launch, by agent. */
  observe(event: AppEvent): void {
    if (event.type !== 'worker') return
    const { worker } = event
    if (this.workers.has(worker.id)) return
    this.workers.add(worker.id)
    if (new Date(worker.createdAt) < this.startedAt) return
    this.capture('worker_started', {
      agent: worker.provider,
      in_project: worker.projectId !== null
    })
  }
  settingsChanged(saved: AppSettings, previous: AppSettings): void {
    if (saved.usageData !== previous.usageData) {
      if (saved.usageData) {
        void this.deps.sink.resume()
        this.begin()
      } else {
        void this.deps.sink.pause()
        this.flagSnapshot = null
      }
    }
    if (previous.onboarding === 'pending' && saved.onboarding !== 'pending')
      this.capture('onboarding_finished', { result: saved.onboarding })
  }
  /**
   * A feature flag's value for this install, for A/B tests. The SDK reports the first read of
   * each flag as the exposure PostHog experiments count. Null while usage data is off.
   */
  async flag(key: FeatureFlagKey): Promise<FeatureFlagValue> {
    if (!this.enabled()) return null
    this.begin()
    const flags = await this.readFlags()
    return flags?.get(key) ?? null
  }
  private readFlags(): Promise<FlagSnapshot | null> {
    const cached = this.flagSnapshot
    if (cached && this.now().getTime() - cached.at < FLAGS_TTL_MS)
      return Promise.resolve(cached.flags)
    const identity = this.identity
    if (!identity) return Promise.resolve(null)
    this.flagRead ??= this.deps.sink
      .flags(identity.distinctId, {
        $app_version: this.deps.context.appVersion,
        language: this.deps.settings().language
      })
      .then((flags) => {
        // An unreachable PostHog keeps the last values, or none, until the next read.
        if (flags) this.flagSnapshot = { flags, at: this.now().getTime() }
        return flags ?? cached?.flags ?? null
      })
      .finally(() => {
        this.flagRead = null
      })
    return this.flagRead
  }
  /** Sends what is queued, waiting at most `timeoutMs`; nothing is sent after. */
  async close(timeoutMs: number): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.deps.sink.shutdown(timeoutMs).catch(() => undefined)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
