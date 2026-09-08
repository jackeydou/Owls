import { randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { safeStorage } from 'electron'
import type {
  CustomMcpRemoteServer,
  CustomMcpServer,
  CustomMcpServerSummary,
  SaveCustomMcpServerInput
} from '../../shared/custom-mcp.js'
import { getDataRoot } from '../pichu-paths.js'
import { deleteStoredSetting, getStoredSetting, setStoredSetting } from './settings-store.js'

const CUSTOM_MCP_SERVERS_KEY = 'customMcpServers'
const CUSTOM_MCP_OAUTH_KEY_PREFIX = 'customMcpOAuth:'
const RESERVED_HEADER_NAMES = new Set([
  'authorization',
  'connection',
  'content-length',
  'host',
  'mcp-protocol-version',
  'mcp-session-id',
  'proxy-authorization',
  'transfer-encoding'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a list of strings`)
  }
  return value.map((entry) => entry.trim()).filter(Boolean)
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (!isRecord(value)) throw new Error(`${label} must be a key-value object`)
  const result: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.trim()
    if (!name || typeof rawValue !== 'string') throw new Error(`${label} contains an invalid entry`)
    result[name] = rawValue
  }
  return result
}

function validateRemoteUrl(value: unknown): string {
  const raw = requireString(value, 'Server URL')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Server URL must be a valid absolute URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('Server URL must be an HTTP(S) URL without credentials or a fragment')
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error('Remote MCP servers must use HTTPS unless they run on this computer')
  }
  return url.toString()
}

function validateHeaders(value: unknown): Record<string, string> {
  const headers = stringRecord(value, 'Headers')
  const normalized = new Set<string>()
  for (const name of Object.keys(headers)) {
    const lowerName = name.toLowerCase()
    if (normalized.has(lowerName)) throw new Error(`Duplicate header: ${name}`)
    if (RESERVED_HEADER_NAMES.has(lowerName)) throw new Error(`Header is managed by Owls: ${name}`)
    normalized.add(lowerName)
  }
  return headers
}

function normalizeServer(value: unknown, idFallback?: string): CustomMcpServer {
  if (!isRecord(value)) throw new Error('MCP server configuration must be an object')
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : idFallback
  if (!id) throw new Error('MCP server ID is required')
  const name = requireString(value.name, 'Server name')
  const enabled = value.enabled !== false
  if (value.type === 'stdio') {
    const cwd = typeof value.cwd === 'string' ? value.cwd.trim() : ''
    if (cwd && !isAbsolute(cwd)) throw new Error('Working directory must be an absolute path')
    return {
      id,
      name,
      enabled,
      type: 'stdio',
      command: requireString(value.command, 'Command'),
      args: stringList(value.args ?? [], 'Arguments'),
      cwd,
      env: stringRecord(value.env ?? {}, 'Environment variables')
    }
  }
  if (value.type === 'streamable-http') {
    return {
      id,
      name,
      enabled,
      type: 'streamable-http',
      url: validateRemoteUrl(value.url),
      headers: validateHeaders(value.headers ?? {})
    }
  }
  throw new Error('Transport must be stdio or remote')
}

function readServers(): CustomMcpServer[] {
  const stored = getStoredSetting(CUSTOM_MCP_SERVERS_KEY)
  if (!stored) return []
  try {
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      try {
        return [normalizeServer(entry)]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

function writeServers(servers: CustomMcpServer[]): void {
  setStoredSetting(CUSTOM_MCP_SERVERS_KEY, JSON.stringify(servers))
}

export function customMcpOAuthSettingKey(serverId: string): string {
  return `${CUSTOM_MCP_OAUTH_KEY_PREFIX}${serverId}`
}

export function hasCustomMcpOAuthCredential(serverId: string): boolean {
  const credential = readCustomMcpOAuthCredential<Record<string, unknown>>(serverId)
  if (!isRecord(credential?.tokens)) return false
  return (
    typeof credential.tokens.access_token === 'string' && Boolean(credential.tokens.access_token)
  )
}

export function readCustomMcpOAuthCredential<T>(serverId: string): T | undefined {
  const stored = getStoredSetting(customMcpOAuthSettingKey(serverId))
  if (!stored || !safeStorage.isEncryptionAvailable()) return undefined
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(stored, 'base64'))) as T
  } catch {
    return undefined
  }
}

export function writeCustomMcpOAuthCredential(serverId: string, value: unknown): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OAuth requires a system keyring to store credentials securely')
  }
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('OAuth requires a secure system keyring')
  }
  setStoredSetting(
    customMcpOAuthSettingKey(serverId),
    safeStorage.encryptString(JSON.stringify(value)).toString('base64')
  )
}

export function clearCustomMcpOAuthCredential(serverId: string): void {
  deleteStoredSetting(customMcpOAuthSettingKey(serverId))
}

export function listCustomMcpServers(): CustomMcpServerSummary[] {
  return readServers()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((server) => ({
      ...server,
      oauthConnected: server.type === 'streamable-http' && hasCustomMcpOAuthCredential(server.id)
    }))
}

export function getCustomMcpServer(serverId: string): CustomMcpServer | undefined {
  return readServers().find((server) => server.id === serverId)
}

export function saveCustomMcpServer(input: unknown): CustomMcpServerSummary[] {
  if (!isRecord(input)) throw new Error('MCP server configuration must be an object')
  const requestedId = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : undefined
  const id = requestedId ?? randomUUID()
  const next = normalizeServer(input as SaveCustomMcpServerInput, id)
  const servers = readServers()
  const existing = servers.find((server) => server.id === id)
  if (
    servers.some(
      (server) => server.id !== id && server.name.toLowerCase() === next.name.toLowerCase()
    )
  ) {
    throw new Error('An MCP server with this name already exists')
  }
  if (
    existing?.type === 'streamable-http' &&
    (next.type !== 'streamable-http' || new URL(existing.url).origin !== new URL(next.url).origin)
  ) {
    clearCustomMcpOAuthCredential(id)
  }
  writeServers([...servers.filter((server) => server.id !== id), next])
  return listCustomMcpServers()
}

export function deleteCustomMcpServer(serverId: unknown): CustomMcpServerSummary[] {
  const id = requireString(serverId, 'Server ID')
  clearCustomMcpOAuthCredential(id)
  writeServers(readServers().filter((server) => server.id !== id))
  return listCustomMcpServers()
}

export function customMcpRuntimeDataPath(serverId: string): string {
  return join(getDataRoot(), 'mcp', serverId.replace(/[^a-zA-Z0-9._-]/g, '_'))
}

export function enabledCustomMcpServers(): CustomMcpServer[] {
  return readServers().filter((server) => server.enabled)
}

export function getCustomMcpRemoteServer(serverId: string): CustomMcpRemoteServer {
  const server = getCustomMcpServer(serverId)
  if (!server || server.type !== 'streamable-http') {
    throw new Error('This MCP server is not remote')
  }
  return server
}
