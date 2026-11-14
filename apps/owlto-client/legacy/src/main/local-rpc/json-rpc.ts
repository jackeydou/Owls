import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  LocalRpcError,
  toLocalRpcError
} from './errors.js'

export type JsonRpcId = string | number | null

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: unknown
}

export type JsonRpcSuccessResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export type JsonRpcErrorResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidId(value: unknown): value is JsonRpcId {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

export function parseJsonRpcRequest(frame: string): JsonRpcRequest {
  let parsed: unknown
  try {
    parsed = JSON.parse(frame) as unknown
  } catch {
    throw new LocalRpcError(JSON_RPC_PARSE_ERROR, 'Parse error')
  }

  if (Array.isArray(parsed)) {
    throw new LocalRpcError(JSON_RPC_INVALID_REQUEST, 'Batch requests are not supported')
  }

  if (!isRecord(parsed) || parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
    throw new LocalRpcError(JSON_RPC_INVALID_REQUEST, 'Invalid request')
  }

  const id = parsed.id
  if ('id' in parsed && !isValidId(id)) {
    throw new LocalRpcError(JSON_RPC_INVALID_REQUEST, 'Invalid request id')
  }
  const resolvedId = 'id' in parsed && isValidId(id) ? id : undefined

  const method = parsed.method.trim()
  if (!method) {
    throw new LocalRpcError(JSON_RPC_INVALID_REQUEST, 'Invalid request method')
  }

  return {
    jsonrpc: '2.0',
    id: resolvedId,
    method,
    params: parsed.params
  }
}

export function successResponse(id: JsonRpcId, result: unknown): JsonRpcSuccessResponse {
  return {
    jsonrpc: '2.0',
    id,
    result
  }
}

export function errorResponse(id: JsonRpcId, error: unknown): JsonRpcErrorResponse {
  const rpcError = toLocalRpcError(error)
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: rpcError.code,
      message:
        rpcError.code === JSON_RPC_INTERNAL_ERROR && !rpcError.message
          ? 'Internal error'
          : rpcError.message,
      ...(rpcError.data === undefined ? {} : { data: rpcError.data })
    }
  }
}

export function methodNotFoundResponse(id: JsonRpcId, method: string): JsonRpcErrorResponse {
  return errorResponse(
    id,
    new LocalRpcError(JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${method}`)
  )
}

export function serializeJsonRpcResponse(response: JsonRpcResponse): string {
  return JSON.stringify(response)
}
