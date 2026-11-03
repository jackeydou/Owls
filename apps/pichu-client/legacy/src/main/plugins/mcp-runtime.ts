import { access, mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  getDefaultEnvironment,
  StdioClientTransport
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { TSchema } from 'typebox'
import { preparePichuSandboxedStdioCommand } from '../tools/pichu-bash-sandbox.js'
import type { EnabledPluginMcpServer } from './plugin-registry.js'

type McpToolDescription = Awaited<ReturnType<Client['listTools']>>['tools'][number]

type McpConnection = {
  client: Client
  transport: Transport
  tools: McpToolDescription[]
}

const connections = new Map<string, Promise<McpConnection>>()
const MCP_CONNECT_TIMEOUT_MS = 15_000
const MAX_MCP_TEXT_CHARS = 100_000
const MAX_MCP_IMAGE_BASE64_CHARS = 14_000_000
const PLUGIN_ROOT_VARIABLE = '$' + '{PLUGIN_ROOT}'
const PLUGIN_DATA_VARIABLE = '$' + '{PLUGIN_DATA}'

function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path) && !path.includes(`..${sep}`))
}

async function resolveContainedPath(parent: string, candidate: string): Promise<string> {
  const realParent = await realpath(parent)
  const realCandidate = await realpath(candidate)
  if (!isPathInside(realParent, realCandidate)) {
    throw new Error(`MCP path resolves outside its allowed root: ${candidate}`)
  }
  return realCandidate
}

function expandPluginPath(value: string, descriptor: EnabledPluginMcpServer): string {
  if (value === PLUGIN_ROOT_VARIABLE) return descriptor.pluginRoot
  if (value.startsWith(`${PLUGIN_ROOT_VARIABLE}/`)) {
    return join(descriptor.pluginRoot, value.slice(PLUGIN_ROOT_VARIABLE.length + 1))
  }
  if (value === PLUGIN_DATA_VARIABLE) return descriptor.pluginDataRoot
  if (value.startsWith(`${PLUGIN_DATA_VARIABLE}/`)) {
    return join(descriptor.pluginDataRoot, value.slice(PLUGIN_DATA_VARIABLE.length + 1))
  }
  if (value.startsWith('./')) return resolve(descriptor.pluginRoot, value)
  throw new Error(`Unsupported MCP working directory: ${value}`)
}

function expandPluginVariables(value: string, descriptor: EnabledPluginMcpServer): string {
  return value
    .replaceAll(PLUGIN_ROOT_VARIABLE, descriptor.pluginRoot)
    .replaceAll(PLUGIN_DATA_VARIABLE, descriptor.pluginDataRoot)
}

async function resolveStdioCwd(descriptor: EnabledPluginMcpServer): Promise<string> {
  const server = descriptor.server
  if (descriptor.source === 'custom') {
    if (server.type !== 'stdio') throw new Error('Expected an MCP stdio server')
    const requested = server.cwd ? resolve(server.cwd) : descriptor.pluginRoot
    if (!server.cwd) await mkdir(requested, { recursive: true })
    return realpath(requested)
  }
  if (server.type !== 'stdio' || !server.cwd)
    return resolveContainedPath(descriptor.pluginRoot, descriptor.pluginRoot)

  const requested = expandPluginPath(server.cwd, descriptor)
  if (
    requested === descriptor.pluginDataRoot ||
    requested.startsWith(`${descriptor.pluginDataRoot}${sep}`)
  ) {
    await mkdir(requested, { recursive: true })
    return resolveContainedPath(descriptor.pluginDataRoot, requested)
  }
  return resolveContainedPath(descriptor.pluginRoot, requested)
}

async function resolveStdioCommand(
  descriptor: EnabledPluginMcpServer
): Promise<{ command: string; args: string[]; cwd: string; env: Record<string, string> }> {
  const server = descriptor.server
  if (server.type !== 'stdio') throw new Error('Expected an MCP stdio server')

  await mkdir(descriptor.pluginDataRoot, { recursive: true })
  const cwd = await resolveStdioCwd(descriptor)
  let command = server.command
  if (descriptor.source === 'custom' && (command.startsWith('./') || isAbsolute(command))) {
    command = await realpath(command.startsWith('./') ? resolve(cwd, command) : command)
    const commandStat = await stat(command)
    if (!commandStat.isFile()) throw new Error(`MCP command is not a file: ${server.command}`)
    await access(command)
  } else if (command.startsWith('./')) {
    command = await resolveContainedPath(
      descriptor.pluginRoot,
      resolve(descriptor.pluginRoot, command)
    )
    const commandStat = await stat(command)
    if (!commandStat.isFile()) throw new Error(`MCP command is not a file: ${server.command}`)
    await access(command)
  }

  const prepared = await preparePichuSandboxedStdioCommand({
    command,
    args: (server.args ?? []).map((value) => expandPluginVariables(value, descriptor)),
    cwd,
    allowWritePaths: [descriptor.pluginDataRoot],
    pluginDataPath: descriptor.pluginDataRoot
  })
  return {
    ...prepared,
    cwd,
    env: {
      ...getDefaultEnvironment(),
      ...Object.fromEntries(
        Object.entries(server.env ?? {}).map(([name, value]) => [
          name,
          expandPluginVariables(value, descriptor)
        ])
      ),
      PLUGIN_ROOT: descriptor.pluginRoot,
      PLUGIN_DATA: descriptor.pluginDataRoot
    }
  }
}

type CustomMcpOAuthProviderResolver = (serverId: string) => OAuthClientProvider | undefined

async function createTransport(
  descriptor: EnabledPluginMcpServer,
  resolveOAuthProvider?: CustomMcpOAuthProviderResolver
): Promise<Transport> {
  if (descriptor.server.type === 'stdio') {
    const launch = await resolveStdioCommand(descriptor)
    const transport = new StdioClientTransport({ ...launch, stderr: 'pipe' })
    transport.stderr?.on('data', () => undefined)
    return transport
  }
  const authProvider =
    descriptor.source === 'custom'
      ? resolveOAuthProvider?.(descriptor.pluginId.replace(/^custom:/, ''))
      : undefined
  if (descriptor.source === 'custom' && !authProvider) {
    throw new Error('Custom MCP authentication is unavailable')
  }
  return new StreamableHTTPClientTransport(new URL(descriptor.server.url), {
    authProvider,
    requestInit: {
      headers: descriptor.server.headers,
      redirect: 'error'
    }
  })
}

function connectionKey(descriptor: EnabledPluginMcpServer): string {
  return [
    descriptor.pluginId,
    descriptor.pluginVersion,
    descriptor.serverName,
    JSON.stringify(descriptor.server)
  ].join('\0')
}

async function connect(
  descriptor: EnabledPluginMcpServer,
  resolveOAuthProvider?: CustomMcpOAuthProviderResolver
): Promise<McpConnection> {
  const key = connectionKey(descriptor)
  const existing = connections.get(key)
  if (existing) return existing

  const pending = (async () => {
    const transport = await createTransport(descriptor, resolveOAuthProvider)
    const client = new Client({ name: 'pichu', version: '1.0.0' }, { capabilities: {} })
    try {
      await client.connect(transport, { timeout: MCP_CONNECT_TIMEOUT_MS })
      client.onclose = () => {
        if (connections.get(key) === pending) connections.delete(key)
      }
      const tools = (
        await client.listTools(undefined, { timeout: MCP_CONNECT_TIMEOUT_MS })
      ).tools.sort((left, right) => left.name.localeCompare(right.name))
      return { client, transport, tools }
    } catch (error) {
      await transport.close().catch(() => undefined)
      throw error
    }
  })()
  connections.set(key, pending)
  pending.catch(() => {
    if (connections.get(key) === pending) connections.delete(key)
  })
  return pending
}

function encodeToolNameSegment(value: string): string {
  return [...value]
    .map((character) =>
      /^[a-zA-Z0-9]$/.test(character) ? character : `_${character.codePointAt(0)?.toString(16)}_`
    )
    .join('')
}

function externalToolName(descriptor: EnabledPluginMcpServer, toolName: string): string {
  return `mcp__${encodeToolNameSegment(descriptor.pluginName)}__${encodeToolNameSegment(descriptor.serverName)}__${encodeToolNameSegment(toolName)}`
}

function stringifyUnknown(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function boundedText(value: string): string {
  if (value.length <= MAX_MCP_TEXT_CHARS) return value
  return `${value.slice(0, MAX_MCP_TEXT_CHARS)}\n[truncated ${value.length - MAX_MCP_TEXT_CHARS} characters]`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resultContent(
  result: unknown
): Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return [
      {
        type: 'text',
        text: boundedText(
          stringifyUnknown(isRecord(result) && 'toolResult' in result ? result.toolResult : result)
        )
      }
    ]
  }
  return result.content.map((item) => {
    if (!isRecord(item) || typeof item.type !== 'string') {
      return { type: 'text', text: boundedText(stringifyUnknown(item)) }
    }
    if (item.type === 'text' && typeof item.text === 'string') {
      return { type: 'text', text: boundedText(item.text) }
    }
    if (
      item.type === 'image' &&
      typeof item.data === 'string' &&
      typeof item.mimeType === 'string'
    ) {
      if (item.data.length > MAX_MCP_IMAGE_BASE64_CHARS) {
        return { type: 'text', text: `[MCP image omitted: ${item.mimeType}, payload too large]` }
      }
      return { type: 'image', data: item.data, mimeType: item.mimeType }
    }
    if (item.type === 'audio') {
      return { type: 'text', text: `[MCP audio result omitted: ${String(item.mimeType)}]` }
    }
    if (
      item.type === 'resource_link' &&
      typeof item.name === 'string' &&
      typeof item.uri === 'string'
    ) {
      return { type: 'text', text: `[MCP resource: ${item.name}](${item.uri})` }
    }
    if (!isRecord(item.resource) || typeof item.resource.uri !== 'string') {
      return { type: 'text', text: boundedText(stringifyUnknown(item)) }
    }
    if (typeof item.resource.text === 'string') {
      return { type: 'text', text: boundedText(item.resource.text) }
    }
    return {
      type: 'text',
      text: `[MCP binary resource omitted: ${item.resource.uri}${typeof item.resource.mimeType === 'string' ? ` (${item.resource.mimeType})` : ''}]`
    }
  })
}

function createAgentTool(
  descriptor: EnabledPluginMcpServer,
  tool: McpToolDescription,
  resolveOAuthProvider?: CustomMcpOAuthProviderResolver
): AgentTool {
  const parameters = tool.inputSchema as TSchema
  return {
    name: externalToolName(descriptor, tool.name),
    label: tool.title ?? tool.annotations?.title ?? tool.name,
    description:
      tool.description ??
      `MCP tool ${tool.name} from ${descriptor.pluginName}/${descriptor.serverName}.`,
    parameters,
    async execute(_toolCallId, params, signal) {
      const argumentsValue = isRecord(params) ? params : {}
      const connection = await connect(descriptor, resolveOAuthProvider)
      const result = await connection.client.callTool(
        { name: tool.name, arguments: argumentsValue },
        undefined,
        { signal }
      )
      if (isRecord(result) && result.isError === true) {
        throw new Error(
          resultContent(result)
            .map((item) => (item.type === 'text' ? item.text : '[image]'))
            .join('\n')
        )
      }
      return {
        content: resultContent(result),
        details: {
          pluginName: descriptor.pluginName,
          serverName: descriptor.serverName,
          toolName: tool.name,
          hasStructuredContent: isRecord(result) && isRecord(result.structuredContent)
        }
      }
    }
  }
}

export async function createEnabledPluginMcpToolsAsync(
  descriptors: EnabledPluginMcpServer[],
  resolveOAuthProvider?: CustomMcpOAuthProviderResolver
): Promise<AgentTool[]> {
  const tools: AgentTool[] = []
  const names = new Set<string>()
  const connected = await Promise.all(
    descriptors.map(async (descriptor) => {
      try {
        return { descriptor, connection: await connect(descriptor, resolveOAuthProvider) }
      } catch (error) {
        console.warn('[plugin-mcp] Failed to connect MCP server', {
          pluginName: descriptor.pluginName,
          serverName: descriptor.serverName,
          error: error instanceof Error ? error.message : String(error)
        })
        return null
      }
    })
  )
  for (const entry of connected) {
    if (!entry) continue
    const { descriptor, connection } = entry
    for (const tool of connection.tools) {
      const agentTool = createAgentTool(descriptor, tool, resolveOAuthProvider)
      if (names.has(agentTool.name)) {
        throw new Error(`Duplicate MCP tool name: ${agentTool.name}`)
      }
      names.add(agentTool.name)
      tools.push(agentTool)
    }
  }
  return tools.sort((left, right) => left.name.localeCompare(right.name))
}

export async function stopPluginMcpServersAsync(pluginId: string): Promise<void> {
  const prefix = `${pluginId}\0`
  const matches = [...connections.entries()].filter(([key]) => key.startsWith(prefix))
  for (const [key, pending] of matches) {
    connections.delete(key)
    const connection = await pending.catch(() => undefined)
    await connection?.client.close().catch(() => undefined)
  }
}

export async function stopCustomMcpServerAsync(serverId: string): Promise<void> {
  await stopPluginMcpServersAsync(`custom:${serverId}`)
}

export async function disposePluginMcpRuntimeAsync(): Promise<void> {
  const pending = [...connections.values()]
  connections.clear()
  for (const connectionPromise of pending) {
    const connection = await connectionPromise.catch(() => undefined)
    await connection?.client.close().catch(() => undefined)
  }
}
