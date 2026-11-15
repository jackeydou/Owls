import {
  AUTOMATION_LIMIT,
  type Automation,
  type AutomationSave,
  type AutomationSchedule,
  type AutomationTarget,
  nextAutomationRun
} from '../../shared/automations.js'
import { OwltoError } from '../app/errors.js'

/** Most automations one thread's agents may create, so a looping agent stays contained. */
export const THREAD_AUTOMATION_LIMIT = 20
/** The longest the scheduler sleeps, so a clock change or sleep/wake is noticed within a minute. */
const MAX_SLEEP_MS = 60_000

export type AutomationRecords = {
  list(): Automation[]
  put(automation: Automation): Automation
  remove(id: string): void
}

/** Where a run went: the thread that got it, and whether a missing worker sent it to the Router. */
export type AutomationDelivery = { threadId: string; fellBack: boolean }

export type AutomationDeps = {
  records: AutomationRecords
  /** Delivers one run to its Router or worker. Throws when it cannot. */
  deliver(automation: Automation): Promise<AutomationDelivery>
  /** The list changed; the renderer reads it again. */
  changed(): void
  now?: () => Date
}

/** An automation an agent creates from a thread. */
export type AgentAutomation = {
  name: string
  instructions: string
  schedule: AutomationSchedule
  target: AutomationTarget
  projectId: string | null
  createdBy: 'router' | 'worker'
}

/**
 * Scheduled automations on this device: their records and the timer that runs
 * them. A run that came due while the app was closed runs once at the next start,
 * then the schedule continues from that moment.
 */
/** What an agent may change on an automation. */
export type AutomationChange = {
  name?: string
  instructions?: string
  schedule?: AutomationSchedule
  enabled?: boolean
}

export class AutomationService {
  private readonly automations = new Map<string, Automation>()
  private readonly running = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private ticking = false
  private closed = false

  constructor(private readonly deps: AutomationDeps) {
    for (const automation of deps.records.list()) this.automations.set(automation.id, automation)
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /** Starts the timer; call once the Router can take runs. */
  start(): void {
    if (this.closed) return
    this.started = true
    this.arm()
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Every automation, oldest first. */
  list(): Automation[] {
    return [...this.automations.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    )
  }

  get(id: string): Automation | undefined {
    return this.automations.get(id)
  }

  /** Automations whose runs go to one thread. */
  forThread(threadId: string): Automation[] {
    return this.list().filter((a) => a.target.threadId === threadId)
  }

  /** Creates or edits an automation from the Automation page. */
  save(input: AutomationSave): Automation {
    const now = this.now()
    const existing = input.id ? this.automations.get(input.id) : undefined
    if (input.id && !existing)
      throw new OwltoError('request_unavailable', 'This automation no longer exists.')
    if (!existing) this.checkLimit()
    const automation: Automation = existing
      ? {
          ...existing,
          name: input.name,
          instructions: input.instructions,
          schedule: input.schedule,
          // Only an automation that opens its own thread can move to another project.
          projectId: existing.target.threadId === null ? input.projectId : existing.projectId,
          enabled: input.enabled,
          nextRunAt: input.enabled ? nextAutomationRun(input.schedule, now).toISOString() : null,
          updatedAt: now.toISOString()
        }
      : {
          id: newId(),
          name: input.name,
          instructions: input.instructions,
          schedule: input.schedule,
          target: { kind: 'router', threadId: null },
          projectId: input.projectId,
          enabled: input.enabled,
          createdBy: 'user',
          nextRunAt: input.enabled ? nextAutomationRun(input.schedule, now).toISOString() : null,
          lastRun: null,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        }
    return this.write(automation)
  }

  /** Creates an automation for a Router or worker tool call. */
  create(input: AgentAutomation): Automation {
    this.checkLimit()
    if (this.forThread(input.target.threadId ?? '').length >= THREAD_AUTOMATION_LIMIT)
      throw new OwltoError(
        'invalid_request',
        `A thread can have at most ${THREAD_AUTOMATION_LIMIT} automations.`
      )
    const now = this.now()
    return this.write({
      id: newId(),
      name: input.name,
      instructions: input.instructions,
      schedule: input.schedule,
      target: input.target,
      projectId: input.projectId,
      enabled: true,
      createdBy: input.createdBy,
      nextRunAt: nextAutomationRun(input.schedule, now).toISOString(),
      lastRun: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
  }

  /**
   * Changes an automation for a Router or worker tool call. Fields left out keep
   * their value; who a run wakes never changes. A new schedule or a resume picks
   * the next run from now.
   */
  update(id: string, change: AutomationChange): Automation {
    const automation = this.require(id)
    const now = this.now()
    const schedule = change.schedule ?? automation.schedule
    const enabled = change.enabled ?? automation.enabled
    const replan = change.schedule !== undefined || enabled !== automation.enabled
    return this.write({
      ...automation,
      name: change.name ?? automation.name,
      instructions: change.instructions ?? automation.instructions,
      schedule,
      enabled,
      nextRunAt: !enabled
        ? null
        : replan
          ? nextAutomationRun(schedule, now).toISOString()
          : automation.nextRunAt,
      updatedAt: now.toISOString()
    })
  }

  setEnabled(id: string, enabled: boolean): Automation {
    const automation = this.require(id)
    if (automation.enabled === enabled) return automation
    const now = this.now()
    return this.write({
      ...automation,
      enabled,
      nextRunAt: enabled ? nextAutomationRun(automation.schedule, now).toISOString() : null,
      updatedAt: now.toISOString()
    })
  }

  remove(id: string): void {
    if (!this.automations.delete(id)) return
    this.deps.records.remove(id)
    this.deps.changed()
    this.arm()
  }

  /** Runs an automation now, off its schedule; its next scheduled run stays as it was. */
  async runNow(id: string): Promise<Automation> {
    const automation = this.require(id)
    await this.fire(automation, false)
    return this.require(id)
  }

  /** The thread an automation's runs went to is gone; its automations go with it. */
  threadRemoved(threadId: string): void {
    for (const automation of this.forThread(threadId)) {
      // An automation the user made only lent its thread; the next run opens a new one.
      if (automation.createdBy === 'user')
        this.write({
          ...automation,
          target: { kind: 'router', threadId: null },
          updatedAt: this.now().toISOString()
        })
      else this.remove(automation.id)
    }
  }

  private checkLimit(): void {
    if (this.automations.size >= AUTOMATION_LIMIT)
      throw new OwltoError(
        'invalid_request',
        `Owlto keeps at most ${AUTOMATION_LIMIT} automations. Delete one first.`
      )
  }

  private require(id: string): Automation {
    const automation = this.automations.get(id)
    if (!automation)
      throw new OwltoError('request_unavailable', 'This automation no longer exists.')
    return automation
  }

  private write(automation: Automation): Automation {
    const saved = this.deps.records.put(automation)
    this.automations.set(saved.id, saved)
    this.deps.changed()
    this.arm()
    return saved
  }

  /**
   * Delivers one run. A scheduled run moves `nextRunAt` first, so a slow or
   * failing delivery never runs twice for the same slot.
   */
  private async fire(automation: Automation, scheduled: boolean): Promise<void> {
    if (this.running.has(automation.id) || this.closed) return
    const at = this.now()
    let current = this.automations.get(automation.id)
    if (!current) return
    if (scheduled) {
      // Another tick may have run it since the caller looked.
      if (!current.enabled || !current.nextRunAt || Date.parse(current.nextRunAt) > at.getTime())
        return
      current = this.write({
        ...current,
        nextRunAt: nextAutomationRun(current.schedule, at).toISOString()
      })
    }
    this.running.add(automation.id)
    try {
      const delivery = await this.deps.deliver(current)
      const latest = this.automations.get(automation.id)
      if (!latest || this.closed) return
      this.write({
        ...latest,
        // A thread opened on the first run, or the Router that took over from a missing
        // worker, keeps the later runs.
        target:
          latest.target.threadId === null || delivery.fellBack
            ? { kind: 'router', threadId: delivery.threadId }
            : latest.target,
        lastRun: {
          at: at.toISOString(),
          status: 'started',
          threadId: delivery.threadId,
          ...(delivery.fellBack ? { fellBack: true } : {}),
          error: null
        }
      })
    } catch (error) {
      const latest = this.automations.get(automation.id)
      if (!latest || this.closed) return
      this.write({
        ...latest,
        lastRun: {
          at: at.toISOString(),
          status: 'failed',
          threadId: latest.target.threadId,
          error: error instanceof Error ? error.message.slice(0, 300) : 'The run failed.'
        }
      })
    } finally {
      this.running.delete(automation.id)
    }
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.started || this.closed || this.ticking) return
    const now = this.now().getTime()
    let soonest = Number.POSITIVE_INFINITY
    for (const automation of this.automations.values()) {
      if (automation.enabled && automation.nextRunAt)
        soonest = Math.min(soonest, Date.parse(automation.nextRunAt))
    }
    if (!Number.isFinite(soonest)) return
    const delay = Math.min(Math.max(soonest - now, 0), MAX_SLEEP_MS)
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  /** Runs every automation that is due, oldest first, then sleeps until the next one. */
  async tick(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.ticking) return
    this.ticking = true
    try {
      const now = this.now().getTime()
      const due = this.list().filter(
        (a) => a.enabled && a.nextRunAt && Date.parse(a.nextRunAt) <= now
      )
      for (const automation of due) await this.fire(automation, true)
    } finally {
      this.ticking = false
    }
    this.arm()
  }
}

function newId(): string {
  return `au_${crypto.randomUUID().slice(0, 8)}`
}
