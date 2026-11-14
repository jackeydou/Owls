import type { InstalledPlugin } from '../../../../preload/index.d'
import type {
  MentionMessagePart,
  MentionTarget,
  MessagePart
} from '../../../../shared/message-parts'
import { pluginIconUrl } from '../../lib/plugin-assets'

export type ComposerContextTag = {
  kind: 'plugin'
  id: string
  name: string
  path: string
  description?: string
  iconUrl?: string
  enabled?: boolean
}

export type ParsedMessageContextTag = {
  kind: 'plugin'
  name: string
  id?: string
  path?: string
  iconUrl?: string
}

export type ParsedMessageSkillTag = {
  name: string
  qualifiedName?: string
  filePath?: string
  sourceLabel?: string
}

export type ParsedMessageContextSegment =
  | {
      kind: 'text'
      key: string
      text: string
    }
  | {
      kind: 'tag'
      key: string
      tag: ParsedMessageContextTag
    }
  | {
      kind: 'skill'
      key: string
      skill: ParsedMessageSkillTag
      text: string
    }
  | {
      kind: 'workspaceLink'
      key: string
      text: string
      title?: string
      url: string
      href: string
    }

export function createMessagePartId(): string {
  return `part_${crypto.randomUUID()}`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function compactJsonRecord(record: Record<string, string | number | undefined>): string {
  const entries = Object.entries(record).filter((entry): entry is [string, string | number] => {
    const value = entry[1]
    return value !== undefined && value !== ''
  })
  return JSON.stringify(Object.fromEntries(entries))
}

export function serializeContextTag(tag: ComposerContextTag): string {
  return `@${tag.name}`
}

export function serializeContextTagForAgent(tag: ComposerContextTag): string {
  return `<plugin>${escapeXml(
    compactJsonRecord({
      name: tag.name,
      id: tag.id,
      path: tag.path,
      description: tag.description,
      iconUrl: tag.iconUrl
    })
  )}</plugin>`
}

function contextTagToMentionTarget(
  tag: ComposerContextTag
): Extract<MentionTarget, { kind: 'plugin' }> {
  return {
    kind: 'plugin',
    id: tag.id,
    name: tag.name,
    path: tag.path,
    description: tag.description,
    iconUrl: tag.iconUrl
  }
}

function parsedTagFromMentionTarget(target: MentionTarget): ParsedMessageContextTag | null {
  if (target.kind !== 'plugin') return null
  return {
    kind: 'plugin',
    name: target.name,
    id: target.id,
    path: target.path,
    iconUrl: target.iconUrl
  }
}

export function contextTagToMessagePart(tag: ComposerContextTag): MentionMessagePart {
  return {
    id: createMessagePartId(),
    type: 'mention',
    text: `@${tag.name}`,
    target: contextTagToMentionTarget(tag),
    model: {
      visibility: 'include',
      text: serializeContextTagForAgent(tag)
    },
    ui: {
      visibility: 'inline'
    }
  }
}

export function pluginToContextTag(plugin: InstalledPlugin): ComposerContextTag {
  return {
    kind: 'plugin',
    id: plugin.id,
    name: plugin.manifest.interface?.displayName || plugin.name,
    path: plugin.cachePath,
    description: plugin.manifest.interface?.shortDescription || plugin.manifest.description,
    iconUrl: pluginIconUrl(plugin),
    enabled: plugin.enabled
  }
}

function trimTextSegments(segments: ParsedMessageContextSegment[]): ParsedMessageContextSegment[] {
  const displayText = segments
    .map((segment) => {
      if (segment.kind === 'text' || segment.kind === 'workspaceLink') return segment.text
      if (segment.kind === 'skill') return segment.text
      return `@${segment.tag.name}`
    })
    .join('')
  const leadingTrimLength = displayText.length - displayText.trimStart().length
  const trailingTrimLength = displayText.length - displayText.trimEnd().length
  let remainingLeadingTrim = leadingTrimLength
  let remainingTrailingTrim = trailingTrimLength

  return segments
    .map((segment) => {
      if (segment.kind !== 'text' || remainingLeadingTrim === 0) return segment
      const nextText = segment.text.slice(remainingLeadingTrim)
      remainingLeadingTrim = Math.max(remainingLeadingTrim - segment.text.length, 0)
      return nextText ? { ...segment, text: nextText } : null
    })
    .reverse()
    .map((segment) => {
      if (!segment || segment.kind !== 'text' || remainingTrailingTrim === 0) return segment
      const trimLength = Math.min(remainingTrailingTrim, segment.text.length)
      const nextText = segment.text.slice(0, segment.text.length - trimLength)
      remainingTrailingTrim -= trimLength
      return nextText ? { ...segment, text: nextText } : null
    })
    .reverse()
    .filter((segment): segment is ParsedMessageContextSegment => segment !== null)
}

export function parseMessageContext(
  content: string,
  parts?: readonly MessagePart[] | null
): {
  text: string
  tags: ParsedMessageContextTag[]
  segments: ParsedMessageContextSegment[]
  displayText: string
} {
  const segments: ParsedMessageContextSegment[] = []
  const tags: ParsedMessageContextTag[] = []

  if (parts && parts.length > 0) {
    parts.forEach((part, index) => {
      if (part.ui?.visibility === 'hidden') return
      if (part.type === 'text') {
        segments.push({ kind: 'text', key: `part:${index}:text`, text: part.text })
        return
      }
      if (part.type === 'mention') {
        const tag = parsedTagFromMentionTarget(part.target)
        if (tag) {
          tags.push(tag)
          segments.push({ kind: 'tag', key: `part:${index}:mention`, tag })
        } else {
          segments.push({ kind: 'text', key: `part:${index}:mention`, text: part.text })
        }
        return
      }
      if (part.type === 'skill') {
        segments.push({
          kind: 'skill',
          key: `part:${index}:skill`,
          skill: part.target,
          text: part.text
        })
        return
      }
      if (part.type === 'workspaceLink') {
        segments.push({
          kind: 'workspaceLink',
          key: `part:${index}:workspaceLink`,
          text: part.title || part.url,
          title: part.title,
          url: part.url,
          href: part.href
        })
      }
    })
  } else if (content) {
    segments.push({ kind: 'text', key: 'content:text', text: content })
  }

  const trimmedSegments = trimTextSegments(segments)
  const displayText = trimmedSegments
    .map((segment) => {
      if (segment.kind === 'text' || segment.kind === 'workspaceLink') return segment.text
      if (segment.kind === 'skill') return segment.text
      return `@${segment.tag.name}`
    })
    .join('')
    .trim()

  const text = trimmedSegments
    .filter((segment): segment is Extract<ParsedMessageContextSegment, { kind: 'text' }> => {
      return segment.kind === 'text'
    })
    .map((segment) => segment.text)
    .join('')
    .trim()

  return {
    text,
    tags,
    segments: trimmedSegments,
    displayText
  }
}

export function stripMessageContext(
  content: string,
  parts?: readonly MessagePart[] | null
): string {
  return parseMessageContext(content, parts).displayText
}
