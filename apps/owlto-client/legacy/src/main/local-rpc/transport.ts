export type LocalRpcTransportKind = 'unix' | 'windows-named-pipe'

export type LocalRpcTransportMetadata = {
  version: 1
  transport: LocalRpcTransportKind
  endpoint: string
  protocol: 'jsonrpc-2.0'
  framing: 'ndjson'
  pid: number
  startedAt: string
}

export type LocalRpcTransportDiagnostics = {
  enabled: boolean
  endpoint: string | null
  clientCount: number
  startedAt: string | null
  lastError?: string
}

export type LocalRpcConnection = {
  id: string
  remoteLabel: string
  write: (frame: string) => Promise<void>
  close: () => void
  onFrame: (listener: (frame: string) => void) => () => void
  onClose: (listener: () => void) => () => void
}

export type LocalRpcTransport = {
  start: (handlers: {
    onConnection: (connection: LocalRpcConnection) => void
    onError: (error: Error) => void
  }) => Promise<LocalRpcTransportMetadata>
  stop: () => Promise<void>
  diagnostics: () => LocalRpcTransportDiagnostics
}
