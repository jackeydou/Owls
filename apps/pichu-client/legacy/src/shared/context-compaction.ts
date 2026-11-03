import type { AgentMessage } from '@earendil-works/pi-agent-core'

export const CONTEXT_COMPACTION_SYSTEM_MESSAGE_PREFIX = '[[pichu:context-compaction]]'
const LEGACY_CONTEXT_COMPACTION_SYSTEM_MESSAGE_PREFIX = '[[pix:context-compaction]]'
export const CONTEXT_COMPACTION_SUMMARY_PREFIX =
  'Another language model started to solve this problem and produced a summary of its work.'

export type ContextCompactionMarker = {
  kind: 'context-compaction'
  version: 1
  id: string
  createdAt: string
  modelId: string
  contextWindow: number
  estimatedTokensBefore: number
  estimatedTokensAfter: number
  messagesBefore: number
  messagesAfter: number
  summary: string
  replacementMessages: AgentMessage[]
}

export type ContextCompactionEvent = {
  type: 'context_compaction'
  marker: ContextCompactionMarker
}

export function serializeContextCompactionMarker(marker: ContextCompactionMarker): string {
  return `${CONTEXT_COMPACTION_SYSTEM_MESSAGE_PREFIX}${JSON.stringify(marker)}`
}

export function parseContextCompactionMarker(content: string): ContextCompactionMarker | null {
  const prefix = [
    CONTEXT_COMPACTION_SYSTEM_MESSAGE_PREFIX,
    LEGACY_CONTEXT_COMPACTION_SYSTEM_MESSAGE_PREFIX
  ].find((candidate) => content.startsWith(candidate))
  if (!prefix) return null

  try {
    const parsed = JSON.parse(content.slice(prefix.length)) as
      | Partial<ContextCompactionMarker>
      | undefined
    if (!parsed || parsed.kind !== 'context-compaction' || parsed.version !== 1) return null
    if (typeof parsed.id !== 'string' || typeof parsed.createdAt !== 'string') return null
    if (typeof parsed.modelId !== 'string') return null
    if (typeof parsed.contextWindow !== 'number') return null
    if (typeof parsed.estimatedTokensBefore !== 'number') return null
    if (typeof parsed.estimatedTokensAfter !== 'number') return null
    if (typeof parsed.messagesBefore !== 'number') return null
    if (typeof parsed.messagesAfter !== 'number') return null
    if (typeof parsed.summary !== 'string') return null
    if (!Array.isArray(parsed.replacementMessages)) return null
    return parsed as ContextCompactionMarker
  } catch {
    return null
  }
}
