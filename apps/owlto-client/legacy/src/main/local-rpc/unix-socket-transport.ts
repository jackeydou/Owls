import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { dirname } from 'node:path'
import type {
  LocalRpcConnection,
  LocalRpcTransport,
  LocalRpcTransportDiagnostics,
  LocalRpcTransportMetadata
} from './transport.js'

const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024
const STALE_SOCKET_PROBE_MS = 250

type UnixSocketTransportOptions = {
  socketPath: string
  metadataPath: string
  maxFrameBytes?: number
}

type TransportState = {
  server: Server | null
  connections: Map<string, UnixSocketConnection>
  metadata: LocalRpcTransportMetadata | null
  lastError?: string
}

let nextConnectionId = 0

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function isStaleSocketError(error: unknown): boolean {
  return (
    isNodeError(error) &&
    (error.code === 'ECONNREFUSED' || error.code === 'ENOENT' || error.code === 'ENOTSOCK')
  )
}

async function probeExistingSocket(socketPath: string): Promise<'active' | 'stale'> {
  if (!existsSync(socketPath)) return 'stale'

  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`Timed out probing existing local RPC socket: ${socketPath}`))
    }, STALE_SOCKET_PROBE_MS)

    socket.once('connect', () => {
      clearTimeout(timer)
      socket.end()
      resolve('active')
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      socket.destroy()
      if (isStaleSocketError(error)) {
        resolve('stale')
        return
      }
      reject(error)
    })
  })
}

class UnixSocketConnection implements LocalRpcConnection {
  readonly id: string
  readonly remoteLabel: string

  private buffer = Buffer.alloc(0)
  private closed = false
  private frameListeners = new Set<(frame: string) => void>()
  private closeListeners = new Set<() => void>()

  constructor(
    private readonly socket: Socket,
    private readonly maxFrameBytes: number,
    private readonly onFrameTooLarge: (connection: UnixSocketConnection) => void,
    private readonly onClosed: (connection: UnixSocketConnection) => void
  ) {
    nextConnectionId += 1
    this.id = `conn_${Date.now()}_${nextConnectionId}`
    this.remoteLabel = 'local'

    socket.on('data', (chunk) => this.consume(chunk))
    socket.once('close', () => this.handleClose())
    socket.once('error', () => this.handleClose())
  }

  write(frame: string): Promise<void> {
    if (this.closed) return Promise.resolve()
    const payload = `${frame}\n`
    return new Promise((resolve, reject) => {
      this.socket.write(payload, 'utf8', (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  close(): void {
    if (this.closed) return
    this.socket.end()
    setTimeout(() => {
      if (!this.closed) {
        this.socket.destroy()
      }
    }, 500).unref()
  }

  onFrame(listener: (frame: string) => void): () => void {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => {
      this.closeListeners.delete(listener)
    }
  }

  private consume(chunk: Buffer): void {
    if (this.closed) return
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const newlineIndex = this.buffer.indexOf(10)
      if (newlineIndex === -1) {
        if (this.buffer.length > this.maxFrameBytes) {
          this.onFrameTooLarge(this)
        }
        return
      }

      const frame = this.buffer.subarray(0, newlineIndex)
      this.buffer = this.buffer.subarray(newlineIndex + 1)
      if (frame.length > this.maxFrameBytes) {
        this.onFrameTooLarge(this)
        return
      }
      const text = frame.toString('utf8').trim()
      if (!text) continue
      for (const listener of this.frameListeners) {
        listener(text)
      }
    }
  }

  private handleClose(): void {
    if (this.closed) return
    this.closed = true
    this.onClosed(this)
    for (const listener of this.closeListeners) {
      listener()
    }
    this.frameListeners.clear()
    this.closeListeners.clear()
  }
}

export function createUnixSocketTransport(options: UnixSocketTransportOptions): LocalRpcTransport {
  const state: TransportState = {
    server: null,
    connections: new Map(),
    metadata: null
  }
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES

  async function removeOwnedFiles(): Promise<void> {
    await Promise.allSettled([
      rm(options.socketPath, { force: true }),
      rm(options.metadataPath, { force: true })
    ])
  }

  async function closeServer(server: Server): Promise<void> {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    }).catch(() => undefined)
  }

  async function closeAndRemoveOwnedFiles(server: Server): Promise<void> {
    for (const connection of state.connections.values()) {
      connection.close()
    }
    state.connections.clear()
    await closeServer(server)
    await removeOwnedFiles()
  }

  return {
    async start(handlers) {
      if (state.server?.listening && state.metadata) return state.metadata

      await mkdir(dirname(options.socketPath), { recursive: true, mode: 0o700 })
      await chmod(dirname(options.socketPath), 0o700)

      const probeResult = await probeExistingSocket(options.socketPath)
      if (probeResult === 'active') {
        throw new Error(`Local RPC socket is already active: ${options.socketPath}`)
      }
      await rm(options.socketPath, { force: true })

      const server = createServer((socket) => {
        const connection = new UnixSocketConnection(
          socket,
          maxFrameBytes,
          (oversizedConnection) => {
            handlers.onError(
              new Error(
                `Local RPC frame exceeded ${maxFrameBytes} bytes on ${oversizedConnection.id}`
              )
            )
            oversizedConnection.close()
          },
          (closedConnection) => {
            state.connections.delete(closedConnection.id)
          }
        )
        state.connections.set(connection.id, connection)
        handlers.onConnection(connection)
      })

      server.on('error', (error) => {
        state.lastError = describeError(error)
        handlers.onError(error)
      })

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(options.socketPath, () => {
          server.off('error', reject)
          resolve()
        })
      })

      state.server = server
      try {
        await chmod(options.socketPath, 0o600)
      } catch (error) {
        state.lastError = describeError(error)
        await closeAndRemoveOwnedFiles(server)
        state.server = null
        const permissionError =
          error instanceof Error ? error : new Error(`Failed to secure local RPC socket: ${error}`)
        handlers.onError(permissionError)
        throw permissionError
      }

      const metadata: LocalRpcTransportMetadata = {
        version: 1,
        transport: 'unix',
        endpoint: options.socketPath,
        protocol: 'jsonrpc-2.0',
        framing: 'ndjson',
        pid: process.pid,
        startedAt: new Date().toISOString()
      }
      try {
        await writeFile(options.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
          encoding: 'utf8',
          mode: 0o600
        })
        await chmod(options.metadataPath, 0o600)
      } catch (error) {
        state.lastError = describeError(error)
        await closeAndRemoveOwnedFiles(server)
        state.server = null
        state.metadata = null
        const metadataError =
          error instanceof Error ? error : new Error(`Failed to write local RPC metadata: ${error}`)
        handlers.onError(metadataError)
        throw metadataError
      }
      state.metadata = metadata
      return metadata
    },

    async stop() {
      const server = state.server
      state.server = null
      for (const connection of state.connections.values()) {
        connection.close()
      }
      state.connections.clear()
      if (server) {
        await closeServer(server)
      }
      state.metadata = null
      await removeOwnedFiles()
    },

    diagnostics(): LocalRpcTransportDiagnostics {
      return {
        enabled: state.server?.listening === true,
        endpoint: state.metadata?.endpoint ?? null,
        clientCount: state.connections.size,
        startedAt: state.metadata?.startedAt ?? null,
        ...(state.lastError ? { lastError: state.lastError } : {})
      }
    }
  }
}
