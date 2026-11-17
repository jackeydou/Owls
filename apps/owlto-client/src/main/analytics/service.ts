import { randomUUID } from 'node:crypto'
import type { FeatureFlagKey, FeatureFlagValue } from '../../shared/analytics.js'
import type { AppEvent, AppSettings } from '../../shared/app.js'
import type { EventProperties, PostHogClient } from './posthog.js'

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
  | '$feature_flag_called'

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
/** Queued events go out on this beat, and at once when the queue reaches `FLUSH_AT`. */
const FLUSH_INTERVAL_MS = 30_000
const FLUSH_AT = 20
/** Flags are read once per launch and again after this long. */
const FLAGS_TTL_MS = 60 * 60_000

/** The anonymous install id, kept in the data root; it is not tied to any account. */
export type AnalyticsIdentity = { distinctId: string; firstSeenAt: string }
export type AnalyticsDeps = {
  client: PostHogClient
  settings: () => Pick<AppSettings, 'usageData' | 'language' | 'connectedAgents'>
  /** Reads the saved identity; null when there is none yet or it is unreadable. */
  loadIdentity: () => AnalyticsIdentity | null
  saveIdentity: (identity: AnalyticsIdentity) => void
  /** Sent with every event: app version, OS, and architecture. */
  context: { appVersion: string; os: string; osVersion: string; arch: string }
  now?: () => Date
  /** Starts the periodic flush; returns its stop function. Tests pass a fake. */
  every?: (run: () => void, ms: number) => () => void
}

const every = (run: () => void, ms: number): (() => void) => {
  const timer = setInterval(run, ms)
  timer.unref()
  return () => clearInterval(timer)
}

/**
 * Anonymous install and usage analytics with PostHog feature flags for A/B tests. It exists
 * only in builds that carry a PostHog key, and sends nothing while the user has usage data off.
 */
export class Analytics {
  private identity: AnalyticsIdentity | null = null
  private stopTimer: (() => void) | null = null
  private readonly startedAt: Date
  /** Workers already seen, so a worker counts as started once. */
  private readonly workers = new Set<string>()
  private flagValues: { values: Record<string, FeatureFlagValue>; at: number } | null = null
  private flagRead: Promise<Record<string, FeatureFlagValue>> | null = null
  /** Flags whose exposure was already reported this launch. */
  private readonly exposed = new Set<string>()
  constructor(private readonly deps: AnalyticsDeps) {
    this.startedAt = this.now()
  }
  /** Records the launch, and the install on the first launch. */
  start(): void {
    if (!this.enabled()) return
    this.begin()
    this.capture('app_opened', {
      connected_agents: [...this.deps.settings().connectedAgents].sort().join(',')
    })
  }
  private begin(): void {
    if (!this.identity) {
      const saved = this.deps.loadIdentity()
      if (saved) this.identity = saved
      else {
        this.identity = { distinctId: randomUUID(), firstSeenAt: this.now().toISOString() }
        this.deps.saveIdentity(this.identity)
        this.capture('app_installed')
      }
    }
    this.stopTimer ??= (this.deps.every ?? every)(() => void this.flush(), FLUSH_INTERVAL_MS)
  }
  private stop(): void {
    this.stopTimer?.()
    this.stopTimer = null
    this.deps.client.clear()
    this.flagValues = null
  }
  private enabled(): boolean {
    return this.deps.settings().usageData
  }
  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }
  capture(event: AnalyticsEvent, properties: EventProperties = {}): void {
    if (!this.enabled() || !this.identity) return
    const { context } = this.deps
    this.deps.client.enqueue({
      event,
      timestamp: this.now().toISOString(),
      properties: {
        ...properties,
        $lib: 'owlto-desktop',
        $app_version: context.appVersion,
        $os: context.os,
        $os_version: context.osVersion,
        arch: context.arch,
        release_channel: context.appVersion.includes('-beta.') ? 'beta' : 'stable',
        language: this.deps.settings().language
      }
    })
    if (this.deps.client.pending >= FLUSH_AT) void this.flush()
  }
  flush(timeoutMs?: number): Promise<void> {
    if (!this.identity || !this.enabled()) return Promise.resolve()
    return this.deps.client.flush(this.identity.distinctId, timeoutMs)
  }
  /** Whether events are still waiting to go out, so quitting can send them first. */
  pending(): boolean {
    return this.enabled() && this.deps.client.pending > 0
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
      if (saved.usageData) this.begin()
      else this.stop()
    }
    if (previous.onboarding === 'pending' && saved.onboarding !== 'pending')
      this.capture('onboarding_finished', { result: saved.onboarding })
  }
  /**
   * A feature flag's value for this install, for A/B tests. The first read of each flag per
   * launch reports the exposure PostHog experiments count. Null while usage data is off.
   */
  async flag(key: FeatureFlagKey): Promise<FeatureFlagValue> {
    if (!this.enabled()) return null
    this.begin()
    const values = await this.readFlags()
    const value = values[key] ?? null
    if (!this.exposed.has(key)) {
      this.exposed.add(key)
      this.capture('$feature_flag_called', {
        $feature_flag: key,
        $feature_flag_response: value
      })
    }
    return value
  }
  private readFlags(): Promise<Record<string, FeatureFlagValue>> {
    const cached = this.flagValues
    if (cached && this.now().getTime() - cached.at < FLAGS_TTL_MS)
      return Promise.resolve(cached.values)
    if (!this.flagRead) {
      const identity = this.identity
      if (!identity) return Promise.resolve({})
      this.flagRead = this.deps.client
        .flags(identity.distinctId, {
          $app_version: this.deps.context.appVersion,
          language: this.deps.settings().language
        })
        .then((values) => {
          // An unreachable PostHog keeps the last values, or none, until the next read.
          if (values) this.flagValues = { values, at: this.now().getTime() }
          return values ?? cached?.values ?? {}
        })
        .finally(() => {
          this.flagRead = null
        })
    }
    return this.flagRead
  }
  /** Sends what is queued, waiting at most `timeoutMs`, and stops the flush timer. */
  async close(timeoutMs: number): Promise<void> {
    this.stopTimer?.()
    this.stopTimer = null
    let timeout: NodeJS.Timeout | undefined
    await Promise.race([
      this.flush(timeoutMs),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs)
      })
    ])
    clearTimeout(timeout)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
