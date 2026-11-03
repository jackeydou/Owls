import { isPichuThinkingLevel, type PichuThinkingLevel } from '../../shared/model-settings.js'
import {
  assertPluginAdminUploadFilePath,
  normalizePluginAdminName,
  type PluginAdminUploadVersionInput
} from '../../shared/plugin-admin.js'
import { JSON_RPC_INVALID_PARAMS, LocalRpcError } from './errors.js'

export type EmptyParams = Record<string, never>

export type SessionOpenParams = {
  sessionId: string
}

export type SessionListParams = {
  page: number
  pageSize: number
}

export type SessionNewParams = {
  prompt: string
  cwd?: string
  model?: string
  thinkingLevel?: PichuThinkingLevel
  skills?: string[]
}

export type SessionContinueParams = {
  sessionId: string
  prompt: string
}

export type SessionStatusParams = {
  sessionId?: string
}

export type SessionMessagesParams = {
  sessionId: string
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

export type PluginUploadParams = PluginAdminUploadVersionInput

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseEmptyParams(value: unknown): EmptyParams {
  if (value === undefined) return {}
  if (isRecord(value) && Object.keys(value).length === 0) return {}
  throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'Expected empty params object')
}

export function parseSessionOpenParams(value: unknown): SessionOpenParams {
  if (!isRecord(value)) {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'Expected params object')
  }
  const sessionId = typeof value.sessionId === 'string' ? value.sessionId.trim() : ''
  if (!sessionId) {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'sessionId is required')
  }
  return { sessionId }
}

function parseRequiredString(
  value: unknown,
  fieldName: string,
  options?: { trim?: boolean }
): string {
  if (typeof value !== 'string') {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, `${fieldName} is required`)
  }
  const resolved = options?.trim === false ? value : value.trim()
  if (!resolved) {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, `${fieldName} is required`)
  }
  return resolved
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'Expected string value')
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

function parsePluginAdminField<T>(parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    throw new LocalRpcError(
      JSON_RPC_INVALID_PARAMS,
      error instanceof Error ? error.message : 'Invalid plugin params'
    )
  }
}

function parsePositiveInteger(value: unknown, fieldName: string, fallback: number): number {
  if (value === undefined || value === null) return fallback
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value.trim())
        : NaN
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, `${fieldName} must be a positive integer`)
  }
  return parsed
}

export function parseSessionListParams(value: unknown): SessionListParams {
  if (value === undefined) {
    return { page: 1, pageSize: 20 }
  }
  if (!isRecord(value)) {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'Expected params object')
  }
  const page = parsePositiveInteger(value.page, 'page', 1)
  const pageSize = Math.min(parsePositiveInteger(value.pageSize, 'pageSize', 20), 100)
  return { page, pageSize }
}

export function parseSessionNewParams(value: unknown): SessionNewParams {
  if (!isRecord(value)) {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'Expected params object')
  }
  const prompt = parseRequiredString(value.prompt, 'prompt')
  const cwd = parseOptionalString(value.cwd)
  const model = parseOptionalString(value.model)
  const thinkingLevelRaw = value.thinkingLevel
  if (
    thinkingLevelRaw !== undefined &&
    (typeof thinkingLevelRaw !== 'string' || !isPichuThinkingLevel(thinkingLevelRaw))
  ) {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'Invalid thinkingLevel')
  }
  const thinkingLevel =
    typeof thinkingLevelRaw === 'string' && isPichuThinkingLevel(thinkingLevelRaw)
      ? thinkingLevelRaw
      : undefined
  let skills: string[] | undefined
  if (value.skills !== undefined) {
    if (!Array.isArray(value.skills) || value.skills.some((s) => typeof s !== 'string')) {
      throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'skills must be an array of strings')
    }
    const cleaned = (value.skills as string[]).map((s) => s.trim()).filter(Boolean)
    if (cleaned.length) skills = cleaned
  }
  return {
    prompt,
    ...(cwd ? { cwd } : {}),
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(skills ? { skills } : {})
  }
}

export function parseSessionContinueParams(value: unknown): SessionContinueParams {
  if (!isRecord(value)) {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'Expected params object')
  }
  return {
    sessionId: parseRequiredString(value.sessionId, 'sessionId'),
    prompt: parseRequiredString(value.prompt, 'prompt')
  }
}

export function parseSessionStatusParams(value: unknown): SessionStatusParams {
  if (value === undefined) return {}
  if (!isRecord(value)) {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'Expected params object')
  }
  const sessionId = parseOptionalString(value.sessionId)
  return sessionId ? { sessionId } : {}
}

export function parseSessionMessagesParams(value: unknown): SessionMessagesParams {
  if (!isRecord(value)) {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'Expected params object')
  }
  return {
    sessionId: parseRequiredString(value.sessionId, 'sessionId')
  }
}

export function parsePluginInstallParams(value: unknown): PluginInstallParams {
  if (!isRecord(value)) {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'Expected params object')
  }
  return {
    marketplaceName: parseRequiredString(value.marketplaceName, 'marketplaceName'),
    pluginName: parseRequiredString(value.pluginName, 'pluginName')
  }
}

export function parsePluginUninstallParams(value: unknown): PluginUninstallParams {
  if (!isRecord(value)) {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'Expected params object')
  }
  return {
    pluginName: parseRequiredString(value.pluginName, 'pluginName')
  }
}

export function parsePluginInstallLocalParams(value: unknown): PluginInstallLocalParams {
  if (!isRecord(value)) {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'Expected params object')
  }
  return {
    sourcePath: parseRequiredString(value.sourcePath, 'sourcePath')
  }
}

export function parsePluginUploadParams(value: unknown): PluginUploadParams {
  if (!isRecord(value)) {
    throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, 'Expected params object')
  }
  const category = parseOptionalString(value.category)
  const pluginName = parsePluginAdminField(() =>
    normalizePluginAdminName(parseRequiredString(value.pluginName, 'pluginName'))
  )
  const filePath = parsePluginAdminField(() =>
    assertPluginAdminUploadFilePath(parseRequiredString(value.filePath, 'filePath'))
  )
  return {
    pluginName,
    filePath,
    ...(category ? { category } : {})
  }
}
