import { execFile as execFileCallback } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { getStoredSetting, setStoredSetting } from '../stores/settings-store.js'

const DEVICE_ID_SETTING_KEY = 'deviceId'
const DEVICE_ID_NAMESPACE = 'pichu-client-device-id:v1'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const execFile = promisify(execFileCallback)
let cachedDeviceId: string | null = null
let initializeDeviceIdPromise: Promise<string> | null = null

function uuidFromHash(input: string): string {
  const chars = createHash('sha256')
    .update(`${DEVICE_ID_NAMESPACE}:${input.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32)
    .split('')

  chars[12] = '5'
  chars[16] = (8 + (Number.parseInt(chars[16], 16) % 4)).toString(16)

  return `${chars.slice(0, 8).join('')}-${chars.slice(8, 12).join('')}-${chars
    .slice(12, 16)
    .join('')}-${chars.slice(16, 20).join('')}-${chars.slice(20, 32).join('')}`
}

async function readMacMachineId(): Promise<string | null> {
  const { stdout } = await execFile('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
  return stdout.match(/"IOPlatformUUID"\s=\s"([^"]+)"/)?.[1]?.trim() ?? null
}

async function readWindowsMachineId(): Promise<string | null> {
  const { stdout } = await execFile('reg', [
    'query',
    'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
    '/v',
    'MachineGuid'
  ])
  return stdout.match(/MachineGuid\s+REG_SZ\s+([^\s]+)/i)?.[1]?.trim() ?? null
}

async function readLinuxMachineId(): Promise<string | null> {
  for (const filePath of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const value = (await readFile(filePath, 'utf8')).trim()
      if (value) return value
    } catch {
      // Try the next standard machine-id location.
    }
  }

  return null
}

async function readMachineId(): Promise<string | null> {
  try {
    switch (process.platform) {
      case 'darwin':
        return await readMacMachineId()
      case 'win32':
        return await readWindowsMachineId()
      case 'linux':
        return await readLinuxMachineId()
      default:
        return null
    }
  } catch {
    return null
  }
}

export async function generateDeviceId(): Promise<string> {
  const machineId = await readMachineId()
  return machineId ? uuidFromHash(machineId) : randomUUID()
}

export function isValidDeviceId(deviceId: string): boolean {
  return UUID_PATTERN.test(deviceId)
}

async function resolveDeviceId(): Promise<string> {
  const storedDeviceId = getStoredSetting(DEVICE_ID_SETTING_KEY)
  if (storedDeviceId && isValidDeviceId(storedDeviceId)) {
    return storedDeviceId
  }

  const deviceId = await generateDeviceId()
  setStoredSetting(DEVICE_ID_SETTING_KEY, deviceId)
  return deviceId
}

export async function initializeDeviceId(): Promise<string> {
  if (cachedDeviceId) {
    return cachedDeviceId
  }

  if (!initializeDeviceIdPromise) {
    initializeDeviceIdPromise = resolveDeviceId().then((deviceId) => {
      cachedDeviceId = deviceId
      return deviceId
    })
  }

  return initializeDeviceIdPromise
}

export function getDeviceId(): string {
  if (!cachedDeviceId) {
    throw new Error('Device ID has not been initialized')
  }

  return cachedDeviceId
}

export function getCachedDeviceId(): string | null {
  return cachedDeviceId
}

export function getOrCreateDeviceId(): Promise<string> {
  return initializeDeviceId()
}
