import { safeStorage } from 'electron'
import { IMAGE_GENERATION_MODEL } from '../../shared/image-generation-config.js'
import {
  isModelApiSpec,
  resolveConfiguredModelId,
  type UserModelConfig,
  type UserModelSummary
} from '../../shared/model-config.js'
import type { OpenAIOAuthModel } from '../../shared/openai-oauth.js'
import { hasOpenAIOAuthCredential, listOpenAIOAuthChatModels } from '../openai-oauth.js'
import { deleteStoredSetting, getStoredSetting, setStoredSetting } from './settings-store.js'

const MODELS_SETTING_KEY = 'userModels'
const OPENAI_OAUTH_ENABLED_MODELS_SETTING_KEY = 'openAiOAuthEnabledModels'
const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_TOKENS = 16_384

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function positiveInteger(value: unknown, fallback: number, label: string): number {
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'number' || !Number.isInteger(resolved) || resolved <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return resolved
}

function normalizeModel(value: unknown): UserModelConfig {
  if (!value || typeof value !== 'object') throw new Error('Model configuration is invalid')
  const input = value as Record<string, unknown>
  const id = requiredString(input.id, 'Model ID')
  const name = requiredString(input.name, 'Display name')
  if (!isModelApiSpec(input.api)) throw new Error('API specification is not supported')
  if (input.api === 'openai-codex-responses') {
    throw new Error('OpenAI Codex models are managed through OpenAI OAuth')
  }
  const baseUrl = requiredString(input.baseUrl, 'Base URL').replace(/\/+$/, '')
  const url = new URL(baseUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Base URL must use http or https')
  }
  return {
    id,
    name,
    api: input.api,
    baseUrl,
    apiKey: typeof input.apiKey === 'string' ? input.apiKey.trim() : '',
    contextWindow: positiveInteger(input.contextWindow, DEFAULT_CONTEXT_WINDOW, 'Context window'),
    maxTokens: positiveInteger(input.maxTokens, DEFAULT_MAX_TOKENS, 'Maximum output tokens'),
    reasoning: input.reasoning === true,
    supportsImages: input.supportsImages === true,
    source: 'custom'
  }
}

function decryptApiKey(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return ''
  }
}

function serializeModels(models: UserModelConfig[]): string {
  return JSON.stringify(
    models.map(({ apiKey, ...model }) => ({
      ...model,
      apiKeyEncrypted: apiKey ? safeStorage.encryptString(apiKey).toString('base64') : ''
    }))
  )
}

function getStoredUserModelConfigs(): UserModelConfig[] {
  const stored = getStoredSetting(MODELS_SETTING_KEY)
  if (!stored) return []
  try {
    const values: unknown = JSON.parse(stored)
    if (!Array.isArray(values)) return []
    const models: UserModelConfig[] = []
    for (const value of values) {
      try {
        const stored = value as Record<string, unknown>
        const model = normalizeModel({ ...stored, apiKey: decryptApiKey(stored.apiKeyEncrypted) })
        if (!models.some((candidate) => candidate.id === model.id)) models.push(model)
      } catch {
        // Ignore malformed entries while preserving every valid user model.
      }
    }
    return models
  } catch {
    return []
  }
}

function getOpenAIOAuthEnabledModelIds(): string[] {
  const stored = getStoredSetting(OPENAI_OAUTH_ENABLED_MODELS_SETTING_KEY)
  if (!stored) return []
  try {
    const value: unknown = JSON.parse(stored)
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id)))]
      : []
  } catch {
    return []
  }
}

function openAIOAuthModelConfigs(): UserModelConfig[] {
  if (!hasOpenAIOAuthCredential()) return []
  const enabled = new Set(getOpenAIOAuthEnabledModelIds())
  return listOpenAIOAuthChatModels().flatMap((model): UserModelConfig[] => {
    if (!enabled.has(model.id) || model.api !== 'openai-codex-responses') return []
    return [
      {
        id: model.id,
        name: model.name,
        api: 'openai-codex-responses',
        baseUrl: model.baseUrl,
        apiKey: '',
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        reasoning: model.reasoning,
        supportsImages: model.input.includes('image'),
        source: 'openai-oauth'
      }
    ]
  })
}

export function getUserModelConfigs(): UserModelConfig[] {
  const custom = getStoredUserModelConfigs()
  const customIds = new Set(custom.map((model) => model.id))
  return [...custom, ...openAIOAuthModelConfigs().filter((model) => !customIds.has(model.id))]
}

export function listOpenAIOAuthModels(): OpenAIOAuthModel[] {
  const enabled = new Set(getOpenAIOAuthEnabledModelIds())
  return [
    ...listOpenAIOAuthChatModels().map((model) => ({
      id: model.id,
      name: model.name,
      kind: 'chat' as const,
      enabled: enabled.has(model.id)
    })),
    {
      id: IMAGE_GENERATION_MODEL,
      name: 'GPT Image 2',
      kind: 'image' as const,
      enabled: enabled.has(IMAGE_GENERATION_MODEL)
    }
  ]
}

export function isOpenAIOAuthModelEnabled(modelId: string): boolean {
  return getOpenAIOAuthEnabledModelIds().includes(modelId)
}

export function setOpenAIOAuthEnabledModels(value: unknown): OpenAIOAuthModel[] {
  if (!hasOpenAIOAuthCredential()) throw new Error('Sign in with OpenAI before enabling models')
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) {
    throw new Error('Enabled OpenAI model IDs must be an array of strings')
  }
  const availableIds = new Set(listOpenAIOAuthModels().map((model) => model.id))
  const enabledIds = [...new Set(value)].filter((id) => availableIds.has(id)).sort()
  const customIds = new Set(getStoredUserModelConfigs().map((model) => model.id))
  const duplicate = enabledIds.find((id) => id !== IMAGE_GENERATION_MODEL && customIds.has(id))
  if (duplicate) {
    throw new Error(`Remove the custom ${duplicate} model before enabling its OpenAI OAuth version`)
  }
  setStoredSetting(OPENAI_OAUTH_ENABLED_MODELS_SETTING_KEY, JSON.stringify(enabledIds))
  const selected = getStoredSetting('model')?.trim()
  const configuredIds = getUserModelConfigs().map((model) => model.id)
  const nextSelected = resolveConfiguredModelId(selected, configuredIds)
  if (nextSelected) setStoredSetting('model', nextSelected)
  else deleteStoredSetting('model')
  return listOpenAIOAuthModels()
}

export function listUserModelSummaries(): UserModelSummary[] {
  return getUserModelConfigs().map(({ apiKey, ...model }) => ({
    ...model,
    hasApiKey: Boolean(apiKey)
  }))
}

export function saveUserModelConfig(value: unknown, previousId?: unknown): UserModelSummary[] {
  const model = normalizeModel(value)
  const oldId = typeof previousId === 'string' ? previousId.trim() : ''
  if (model.id !== oldId && isOpenAIOAuthModelEnabled(model.id)) {
    throw new Error(`Disable the OpenAI OAuth ${model.id} model before using that custom model ID`)
  }
  const models = getStoredUserModelConfigs()
  const existing = models.find((candidate) => candidate.id === (oldId || model.id))
  const nextModel =
    !model.apiKey && existing?.apiKey ? { ...model, apiKey: existing.apiKey } : model
  const duplicate = models.find(
    (candidate) => candidate.id === nextModel.id && candidate.id !== existing?.id
  )
  if (duplicate) throw new Error(`A model with ID ${nextModel.id} already exists`)
  const next = existing
    ? models.map((candidate) => (candidate.id === existing.id ? nextModel : candidate))
    : [...models, nextModel]
  setStoredSetting(MODELS_SETTING_KEY, serializeModels(next))
  const selected = getStoredSetting('model')?.trim()
  if (!selected || selected === oldId) setStoredSetting('model', nextModel.id)
  return listUserModelSummaries()
}

export function deleteUserModelConfig(modelId: unknown): UserModelSummary[] {
  const id = requiredString(modelId, 'Model ID')
  if (isOpenAIOAuthModelEnabled(id)) {
    throw new Error('Disable OpenAI OAuth models from the OpenAI account section')
  }
  const next = getStoredUserModelConfigs().filter((model) => model.id !== id)
  setStoredSetting(MODELS_SETTING_KEY, serializeModels(next))
  if (getStoredSetting('model')?.trim() === id) {
    const fallback = getUserModelConfigs()[0]
    if (fallback) setStoredSetting('model', fallback.id)
    else deleteStoredSetting('model')
  }
  return listUserModelSummaries()
}

export function resolveUserModelConfig(modelId?: string): UserModelConfig {
  const models = getUserModelConfigs()
  const selectedId = modelId?.trim() || getStoredSetting('model')?.trim()
  const model = selectedId ? models.find((candidate) => candidate.id === selectedId) : models[0]
  if (!model) {
    throw new Error('No LLM model is configured. Add one in Settings > Models.')
  }
  return model
}
