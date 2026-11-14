import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative, sep } from 'node:path'
import {
  AGENT_PLUGIN_MCP_SCHEMA_V1,
  AGENT_PLUGIN_SCHEMA_V1,
  type PluginDiagnostic,
  type PluginMcpConfiguration,
  type PluginMcpHttpServer,
  type PluginMcpServer,
  type PluginMcpStdioServer
} from './plugin-types.js'

const MCP_CONFIG_FILE = 'mcp.json'
const PLUGIN_ROOT_VARIABLE = '$' + '{PLUGIN_ROOT}'
const PLUGIN_DATA_VARIABLE = '$' + '{PLUGIN_DATA}'
const RESERVED_PLUGIN_ENV_NAMES = new Set(['PLUGIN_ROOT', 'PLUGIN_DATA'])
const RESERVED_MCP_HEADER_NAMES = new Set([
  'accept',
  'authorization',
  'content-length',
  'content-type',
  'cookie',
  'host',
  'mcp-protocol-version',
  'mcp-session-id',
  'proxy-authorization',
  'set-cookie'
])

type McpConfigurationLoadResult = {
  configuration?: PluginMcpConfiguration
  path?: string
  diagnostics: PluginDiagnostic[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path) && !path.includes(`..${sep}`))
}

function isolatedError(message: string, path: string): PluginDiagnostic {
  return { level: 'error', message, path, fatal: false }
}

function optionalStringArray(
  value: unknown,
  field: string,
  diagnostics: PluginDiagnostic[]
): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    diagnostics.push(isolatedError(`${field} must be an array of strings`, field))
    return undefined
  }
  return value
}

function optionalStringRecord(
  value: unknown,
  field: string,
  diagnostics: PluginDiagnostic[]
): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== 'string')) {
    diagnostics.push(isolatedError(`${field} must be an object of string values`, field))
    return undefined
  }
  return value as Record<string, string>
}

function hasOnlyFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  serverPath: string,
  diagnostics: PluginDiagnostic[]
): boolean {
  const allowed = new Set(fields)
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  for (const field of unknown) {
    diagnostics.push(
      isolatedError(`${serverPath} contains unknown field: ${field}`, `${serverPath}.${field}`)
    )
  }
  return unknown.length === 0
}

function validateStdioServer(
  raw: Record<string, unknown>,
  serverPath: string,
  diagnostics: PluginDiagnostic[]
): PluginMcpStdioServer | undefined {
  const validFields = hasOnlyFields(
    raw,
    ['type', 'command', 'args', 'env', 'cwd'],
    serverPath,
    diagnostics
  )
  const command = typeof raw.command === 'string' ? raw.command.trim() : ''
  let validCommand = true
  if (!command) {
    validCommand = false
    diagnostics.push(isolatedError(`${serverPath}.command must be a non-empty string`, serverPath))
  } else if (isAbsolute(command) || (command.includes('/') && !command.startsWith('./'))) {
    validCommand = false
    diagnostics.push(
      isolatedError(
        `${serverPath}.command must be a bare executable name or start with "./"`,
        `${serverPath}.command`
      )
    )
  }

  const entryDiagnostics: PluginDiagnostic[] = []
  const args = optionalStringArray(raw.args, `${serverPath}.args`, entryDiagnostics)
  const env = optionalStringRecord(raw.env, `${serverPath}.env`, entryDiagnostics)
  const cwd = raw.cwd === undefined ? undefined : typeof raw.cwd === 'string' ? raw.cwd : null
  if (cwd === null) {
    entryDiagnostics.push(isolatedError(`${serverPath}.cwd must be a string`, `${serverPath}.cwd`))
  } else if (cwd !== undefined && !isAllowedPluginCwd(cwd)) {
    entryDiagnostics.push(
      isolatedError(
        `${serverPath}.cwd must start with "./", "\${PLUGIN_ROOT}", or "\${PLUGIN_DATA}"`,
        `${serverPath}.cwd`
      )
    )
  }

  if (env) {
    for (const name of Object.keys(env)) {
      if (RESERVED_PLUGIN_ENV_NAMES.has(name.toUpperCase())) {
        entryDiagnostics.push(
          isolatedError(
            `${serverPath}.env cannot override ${name.toUpperCase()}`,
            `${serverPath}.env.${name}`
          )
        )
      }
    }
  }
  diagnostics.push(...entryDiagnostics)

  if (!validFields || !validCommand || entryDiagnostics.length > 0) return undefined
  return {
    type: 'stdio',
    command,
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
    ...(cwd ? { cwd } : {})
  }
}

function isAllowedPluginCwd(value: string): boolean {
  return (
    value.startsWith('./') ||
    value === PLUGIN_ROOT_VARIABLE ||
    value.startsWith(`${PLUGIN_ROOT_VARIABLE}/`) ||
    value === PLUGIN_DATA_VARIABLE ||
    value.startsWith(`${PLUGIN_DATA_VARIABLE}/`)
  )
}

function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname === '::1' ||
    normalizedHostname.startsWith('127.')
  )
}

function validateHttpServer(
  raw: Record<string, unknown>,
  serverPath: string,
  diagnostics: PluginDiagnostic[]
): PluginMcpHttpServer | undefined {
  const validFields = hasOnlyFields(raw, ['type', 'url', 'headers'], serverPath, diagnostics)
  const type = raw.type === 'streamable-http' ? raw.type : undefined
  const urlText = typeof raw.url === 'string' ? raw.url : ''
  let validUrl = true
  try {
    const url = new URL(urlText)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
      validUrl = false
    }
    if (url.protocol !== 'https:' && !isLoopbackHostname(url.hostname)) validUrl = false
  } catch {
    validUrl = false
  }
  if (!validUrl) {
    diagnostics.push(
      isolatedError(
        `${serverPath}.url must be an absolute HTTP(S) URL; non-loopback endpoints require HTTPS`,
        `${serverPath}.url`
      )
    )
  }

  const entryDiagnostics: PluginDiagnostic[] = []
  const headers = optionalStringRecord(raw.headers, `${serverPath}.headers`, entryDiagnostics)
  if (headers) {
    const names = new Set<string>()
    for (const name of Object.keys(headers)) {
      const normalizedName = name.toLowerCase()
      if (names.has(normalizedName)) {
        entryDiagnostics.push(
          isolatedError(
            `${serverPath}.headers contains duplicate case-insensitive header: ${name}`,
            `${serverPath}.headers.${name}`
          )
        )
      }
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
        entryDiagnostics.push(
          isolatedError(
            `${serverPath}.headers contains an invalid HTTP header name: ${name}`,
            `${serverPath}.headers.${name}`
          )
        )
      }
      if (RESERVED_MCP_HEADER_NAMES.has(normalizedName)) {
        entryDiagnostics.push(
          isolatedError(
            `${serverPath}.headers cannot set reserved or credential header: ${name}`,
            `${serverPath}.headers.${name}`
          )
        )
      }
      if (/\r|\n/.test(headers[name])) {
        entryDiagnostics.push(
          isolatedError(
            `${serverPath}.headers.${name} cannot contain line breaks`,
            `${serverPath}.headers.${name}`
          )
        )
      }
      names.add(normalizedName)
    }
  }
  diagnostics.push(...entryDiagnostics)

  if (!validFields || !type || !validUrl || entryDiagnostics.length > 0) return undefined
  return { type, url: urlText, ...(headers ? { headers } : {}) }
}

function validateServer(
  raw: unknown,
  serverPath: string,
  diagnostics: PluginDiagnostic[]
): PluginMcpServer | undefined {
  if (!isRecord(raw)) {
    diagnostics.push(isolatedError(`${serverPath} must be an object`, serverPath))
    return undefined
  }
  if (raw.type === 'stdio') return validateStdioServer(raw, serverPath, diagnostics)
  if (raw.type === 'streamable-http') {
    return validateHttpServer(raw, serverPath, diagnostics)
  }
  diagnostics.push(
    isolatedError(`${serverPath}.type is unsupported: ${String(raw.type)}`, `${serverPath}.type`)
  )
  return undefined
}

async function resolveMcpConfigPath(pluginRoot: string): Promise<string | undefined> {
  const configPath = join(pluginRoot, MCP_CONFIG_FILE)
  try {
    if (!(await stat(configPath)).isFile()) return undefined
    const realRoot = await realpath(pluginRoot)
    const realConfigPath = await realpath(configPath)
    if (!isPathInside(realRoot, realConfigPath)) {
      throw new Error('mcp.json resolves outside the plugin root')
    }
    return normalize(configPath)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

export async function loadPluginMcpConfigurationAsync(
  pluginRoot: string,
  pluginSchema: string
): Promise<McpConfigurationLoadResult> {
  let configPath: string | undefined
  try {
    configPath = await resolveMcpConfigPath(pluginRoot)
  } catch (error) {
    return {
      diagnostics: [
        isolatedError(error instanceof Error ? error.message : String(error), MCP_CONFIG_FILE)
      ]
    }
  }
  if (!configPath) return { diagnostics: [] }

  let raw: unknown
  try {
    raw = JSON.parse(await readFile(configPath, 'utf8')) as unknown
  } catch (error) {
    return {
      path: configPath,
      diagnostics: [
        isolatedError(
          `Invalid mcp.json: ${error instanceof Error ? error.message : String(error)}`,
          MCP_CONFIG_FILE
        )
      ]
    }
  }

  if (!isRecord(raw)) {
    return {
      path: configPath,
      diagnostics: [isolatedError('mcp.json must be a JSON object', MCP_CONFIG_FILE)]
    }
  }

  const diagnostics: PluginDiagnostic[] = []
  for (const field of Object.keys(raw)) {
    if (field !== '$schema' && field !== 'mcpServers') {
      diagnostics.push(isolatedError(`mcp.json contains unknown field: ${field}`, field))
    }
  }
  if (raw.$schema !== AGENT_PLUGIN_MCP_SCHEMA_V1) {
    diagnostics.push(isolatedError(`mcp.json must target ${AGENT_PLUGIN_MCP_SCHEMA_V1}`, '$schema'))
  }
  if (pluginSchema !== AGENT_PLUGIN_SCHEMA_V1) {
    diagnostics.push(
      isolatedError('mcp.json version must match plugin.json Agent Plugins version', '$schema')
    )
  }
  if (!isRecord(raw.mcpServers)) {
    diagnostics.push(isolatedError('mcpServers must be an object', 'mcpServers'))
  }
  if (diagnostics.length > 0 || !isRecord(raw.mcpServers)) {
    return { path: configPath, diagnostics }
  }

  const servers: Record<string, PluginMcpServer> = {}
  for (const name of Object.keys(raw.mcpServers).sort((left, right) => left.localeCompare(right))) {
    const server = validateServer(raw.mcpServers[name], `mcpServers.${name}`, diagnostics)
    if (server) servers[name] = server
  }

  return {
    configuration: { schema: AGENT_PLUGIN_MCP_SCHEMA_V1, servers },
    path: configPath,
    diagnostics
  }
}
