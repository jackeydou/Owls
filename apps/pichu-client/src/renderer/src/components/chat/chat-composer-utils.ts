import type { Editor, JSONContent } from '@tiptap/core'
import type { KeyboardEvent } from 'react'
import type { InstalledPlugin, PluginMarketplaceEntry } from '../../../../preload/index.d'
import {
  formatCommentAttachmentForModel,
  type MessagePart,
  normalizeMessagePart
} from '../../../../shared/message-parts'
import type {
  AddChatCommentEventDetail,
  ArtifactContext,
  CommentAttachmentContext,
  ComposerQueuedPrompt,
  ComposerTrigger,
  PluginInstallPrompt,
  RestoredQueuedPromptContent,
  SelectionContext
} from './chat-composer-types'
import { type ComposerContextTag, pluginToContextTag } from './context-tags'

const PLUGIN_RECENT_IDS_STORAGE_KEY = 'pichu:chat:pluginRecentIds'
export const PLUGIN_RECENT_IDS_LIMIT = 20

const ASCII_MENTION_STOP_CHARACTERS = new Set(Array.from('!"#$%&\'()*+,./:;<=>?[\\]^`{|}~'))

export function selectionSnippet(value: string, maxLength = 28): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized
}

function formatSelectionContext(selections: SelectionContext[]): string {
  const selectionBlocks = selections.map(
    (selection, index) => `## Selection ${index + 1}\n${selection.text}`
  )
  return ['# Selected text:', ...selectionBlocks].join('\n\n')
}

function formatArtifactContext(artifacts: ArtifactContext[]): string {
  const lines = artifacts.map((artifact, index) => {
    return `<artifact index="${index + 1}" id="${artifact.artifactId}" kind="${artifact.kind}" title="${artifact.title}">\n${artifact.body}\n</artifact>`
  })
  return ['Saved artifact context:', ...lines].join('\n')
}

function formatCommentContext(comments: CommentAttachmentContext[]): string {
  return comments.map(formatCommentAttachmentForModel).join('\n\n')
}

export function composePromptWithContexts(
  prompt: string,
  selections: SelectionContext[],
  artifacts: ArtifactContext[],
  comments: CommentAttachmentContext[] = []
): string {
  const userRequest = prompt.trim()
  const requestBlock =
    userRequest && selections.length > 0 ? `## My request for Owls:\n${userRequest}` : userRequest
  return [
    selections.length > 0 ? formatSelectionContext(selections) : '',
    artifacts.length > 0 ? formatArtifactContext(artifacts) : '',
    comments.length > 0 ? formatCommentContext(comments) : '',
    requestBlock
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function composeMessageParts(
  editorParts: MessagePart[],
  selections: SelectionContext[],
  artifacts: ArtifactContext[],
  comments: CommentAttachmentContext[] = []
): MessagePart[] {
  return [
    ...editorParts,
    ...selections.map(
      (selection): MessagePart => ({
        id: selection.id,
        type: 'selectionContext',
        title: 'Selected context',
        text: selection.text,
        preview: selectionSnippet(selection.text),
        sourceMessageId: selection.sourceMessageId,
        model: {
          visibility: 'include',
          text: `\n\n${formatSelectionContext([selection])}`
        },
        ui: {
          visibility: 'block'
        }
      })
    ),
    ...artifacts.map(
      (artifact): MessagePart => ({
        id: artifact.id,
        type: 'artifactContext',
        artifactId: artifact.artifactId,
        artifactKind: artifact.kind,
        title: artifact.title,
        text: artifact.body,
        preview: artifact.preview,
        model: {
          visibility: 'include',
          text: `\n\n${formatArtifactContext([artifact])}`
        },
        ui: {
          visibility: 'block'
        }
      })
    ),
    ...comments.map(
      (comment): MessagePart => ({
        ...comment,
        model: {
          visibility: 'include',
          text: `\n\n${formatCommentAttachmentForModel(comment)}`
        },
        ui: {
          visibility: 'block'
        }
      })
    )
  ]
}

function commentText(comment: Pick<CommentAttachmentContext, 'content'>): string {
  return comment.content
    .map((block) => block.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function defaultCommentTitle(origin: CommentAttachmentContext['origin']): string {
  if (origin === 'browser') return 'Browser comment'
  return 'Artifact comment'
}

export function normalizeCommentAttachmentInput(
  detail: AddChatCommentEventDetail
): CommentAttachmentContext | null {
  const id = 'id' in detail && typeof detail.id === 'string' ? detail.id : crypto.randomUUID()
  const commentId =
    'commentId' in detail && typeof detail.commentId === 'string' && detail.commentId.trim()
      ? detail.commentId
      : crypto.randomUUID()
  const title =
    'title' in detail && typeof detail.title === 'string' && detail.title.trim()
      ? detail.title
      : defaultCommentTitle(detail.origin)
  const preview =
    'preview' in detail && typeof detail.preview === 'string' && detail.preview.trim()
      ? detail.preview
      : selectionSnippet(commentText(detail), 80)
  const normalized = normalizeMessagePart({
    ...detail,
    id,
    commentId,
    type: 'comment',
    title,
    preview
  })
  return normalized?.type === 'comment' ? normalized : null
}

export function textMatchesOrderedQuery(value: string, query: string): boolean {
  if (!query) return true

  const normalizedValue = value.toLowerCase()
  let searchFrom = 0

  for (const character of query) {
    const index = normalizedValue.indexOf(character, searchFrom)
    if (index === -1) return false
    searchFrom = index + character.length
  }

  return true
}

function comparePluginVersions(a: string, b: string): number {
  const aParts = a.split(/[.-]/)
  const bParts = b.split(/[.-]/)
  const length = Math.max(aParts.length, bParts.length)

  for (let index = 0; index < length; index += 1) {
    const aPart = aParts[index] ?? '0'
    const bPart = bParts[index] ?? '0'
    const aNumber = Number(aPart)
    const bNumber = Number(bPart)
    const bothNumeric = Number.isInteger(aNumber) && Number.isInteger(bNumber)
    const comparison = bothNumeric ? aNumber - bNumber : aPart.localeCompare(bPart)
    if (comparison !== 0) return comparison > 0 ? 1 : -1
  }

  return 0
}

function pluginDisplayName(entry: PluginMarketplaceEntry | InstalledPlugin): string {
  if ('manifest' in entry) {
    return entry.manifest.interface?.displayName ?? entry.name
  }
  return entry.interface?.displayName ?? entry.name
}

function compareInstalledPluginsForComposer(
  a: InstalledPlugin,
  b: InstalledPlugin,
  recentPluginIds: readonly string[]
): number {
  if (a.enabled !== b.enabled) {
    return a.enabled ? -1 : 1
  }
  const aRecentIndex = recentPluginIds.indexOf(a.id)
  const bRecentIndex = recentPluginIds.indexOf(b.id)
  if (aRecentIndex !== bRecentIndex) {
    if (aRecentIndex === -1) return 1
    if (bRecentIndex === -1) return -1
    return aRecentIndex - bRecentIndex
  }
  return pluginDisplayName(a).localeCompare(pluginDisplayName(b), undefined, {
    sensitivity: 'base'
  })
}

export function orderInstalledPluginsForComposer(
  plugins: readonly InstalledPlugin[],
  recentPluginIds: readonly string[],
  frozenPluginIds: readonly string[] | null = null
): InstalledPlugin[] {
  const pluginsById = new Map(plugins.map((plugin) => [plugin.id, plugin]))
  const ordered = frozenPluginIds?.flatMap((id) => {
    const plugin = pluginsById.get(id)
    if (!plugin) return []
    pluginsById.delete(id)
    return [plugin]
  })
  const added = Array.from(pluginsById.values()).sort((a, b) =>
    compareInstalledPluginsForComposer(a, b, recentPluginIds)
  )
  return ordered ? [...ordered, ...added] : added
}

function pluginKeywordCandidates(entry: PluginMarketplaceEntry): string[] {
  return Array.from(
    new Set(
      [
        entry.name,
        entry.interface?.displayName,
        entry.description,
        entry.interface?.shortDescription,
        ...(entry.keywords ?? [])
      ]
        .map((value) => value?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value))
    )
  )
}

function textContainsPluginKeyword(text: string, keyword: string): boolean {
  const normalizedText = text.toLowerCase()
  if (!keyword) return false
  if (/^[a-z0-9][a-z0-9_-]*$/i.test(keyword)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^a-z0-9_-])${escaped}($|[^a-z0-9_-])`, 'i').test(normalizedText)
  }
  return normalizedText.includes(keyword)
}

export function findPluginInstallPrompt(params: {
  text: string
  available: PluginMarketplaceEntry[]
  installed: InstalledPlugin[]
}): PluginInstallPrompt | null {
  const normalizedText = params.text.trim().toLowerCase()
  if (!normalizedText) return null

  for (const entry of params.available) {
    if (entry.policy?.installation === 'NOT_AVAILABLE') continue
    const isKeywordMatch = pluginKeywordCandidates(entry).some((keyword) =>
      textContainsPluginKeyword(normalizedText, keyword)
    )
    if (!isKeywordMatch) {
      continue
    }

    const installed = params.installed.find((plugin) => plugin.name === entry.name)
    const title = pluginDisplayName(entry)
    if (!installed) {
      return {
        key: `install:${entry.marketplaceName}:${entry.name}`,
        action: 'install',
        entry,
        title,
        toVersion: entry.version
      }
    }

    const availableVersion = installed.marketplaceStatus?.availableVersion ?? entry.version
    if (
      availableVersion &&
      installed.installedVersion &&
      comparePluginVersions(availableVersion, installed.installedVersion) > 0
    ) {
      return {
        key: `update:${installed.id}:${availableVersion}`,
        action: 'update',
        entry,
        installed,
        title,
        fromVersion: installed.installedVersion,
        toVersion: availableVersion
      }
    }
  }

  return null
}

export function isAsciiWhitespace(character: string | undefined): boolean {
  return character === ' ' || character === '\n' || character === '\t' || character === '\r'
}

export function findSkillTrigger(value: string): ComposerTrigger | null {
  const slashIndex = value.lastIndexOf('/')
  if (slashIndex < 0) return null
  if (slashIndex > 0 && !isAsciiWhitespace(value[slashIndex - 1])) return null

  const query = value.slice(slashIndex + 1)
  for (const character of query) {
    if (isAsciiWhitespace(character)) return null
  }

  return {
    query: query.toLowerCase(),
    start: slashIndex,
    end: value.length
  }
}

function canContinueMentionQuery(character: string): boolean {
  if (isAsciiWhitespace(character) || character === '@') return false
  return !ASCII_MENTION_STOP_CHARACTERS.has(character)
}

export function findMentionTrigger(value: string): ComposerTrigger | null {
  const atIndex = value.lastIndexOf('@')
  if (atIndex < 0) return null

  const query = value.slice(atIndex + 1)
  for (const character of query) {
    if (!canContinueMentionQuery(character)) return null
  }

  return {
    query: query.toLowerCase(),
    start: atIndex,
    end: value.length
  }
}

export function loadRecentPluginIds(): string[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(PLUGIN_RECENT_IDS_STORAGE_KEY) ?? '[]'
    ) as unknown
    return Array.isArray(parsed)
      ? parsed
          .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
          .slice(0, PLUGIN_RECENT_IDS_LIMIT)
      : []
  } catch {
    return []
  }
}

export function saveRecentPluginIds(pluginIds: readonly string[]): void {
  try {
    localStorage.setItem(
      PLUGIN_RECENT_IDS_STORAGE_KEY,
      JSON.stringify(pluginIds.slice(0, PLUGIN_RECENT_IDS_LIMIT))
    )
  } catch {
    // Ignore storage failures; recents are only a UI convenience.
  }
}

export function isImeComposing(event: KeyboardEvent, composing: boolean): boolean {
  return composing || event.nativeEvent.isComposing || event.key === 'Process'
}

export function queuedPromptPreview(prompt: ComposerQueuedPrompt): string {
  const text = prompt.text.replace(/\s+/g, ' ').trim()
  if (text) return text
  if (prompt.parts?.length) {
    return prompt.parts.map(messagePartPreview).filter(Boolean).join(', ')
  }
  if (prompt.attachments?.length) {
    return prompt.attachments.map((attachment) => attachment.name).join(', ')
  }
  return ''
}

function messagePartPreview(part: MessagePart): string {
  switch (part.type) {
    case 'text':
    case 'mention':
    case 'skill':
      return part.text
    case 'workspaceLink':
      return part.title || part.url
    case 'selectionContext':
    case 'artifactContext':
    case 'comment':
      return part.preview
  }
}

function textToEditorContent(text: string): JSONContent[] {
  return text.split('\n').flatMap((line, index) => {
    const content: JSONContent[] = []
    if (index > 0) content.push({ type: 'hardBreak' })
    if (line) content.push({ type: 'text', text: line })
    return content
  })
}

function messagePartToEditorContent(part: MessagePart): JSONContent[] {
  switch (part.type) {
    case 'text':
      return textToEditorContent(part.text)
    case 'mention':
      if (part.target.kind === 'plugin') {
        return [
          {
            type: 'contextMention',
            attrs: {
              kind: 'plugin',
              id: part.target.id,
              name: part.target.name,
              path: part.target.path,
              description: part.target.description ?? null,
              iconUrl: part.target.iconUrl ?? null
            }
          }
        ]
      }
      return textToEditorContent(part.text)
    case 'skill':
      return [
        {
          type: 'skillMention',
          attrs: {
            name: part.target.name,
            qualifiedName: part.target.qualifiedName ?? null,
            filePath: part.target.filePath ?? null,
            sourceLabel: part.target.sourceLabel ?? null
          }
        }
      ]
    case 'workspaceLink':
      return [
        {
          type: 'workspaceLink',
          attrs: {
            id: part.id,
            url: part.url,
            href: part.href,
            resourceType: part.resourceType,
            token: part.token ?? null,
            title: part.title ?? null,
            subtitle: part.subtitle ?? null,
            iconUrl: part.iconUrl ?? null,
            enrichmentStatus: part.enrichment?.status ?? null,
            enrichmentFetchedAt: part.enrichment?.fetchedAt ?? null,
            enrichmentErrorCode: part.enrichment?.errorCode ?? null
          }
        }
      ]
    case 'selectionContext':
    case 'artifactContext':
    case 'comment':
      return []
  }
}

export function queuedPromptToComposerContent(
  prompt: ComposerQueuedPrompt
): RestoredQueuedPromptContent {
  const parts = prompt.parts ?? []
  const inlineContent =
    parts.length > 0 ? parts.flatMap(messagePartToEditorContent) : textToEditorContent(prompt.text)
  return {
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: inlineContent
        }
      ]
    },
    selectionContexts: parts.flatMap((part) =>
      part.type === 'selectionContext'
        ? [
            {
              id: part.id,
              text: part.text,
              sourceMessageId: part.sourceMessageId
            }
          ]
        : []
    ),
    artifactContexts: parts.flatMap((part) =>
      part.type === 'artifactContext'
        ? [
            {
              id: part.id,
              artifactId: part.artifactId,
              kind: part.artifactKind,
              title: part.title,
              body: part.text,
              preview: part.preview
            }
          ]
        : []
    ),
    commentAttachments: parts.flatMap((part) =>
      part.type === 'comment'
        ? [
            {
              ...part
            }
          ]
        : []
    )
  }
}

export function editorTextBeforeSelection(editor: Editor): string {
  return editor.state.doc.textBetween(0, editor.state.selection.from, '\n', '\n')
}

export function buildPluginTags({
  contextTags,
  installedPlugins,
  mentionPluginOrderIds,
  mentionQuery,
  recentPluginIds
}: {
  contextTags: ComposerContextTag[]
  installedPlugins: InstalledPlugin[]
  mentionPluginOrderIds: string[] | null
  mentionQuery: string
  recentPluginIds: string[]
}): Extract<ComposerContextTag, { kind: 'plugin' }>[] {
  const selectedPluginIds = new Set(
    contextTags.flatMap((tag) => (tag.kind === 'plugin' ? [tag.id] : []))
  )
  const orderedPlugins = orderInstalledPluginsForComposer(
    installedPlugins,
    recentPluginIds,
    mentionPluginOrderIds
  )

  return orderedPlugins
    .filter((plugin) => !selectedPluginIds.has(plugin.id))
    .map(pluginToContextTag)
    .filter((tag) => {
      if (!mentionQuery) return true
      const haystack = `${tag.name} ${tag.description ?? ''} ${tag.id}`.toLowerCase()
      return haystack.includes(mentionQuery)
    })
}
