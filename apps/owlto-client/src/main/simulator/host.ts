/**
 * The simulator host: an Electron utility process that loads serve-sim's native addon, which
 * reads a simulated device's framebuffer, encodes it, and injects touches and keys through
 * Xcode's private simulator frameworks. Those frameworks change with Xcode releases, so they
 * stay out of the main process: a crash here only takes this process down.
 */
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { MessagePortMain } from 'electron'
import type { SimulatorInputMessage, SimulatorStreamMessage } from '../../shared/simulator.js'
import type { SimulatorHostPaths, SimulatorHostReply, SimulatorHostRequest } from './protocol.js'

type Unsubscribe = () => void | Promise<void>

/** The parts of serve-sim's addon (see its src/native.ts) that Owlto uses. */
interface NativeHid {
  touch(type: string, x: number, y: number, w: number, h: number, edge: number): Promise<void>
  button(name: string): Promise<void>
  key(type: string, usage: number): Promise<void>
  close(): Promise<void>
}
interface NativeCapture {
  start(): Promise<void>
  stop(): Promise<void>
  subscribe(
    codec: number,
    onFrame: (data: Uint8Array, width: number, height: number, flags: number) => Promise<void>
  ): Promise<Unsubscribe>
  snapshotJpeg(): Promise<Uint8Array | null>
}
interface NativeAddon {
  SimHID: new (udid: string, duoHelper: string) => NativeHid
  SimCapture: new (udid: string, maxBitrate: number | null) => NativeCapture
  axDescribe(udid: string): Promise<string>
  setDeviceSet(path: string | null): void
}

const CODEC_AVCC = 1
const CODEC_SIZE = 2
const FLAG_DESCRIPTION = 1
const FLAG_KEYFRAME = 2

type Device = {
  capture: NativeCapture
  hid: NativeHid
  width: number
  height: number
  stopSize: Unsubscribe
  streams: Map<MessagePortMain, Unsubscribe | null>
  /** The last decoder configuration, so a panel that joins late can start decoding. */
  description: SimulatorStreamMessage | null
}

const paths = JSON.parse(process.argv.at(-1) ?? '{}') as SimulatorHostPaths
const devices = new Map<string, Device>()
let addon: NativeAddon | null = null

function load(): NativeAddon {
  if (!addon) {
    const required = createRequire(__filename)(paths.addon) as NativeAddon
    // The default device set, the one Xcode and simctl use.
    required.setDeviceSet(null)
    addon = required
  }
  return addon
}

function device(udid: string): Device {
  const found = devices.get(udid)
  if (!found) throw new Error('This simulator is not attached.')
  return found
}

async function attach(udid: string): Promise<void> {
  if (devices.has(udid)) return
  const native = load()
  const capture = new native.SimCapture(udid, null)
  await capture.start()
  const hid = new native.SimHID(udid, paths.duoHelper)
  const entry: Device = {
    capture,
    hid,
    width: 0,
    height: 0,
    stopSize: () => {},
    streams: new Map(),
    description: null
  }
  devices.set(udid, entry)
  entry.stopSize = await capture.subscribe(CODEC_SIZE, async (_data, width, height) => {
    entry.width = width
    entry.height = height
    for (const port of entry.streams.keys()) post(port, { type: 'size', width, height })
  })
}

async function detach(udid: string): Promise<void> {
  const entry = devices.get(udid)
  if (!entry) return
  devices.delete(udid)
  for (const [port, stop] of entry.streams) {
    post(port, { type: 'ended', reason: 'detached' })
    await stop?.()
    port.close()
  }
  await entry.stopSize()
  await entry.hid.close().catch(() => {})
  await entry.capture.stop().catch(() => {})
}

function post(port: MessagePortMain, message: SimulatorStreamMessage): void {
  try {
    port.postMessage(message)
  } catch {
    // The panel went away; its close handler drops the stream.
  }
}

async function input(entry: Device, message: SimulatorInputMessage): Promise<void> {
  if (message.type === 'touch') {
    if (!entry.width || !entry.height) return
    const x = Math.min(1, Math.max(0, message.x))
    const y = Math.min(1, Math.max(0, message.y))
    await entry.hid.touch(message.phase, x, y, entry.width, entry.height, 0)
  } else if (message.type === 'key') await entry.hid.key(message.phase, message.usage)
  else if (message.type === 'button') await entry.hid.button(message.name)
}

/** Streams H.264 to one panel until it closes its port or the device is detached. */
async function stream(udid: string, port: MessagePortMain): Promise<void> {
  const entry = device(udid)
  entry.streams.set(port, null)
  port.on('message', (event) => {
    void input(entry, event.data as SimulatorInputMessage).catch(() => {})
  })
  port.on('close', () => {
    const stop = entry.streams.get(port)
    entry.streams.delete(port)
    void stop?.()
  })
  port.start()
  if (entry.width) post(port, { type: 'size', width: entry.width, height: entry.height })
  if (entry.description) post(port, entry.description)
  const stop = await entry.capture.subscribe(CODEC_AVCC, async (data, width, height, flags) => {
    const message: SimulatorStreamMessage = {
      type: 'frame',
      data,
      width,
      height,
      description: (flags & FLAG_DESCRIPTION) !== 0,
      keyframe: (flags & FLAG_KEYFRAME) !== 0
    }
    if (message.description) entry.description = message
    post(port, message)
  })
  if (entry.streams.has(port)) entry.streams.set(port, stop)
  else await stop()
}

async function handle(request: SimulatorHostRequest, ports: MessagePortMain[]): Promise<unknown> {
  switch (request.type) {
    case 'attach':
      return attach(request.udid)
    case 'detach':
      return detach(request.udid)
    case 'stream': {
      const port = ports[0]
      if (!port) throw new Error('No stream port.')
      return stream(request.udid, port)
    }
    case 'touch':
      return input(device(request.udid), request)
    case 'key':
      return input(device(request.udid), request)
    case 'button':
      return input(device(request.udid), { type: 'button', name: request.name })
    case 'snapshot': {
      const jpeg = await device(request.udid).capture.snapshotJpeg()
      if (!jpeg) throw new Error('The simulator has not drawn a frame yet. Try again.')
      await writeFile(request.path, jpeg)
      return request.path
    }
    case 'ax':
      device(request.udid)
      return load().axDescribe(request.udid)
  }
}

process.parentPort.on('message', (event) => {
  const request = event.data as SimulatorHostRequest
  void handle(request, event.ports).then(
    (value) => process.parentPort.postMessage({ id: request.id, ok: true, value: value ?? null }),
    (error: unknown) =>
      process.parentPort.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      } satisfies SimulatorHostReply)
  )
})
