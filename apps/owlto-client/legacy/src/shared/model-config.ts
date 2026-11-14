export const MODEL_API_SPECS = [
  'openai-responses',
  'openai-codex-responses',
  'openai-completions',
  'anthropic-messages',
  'google-generative-ai'
] as const

export type ModelApiSpec = (typeof MODEL_API_SPECS)[number]

export type UserModelSource = 'custom' | 'openai-oauth'

export type UserModelConfig = {
  id: string
  name: string
  api: ModelApiSpec
  baseUrl: string
  apiKey: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  supportsImages: boolean
  source: UserModelSource
}

export type UserModelSummary = Omit<UserModelConfig, 'apiKey'> & {
  hasApiKey: boolean
}

export function configuredModelIdsFromStoredSettings(
  userModelsSetting: string | undefined,
  subscriptionModelsSetting: string | undefined,
  excludedSubscriptionIds: readonly string[] = []
): string[] {
  const excludedSubscriptions = new Set(excludedSubscriptionIds)
  const ids: string[] = []
  const add = (value: unknown, excluded: ReadonlySet<string> = new Set()): void => {
    if (typeof value !== 'string') return
    const id = value.trim()
    if (id && !excluded.has(id) && !ids.includes(id)) ids.push(id)
  }

  if (userModelsSetting) {
    try {
      const models: unknown = JSON.parse(userModelsSetting)
      if (Array.isArray(models)) {
        for (const model of models) {
          if (model && typeof model === 'object') add((model as { id?: unknown }).id)
        }
      }
    } catch {
      // Ignore malformed persisted settings.
    }
  }

  if (subscriptionModelsSetting) {
    try {
      const modelIds: unknown = JSON.parse(subscriptionModelsSetting)
      if (Array.isArray(modelIds)) {
        for (const id of modelIds) add(id, excludedSubscriptions)
      }
    } catch {
      // Ignore malformed persisted settings.
    }
  }

  return ids
}

export function resolveConfiguredModelId(
  storedModelId: string | undefined,
  configuredModelIds: readonly string[]
): string {
  const stored = storedModelId?.trim()
  return stored && configuredModelIds.includes(stored) ? stored : (configuredModelIds[0] ?? '')
}

export function isModelApiSpec(value: unknown): value is ModelApiSpec {
  return typeof value === 'string' && MODEL_API_SPECS.includes(value as ModelApiSpec)
}
