export const JSON_RPC_PARSE_ERROR = -32700
export const JSON_RPC_INVALID_REQUEST = -32600
export const JSON_RPC_METHOD_NOT_FOUND = -32601
export const JSON_RPC_INVALID_PARAMS = -32602
export const JSON_RPC_INTERNAL_ERROR = -32603

export const LOCAL_RPC_APP_NOT_READY = -32001
export const LOCAL_RPC_UNAUTHORIZED = -32002
export const LOCAL_RPC_CONFLICT = -32003
export const LOCAL_RPC_TIMEOUT = -32004
export const LOCAL_RPC_REQUEST_TOO_LARGE = -32005
export const LOCAL_RPC_METHOD_DISABLED = -32006
export const LOCAL_RPC_OPERATION_CANCELLED = -32007

export class LocalRpcError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'LocalRpcError'
    this.code = code
    this.data = data
  }
}

export function toLocalRpcError(error: unknown): LocalRpcError {
  if (error instanceof LocalRpcError) return error
  if (error instanceof Error) {
    return new LocalRpcError(JSON_RPC_INTERNAL_ERROR, error.message)
  }
  return new LocalRpcError(JSON_RPC_INTERNAL_ERROR, 'Internal error')
}
