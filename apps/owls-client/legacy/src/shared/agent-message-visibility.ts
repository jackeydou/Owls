import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  Api,
  ImageContent,
  Message,
  StopReason,
  TextContent,
  Usage
} from '@earendil-works/pi-ai'

export const OWLS_USER_MESSAGE_ROLE = 'owlsUser'
export const OWLS_ASSISTANT_MESSAGE_ROLE = 'owlsAssistant'
export const OWLS_CONTEXT_SUMMARY_MESSAGE_ROLE = 'owlsContextSummary'
const LEGACY_USER_MESSAGE_ROLE = 'pixUser'
const LEGACY_ASSISTANT_MESSAGE_ROLE = 'pixAssistant'
const LEGACY_CONTEXT_SUMMARY_MESSAGE_ROLE = 'pixContextSummary'

export const OWLS_MESSAGE_VISIBILITIES = ['shared', 'model-only', 'ui-only'] as const
export const OWLS_MESSAGE_KINDS = ['default', 'steer'] as const

export type OwlsMessageVisibility = (typeof OWLS_MESSAGE_VISIBILITIES)[number]
export type OwlsMessageKind = (typeof OWLS_MESSAGE_KINDS)[number]

type OwlsBaseMessage = {
  visibility: OwlsMessageVisibility
  timestamp: number
}

export type OwlsUserMessage = OwlsBaseMessage & {
  role: typeof OWLS_USER_MESSAGE_ROLE
  content: string | Array<TextContent | ImageContent>
}

export type OwlsAssistantMessage = OwlsBaseMessage & {
  role: typeof OWLS_ASSISTANT_MESSAGE_ROLE
  content: string
  api?: Api
  provider?: string
  model?: string
  usage?: Usage
  stopReason?: StopReason
  errorMessage?: string
}

export type OwlsContextSummaryMessage = {
  role: typeof OWLS_CONTEXT_SUMMARY_MESSAGE_ROLE
  content: string
  timestamp: number
}

export type OwlsAgentMessage =
  | OwlsUserMessage
  | OwlsAssistantMessage
  | OwlsContextSummaryMessage

type LegacyUserMessage = Omit<OwlsUserMessage, 'role'> & { role: typeof LEGACY_USER_MESSAGE_ROLE }
type LegacyAssistantMessage = Omit<OwlsAssistantMessage, 'role'> & {
  role: typeof LEGACY_ASSISTANT_MESSAGE_ROLE
}
type LegacyContextSummaryMessage = Omit<OwlsContextSummaryMessage, 'role'> & {
  role: typeof LEGACY_CONTEXT_SUMMARY_MESSAGE_ROLE
}
export type OwlsCompatibleAgentMessage =
  | OwlsAgentMessage
  | LegacyUserMessage
  | LegacyAssistantMessage
  | LegacyContextSummaryMessage

declare module '@earendil-works/pi-agent-core' {
  interface CustomAgentMessages {
    owlsUser: OwlsUserMessage
    owlsAssistant: OwlsAssistantMessage
    owlsContextSummary: OwlsContextSummaryMessage
    pixUser: LegacyUserMessage
    pixAssistant: LegacyAssistantMessage
    pixContextSummary: LegacyContextSummaryMessage
  }
}

export function isOwlsMessageVisibility(value: unknown): value is OwlsMessageVisibility {
  return (
    typeof value === 'string' && (OWLS_MESSAGE_VISIBILITIES as readonly string[]).includes(value)
  )
}

export function isOwlsMessageKind(value: unknown): value is OwlsMessageKind {
  return typeof value === 'string' && (OWLS_MESSAGE_KINDS as readonly string[]).includes(value)
}

export function normalizeMessageKind(value: unknown): OwlsMessageKind {
  return isOwlsMessageKind(value) ? value : 'default'
}

export function isModelVisibleMessage(visibility: OwlsMessageVisibility): boolean {
  return visibility === 'shared' || visibility === 'model-only'
}

export function isUserVisibleMessage(visibility: OwlsMessageVisibility): boolean {
  return visibility === 'shared' || visibility === 'ui-only'
}

export function defaultVisibilityForRole(role: string): OwlsMessageVisibility {
  if (role === 'system') return 'model-only'
  return 'shared'
}

export function normalizeMessageVisibility(value: unknown, role: string): OwlsMessageVisibility {
  return isOwlsMessageVisibility(value) ? value : defaultVisibilityForRole(role)
}

export function isOwlsUserMessageRole(
  role: unknown
): role is typeof OWLS_USER_MESSAGE_ROLE | typeof LEGACY_USER_MESSAGE_ROLE {
  return role === OWLS_USER_MESSAGE_ROLE || role === LEGACY_USER_MESSAGE_ROLE
}

export function isOwlsAssistantMessageRole(
  role: unknown
): role is typeof OWLS_ASSISTANT_MESSAGE_ROLE | typeof LEGACY_ASSISTANT_MESSAGE_ROLE {
  return role === OWLS_ASSISTANT_MESSAGE_ROLE || role === LEGACY_ASSISTANT_MESSAGE_ROLE
}

export function isOwlsContextSummaryMessageRole(
  role: unknown
): role is typeof OWLS_CONTEXT_SUMMARY_MESSAGE_ROLE | typeof LEGACY_CONTEXT_SUMMARY_MESSAGE_ROLE {
  return role === OWLS_CONTEXT_SUMMARY_MESSAGE_ROLE || role === LEGACY_CONTEXT_SUMMARY_MESSAGE_ROLE
}

export function isOwlsAgentMessage(message: AgentMessage): message is OwlsCompatibleAgentMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'role' in message &&
    (isOwlsUserMessageRole(message.role) ||
      isOwlsAssistantMessageRole(message.role) ||
      isOwlsContextSummaryMessageRole(message.role))
  )
}

function owlsAssistantMessageToLlm(
  message: OwlsAssistantMessage | LegacyAssistantMessage
): Message | null {
  if (!isModelVisibleMessage(message.visibility)) return null

  const content = [{ type: 'text' as const, text: message.content }]
  return {
    role: 'assistant',
    content,
    api: message.api ?? 'openai-completions',
    provider: message.provider ?? 'owls-custom',
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

export function owlsAgentMessageToLlm(message: OwlsCompatibleAgentMessage): Message | null {
  if (
    message.role === OWLS_CONTEXT_SUMMARY_MESSAGE_ROLE ||
    message.role === LEGACY_CONTEXT_SUMMARY_MESSAGE_ROLE
  ) {
    return {
      role: 'user',
      content: message.content,
      timestamp: message.timestamp
    }
  }

  if (message.role === OWLS_USER_MESSAGE_ROLE || message.role === LEGACY_USER_MESSAGE_ROLE) {
    if (!isModelVisibleMessage(message.visibility)) return null
    return {
      role: 'user',
      content: message.content,
      timestamp: message.timestamp
    }
  }

  if (
    message.role === OWLS_ASSISTANT_MESSAGE_ROLE ||
    message.role === LEGACY_ASSISTANT_MESSAGE_ROLE
  ) {
    return owlsAssistantMessageToLlm(message)
  }

  return null
}
