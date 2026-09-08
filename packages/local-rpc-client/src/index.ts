import { readFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type JsonRpcId = string | number | null

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type LocalRpcMetadata = {
  version: number
  transport: 'unix'
  endpoint: string
  protocol: string
  framing: string
  pid: number | null
  startedAt: string | null
}

export type LocalRpcClientOptions = {
  socketPath?: string
  metadataPath?: string
  dataRoot?: string
  timeoutMs?: number
  maxResponseBytes?: number
}

export type LocalRpcCallOptions = {
  id?: JsonRpcId
  timeoutMs?: number
  maxResponseBytes?: number
}

export type LocalRpcAppStatus = {
  ready: boolean
  authenticated: boolean
  rendererReady: boolean
  hasMainWindow: boolean
  hasAuthWindow: boolean
  currentSessionId: string | null
}

export type AgentStatusSnapshot = {
  hasSession: boolean
  sessionId: string | null
  runningSessionIds: string[]
  waitingSessionIds: string[]
  activeRunIdsBySession: Record<string, string>
  activeRunStartedAtsBySession: Record<string, string>
  runStatusBySession: Record<string, 'idle' | 'running' | 'waiting_for_user'>
  waitingInputIdBySession: Record<string, string>
  modelId: string | null
}

export type SessionIndexEntry = {
  sessionId: string
  agentId: string
  cwd: string
  title: string
  createdAt: string
  updatedAt: string
  pinned?: boolean
  pinnedOrder?: number
  sessionModelId?: string | null
  sessionThinkingLevel?: string | null
  sessionModelUpdatedAt?: string | null
  sessionModelUpdatedBy?: string | null
}

export type MessageRow = {
  id: string
  sessionId: string
  runId?: string | null
  role: 'user' | 'assistant' | 'system' | 'tool'
  kind?: string | null
  content: string
  agentContent: string
  visibility: string
  sortOrder: number
  createdAt: string
  toolCallId?: string | null
  toolName?: string | null
  toolCallResult?: string | null
  attachmentsJson?: string | null
  modelId?: string | null
  modelProvider?: string | null
  modelApi?: string | null
  modelUsageJson?: string | null
  parts?: unknown[]
}

export type SessionListParams = {
  page?: number
  pageSize?: number
}

export type SessionListResult = {
  page: number
  pageSize: number
  total: number
  sessions: SessionIndexEntry[]
}

export type SessionNewParams = {
  prompt: string
  cwd?: string
  model?: string
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  /** Qualified skill names to force-invoke (inlines each SKILL.md into the prompt). */
  skills?: string[]
}

export type SessionContinueParams = {
  sessionId: string
  prompt: string
}

export type SessionAcceptedResult = {
  accepted: true
  sessionId: string
}

export type SessionStatusParams = {
  sessionId?: string
}

export type SessionStatusView = {
  sessionId: string | null
  status: 'idle' | 'running' | 'waiting_for_user'
  activeRunId: string | null
  activeRunStartedAt: string | null
  waitingInputId: string | null
}

export type SessionMessagesParams = {
  sessionId: string
}

export type PluginMarketplaceEntry = Record<string, unknown>
export type InstalledPlugin = Record<string, unknown>

export type PluginListResult = {
  available: PluginMarketplaceEntry[]
  installed: InstalledPlugin[]
}

export type PluginInstallParams = {
  marketplaceName: string
  pluginName: string
}

export type PluginUninstallParams = {
  pluginName: string
}

export type PluginInstallLocalParams = {
  sourcePath: string
}

export type PluginUploadParams = {
  pluginName: string
  filePath: string
  category?: string
}

export type PluginLocalUploadResult = {
  localDev: true
  pluginName: string
  version: string
  marketplaceName: string
  sourcePath: string
  installedPluginId: string
  packageSha256: string
  packageSizeBytes: number
  uploadedAt: string
}

export type PluginUploadResult = PluginLocalUploadResult

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

type JsonRpcErrorPayload = {
  code: number
  message: string
  data?: unknown
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
export const PLUGIN_ADMIN_RPC_TIMEOUT_MS = 120_000

let nextRequestId = 1

export class PichuLocalRpcError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(error: JsonRpcErrorPayload) {
    super(error.message)
    this.name = 'PichuLocalRpcError'
    this.code = error.code
    this.data = error.data
  }
}

export class PichuLocalRpcConnectionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PichuLocalRpcConnectionError'
  }
}

export function defaultPichuDataRoot(): string {
  return join(homedir(), '.pichu')
}

export function localRpcMetadataPath(dataRoot = defaultPichuDataRoot()): string {
  return join(dataRoot, 'run', 'local-rpc.json')
}

function createRequestId(): string {
  const id = nextRequestId
  nextRequestId += 1
  return `pichu-local-rpc-${Date.now()}-${id}`
}

function assertRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PichuLocalRpcConnectionError(message)
  }
  return value as Record<string, unknown>
}

export async function readLocalRpcMetadata(
  options: { dataRoot?: string; metadataPath?: string } = {}
): Promise<LocalRpcMetadata> {
  const metadataPath = options.metadataPath ?? localRpcMetadataPath(options.dataRoot)
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(metadataPath, 'utf8')) as unknown
  } catch (error) {
    throw new PichuLocalRpcConnectionError(
      `Failed to read Owls local RPC metadata at ${metadataPath}`,
      { cause: error }
    )
  }

  const metadata = assertRecord(parsed, 'Invalid Owls local RPC metadata')
  if (metadata.transport !== 'unix') {
    throw new PichuLocalRpcConnectionError(
      `Unsupported Owls local RPC transport: ${String(metadata.transport)}`
    )
  }
  if (typeof metadata.endpoint !== 'string' || !metadata.endpoint.trim()) {
    throw new PichuLocalRpcConnectionError('Owls local RPC metadata is missing endpoint')
  }

  return {
    version: typeof metadata.version === 'number' ? metadata.version : 1,
    transport: 'unix',
    endpoint: metadata.endpoint,
    protocol: typeof metadata.protocol === 'string' ? metadata.protocol : 'jsonrpc-2.0',
    framing: typeof metadata.framing === 'string' ? metadata.framing : 'ndjson',
    pid: typeof metadata.pid === 'number' ? metadata.pid : null,
    startedAt: typeof metadata.startedAt === 'string' ? metadata.startedAt : null
  }
}

function parseJsonRpcResponse(frame: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(frame) as unknown
  } catch (error) {
    throw new PichuLocalRpcConnectionError('Invalid JSON-RPC response from Owls Client', {
      cause: error
    })
  }

  const response = assertRecord(parsed, 'Invalid JSON-RPC response from Owls Client')
  if (response.jsonrpc !== '2.0') {
    throw new PichuLocalRpcConnectionError('Invalid JSON-RPC version from Owls Client')
  }
  if ('error' in response) {
    const error = assertRecord(response.error, 'Invalid JSON-RPC error from Owls Client')
    throw new PichuLocalRpcError({
      code: typeof error.code === 'number' ? error.code : -32603,
      message: typeof error.message === 'string' ? error.message : 'Owls local RPC error',
      data: error.data
    })
  }
  return response.result
}

export class PichuLocalRpcClient {
  private readonly socketPath?: string
  private readonly metadataPath?: string
  private readonly dataRoot?: string
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number

  constructor(options: LocalRpcClientOptions = {}) {
    this.socketPath = options.socketPath
    this.metadataPath = options.metadataPath
    this.dataRoot = options.dataRoot
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  }

  metadata(): Promise<LocalRpcMetadata> {
    return readLocalRpcMetadata({
      dataRoot: this.dataRoot,
      metadataPath: this.metadataPath
    })
  }

  async endpoint(): Promise<string> {
    if (this.socketPath?.trim()) return this.socketPath
    return (await this.metadata()).endpoint
  }

  async call<TResult = unknown>(
    method: string,
    params: unknown = {},
    options: LocalRpcCallOptions = {}
  ): Promise<TResult> {
    if (typeof method !== 'string' || !method.trim()) {
      throw new PichuLocalRpcConnectionError('Local RPC method is required')
    }
    const socketPath = await this.endpoint()
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: options.id ?? createRequestId(),
      method: method.trim(),
      ...(params === undefined ? {} : { params })
    }
    return sendJsonRpcRequest<TResult>(socketPath, request, {
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      maxResponseBytes: options.maxResponseBytes ?? this.maxResponseBytes
    })
  }

  discover(): Promise<{ protocolVersion: number; appName: string; methods: string[] }> {
    return this.call('rpc.discover', {})
  }

  diagnostics(): Promise<Record<string, unknown>> {
    return this.call('rpc.diagnostics', {})
  }

  appStatus(): Promise<LocalRpcAppStatus> {
    return this.call('app.status', {})
  }

  focusApp(): Promise<{ focused: true }> {
    return this.call('app.focus', {})
  }

  agentStatus(): Promise<AgentStatusSnapshot> {
    return this.call('agent.status', {})
  }

  sessionList(params: SessionListParams = {}): Promise<SessionListResult> {
    return this.call('session.list', {
      page: params.page ?? DEFAULT_PAGE,
      pageSize: params.pageSize ?? DEFAULT_PAGE_SIZE
    })
  }

  sessionNew(params: SessionNewParams): Promise<SessionAcceptedResult> {
    return this.call('session.new', params)
  }

  sessionContinue(params: SessionContinueParams): Promise<SessionAcceptedResult> {
    return this.call('session.continue', params)
  }

  sessionStatus(params: SessionStatusParams = {}): Promise<SessionStatusView> {
    return this.call('session.status', params)
  }

  sessionMessages(params: SessionMessagesParams): Promise<MessageRow[]> {
    return this.call('session.messages', params)
  }

  pluginList(): Promise<PluginListResult> {
    return this.call('plugin.list', {})
  }

  pluginInstall(params: PluginInstallParams): Promise<InstalledPlugin> {
    return this.call('plugin.install', params)
  }

  pluginInstallLocal(params: PluginInstallLocalParams): Promise<InstalledPlugin> {
    return this.call('plugin.installLocal', params)
  }

  pluginUpload(params: PluginUploadParams): Promise<PluginUploadResult> {
    return this.call('plugin.upload', params, {
      timeoutMs: PLUGIN_ADMIN_RPC_TIMEOUT_MS
    })
  }

  pluginUninstall(params: PluginUninstallParams): Promise<{ uninstalled: boolean }> {
    return this.call('plugin.uninstall', params)
  }
}

export function createPichuLocalRpcClient(
  options: LocalRpcClientOptions = {}
): PichuLocalRpcClient {
  return new PichuLocalRpcClient(options)
}

export function callPichuLocalRpc<TResult = unknown>(
  method: string,
  params: unknown = {},
  options: LocalRpcClientOptions & LocalRpcCallOptions = {}
): Promise<TResult> {
  return new PichuLocalRpcClient(options).call<TResult>(method, params, options)
}

function sendJsonRpcRequest<TResult>(
  socketPath: string,
  request: JsonRpcRequest,
  options: { timeoutMs: number; maxResponseBytes: number }
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    let responseBytes = 0
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
    }

    const settle = <T>(fn: (value: T) => void, value: T): void => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }

    const fail = (error: unknown): void => {
      settle(reject, error)
    }

    timer = setTimeout(() => {
      fail(
        new PichuLocalRpcConnectionError(`Owls local RPC timed out after ${options.timeoutMs}ms`)
      )
    }, options.timeoutMs)

    socket.setEncoding('utf8')
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on('data', (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      responseBytes += Buffer.byteLength(text)
      if (responseBytes > options.maxResponseBytes) {
        fail(new PichuLocalRpcConnectionError('Owls local RPC response exceeded maxResponseBytes'))
        return
      }

      buffer += text
      while (!settled) {
        const newlineIndex = buffer.indexOf('\n')
        if (newlineIndex < 0) return

        const frame = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (!frame) continue

        try {
          settle(resolve, parseJsonRpcResponse(frame) as TResult)
        } catch (error) {
          fail(error)
        }
      }
    })
    socket.on('error', (error) => {
      fail(
        new PichuLocalRpcConnectionError('Failed to connect to Owls local RPC socket', {
          cause: error
        })
      )
    })
    socket.on('end', () => {
      if (!settled) {
        fail(new PichuLocalRpcConnectionError('Owls local RPC socket closed before a response'))
      }
    })
  })
}
