import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import {
  isUserVisibleMessage,
  normalizeMessageVisibility
} from '../../shared/agent-message-visibility.js'
import {
  partsToTitleFallbackText,
  partsToTitleText,
  textToTitleFallbackText
} from '../../shared/message-parts.js'
import { stripThinkingTags } from '../../shared/thinking-tags.js'
import {
  getSessionMessages,
  type MessageRow,
  updateSessionTitle
} from '../stores/settings-store.js'
import { parseMessageAttachments, readImageContentFromAttachment } from './message-utils.js'
import { completePichuText, type PichuModelConfig, resolvePichuModelConfig } from './pi-models.js'

const FALLBACK_TITLE_MAX_CHARS = 48

export function deriveSessionTitle(text: string): string {
  return text.length > FALLBACK_TITLE_MAX_CHARS
    ? `${text.slice(0, FALLBACK_TITLE_MAX_CHARS - 3).trimEnd()}...`
    : text
}

function cleanTitleCandidate(title: string): string {
  const cleaned = stripThinkingTags(title, { stripLeadingCloseTagPrefix: true })
    .replace(/^["'“”‘’`]+|["'“”‘’`.]+$/g, '')
    .replace(/^(?:title|标题)\s*[:：]\s*/i, '')
    .replace(/^["'“”‘’`]+|["'“”‘’`.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return ''
  return cleaned.length > 60 ? `${cleaned.slice(0, 57).trimEnd()}...` : cleaned
}

function buildSessionTitlePrompt(rows: MessageRow[], fallbackText: string): string {
  const visibleRows = rows
    .filter(
      (row) =>
        (row.role === 'user' || row.role === 'assistant') &&
        isUserVisibleMessage(normalizeMessageVisibility(row.visibility, row.role))
    )
    .slice(0, 4)

  const transcript =
    visibleRows.length > 0
      ? visibleRows
          .map((row) => {
            const content =
              row.role === 'user'
                ? (partsToTitleText(row.parts ?? []) || row.agentContent || row.content).trim()
                : row.content.trim()
            const clipped = content.length > 1400 ? `${content.slice(0, 1397)}...` : content
            return `${row.role.toUpperCase()}: ${clipped}`
          })
          .join('\n\n')
      : `USER: ${fallbackText}`

  return [
    'Generate a concise title for this chat.',
    '',
    'Rules:',
    '- Return only the title.',
    '- Use the same language as the user when it is clear.',
    '- Prefer a concrete task/action over a generic summary.',
    '- Keep it under 8 words or 48 characters.',
    '- Do not wrap it in quotes.',
    '- Links in the conversation are context only: do not copy raw URLs or Markdown links into the title.',
    '- Name the linked content or user task instead of using domains, query strings, or link tokens.',
    '',
    'Conversation:',
    transcript
  ].join('\n')
}

function buildSessionTitleFallbackText(rows: MessageRow[], fallbackText: string): string {
  const firstUserRow = rows.find(
    (row) =>
      row.role === 'user' &&
      isUserVisibleMessage(normalizeMessageVisibility(row.visibility, row.role))
  )
  const structuredText = firstUserRow ? partsToTitleFallbackText(firstUserRow.parts ?? []) : ''
  return structuredText || textToTitleFallbackText(fallbackText) || fallbackText
}

function collectSessionTitleImages(rows: MessageRow[]): ImageContent[] {
  return rows
    .filter(
      (row) =>
        row.role === 'user' &&
        isUserVisibleMessage(normalizeMessageVisibility(row.visibility, row.role))
    )
    .slice(0, 4)
    .flatMap((row) => parseMessageAttachments(row.attachmentsJson) ?? [])
    .filter((attachment) => attachment.kind === 'image')
    .map(readImageContentFromAttachment)
    .filter((block): block is ImageContent => Boolean(block))
    .slice(0, 4)
}

function sessionRowsHaveImageAttachments(rows: MessageRow[]): boolean {
  return rows.some(
    (row) =>
      isUserVisibleMessage(normalizeMessageVisibility(row.visibility, row.role)) &&
      parseMessageAttachments(row.attachmentsJson)?.some(
        (attachment) => attachment.kind === 'image'
      )
  )
}

export async function generateAndSaveSessionTitle(
  sessionId: string,
  fallbackText: string,
  hasImages = false
): Promise<string> {
  const rows = getSessionMessages(sessionId)
  const fallback =
    cleanTitleCandidate(deriveSessionTitle(buildSessionTitleFallbackText(rows, fallbackText))) ||
    'New chat'
  const imageBlocks = collectSessionTitleImages(rows)
  const shouldUseImageModel =
    hasImages || imageBlocks.length > 0 || sessionRowsHaveImageAttachments(rows)
  let modelConfig: PichuModelConfig
  try {
    modelConfig = resolvePichuModelConfig()
  } catch (error) {
    console.warn('[pi-handler] cannot generate a title without a configured model:', error)
    updateSessionTitle(sessionId, fallback)
    return fallback
  }
  const promptText = buildSessionTitlePrompt(rows, fallbackText)
  const promptContent =
    imageBlocks.length > 0 && modelConfig.supportsImages
      ? ([{ type: 'text', text: promptText }, ...imageBlocks] satisfies Array<
          TextContent | ImageContent
        >)
      : promptText

  if (shouldUseImageModel && modelConfig.supportsImages) {
    console.info(
      '[pi-handler] title image model selected session=%s model=%s images=%d',
      sessionId,
      modelConfig.id,
      imageBlocks.length
    )
  }

  try {
    const title = cleanTitleCandidate(
      await completePichuText(
        modelConfig,
        {
          systemPrompt:
            'You write short, useful chat titles for a desktop AI agent. Be specific, do not explain, and never include raw links.',
          messages: [
            {
              role: 'user',
              content: promptContent,
              timestamp: Date.now()
            }
          ]
        },
        {
          maxTokens: 128,
          sessionId,
          source: 'session_title'
        }
      )
    )
    const nextTitle = title || fallback
    updateSessionTitle(sessionId, nextTitle)
    return nextTitle
  } catch (error) {
    console.warn('[pi-handler] failed to generate session title:', error)
    updateSessionTitle(sessionId, fallback)
    return fallback
  }
}
