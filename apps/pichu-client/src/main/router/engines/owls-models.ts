import type { Api, Model } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { createModels, createProvider, type MutableModels } from '@earendil-works/pi-ai/models'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek'
import { googleProvider } from '@earendil-works/pi-ai/providers/google'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import type { OwlsModelSettings, OwlsProviderId } from '../../../shared/router.js'

/** Providers offered for the Owls engine, sorted by id. */
export const OWLS_PROVIDERS: { id: OwlsProviderId; name: string }[] = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'custom', name: 'OpenAI-compatible endpoint' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'google', name: 'Google' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'openrouter', name: 'OpenRouter' }
]

/** Built-in provider catalogs. Imported per provider so other SDKs stay out of the bundle. */
export function builtinRouterModels(): MutableModels {
  const models = createModels()
  models.setProvider(anthropicProvider())
  models.setProvider(deepseekProvider())
  models.setProvider(googleProvider())
  models.setProvider(openaiProvider())
  models.setProvider(openrouterProvider())
  return models
}

export function catalog(models: MutableModels, providerId: OwlsProviderId) {
  if (providerId === 'custom') return []
  return models
    .getModels(providerId)
    .map((m) => ({ id: m.id, name: m.name }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Resolves the configured Router model. A custom endpoint becomes a one-model
 * OpenAI-compatible provider; keys still come from Owls through `getApiKey`.
 */
export function resolveRouterModel(
  settings: OwlsModelSettings
): { models: MutableModels; model: Model<Api> } | null {
  const models = builtinRouterModels()
  if (settings.provider === 'custom') {
    if (!settings.baseUrl) return null
    const model: Model<'openai-completions'> = {
      id: settings.model,
      name: settings.model,
      api: 'openai-completions',
      provider: 'custom',
      baseUrl: settings.baseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 8192
    }
    models.setProvider(
      createProvider({
        id: 'custom',
        name: 'OpenAI-compatible endpoint',
        baseUrl: settings.baseUrl,
        // Keyless local servers resolve with no key; a stored key arrives via getApiKey.
        auth: { apiKey: { name: 'Endpoint key', resolve: async () => ({ auth: {} }) } },
        models: [model],
        api: openAICompletionsApi()
      })
    )
    return { models, model }
  }
  const model = models.getModel(settings.provider, settings.model)
  return model ? { models, model } : null
}
