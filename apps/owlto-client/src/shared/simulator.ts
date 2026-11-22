import { z } from 'zod'
import type { AgentProvider } from './agents.js'
import type { AppSettings, Reply } from './app.js'

/**
 * The iOS Simulator panel: simulated devices main drives through Xcode's tools and the
 * serve-sim native addon, shown live in the right sidebar. See docs/RFC_OWLTO_IOS_SIMULATOR.md.
 */

/** One simulated device, as `simctl list devices` reports it. */
export type SimulatorDevice = {
  udid: string
  name: string
  /** Such as `iOS 26.1`. */
  runtime: string
  state: 'booted' | 'shutdown' | 'busy'
}

/** Why the panel cannot show a device yet, or `ready`. */
export type SimulatorAvailability = 'ready' | 'unsupported' | 'no-xcode' | 'no-devices'

/** The last thing a worker did on its device, for the panel's who-drives line. */
export type SimulatorAction =
  | { kind: 'install' }
  | { kind: 'launch'; bundleId: string }
  | { kind: 'open-url' }
  | { kind: 'tap' }
  | { kind: 'swipe' }
  | { kind: 'type' }
  | { kind: 'button' }
  | { kind: 'look' }

/** The worker holding a device: only it may drive the device until it lets go. */
export type SimulatorLease = {
  workerId: string
  provider: AgentProvider
  title: string
  /** True while one of its calls runs. */
  busy: boolean
  action: SimulatorAction | null
}

/** Something a worker waits on the user for before it touches a device. */
export type SimulatorAsk = {
  id: string
  /** `device`: first use of a device. The others follow the worker's permission mode. */
  kind: 'device' | 'install' | 'launch' | 'open-url'
  udid: string
  workerId: string
  provider: AgentProvider
  title: string
  /** What the ask is about: an app path, a bundle id, or a URL; empty for `device`. */
  detail: string
}

export type SimulatorSnapshot = {
  availability: SimulatorAvailability
  /** Sorted booted first, then by runtime (newest first) and name. */
  devices: SimulatorDevice[]
  /** The device the panel shows, or null before one is attached. */
  activeUdid: string | null
  /** Devices with a live capture, which the panel can stream. */
  attached: string[]
  leases: Record<string, SimulatorLease>
  ask: SimulatorAsk | null
  /** Attached devices whose touch and keyboard input Xcode 27's Device Hub disconnected. */
  inputBlocked: string[]
}

export const simulatorUdidSchema = z
  .string()
  .regex(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i)
export const simulatorAnswerSchema = z.object({
  askId: z.string().min(1).max(64),
  answer: z.enum(['allow', 'deny'])
})
export type SimulatorAnswer = z.infer<typeof simulatorAnswerSchema>

/** Settings → Browser & Simulator. Added later, so older rows get the defaults. */
export const simulatorSettingsSchema = z.object({
  /** Whether workers get the `simulator_*` tools. */
  enabled: z.boolean().catch(true).default(true),
  /** Devices the user let workers drive, by udid, sorted. */
  allowedDevices: z.array(simulatorUdidSchema).max(200).catch([]).default([])
})
export type SimulatorSettings = z.infer<typeof simulatorSettingsSchema>
export const defaultSimulatorSettings: SimulatorSettings = { enabled: true, allowedDevices: [] }

/**
 * Messages on a device's stream port. The host posts video and the screen size; the panel
 * posts the user's touches and keys. Touch coordinates are 0..1 of the portrait screen.
 */
export type SimulatorStreamMessage =
  | { type: 'size'; width: number; height: number }
  /** H.264 in AVCC form: `description` frames carry the decoder configuration. */
  | {
      type: 'frame'
      data: Uint8Array
      width: number
      height: number
      description: boolean
      keyframe: boolean
    }
  | { type: 'ended'; reason: string }
export type SimulatorInputMessage =
  | { type: 'touch'; phase: 'begin' | 'move' | 'end'; x: number; y: number }
  | { type: 'key'; phase: 'down' | 'up'; usage: number }
  | { type: 'button'; name: SimulatorButton }
export const simulatorButtonSchema = z.enum(['home', 'lock', 'app_switcher', 'siri'])
export type SimulatorButton = z.infer<typeof simulatorButtonSchema>

/** The `window` message the preload posts a stream port with. */
export const SIMULATOR_STREAM_MESSAGE = 'owlto:simulator-stream'
export type SimulatorStreamEnvelope = { type: typeof SIMULATOR_STREAM_MESSAGE; udid: string }

/** `window.owlto.simulator`. */
export interface SimulatorAPI {
  snapshot(): Promise<Reply<SimulatorSnapshot>>
  /** Reads the device list again, such as after the user installs a runtime. */
  refresh(): Promise<Reply<SimulatorSnapshot>>
  /** Boots the device if needed, starts its capture, and shows it in the panel. */
  attach(udid: string): Promise<Reply<void>>
  /** Stops streaming the device; it keeps running. */
  detach(udid: string): Promise<Reply<void>>
  shutdown(udid: string): Promise<Reply<void>>
  /** Reconnects input Device Hub disconnected; it restarts SpringBoard and closes apps. */
  repairInput(udid: string): Promise<Reply<void>>
  /** Answers an ask; allowing a device saves it and returns the saved settings, else null. */
  answer(input: SimulatorAnswer): Promise<Reply<AppSettings | null>>
  /**
   * Opens the device's live stream. A MessagePort cannot cross an invoke or the context
   * bridge, so the preload posts it to the page as a `window` message
   * (`SIMULATOR_STREAM_MESSAGE`, with the udid) carrying the port.
   */
  openStream(udid: string): Promise<Reply<void>>
  onChanged(listener: (snapshot: SimulatorSnapshot) => void): () => void
}
