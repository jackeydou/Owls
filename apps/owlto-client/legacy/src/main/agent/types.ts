import type { Agent } from '@earendil-works/pi-agent-core'
import type { MessagePart } from '../../shared/message-parts.js'
import type { AgentRunSource } from './system-prompt.js'

export type SessionRuntime = {
  sessionId: string
  cwd: string
  agent: Agent
  unsubscribe: () => void
  systemPrompt: string
  stopHookContinuationCount: number
}

export type AgentRunFinishStatus = 'completed' | 'failed' | 'cancelled'

export type PromptAgentPayload = {
  sessionId?: string
  text: string
  images?: string[]
  hasImages?: boolean
  parts?: MessagePart[]
}

export type SteerAgentPayload = PromptAgentPayload & {
  expectedRunId?: string
}

export type DetachedSessionPromptOptions = {
  agentId?: string
  title?: string
  source?: AgentRunSource
  onSessionCreated?: (sessionId: string) => void
}

export type { AgentRunSource }
