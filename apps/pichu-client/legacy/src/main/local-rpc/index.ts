import { join } from 'node:path'
import { LocalRpcCommandRegistry } from './command-registry.js'
import { registerAgentLocalRpcCommands } from './commands/agent.js'
import { registerAppLocalRpcCommands } from './commands/app.js'
import { registerBackgroundTerminalLocalRpcCommands } from './commands/background-terminals.js'
import { registerBrowserLocalRpcCommands } from './commands/browser.js'
import { registerPluginLocalRpcCommands } from './commands/plugins.js'
import { registerSessionLocalRpcCommands } from './commands/sessions.js'
import {
  errorResponse,
  type JsonRpcRequest,
  methodNotFoundResponse,
  parseJsonRpcRequest,
  serializeJsonRpcResponse,
  successResponse
} from './json-rpc.js'
import { type EmptyParams, parseEmptyParams } from './schemas.js'
import type { LocalRpcConnection, LocalRpcTransport } from './transport.js'
import type { LocalRpcContext } from './types.js'
import { createUnixSocketTransport } from './unix-socket-transport.js'

const LOCAL_RPC_RUN_DIR = 'run'
const LOCAL_RPC_SOCKET_FILENAME = 'pichu.sock'
const LOCAL_RPC_METADATA_FILENAME = 'local-rpc.json'

let transport: LocalRpcTransport | null = null
let pendingRequests = 0

function logLocalRpcError(message: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(`[local-rpc] ${message}:`, error.message)
    return
  }
  console.error(`[local-rpc] ${message}:`, String(error))
}

function registerCoreCommands(
  registry: LocalRpcCommandRegistry<LocalRpcContext>,
  context: LocalRpcContext
): void {
  registry.register<EmptyParams, { protocolVersion: 1; appName: string; methods: string[] }>({
    method: 'rpc.discover',
    description: 'Return local RPC protocol and method metadata.',
    parseParams: parseEmptyParams,
    run: () => ({
      protocolVersion: 1,
      appName: context.appName,
      methods: registry.methods()
    })
  })

  registry.register<EmptyParams, ReturnType<LocalRpcContext['getDiagnostics']>>({
    method: 'rpc.diagnostics',
    description: 'Return local RPC transport diagnostics.',
    parseParams: parseEmptyParams,
    run: (_, commandContext) => commandContext.getDiagnostics()
  })
}

async function writeResponse(connection: LocalRpcConnection, response: string): Promise<void> {
  try {
    await connection.write(response)
  } catch (error) {
    logLocalRpcError(`failed to write response for ${connection.id}`, error)
  }
}

function installConnectionHandler(
  connection: LocalRpcConnection,
  registry: LocalRpcCommandRegistry<LocalRpcContext>,
  context: LocalRpcContext
): void {
  connection.onFrame((frame) => {
    void handleFrame(connection, frame, registry, context)
  })
}

async function handleFrame(
  connection: LocalRpcConnection,
  frame: string,
  registry: LocalRpcCommandRegistry<LocalRpcContext>,
  context: LocalRpcContext
): Promise<void> {
  let request: JsonRpcRequest
  try {
    request = parseJsonRpcRequest(frame)
  } catch (error) {
    await writeResponse(connection, serializeJsonRpcResponse(errorResponse(null, error)))
    return
  }

  const isNotification = request.id === undefined
  if (!registry.has(request.method)) {
    if (!isNotification) {
      await writeResponse(
        connection,
        serializeJsonRpcResponse(methodNotFoundResponse(request.id ?? null, request.method))
      )
    }
    return
  }

  pendingRequests += 1
  try {
    const result = await registry.run(request.method, request.params, context)
    if (!isNotification) {
      await writeResponse(
        connection,
        serializeJsonRpcResponse(successResponse(request.id ?? null, result))
      )
    }
  } catch (error) {
    if (!isNotification) {
      await writeResponse(
        connection,
        serializeJsonRpcResponse(errorResponse(request.id ?? null, error))
      )
    }
  } finally {
    pendingRequests -= 1
  }
}

export async function startLocalRpc(
  dataRoot: string,
  context: Omit<LocalRpcContext, 'getDiagnostics'>
): Promise<void> {
  if (transport) return
  if (process.platform === 'win32') {
    console.info('[local-rpc] Windows named pipe transport is not implemented; local RPC disabled')
    return
  }

  const runDir = join(dataRoot, LOCAL_RPC_RUN_DIR)
  const nextTransport = createUnixSocketTransport({
    socketPath: join(runDir, LOCAL_RPC_SOCKET_FILENAME),
    metadataPath: join(runDir, LOCAL_RPC_METADATA_FILENAME)
  })
  const registry = new LocalRpcCommandRegistry<LocalRpcContext>()
  const fullContext: LocalRpcContext = {
    ...context,
    getDiagnostics: () => ({
      ...nextTransport.diagnostics(),
      pendingRequests
    })
  }

  registerCoreCommands(registry, fullContext)
  registerAppLocalRpcCommands(registry)
  registerBackgroundTerminalLocalRpcCommands(registry)
  registerAgentLocalRpcCommands(registry)
  registerSessionLocalRpcCommands(registry)
  registerPluginLocalRpcCommands(registry)
  registerBrowserLocalRpcCommands(registry)

  try {
    const metadata = await nextTransport.start({
      onConnection: (connection) => installConnectionHandler(connection, registry, fullContext),
      onError: (error) => logLocalRpcError('transport error', error)
    })
    transport = nextTransport
    console.info('[local-rpc] server started', {
      transport: metadata.transport,
      endpoint: metadata.endpoint
    })
  } catch (error) {
    logLocalRpcError('failed to start server', error)
  }
}

export async function disposeLocalRpc(): Promise<void> {
  const currentTransport = transport
  transport = null
  if (!currentTransport) return
  try {
    await currentTransport.stop()
    console.info('[local-rpc] server stopped')
  } catch (error) {
    logLocalRpcError('failed to stop server', error)
  }
}
