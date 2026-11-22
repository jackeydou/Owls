import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SimulatorDevice } from '../../shared/simulator.js'

const execFileAsync = promisify(execFile)

/** Always present on macOS; it finds the Xcode that `xcode-select` points at. */
const XCRUN = '/usr/bin/xcrun'
const PLUTIL = '/usr/bin/plutil'
const SHORT_MS = 30_000
/** Booting a cold device or installing a large app can take a while. */
const LONG_MS = 180_000

type RawDevice = {
  udid?: unknown
  name?: unknown
  state?: unknown
  isAvailable?: unknown
}

/** `com.apple.CoreSimulator.SimRuntime.iOS-26-1` → `iOS 26.1`; null for other platforms. */
export function runtimeName(key: string): string | null {
  const match = /SimRuntime\.iOS-(\d+)(?:-(\d+))?(?:-(\d+))?$/.exec(key)
  if (!match) return null
  return `iOS ${[match[1], match[2], match[3]].filter(Boolean).join('.')}`
}

function runtimeOrder(runtime: string): number[] {
  return runtime
    .replace(/^iOS /, '')
    .split('.')
    .map((part) => Number(part))
}

/** Booted first, then the newest runtime, then by name, so the list reads the same every time. */
export function compareDevices(a: SimulatorDevice, b: SimulatorDevice): number {
  if ((a.state === 'booted') !== (b.state === 'booted')) return a.state === 'booted' ? -1 : 1
  const ra = runtimeOrder(a.runtime)
  const rb = runtimeOrder(b.runtime)
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
    const diff = (rb[i] ?? 0) - (ra[i] ?? 0)
    if (diff) return diff
  }
  return a.name.localeCompare(b.name) || a.udid.localeCompare(b.udid)
}

/** The available iOS devices in `simctl list devices -j` output. */
export function parseDevices(json: string): SimulatorDevice[] {
  const parsed = JSON.parse(json) as { devices?: Record<string, RawDevice[]> }
  const devices: SimulatorDevice[] = []
  for (const [key, list] of Object.entries(parsed.devices ?? {})) {
    const runtime = runtimeName(key)
    if (!runtime || !Array.isArray(list)) continue
    for (const raw of list) {
      if (raw.isAvailable === false) continue
      if (typeof raw.udid !== 'string' || typeof raw.name !== 'string') continue
      const state =
        raw.state === 'Booted' ? 'booted' : raw.state === 'Shutdown' ? 'shutdown' : 'busy'
      devices.push({ udid: raw.udid, name: raw.name, runtime, state })
    }
  }
  return devices.sort(compareDevices)
}

/** `simctl launch` prints `<bundle id>: <pid>`. */
export function parseLaunchPid(output: string): number | null {
  const match = /:\s*(\d+)\s*$/.exec(output.trim())
  return match ? Number(match[1]) : null
}

/** A short reason from a failed command, without the command line it ran. */
function failure(error: unknown, fallback: string): Error {
  const stderr =
    error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : ''
  const line = stderr
    .split('\n')
    .map((x) => x.trim())
    .find((x) => x && !x.startsWith('Underlying error'))
  return new Error(
    line
      ? line.replace(/^An error was encountered processing the command \(domain=[^)]*\):\s*/, '')
      : fallback
  )
}

async function simctl(args: string[], timeout = SHORT_MS): Promise<string> {
  const { stdout } = await execFileAsync(XCRUN, ['simctl', ...args], {
    timeout,
    maxBuffer: 16 * 1024 * 1024
  })
  return stdout
}

/** The devices, or null when Xcode's simulator tools are missing. */
export async function listDevices(): Promise<SimulatorDevice[] | null> {
  try {
    return parseDevices(await simctl(['list', 'devices', '-j']))
  } catch {
    return null
  }
}

/** The device's state in `simctl list`, or null when it is not listed. */
async function deviceState(udid: string): Promise<SimulatorDevice['state'] | null> {
  const devices = await listDevices()
  return devices?.find((device) => device.udid === udid)?.state ?? null
}

/**
 * Boots the device and waits until it has finished booting. It asks for the boot first and
 * then only monitors it: on Xcode 27, `bootstatus -b` (boot if needed) can stay blocked after
 * the device is already booted.
 */
export async function bootDevice(udid: string): Promise<void> {
  let bootError: unknown = null
  try {
    await simctl(['boot', udid], LONG_MS)
  } catch (error) {
    // It also fails when the device is already booted; bootstatus settles which.
    bootError = error
    // A device still shut down after a failed boot will not come up; do not wait for it.
    if ((await deviceState(udid)) === 'shutdown')
      throw failure(error, 'The simulator could not boot.')
  }
  try {
    await simctl(['bootstatus', udid], LONG_MS)
    return
  } catch {
    // bootstatus can exit non-zero or time out with the device ready; check its real state.
  }
  if ((await deviceState(udid)) === 'booted') return
  throw failure(bootError, 'The simulator could not boot.')
}

export async function shutdownDevice(udid: string): Promise<void> {
  try {
    await simctl(['shutdown', udid])
  } catch (error) {
    throw failure(error, 'The simulator could not shut down.')
  }
}

/** The guest flag Device Hub sets when it takes the device's input over. */
const DEVICE_HUB_INPUT = 'com.apple.coredevice.dtuhidd.active'

/**
 * Whether Xcode 27's Device Hub has disconnected the device's legacy touch and keyboard
 * input, which the panel and the worker tools use. False on runtimes without the flag.
 */
export async function inputShadowed(udid: string): Promise<boolean> {
  try {
    const out = await simctl(['spawn', udid, 'notifyutil', '-g', DEVICE_HUB_INPUT], 5_000)
    return out.trim() === `${DEVICE_HUB_INPUT} 1`
  } catch {
    return false
  }
}

/**
 * Hands input back from Device Hub by restarting backboardd with the flag cleared, in that
 * order. It restarts SpringBoard and closes running apps, so it only runs when asked.
 */
export async function repairInput(udid: string): Promise<void> {
  try {
    await simctl(['spawn', udid, 'notifyutil', '-s', DEVICE_HUB_INPUT, '0'])
    await simctl(['spawn', udid, 'launchctl', 'kickstart', '-k', 'system/com.apple.backboardd'])
  } catch (error) {
    throw failure(error, 'The simulator input could not be repaired.')
  }
}

/** Reads a key from an app bundle's Info.plist. */
async function bundleValue(appPath: string, key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      PLUTIL,
      ['-extract', key, 'raw', '-o', '-', `${appPath}/Info.plist`],
      { timeout: SHORT_MS }
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

export type InstalledApp = { bundleId: string; executable: string | null }

export async function installApp(udid: string, appPath: string): Promise<InstalledApp> {
  const bundleId = await bundleValue(appPath, 'CFBundleIdentifier')
  if (!bundleId) throw new Error(`${appPath} is not an app bundle: it has no CFBundleIdentifier.`)
  try {
    await simctl(['install', udid, appPath], LONG_MS)
  } catch (error) {
    throw failure(error, 'The app could not be installed.')
  }
  return { bundleId, executable: await bundleValue(appPath, 'CFBundleExecutable') }
}

export async function launchApp(
  udid: string,
  bundleId: string,
  args: string[],
  terminateFirst: boolean
): Promise<number | null> {
  try {
    const flags = terminateFirst ? ['--terminate-running-process'] : []
    return parseLaunchPid(await simctl(['launch', ...flags, udid, bundleId, ...args]))
  } catch (error) {
    throw failure(error, `${bundleId} could not be launched.`)
  }
}

export async function openUrl(udid: string, url: string): Promise<void> {
  try {
    await simctl(['openurl', udid, url])
  } catch (error) {
    throw failure(error, 'The URL could not be opened.')
  }
}

/** Puts text on the device's pasteboard, for pasting text a keyboard cannot type. */
export async function copyToDevice(udid: string, text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile(XCRUN, ['simctl', 'pbcopy', udid], { timeout: SHORT_MS }, (error) =>
      error ? reject(failure(error, 'The text could not be pasted.')) : resolve()
    )
    child.stdin?.end(text)
  })
}

/** Recent log lines, optionally from one process, oldest first. */
export async function recentLogs(
  udid: string,
  seconds: number,
  process: string | null
): Promise<string[]> {
  const predicate = process ? ['--predicate', `process == ${JSON.stringify(process)}`] : []
  try {
    const out = await simctl(
      ['spawn', udid, 'log', 'show', '--last', `${seconds}s`, '--style', 'compact', ...predicate],
      LONG_MS
    )
    return out.split('\n').filter((line) => line.trim() && !line.startsWith('Timestamp'))
  } catch (error) {
    throw failure(error, 'The logs could not be read.')
  }
}
