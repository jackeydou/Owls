import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentProvider, Permission } from '../../shared/agents.js'
import type {
  SimulatorAction,
  SimulatorAsk,
  SimulatorAvailability,
  SimulatorButton,
  SimulatorDevice,
  SimulatorLease,
  SimulatorSettings,
  SimulatorSnapshot
} from '../../shared/simulator.js'
import {
  HID_COMMAND,
  HID_RETURN,
  HID_SHIFT,
  HID_V,
  keystrokesFor
} from '../../shared/simulator-keys.js'
import { type AxScreen, describeScreen } from './ax.js'
import type { InstalledApp } from './simctl.js'

/** Xcode's simulator tools, behind an interface so tests can stand in for them. */
export type Simctl = {
  list(): Promise<SimulatorDevice[] | null>
  boot(udid: string): Promise<void>
  shutdown(udid: string): Promise<void>
  install(udid: string, appPath: string): Promise<InstalledApp>
  launch(
    udid: string,
    bundleId: string,
    args: string[],
    terminateFirst: boolean
  ): Promise<number | null>
  openUrl(udid: string, url: string): Promise<void>
  copy(udid: string, text: string): Promise<void>
  logs(udid: string, seconds: number, process: string | null): Promise<string[]>
  inputShadowed(udid: string): Promise<boolean>
  repairInput(udid: string): Promise<void>
}

/** The host utility process; `call` takes the requests in protocol.ts without their id. */
export type SimulatorHostCalls = {
  attach(udid: string): Promise<void>
  detach(udid: string): Promise<void>
  touch(udid: string, phase: 'begin' | 'move' | 'end', x: number, y: number): Promise<void>
  key(udid: string, phase: 'down' | 'up', usage: number): Promise<void>
  button(udid: string, name: SimulatorButton): Promise<void>
  snapshot(udid: string, path: string): Promise<string>
  ax(udid: string): Promise<string>
}

export type SimulatorWorker = { provider: AgentProvider; title: string; permission: Permission }

/** What a device waits on the user for, for the dock badge and notifications. */
export type SimulatorNeed = { kind: SimulatorAsk['kind']; text: string }

export type SimulatorServiceDeps = {
  platform: NodeJS.Platform
  simctl: Simctl
  host: SimulatorHostCalls
  /** The user's saved consent; IPC saves a new one before it answers the ask. */
  settings(): SimulatorSettings
  /** The worker behind a tool key, or null once it is gone. */
  worker(key: string): SimulatorWorker | null
  changed(snapshot: SimulatorSnapshot): void
  needs(key: string, need: SimulatorNeed | null): void
  shotsDir(): string
  /** Injectable for tests. */
  now?: () => number
  wait?: (ms: number) => Promise<void>
}

/** A device Owlto booted shuts down this long after nothing streams or drives it. */
const IDLE_SHUTDOWN_MS = 10 * 60_000
/** A worker that has not touched its device for this long lets go of it. */
const LEASE_IDLE_MS = 10 * 60_000
/** How long a worker waits for the user to answer an ask. */
const ASK_TIMEOUT_MS = 10 * 60_000
/** Time for the app to react after an input, before the worker looks again. */
const SETTLE_MS = 400

type Lease = SimulatorLease & { key: string; used: number }
type PendingAsk = { ask: SimulatorAsk; key: string; resolve: (allowed: boolean) => void }

export type TapTarget = { ref: string } | { x: number; y: number }

/**
 * Owns the simulated devices Owlto shows and drives: which are attached (captured by the
 * host), which one the panel shows, which worker holds each device, and the asks that wait
 * on the user. Workers reach it through the `simulator_*` tools; the panel through IPC.
 */
export class SimulatorService {
  private devices: SimulatorDevice[] = []
  private availability: SimulatorAvailability = 'ready'
  private activeUdid: string | null = null
  private readonly attached = new Set<string>()
  private readonly leases = new Map<string, Lease>()
  private readonly asks: PendingAsk[] = []
  private readonly bootedByUs = new Set<string>()
  /** Attached devices whose input Device Hub took over; see `repairInput`. */
  private readonly inputBlocked = new Set<string>()
  private readonly idleTimers = new Map<string, NodeJS.Timeout>()
  /** Each worker's last look at its screen, for refs and the point size. */
  private readonly screens = new Map<string, AxScreen>()
  /** Executable names of apps workers installed, for their logs. */
  private readonly executables = new Map<string, string>()
  /** What the user already allowed each worker, as `kind:detail`. */
  private readonly allowed = new Map<string, Set<string>>()
  /** Workers whose ask the dock badge and notifications show. */
  private readonly notified = new Set<string>()
  private askSeq = 0
  private closed = false
  private readonly now: () => number
  private readonly wait: (ms: number) => Promise<void>

  constructor(private readonly deps: SimulatorServiceDeps) {
    this.now = deps.now ?? Date.now
    this.wait = deps.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    if (deps.platform !== 'darwin') this.availability = 'unsupported'
  }

  snapshot(): SimulatorSnapshot {
    this.expireLeases()
    const leases: Record<string, SimulatorLease> = {}
    for (const [udid, { key: _key, used: _used, ...lease }] of [...this.leases].sort(([a], [b]) =>
      a.localeCompare(b)
    ))
      leases[udid] = lease
    return {
      availability: this.availability,
      devices: this.devices,
      activeUdid: this.activeUdid,
      attached: [...this.attached].sort(),
      leases,
      ask: this.asks[0]?.ask ?? null,
      inputBlocked: [...this.inputBlocked].sort()
    }
  }

  async refresh(): Promise<SimulatorSnapshot> {
    if (this.deps.platform === 'darwin') {
      const devices = await this.deps.simctl.list()
      this.devices = devices ?? []
      this.availability = devices === null ? 'no-xcode' : devices.length ? 'ready' : 'no-devices'
    }
    this.emit()
    return this.snapshot()
  }

  /** The user picked a device in the panel. */
  async attach(udid: string): Promise<void> {
    await this.ensureAttached(udid)
    this.activeUdid = udid
    this.emit()
  }

  async detach(udid: string): Promise<void> {
    this.inputBlocked.delete(udid)
    if (this.attached.delete(udid)) await this.deps.host.detach(udid).catch(() => {})
    const lease = this.leases.get(udid)
    if (lease) this.screens.delete(lease.key)
    if (this.activeUdid === udid) this.activeUdid = [...this.attached][0] ?? null
    this.scheduleIdle(udid)
    this.emit()
  }

  async shutdown(udid: string): Promise<void> {
    await this.detach(udid)
    this.leases.delete(udid)
    this.bootedByUs.delete(udid)
    this.clearIdle(udid)
    await this.deps.simctl.shutdown(udid)
    await this.refresh()
  }

  answer(askId: string, allow: boolean): void {
    const index = this.asks.findIndex((x) => x.ask.id === askId)
    if (index < 0) return
    const [pending] = this.asks.splice(index, 1)
    if (!pending) return
    if (allow) this.allowedFor(pending.key).add(`${pending.ask.kind}:${pending.ask.detail}`)
    pending.resolve(allow)
    this.announceNeed()
    this.emit()
  }

  /** The ask waiting under this id, if it still waits. */
  pendingAsk(askId: string): SimulatorAsk | null {
    return this.asks.find((x) => x.ask.id === askId)?.ask ?? null
  }

  /** Whether the host has a capture for the device, so the panel may open its stream. */
  isAttached(udid: string): boolean {
    return this.attached.has(udid)
  }

  /** The host exited: its captures are gone, and the panel shows the devices as detached. */
  hostExited(): void {
    this.attached.clear()
    this.inputBlocked.clear()
    this.activeUdid = null
    this.screens.clear()
    this.emit()
  }

  close(): void {
    this.closed = true
    for (const timer of this.idleTimers.values()) clearTimeout(timer)
    this.idleTimers.clear()
    for (const pending of this.asks.splice(0)) pending.resolve(false)
    // Devices Owlto booted go down with it, as Xcode's own tools do for theirs.
    for (const udid of this.bootedByUs) void this.deps.simctl.shutdown(udid).catch(() => {})
  }

  // ---- Worker tools ----

  /** The devices a worker can pick from, one line each. */
  async listForWorker(key: string): Promise<string> {
    await this.refresh()
    if (this.availability !== 'ready') return availabilityText(this.availability)
    const lines = this.devices.map((device) => {
      const lease = this.leases.get(device.udid)
      const holder = lease ? (lease.key === key ? ', yours' : `, in use by ${lease.title}`) : ''
      return `- ${device.name} (${device.runtime}) ${device.udid}: ${device.state}${holder}`
    })
    return lines.join('\n')
  }

  /** Takes a device for the worker: asks the user the first time, boots it, and shows it. */
  async attachForWorker(key: string, wanted: string | undefined): Promise<string> {
    if (this.availability === 'unsupported') return availabilityText(this.availability)
    await this.refresh()
    if (this.availability !== 'ready') throw new Error(availabilityText(this.availability))
    const device = this.pick(key, wanted)
    const holder = this.leases.get(device.udid)
    if (holder && holder.key !== key)
      throw new Error(
        `${device.name} is in use by another worker (${holder.title}). Pick another device from simulator_devices.`
      )
    const worker = this.deps.worker(key)
    if (!worker) throw new Error('This worker is no longer running.')
    if (!this.deps.settings().allowedDevices.includes(device.udid)) {
      const allowed = await this.ask(key, worker, 'device', device.udid, '')
      if (!allowed) throw new Error(`The user did not let you use ${device.name}.`)
    }
    // A worker holds one device at a time.
    for (const [udid, lease] of this.leases)
      if (lease.key === key && udid !== device.udid) this.leases.delete(udid)
    this.leases.set(device.udid, {
      key,
      workerId: key,
      provider: worker.provider,
      title: worker.title,
      busy: true,
      action: null,
      used: this.now()
    })
    this.emit()
    try {
      await this.ensureAttached(device.udid)
    } finally {
      this.settle(device.udid)
    }
    this.activeUdid = device.udid
    this.emit()
    const blocked = this.inputBlocked.has(device.udid)
      ? ' Xcode Device Hub has disconnected its touch and keyboard input, so taps, swipes, and typing will not reach it; the user can repair it from the Simulator panel.'
      : ''
    return `Attached ${device.name} (${device.runtime}). It is yours until you stop using it for 10 minutes. Build for a simulator destination, then call simulator_install.${blocked}`
  }

  async install(key: string, appPath: string, launch: boolean, args: string[]): Promise<string> {
    return this.drive(key, { kind: 'install' }, async (udid, worker) => {
      await this.approve(key, worker, 'install', udid, appPath)
      const app = await this.deps.simctl.install(udid, appPath)
      if (app.executable) this.executables.set(app.bundleId, app.executable)
      this.allowedFor(key).add(`launch:${app.bundleId}`)
      if (!launch) return `Installed ${app.bundleId}.`
      const pid = await this.deps.simctl.launch(udid, app.bundleId, args, true)
      return `Installed and launched ${app.bundleId}${pid ? ` (pid ${pid})` : ''}.`
    })
  }

  async launch(
    key: string,
    bundleId: string,
    args: string[],
    terminateFirst: boolean
  ): Promise<string> {
    return this.drive(key, { kind: 'launch', bundleId }, async (udid, worker) => {
      await this.approve(key, worker, 'launch', udid, bundleId)
      const pid = await this.deps.simctl.launch(udid, bundleId, args, terminateFirst)
      return `Launched ${bundleId}${pid ? ` (pid ${pid})` : ''}.`
    })
  }

  async openUrl(key: string, url: string): Promise<string> {
    return this.drive(key, { kind: 'open-url' }, async (udid, worker) => {
      await this.approve(key, worker, 'open-url', udid, url)
      await this.deps.simctl.openUrl(udid, url)
      return `Opened ${url}.`
    })
  }

  async screen(key: string, tree: boolean, image: boolean): Promise<string> {
    return this.drive(key, { kind: 'look' }, async (udid) => {
      const device = this.devices.find((x) => x.udid === udid)
      const screen = await this.readScreen(key, udid)
      const lines = [
        `${device?.name ?? 'Simulator'} (${device?.runtime ?? 'iOS'}), screen ${Math.round(screen.width)}×${Math.round(screen.height)} points. Coordinates below are element centers in points; tap an element by its ref.`
      ]
      if (tree) {
        lines.push(...(screen.lines.length ? screen.lines : ['(No elements with text or input.)']))
        if (screen.truncated) lines.push('(More elements were left out.)')
      }
      if (image) {
        const dir = this.deps.shotsDir()
        await mkdir(dir, { recursive: true })
        const path = await this.deps.host.snapshot(
          udid,
          join(dir, `${this.now()}-${this.askSeq++}.jpg`)
        )
        lines.push(`Screenshot: ${path} (open it with your image viewer to see the screen).`)
      }
      return lines.join('\n')
    })
  }

  async tap(key: string, target: TapTarget, durationMs: number): Promise<string> {
    return this.drive(key, { kind: 'tap' }, async (udid) => {
      const point = await this.normalize(key, udid, target)
      await this.deps.host.touch(udid, 'begin', point.x, point.y)
      await this.wait(Math.max(40, durationMs))
      await this.deps.host.touch(udid, 'end', point.x, point.y)
      await this.wait(SETTLE_MS)
      this.screens.delete(key)
      return `Tapped ${'ref' in target ? target.ref : `(${target.x}, ${target.y})`}. Call simulator_screen to see the result.`
    })
  }

  async swipe(
    key: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs: number
  ): Promise<string> {
    return this.drive(key, { kind: 'swipe' }, async (udid) => {
      const a = await this.normalize(key, udid, from)
      const b = await this.normalize(key, udid, to)
      const steps = Math.max(2, Math.round(durationMs / 16))
      await this.deps.host.touch(udid, 'begin', a.x, a.y)
      for (let i = 1; i <= steps; i++) {
        await this.wait(durationMs / steps)
        const t = i / steps
        await this.deps.host.touch(udid, 'move', a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
      }
      await this.deps.host.touch(udid, 'end', b.x, b.y)
      await this.wait(SETTLE_MS)
      this.screens.delete(key)
      return 'Swiped. Call simulator_screen to see the result.'
    })
  }

  async type(key: string, text: string, submit: boolean): Promise<string> {
    return this.drive(key, { kind: 'type' }, async (udid) => {
      const strokes = keystrokesFor(text)
      if (strokes) {
        for (const stroke of strokes) {
          if (stroke.shift) await this.deps.host.key(udid, 'down', HID_SHIFT)
          await this.deps.host.key(udid, 'down', stroke.usage)
          await this.deps.host.key(udid, 'up', stroke.usage)
          if (stroke.shift) await this.deps.host.key(udid, 'up', HID_SHIFT)
        }
      } else {
        // A US keyboard cannot type it (Chinese, emoji, accents): paste it instead.
        await this.deps.simctl.copy(udid, text)
        await this.deps.host.key(udid, 'down', HID_COMMAND)
        await this.deps.host.key(udid, 'down', HID_V)
        await this.deps.host.key(udid, 'up', HID_V)
        await this.deps.host.key(udid, 'up', HID_COMMAND)
      }
      if (submit) {
        await this.deps.host.key(udid, 'down', HID_RETURN)
        await this.deps.host.key(udid, 'up', HID_RETURN)
      }
      await this.wait(SETTLE_MS)
      this.screens.delete(key)
      const how = strokes ? 'Typed' : 'Pasted'
      return `${how} ${text.length} characters${submit ? ' and pressed Return' : ''}. If nothing appeared, tap the text field first.`
    })
  }

  async button(key: string, name: SimulatorButton): Promise<string> {
    return this.drive(key, { kind: 'button' }, async (udid) => {
      await this.deps.host.button(udid, name)
      await this.wait(SETTLE_MS)
      this.screens.delete(key)
      return `Pressed ${name}.`
    })
  }

  async logs(
    key: string,
    bundleId: string | undefined,
    seconds: number,
    limit: number
  ): Promise<string> {
    return this.drive(key, null, async (udid) => {
      const process = bundleId ? (this.executables.get(bundleId) ?? null) : null
      if (bundleId && !process)
        throw new Error(
          `Owlto does not know ${bundleId}'s executable. Install it with simulator_install first, or leave bundleId out.`
        )
      const lines = await this.deps.simctl.logs(udid, seconds, process)
      if (!lines.length) return 'No log lines in that time.'
      const kept = lines.slice(-limit)
      const cut = lines.length - kept.length
      return `${cut ? `(${cut} earlier ${cut === 1 ? 'line' : 'lines'} left out)\n` : ''}${kept.join('\n')}`
    })
  }

  // ---- Internals ----

  private emit(): void {
    if (!this.closed) this.deps.changed(this.snapshot())
  }

  private pick(key: string, wanted: string | undefined): SimulatorDevice {
    if (wanted) {
      const needle = wanted.trim().toLowerCase()
      const found =
        this.devices.find((x) => x.udid.toLowerCase() === needle) ??
        this.devices.find((x) => x.name.toLowerCase() === needle)
      if (!found)
        throw new Error(
          `No simulator named ${JSON.stringify(wanted)}. Call simulator_devices for the list.`
        )
      return found
    }
    const free = (device: SimulatorDevice) => {
      const lease = this.leases.get(device.udid)
      return !lease || lease.key === key
    }
    const active = this.devices.find((x) => x.udid === this.activeUdid)
    return (
      (active && free(active) ? active : undefined) ??
      this.devices.find((x) => x.state === 'booted' && free(x)) ??
      this.devices.find(free) ??
      (() => {
        throw new Error('Every simulator is in use by another worker.')
      })()
    )
  }

  private async ensureAttached(udid: string): Promise<void> {
    this.clearIdle(udid)
    if (this.attached.has(udid)) return
    const device = this.devices.find((x) => x.udid === udid)
    if (device?.state !== 'booted') {
      await this.deps.simctl.boot(udid)
      this.bootedByUs.add(udid)
      if (device) device.state = 'booted'
    }
    await this.deps.host.attach(udid)
    this.attached.add(udid)
    if (await this.deps.simctl.inputShadowed(udid)) this.inputBlocked.add(udid)
  }

  /**
   * Gives input back from Device Hub, as the user asked in the panel. The guest restarts its
   * input services, so the host reconnects to them afterward.
   */
  async repairInput(udid: string): Promise<void> {
    await this.deps.simctl.repairInput(udid)
    if (this.attached.has(udid)) {
      await this.deps.host.detach(udid).catch(() => {})
      await this.deps.host.attach(udid)
    }
    if (await this.deps.simctl.inputShadowed(udid)) this.inputBlocked.add(udid)
    else this.inputBlocked.delete(udid)
    this.emit()
  }

  /** Runs a worker's call on the device it holds, showing what it does in the panel. */
  private async drive(
    key: string,
    action: SimulatorAction | null,
    run: (udid: string, worker: SimulatorWorker) => Promise<string>
  ): Promise<string> {
    this.expireLeases()
    const entry = [...this.leases].find(([, lease]) => lease.key === key)
    if (!entry) throw new Error('You have no simulator. Call simulator_attach first.')
    const [udid, lease] = entry
    const worker = this.deps.worker(key)
    if (!worker) throw new Error('This worker is no longer running.')
    lease.busy = true
    if (action) lease.action = action
    lease.used = this.now()
    this.emit()
    try {
      if (!this.attached.has(udid)) await this.ensureAttached(udid)
      return await run(udid, worker)
    } finally {
      this.settle(udid)
    }
  }

  private settle(udid: string): void {
    const lease = this.leases.get(udid)
    if (!lease) return
    lease.busy = false
    lease.used = this.now()
    this.emit()
  }

  private expireLeases(): void {
    const now = this.now()
    for (const [udid, lease] of this.leases)
      if (!lease.busy && now - lease.used > LEASE_IDLE_MS) this.leases.delete(udid)
  }

  /** Install, launch, and open URL follow the worker's permission mode, like its own commands. */
  private async approve(
    key: string,
    worker: SimulatorWorker,
    kind: 'install' | 'launch' | 'open-url',
    udid: string,
    detail: string
  ): Promise<void> {
    if (worker.permission === 'full-access') return
    if (this.allowedFor(key).has(`${kind}:${detail}`)) return
    if (!(await this.ask(key, worker, kind, udid, detail)))
      throw new Error('The user declined. Ask them in your reply if you need it.')
  }

  private ask(
    key: string,
    worker: SimulatorWorker,
    kind: SimulatorAsk['kind'],
    udid: string,
    detail: string
  ): Promise<boolean> {
    this.askSeq += 1
    const ask: SimulatorAsk = {
      id: `ask-${this.askSeq}`,
      kind,
      udid,
      workerId: key,
      provider: worker.provider,
      title: worker.title,
      detail
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.answer(ask.id, false), ASK_TIMEOUT_MS)
      this.asks.push({
        ask,
        key,
        resolve: (allowed) => {
          clearTimeout(timer)
          resolve(allowed)
        }
      })
      this.announceNeed()
      this.emit()
    })
  }

  /** Only the first ask shows; the workers behind the others wait their turn quietly. */
  private announceNeed(): void {
    const first = this.asks[0]
    for (const key of this.notified) if (key !== first?.key) this.deps.needs(key, null)
    this.notified.clear()
    if (!first) return
    const device = this.devices.find((x) => x.udid === first.ask.udid)
    this.deps.needs(first.key, {
      kind: first.ask.kind,
      text: first.ask.detail || device?.name || 'a simulator'
    })
    this.notified.add(first.key)
  }

  private allowedFor(key: string): Set<string> {
    let set = this.allowed.get(key)
    if (!set) {
      set = new Set()
      this.allowed.set(key, set)
    }
    return set
  }

  private async readScreen(key: string, udid: string): Promise<AxScreen> {
    const screen = describeScreen(await this.deps.host.ax(udid))
    this.screens.set(key, screen)
    return screen
  }

  /** A ref or a point in points, as 0..1 of the screen. */
  private async normalize(
    key: string,
    udid: string,
    target: TapTarget
  ): Promise<{ x: number; y: number }> {
    const screen = this.screens.get(key) ?? (await this.readScreen(key, udid))
    if ('ref' in target) {
      const found = screen.refs.get(target.ref)
      if (!found)
        throw new Error(
          `No element ${target.ref} on the screen you last read. Call simulator_screen again.`
        )
      return found
    }
    if (target.x < 0 || target.y < 0 || target.x > screen.width || target.y > screen.height)
      throw new Error(
        `(${target.x}, ${target.y}) is off the ${Math.round(screen.width)}×${Math.round(screen.height)} point screen.`
      )
    return { x: target.x / screen.width, y: target.y / screen.height }
  }

  private scheduleIdle(udid: string): void {
    if (!this.bootedByUs.has(udid) || this.attached.has(udid) || this.closed) return
    this.clearIdle(udid)
    const timer = setTimeout(() => {
      this.idleTimers.delete(udid)
      if (this.attached.has(udid) || this.leases.has(udid)) return
      this.bootedByUs.delete(udid)
      void this.deps.simctl
        .shutdown(udid)
        .catch(() => {})
        .then(() => this.refresh())
    }, IDLE_SHUTDOWN_MS)
    timer.unref?.()
    this.idleTimers.set(udid, timer)
  }

  private clearIdle(udid: string): void {
    const timer = this.idleTimers.get(udid)
    if (timer) clearTimeout(timer)
    this.idleTimers.delete(udid)
  }
}

function availabilityText(availability: SimulatorAvailability): string {
  if (availability === 'unsupported') return 'The iOS Simulator needs a Mac.'
  if (availability === 'no-xcode')
    return "Xcode's simulator tools are missing. Ask the user to install Xcode and select it with xcode-select."
  if (availability === 'no-devices')
    return 'Xcode has no iOS simulators. Ask the user to install an iOS simulator runtime (xcodebuild -downloadPlatform iOS).'
  return 'The simulator is ready.'
}
