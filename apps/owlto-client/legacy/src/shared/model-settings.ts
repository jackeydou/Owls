export const OWLS_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
export type OwlsThinkingLevel = (typeof OWLS_THINKING_LEVELS)[number]

export const OWLS_REASONING_MENU_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const
export type OwlsReasoningMenuLevel = (typeof OWLS_REASONING_MENU_LEVELS)[number]

export const DEFAULT_OWLS_THINKING_LEVEL: OwlsThinkingLevel = 'medium'
export const SESSION_MODEL_UPDATED_BY_VALUES = ['default', 'user', 'migration'] as const
export type SessionModelUpdatedBy = (typeof SESSION_MODEL_UPDATED_BY_VALUES)[number]

export type SessionModelPreference = {
  sessionId: string
  modelId: string
  thinkingLevel: OwlsThinkingLevel
  updatedAt: string
  updatedBy: SessionModelUpdatedBy
}

export type RunModelEffectiveReason = 'normal' | 'image-fallback' | 'retry' | 'compaction'

export type RunModelUsage = {
  requestedModelId: string
  requestedThinkingLevel: OwlsThinkingLevel
  effectiveModelId: string
  effectiveThinkingLevel: OwlsThinkingLevel
  effectiveReason?: RunModelEffectiveReason
}

export function isOwlsThinkingLevel(
  value: string | null | undefined
): value is OwlsThinkingLevel {
  return OWLS_THINKING_LEVELS.includes(value as OwlsThinkingLevel)
}

export function normalizeOwlsThinkingLevel(
  value: string | null | undefined,
  fallback: OwlsThinkingLevel = DEFAULT_OWLS_THINKING_LEVEL
): OwlsThinkingLevel {
  return isOwlsThinkingLevel(value) ? value : fallback
}

export function isSessionModelUpdatedBy(
  value: string | null | undefined
): value is SessionModelUpdatedBy {
  return SESSION_MODEL_UPDATED_BY_VALUES.includes(value as SessionModelUpdatedBy)
}

export function normalizeSessionModelUpdatedBy(
  value: string | null | undefined,
  fallback: SessionModelUpdatedBy = 'migration'
): SessionModelUpdatedBy {
  return isSessionModelUpdatedBy(value) ? value : fallback
}
