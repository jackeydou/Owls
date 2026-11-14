import type { MessageAttachment } from '../../../../preload/index.d'
import {
  type MessagePart,
  partsToTitleFallbackText,
  textToTitleFallbackText
} from '../../../../shared/message-parts'
import { stripMessageContext } from '../../components/chat/context-tags'
import { hasImageAttachments } from './attachments'
import type { SessionStoreSet } from './types'

const FALLBACK_TITLE_MAX_CHARS = 48

export function deriveSessionTitle(text: string): string {
  const visibleText = stripMessageContext(text) || text
  return visibleText.length > FALLBACK_TITLE_MAX_CHARS
    ? `${visibleText.slice(0, FALLBACK_TITLE_MAX_CHARS - 3).trimEnd()}...`
    : visibleText
}

function updateSessionIndexTitle(sid: string, title: string, set: SessionStoreSet): void {
  set((state) => ({
    sessionIndex: state.sessionIndex.map((entry) =>
      entry.sessionId === sid ? { ...entry, title, updatedAt: new Date().toISOString() } : entry
    )
  }))
}

export function generateSessionTitleSoon(
  sid: string,
  text: string,
  agentText: string,
  attachments: MessageAttachment[] | undefined,
  parts: MessagePart[] | undefined,
  set: SessionStoreSet,
  onTitleUpdated?: (sessionId: string, title: string) => void
): void {
  const fallbackText =
    text.trim() ||
    agentText.trim() ||
    attachments?.map((attachment) => attachment.name).join(', ') ||
    'Attachments'
  const titleFallbackText =
    partsToTitleFallbackText(parts ?? []) || textToTitleFallbackText(fallbackText) || fallbackText
  const fallbackTitle = deriveSessionTitle(titleFallbackText)
  updateSessionIndexTitle(sid, fallbackTitle, set)
  onTitleUpdated?.(sid, fallbackTitle)
  void window.api.agent.sessionIndexUpdateTitle(sid, fallbackTitle).catch(console.error)
  void window.api.agent
    .generateSessionTitle(sid, fallbackText, {
      hasImages: hasImageAttachments(attachments)
    })
    .then((generatedTitle) => {
      updateSessionIndexTitle(sid, generatedTitle, set)
      onTitleUpdated?.(sid, generatedTitle)
    })
    .catch(console.error)
}
