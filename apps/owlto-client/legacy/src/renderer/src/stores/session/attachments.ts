import type { MessageAttachment } from '../../../../preload/index.d'
import type { MessagePart } from '../../../../shared/message-parts'
import { isRecord } from './utils'

export function parseMessageAttachments(
  value: string | null | undefined
): MessageAttachment[] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return undefined
    const attachments = parsed.filter((item): item is MessageAttachment => {
      return (
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.path === 'string' &&
        (item.kind === 'image' || item.kind === 'file')
      )
    })
    return attachments.length > 0 ? attachments : undefined
  } catch {
    return undefined
  }
}

export function buildAgentPrompt(
  text: string,
  attachments: MessageAttachment[] | undefined
): string {
  if (!attachments || attachments.length === 0) return text
  const lines = attachments.map((attachment) => `- ${attachment.name}: ${attachment.path}`)
  const attachmentBlock = [
    'Attachments are available at these absolute paths. Use tools to read them when needed:',
    ...lines
  ].join('\n')
  return [text.trim(), attachmentBlock].filter(Boolean).join('\n\n')
}

export function hasPromptOnlyParts(parts: MessagePart[] | undefined): boolean {
  return parts?.some((part) => part.type === 'skill' || part.type === 'comment') ?? false
}

export function hasImageAttachments(attachments: MessageAttachment[] | undefined): boolean {
  return attachments?.some((attachment) => attachment.kind === 'image') ?? false
}

function attachmentNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || 'attachment'
}

function inferAttachmentMimeType(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase()
  if (!ext) return null
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'svg') return 'image/svg+xml'
  return null
}

function inferAttachmentKind(path: string, mimeType: string | null): MessageAttachment['kind'] {
  if (mimeType?.startsWith('image/')) return 'image'
  return /\.(apng|avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(path) ? 'image' : 'file'
}

export function optimisticAttachmentFromPath(path: string): MessageAttachment {
  const mimeType = inferAttachmentMimeType(path)
  return {
    id: crypto.randomUUID(),
    name: attachmentNameFromPath(path),
    path,
    mimeType,
    size: null,
    kind: inferAttachmentKind(path, mimeType),
    previewDataUrl: null
  }
}

function pushUniquePath(paths: string[], seen: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  if (!trimmed || seen.has(trimmed)) return
  seen.add(trimmed)
  paths.push(trimmed)
}

function collectMediaPathsFromRecord(
  record: Record<string, unknown>,
  paths: string[],
  seen: Set<string>
): void {
  pushUniquePath(paths, seen, record.path)
  pushUniquePath(paths, seen, record.filePath)
  pushUniquePath(paths, seen, record.media)
  pushUniquePath(paths, seen, record.mediaUrl)

  for (const key of ['paths', 'mediaUrls']) {
    const raw = record[key]
    if (!Array.isArray(raw)) continue
    for (const item of raw) {
      pushUniquePath(paths, seen, item)
    }
  }

  if (isRecord(record.media)) {
    collectMediaPathsFromRecord(record.media, paths, seen)
  }
}

function collectMediaPathsFromText(text: string, paths: string[], seen: Set<string>): void {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.toLowerCase().startsWith('media:')) continue
    const value = trimmed
      .slice('media:'.length)
      .trim()
      .replace(/^['"`]+|['"`]+$/g, '')
    pushUniquePath(paths, seen, value)
  }
}

export function collectMediaPathsFromToolResult(result: unknown): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  if (!isRecord(result)) return paths

  const content = Array.isArray(result.content) ? result.content : []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      collectMediaPathsFromText(block.text, paths, seen)
    }
  }

  collectMediaPathsFromRecord(result, paths, seen)
  if (isRecord(result.details)) {
    collectMediaPathsFromRecord(result.details, paths, seen)
  }

  return paths
}
