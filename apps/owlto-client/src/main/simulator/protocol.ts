import type { SimulatorButton } from '../../shared/simulator.js'

/** Messages from the main process to the simulator host utility process. */
export type SimulatorHostRequest =
  | { type: 'attach'; id: string; udid: string }
  | { type: 'detach'; id: string; udid: string }
  /** Carries the panel's MessagePort; the host streams the device's video on it. */
  | { type: 'stream'; id: string; udid: string }
  | {
      type: 'touch'
      id: string
      udid: string
      phase: 'begin' | 'move' | 'end'
      x: number
      y: number
    }
  | { type: 'key'; id: string; udid: string; phase: 'down' | 'up'; usage: number }
  | { type: 'button'; id: string; udid: string; name: SimulatorButton }
  /** A JPEG of the latest frame, written to `path`. */
  | { type: 'snapshot'; id: string; udid: string; path: string }
  /** The accessibility tree as the addon's JSON string. */
  | { type: 'ax'; id: string; udid: string }

export type SimulatorHostReply =
  | { id: string; ok: true; value: unknown }
  | { id: string; ok: false; error: string }

/** Arguments the host is forked with: where serve-sim's addon and Duo helper live. */
export type SimulatorHostPaths = { addon: string; duoHelper: string }
