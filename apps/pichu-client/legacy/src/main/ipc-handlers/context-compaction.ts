import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { WebContents } from 'electron'
import {
  PICHU_ASSISTANT_MESSAGE_ROLE,
  PICHU_CONTEXT_SUMMARY_MESSAGE_ROLE,
  PICHU_USER_MESSAGE_ROLE
} from '../../shared/agent-message-visibility.js'
import {
  CONTEXT_COMPACTION_SUMMARY_PREFIX,
  type ContextCompactionEvent,
  type ContextCompactionMarker,
  serializeContextCompactionMarker
} from '../../shared/context-compaction.js'
import {
  autoCompactTokenLimitForModelId,
  completePichuText,
  DEFAULT_CONTEXT_WINDOW,
  effectiveContextWindowForModelId,
  resolvePichuModelConfig
} from '../agent/pi-models.js'
import { getUnresolvedHumanInputRequest } from '../stores/human-input-store.js'

const AUTO_COMPACT_MIN_CONTEXT_WINDOW_TOKENS = 8_000
const AUTO_COMPACT_MIN_MESSAGE_COUNT = 14
const AUTO_COMPACT_TAIL_MESSAGE_COUNT = 8
const AUTO_COMPACT_SUMMARY_MAX_TOKENS = 2_000

const latestCompactionMarkerBySession = new Map<string, ContextCompactionMarker>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function agentMessageTimestamp(message: AgentMessage): number {
  return typeof (message as { timestamp?: unknown }).timestamp === 'number'
    ? (message as { timestamp: number }).timestamp
    : Date.now()
}

function textFromContentBlocks(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block) => {
      if (!isRecord(block)) return []
      if (block.type === 'text' && typeof block.text === 'string') return [block.text]
      if (block.type === 'thinking' && typeof block.thinking === 'string') return [block.thinking]
      if (block.type === 'toolCall') return [JSON.stringify(block)]
      return []
    })
    .join('\n')
}

export function agentMessageText(message: unknown): string {
  if (!isRecord(message) || typeof message.role !== 'string') return ''
  if (message.role === 'toolResult') {
    return [
      `toolResult:${typeof message.toolName === 'string' ? message.toolName : 'tool'}`,
      textFromContentBlocks(message.content),
      isRecord(message.details) ? JSON.stringify(message.details) : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
  return textFromContentBlocks(message.content)
}

function estimateAgentMessageTokens(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => {
    const text = agentMessageText(message)
    return total + Math.ceil(text.length / 4) + 12
  }, 0)
}

function autoCompactTokenLimit(model: Model<Api>): number {
  const contextWindow = Number.isFinite(model.contextWindow)
    ? model.contextWindow
    : DEFAULT_CONTEXT_WINDOW
  return Math.max(
    AUTO_COMPACT_MIN_CONTEXT_WINDOW_TOKENS,
    autoCompactTokenLimitForModelId(model.id, contextWindow)
  )
}

function isValidReplacementMessage(value: unknown): value is AgentMessage {
  if (!isRecord(value) || typeof value.role !== 'string') return false
  if (value.role === PICHU_USER_MESSAGE_ROLE) {
    return 'content' in value && typeof value.timestamp === 'number'
  }
  if (value.role === PICHU_ASSISTANT_MESSAGE_ROLE) {
    return typeof value.content === 'string' && typeof value.timestamp === 'number'
  }
  if (value.role === PICHU_CONTEXT_SUMMARY_MESSAGE_ROLE) {
    return typeof value.content === 'string' && typeof value.timestamp === 'number'
  }
  if (value.role === 'user') return 'content' in value && typeof value.timestamp === 'number'
  if (value.role === 'assistant') return Array.isArray(value.content)
  if (value.role === 'toolResult') {
    return (
      typeof value.toolCallId === 'string' &&
      typeof value.toolName === 'string' &&
      Array.isArray(value.content)
    )
  }
  return false
}

export function replacementMessagesFromMarker(marker: ContextCompactionMarker): AgentMessage[] {
  return marker.replacementMessages.filter(isValidReplacementMessage)
}

export function rememberContextCompactionMarker(
  sessionId: string,
  marker: ContextCompactionMarker
): void {
  latestCompactionMarkerBySession.set(sessionId, marker)
}

export function getLatestContextCompactionMarker(
  sessionId: string
): ContextCompactionMarker | undefined {
  return latestCompactionMarkerBySession.get(sessionId)
}

function buildCompactionPrompt(messages: AgentMessage[]): string {
  const transcript = messages
    .map((message, index) => {
      const role = isRecord(message) && typeof message.role === 'string' ? message.role : 'unknown'
      const text = agentMessageText(message)
      const clipped = text.length > 6_000 ? `${text.slice(0, 6_000)}\n[truncated]` : text
      return `## Message ${index + 1} (${role})\n${clipped || '[non-text content]'}`
    })
    .join('\n\n')

  return [
    'You are performing a context checkpoint compaction for an AI agent session.',
    '',
    'Create a handoff summary for the next model call. Preserve facts, decisions, constraints, user preferences, files touched, commands run, tool results, and unfinished work. Do not invent details.',
    '',
    'Write concise structured notes. The summary must be useful as a replacement for the earlier transcript.',
    '',
    'Transcript to compact:',
    transcript
  ].join('\n')
}

async function summarizeMessagesForCompaction(params: {
  messages: AgentMessage[]
  model: Model<Api>
  signal?: AbortSignal
}): Promise<string> {
  const config = resolvePichuModelConfig(params.model.id)
  return completePichuText(
    config,
    {
      systemPrompt:
        'You write precise context checkpoint summaries for long-running agent conversations.',
      messages: [
        {
          role: 'user',
          content: buildCompactionPrompt(params.messages),
          timestamp: Date.now()
        }
      ]
    },
    {
      maxTokens: AUTO_COMPACT_SUMMARY_MAX_TOKENS,
      reasoning: 'minimal',
      source: 'context_compaction',
      signal: params.signal
    }
  )
}

function buildCompactionSummaryMessage(summary: string, timestamp: number): AgentMessage {
  return {
    role: PICHU_CONTEXT_SUMMARY_MESSAGE_ROLE,
    content: `${CONTEXT_COMPACTION_SUMMARY_PREFIX}\n\n${summary}`,
    timestamp
  }
}

function maybeReuseExistingCompaction(
  sessionId: string,
  messages: AgentMessage[]
): AgentMessage[] | null {
  const marker = latestCompactionMarkerBySession.get(sessionId)
  if (!marker) return null
  const replacement = replacementMessagesFromMarker(marker)
  if (replacement.length === 0) return null

  const lastReplacementTimestamp = replacement.reduce(
    (max, message) => Math.max(max, agentMessageTimestamp(message)),
    0
  )
  const freshMessages = messages.filter(
    (message) => agentMessageTimestamp(message) > lastReplacementTimestamp
  )
  return [...replacement, ...freshMessages]
}

function sendContextCompactionEvent(params: {
  sessionId: string
  marker: ContextCompactionMarker
  getRendererWebContents: () => WebContents | null
}): void {
  const wc = params.getRendererWebContents()
  if (!wc) return
  const event: ContextCompactionEvent = {
    type: 'context_compaction',
    marker: params.marker
  }
  wc.send('agent:event', {
    sessionId: params.sessionId,
    event
  })
}

export async function compactContextForSession(params: {
  sessionId: string
  messages: AgentMessage[]
  model: Model<Api>
  signal?: AbortSignal
  getRendererWebContents: () => WebContents | null
  persistTextMessage: (sessionId: string, role: 'system', content: string) => void
}): Promise<AgentMessage[]> {
  const reused = maybeReuseExistingCompaction(params.sessionId, params.messages)
  const candidateMessages = reused ?? params.messages
  if (getUnresolvedHumanInputRequest(params.sessionId)) return candidateMessages

  const estimatedTokensBefore = estimateAgentMessageTokens(candidateMessages)
  const tokenLimit = autoCompactTokenLimit(params.model)
  const contextWindow = effectiveContextWindowForModelId(
    params.model.id,
    params.model.contextWindow
  )

  if (estimatedTokensBefore <= tokenLimit) return candidateMessages
  if (candidateMessages.length < AUTO_COMPACT_MIN_MESSAGE_COUNT) return candidateMessages

  const tailCount = Math.min(AUTO_COMPACT_TAIL_MESSAGE_COUNT, candidateMessages.length - 1)
  const compactedPrefix = candidateMessages.slice(0, -tailCount)
  const tail = candidateMessages.slice(-tailCount)
  if (compactedPrefix.length === 0) return candidateMessages

  const summary = await summarizeMessagesForCompaction({
    messages: compactedPrefix,
    model: params.model,
    signal: params.signal
  })
  if (!summary.trim()) return candidateMessages

  const lastCompactedMessage = compactedPrefix.at(-1)
  if (!lastCompactedMessage) return candidateMessages
  const summaryTimestamp = agentMessageTimestamp(lastCompactedMessage)
  const replacementMessages = [buildCompactionSummaryMessage(summary, summaryTimestamp), ...tail]
  const marker: ContextCompactionMarker = {
    kind: 'context-compaction',
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    modelId: params.model.id,
    contextWindow,
    estimatedTokensBefore,
    estimatedTokensAfter: estimateAgentMessageTokens(replacementMessages),
    messagesBefore: candidateMessages.length,
    messagesAfter: replacementMessages.length,
    summary,
    replacementMessages
  }

  rememberContextCompactionMarker(params.sessionId, marker)
  params.persistTextMessage(params.sessionId, 'system', serializeContextCompactionMarker(marker))
  sendContextCompactionEvent({
    sessionId: params.sessionId,
    marker,
    getRendererWebContents: params.getRendererWebContents
  })

  return replacementMessages
}
