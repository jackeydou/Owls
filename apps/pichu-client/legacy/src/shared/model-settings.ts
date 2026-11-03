export const PICHU_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
export type PichuThinkingLevel = (typeof PICHU_THINKING_LEVELS)[number]

export const PICHU_REASONING_MENU_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const
export type PichuReasoningMenuLevel = (typeof PICHU_REASONING_MENU_LEVELS)[number]

export const DEFAULT_PICHU_THINKING_LEVEL: PichuThinkingLevel = 'medium'
export const SESSION_MODEL_UPDATED_BY_VALUES = ['default', 'user', 'migration'] as const
export type SessionModelUpdatedBy = (typeof SESSION_MODEL_UPDATED_BY_VALUES)[number]

export type SessionModelPreference = {
  sessionId: string
  modelId: string
  thinkingLevel: PichuThinkingLevel
  updatedAt: string
  updatedBy: SessionModelUpdatedBy
}

export type RunModelEffectiveReason = 'normal' | 'image-fallback' | 'retry' | 'compaction'

export type RunModelUsage = {
  requestedModelId: string
  requestedThinkingLevel: PichuThinkingLevel
  effectiveModelId: string
  effectiveThinkingLevel: PichuThinkingLevel
  effectiveReason?: RunModelEffectiveReason
}

export function isPichuThinkingLevel(
  value: string | null | undefined
): value is PichuThinkingLevel {
  return PICHU_THINKING_LEVELS.includes(value as PichuThinkingLevel)
}

export function normalizePichuThinkingLevel(
  value: string | null | undefined,
  fallback: PichuThinkingLevel = DEFAULT_PICHU_THINKING_LEVEL
): PichuThinkingLevel {
  return isPichuThinkingLevel(value) ? value : fallback
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
