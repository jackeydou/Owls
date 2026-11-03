import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  Api,
  ImageContent,
  Message,
  StopReason,
  TextContent,
  Usage
} from '@earendil-works/pi-ai'

export const PICHU_USER_MESSAGE_ROLE = 'pichuUser'
export const PICHU_ASSISTANT_MESSAGE_ROLE = 'pichuAssistant'
export const PICHU_CONTEXT_SUMMARY_MESSAGE_ROLE = 'pichuContextSummary'
const LEGACY_USER_MESSAGE_ROLE = 'pixUser'
const LEGACY_ASSISTANT_MESSAGE_ROLE = 'pixAssistant'
const LEGACY_CONTEXT_SUMMARY_MESSAGE_ROLE = 'pixContextSummary'

export const PICHU_MESSAGE_VISIBILITIES = ['shared', 'model-only', 'ui-only'] as const
export const PICHU_MESSAGE_KINDS = ['default', 'steer'] as const

export type PichuMessageVisibility = (typeof PICHU_MESSAGE_VISIBILITIES)[number]
export type PichuMessageKind = (typeof PICHU_MESSAGE_KINDS)[number]

type PichuBaseMessage = {
  visibility: PichuMessageVisibility
  timestamp: number
}

export type PichuUserMessage = PichuBaseMessage & {
  role: typeof PICHU_USER_MESSAGE_ROLE
  content: string | Array<TextContent | ImageContent>
}

export type PichuAssistantMessage = PichuBaseMessage & {
  role: typeof PICHU_ASSISTANT_MESSAGE_ROLE
  content: string
  api?: Api
  provider?: string
  model?: string
  usage?: Usage
  stopReason?: StopReason
  errorMessage?: string
}

export type PichuContextSummaryMessage = {
  role: typeof PICHU_CONTEXT_SUMMARY_MESSAGE_ROLE
  content: string
  timestamp: number
}

export type PichuAgentMessage =
  | PichuUserMessage
  | PichuAssistantMessage
  | PichuContextSummaryMessage

type LegacyUserMessage = Omit<PichuUserMessage, 'role'> & { role: typeof LEGACY_USER_MESSAGE_ROLE }
type LegacyAssistantMessage = Omit<PichuAssistantMessage, 'role'> & {
  role: typeof LEGACY_ASSISTANT_MESSAGE_ROLE
}
type LegacyContextSummaryMessage = Omit<PichuContextSummaryMessage, 'role'> & {
  role: typeof LEGACY_CONTEXT_SUMMARY_MESSAGE_ROLE
}
export type PichuCompatibleAgentMessage =
  | PichuAgentMessage
  | LegacyUserMessage
  | LegacyAssistantMessage
  | LegacyContextSummaryMessage

declare module '@earendil-works/pi-agent-core' {
  interface CustomAgentMessages {
    pichuUser: PichuUserMessage
    pichuAssistant: PichuAssistantMessage
    pichuContextSummary: PichuContextSummaryMessage
    pixUser: LegacyUserMessage
    pixAssistant: LegacyAssistantMessage
    pixContextSummary: LegacyContextSummaryMessage
  }
}

export function isPichuMessageVisibility(value: unknown): value is PichuMessageVisibility {
  return (
    typeof value === 'string' && (PICHU_MESSAGE_VISIBILITIES as readonly string[]).includes(value)
  )
}

export function isPichuMessageKind(value: unknown): value is PichuMessageKind {
  return typeof value === 'string' && (PICHU_MESSAGE_KINDS as readonly string[]).includes(value)
}

export function normalizeMessageKind(value: unknown): PichuMessageKind {
  return isPichuMessageKind(value) ? value : 'default'
}

export function isModelVisibleMessage(visibility: PichuMessageVisibility): boolean {
  return visibility === 'shared' || visibility === 'model-only'
}

export function isUserVisibleMessage(visibility: PichuMessageVisibility): boolean {
  return visibility === 'shared' || visibility === 'ui-only'
}

export function defaultVisibilityForRole(role: string): PichuMessageVisibility {
  if (role === 'system') return 'model-only'
  return 'shared'
}

export function normalizeMessageVisibility(value: unknown, role: string): PichuMessageVisibility {
  return isPichuMessageVisibility(value) ? value : defaultVisibilityForRole(role)
}

export function isPichuUserMessageRole(
  role: unknown
): role is typeof PICHU_USER_MESSAGE_ROLE | typeof LEGACY_USER_MESSAGE_ROLE {
  return role === PICHU_USER_MESSAGE_ROLE || role === LEGACY_USER_MESSAGE_ROLE
}

export function isPichuAssistantMessageRole(
  role: unknown
): role is typeof PICHU_ASSISTANT_MESSAGE_ROLE | typeof LEGACY_ASSISTANT_MESSAGE_ROLE {
  return role === PICHU_ASSISTANT_MESSAGE_ROLE || role === LEGACY_ASSISTANT_MESSAGE_ROLE
}

export function isPichuContextSummaryMessageRole(
  role: unknown
): role is typeof PICHU_CONTEXT_SUMMARY_MESSAGE_ROLE | typeof LEGACY_CONTEXT_SUMMARY_MESSAGE_ROLE {
  return role === PICHU_CONTEXT_SUMMARY_MESSAGE_ROLE || role === LEGACY_CONTEXT_SUMMARY_MESSAGE_ROLE
}

export function isPichuAgentMessage(message: AgentMessage): message is PichuCompatibleAgentMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'role' in message &&
    (isPichuUserMessageRole(message.role) ||
      isPichuAssistantMessageRole(message.role) ||
      isPichuContextSummaryMessageRole(message.role))
  )
}

function pichuAssistantMessageToLlm(
  message: PichuAssistantMessage | LegacyAssistantMessage
): Message | null {
  if (!isModelVisibleMessage(message.visibility)) return null

  const content = [{ type: 'text' as const, text: message.content }]
  return {
    role: 'assistant',
    content,
    api: message.api ?? 'openai-completions',
    provider: message.provider ?? 'pichu-custom',
    model: message.model ?? 'unknown',
    usage: message.usage ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: message.stopReason ?? 'stop',
    ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
    timestamp: message.timestamp
  }
}

export function pichuAgentMessageToLlm(message: PichuCompatibleAgentMessage): Message | null {
  if (
    message.role === PICHU_CONTEXT_SUMMARY_MESSAGE_ROLE ||
    message.role === LEGACY_CONTEXT_SUMMARY_MESSAGE_ROLE
  ) {
    return {
      role: 'user',
      content: message.content,
      timestamp: message.timestamp
    }
  }

  if (message.role === PICHU_USER_MESSAGE_ROLE || message.role === LEGACY_USER_MESSAGE_ROLE) {
    if (!isModelVisibleMessage(message.visibility)) return null
    return {
      role: 'user',
      content: message.content,
      timestamp: message.timestamp
    }
  }

  if (
    message.role === PICHU_ASSISTANT_MESSAGE_ROLE ||
    message.role === LEGACY_ASSISTANT_MESSAGE_ROLE
  ) {
    return pichuAssistantMessageToLlm(message)
  }

  return null
}
