import { type JSONContent, mergeAttributes, Node } from '@tiptap/core'
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { SkillSummary } from '../../../../preload/index.d'
import type {
  MessagePart,
  SkillMessagePart,
  WorkspaceLinkMessagePart
} from '../../../../shared/message-parts'
import { ContextTag } from './ContextTag'
import {
  type ComposerContextTag,
  contextTagToMessagePart,
  createMessagePartId,
  serializeContextTag,
  serializeContextTagForAgent
} from './context-tags'
import { SkillTag, type SkillTagLike } from './SkillTag'

type SkillMentionLike = SkillTagLike & {
  name: string
  qualifiedName?: string
}

type ContextMentionAttrs = {
  kind?: string | null
  id?: string | null
  name?: string | null
  path?: string | null
  description?: string | null
  iconUrl?: string | null
}

type WorkspaceLinkAttrs = {
  id?: string | null
  url?: string | null
  href?: string | null
  resourceType?: string | null
  token?: string | null
  title?: string | null
  subtitle?: string | null
  iconUrl?: string | null
  enrichmentStatus?: string | null
  enrichmentFetchedAt?: string | null
  enrichmentErrorCode?: string | null
}

type SkillMentionAttrs = {
  name?: string | null
  qualifiedName?: string | null
  description?: string | null
  filePath?: string | null
  baseDir?: string | null
  sourceKind?: string | null
  sourceLabel?: string | null
  sourceRoot?: string | null
  pluginId?: string | null
  pluginName?: string | null
  pluginVersion?: string | null
  pluginRoot?: string | null
}

function stringAttr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function attrsFromUnknown(value: unknown): ContextMentionAttrs {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as ContextMentionAttrs)
    : {}
}

function workspaceLinkAttrsFromUnknown(value: unknown): WorkspaceLinkAttrs {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as WorkspaceLinkAttrs)
    : {}
}

function skillMentionAttrsFromUnknown(value: unknown): SkillMentionAttrs {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as SkillMentionAttrs)
    : {}
}

export function skillToMentionAttrs(skill: SkillSummary): SkillMentionAttrs {
  return {
    name: skill.name,
    qualifiedName: skill.qualifiedName ?? null,
    description: skill.description,
    filePath: skill.filePath,
    baseDir: skill.baseDir,
    sourceKind: skill.sourceKind,
    sourceLabel: skill.sourceLabel,
    sourceRoot: skill.sourceRoot,
    pluginId: skill.pluginId ?? null,
    pluginName: skill.pluginName ?? null,
    pluginVersion: skill.pluginVersion ?? null,
    pluginRoot: skill.pluginRoot ?? null
  }
}

export function skillFromMentionAttrs(value: unknown): SkillMentionLike | null {
  const attrs = skillMentionAttrsFromUnknown(value)
  const name = stringAttr(attrs.name)
  if (!name) return null

  return {
    name,
    qualifiedName: stringAttr(attrs.qualifiedName),
    filePath: stringAttr(attrs.filePath),
    sourceLabel: stringAttr(attrs.sourceLabel)
  }
}

function serializeSkillMention(skill: SkillMentionLike): string {
  return skill.name
}

function skillToMessagePart(skill: SkillMentionLike): SkillMessagePart {
  const target: SkillMessagePart['target'] = { name: skill.name }
  if (skill.qualifiedName) target.qualifiedName = skill.qualifiedName
  if (skill.filePath) target.filePath = skill.filePath
  if (skill.sourceLabel) target.sourceLabel = skill.sourceLabel

  return {
    id: createMessagePartId(),
    type: 'skill',
    text: serializeSkillMention(skill),
    target,
    ui: {
      visibility: 'inline'
    },
    model: {
      visibility: 'exclude'
    }
  }
}

export function contextTagToMentionAttrs(tag: ComposerContextTag): ContextMentionAttrs {
  return {
    kind: 'plugin',
    id: tag.id,
    name: tag.name,
    path: tag.path,
    description: tag.description ?? null,
    iconUrl: tag.iconUrl ?? null
  }
}

export function contextTagFromMentionAttrs(value: unknown): ComposerContextTag | null {
  const attrs = attrsFromUnknown(value)
  const kind = attrs.kind
  const id = stringAttr(attrs.id)
  const name = stringAttr(attrs.name)
  if (!id || !name) return null

  if (kind !== 'plugin') return null
  return {
    kind: 'plugin',
    id,
    name,
    path: stringAttr(attrs.path) ?? id,
    description: stringAttr(attrs.description),
    iconUrl: stringAttr(attrs.iconUrl)
  }
}

function contextMentionTextFromAttrs(value: unknown): string {
  const name = stringAttr(attrsFromUnknown(value).name)
  return name ? `@${name}` : ''
}

function ContextMentionNodeView({ node }: NodeViewProps): React.JSX.Element {
  const tag = contextTagFromMentionAttrs(node.attrs)
  return (
    <NodeViewWrapper
      as="span"
      className="inline align-baseline"
      contentEditable={false}
      data-pichu-context-mention-node=""
      data-pichu-context-mention-kind={tag?.kind}
    >
      {tag ? <ContextTag tag={tag} /> : <span>{contextMentionTextFromAttrs(node.attrs)}</span>}
    </NodeViewWrapper>
  )
}

function SkillMentionNodeView({ node }: NodeViewProps): React.JSX.Element {
  const skill = skillFromMentionAttrs(node.attrs)
  return (
    <NodeViewWrapper
      as="span"
      className="inline align-baseline"
      contentEditable={false}
      data-pichu-skill-mention-node=""
    >
      {skill ? <SkillTag skill={skill} /> : <span>/skill</span>}
    </NodeViewWrapper>
  )
}

export const ContextMentionNode = Node.create({
  name: 'contextMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      kind: { default: null },
      id: { default: null },
      name: { default: null },
      path: { default: null },
      description: { default: null },
      iconUrl: { default: null }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-pichu-context-mention]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const name = stringAttr(HTMLAttributes.name) ?? 'Mention'
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-pichu-context-mention': 'true'
      }),
      `@${name}`
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ContextMentionNodeView)
  }
})

export const SkillMentionNode = Node.create({
  name: 'skillMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      name: { default: null },
      qualifiedName: { default: null },
      description: { default: null },
      filePath: { default: null },
      baseDir: { default: null },
      sourceKind: { default: null },
      sourceLabel: { default: null },
      sourceRoot: { default: null },
      pluginId: { default: null },
      pluginName: { default: null },
      pluginVersion: { default: null },
      pluginRoot: { default: null }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-pichu-skill-mention]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const skill = skillFromMentionAttrs(HTMLAttributes)
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-pichu-skill-mention': 'true'
      }),
      skill ? serializeSkillMention(skill) : 'Skill'
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(SkillMentionNodeView)
  }
})

export const WorkspaceLinkNode = Node.create({
  name: 'workspaceLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      id: { default: null },
      url: { default: null },
      href: { default: null },
      resourceType: { default: null },
      token: { default: null },
      title: { default: null },
      subtitle: { default: null },
      iconUrl: { default: null },
      enrichmentStatus: { default: null },
      enrichmentFetchedAt: { default: null },
      enrichmentErrorCode: { default: null }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-pichu-workspace-link]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const part = workspaceLinkPartFromAttrs(HTMLAttributes)
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-pichu-workspace-link': 'true',
        'data-pichu-workspace-link-node': '',
        class: 'pichu-inline-link pichu-workspace-inline-link pichu-composer-inline-link'
      }),
      ['span', { class: 'pichu-composer-inline-link-content' }, part?.title || part?.url || '']
    ]
  }
})

function serializeJsonContent(node: JSONContent): string {
  if (node.type === 'text') {
    return node.text ?? ''
  }

  if (node.type === 'hardBreak') {
    return '\n'
  }

  if (node.type === 'contextMention') {
    const tag = contextTagFromMentionAttrs(node.attrs)
    return tag ? serializeContextTag(tag) : contextMentionTextFromAttrs(node.attrs)
  }

  if (node.type === 'skillMention') {
    const skill = skillFromMentionAttrs(node.attrs)
    return skill ? serializeSkillMention(skill) : ''
  }

  if (node.type === 'workspaceLink') {
    const part = workspaceLinkPartFromAttrs(node.attrs)
    return part?.url || ''
  }

  const children = node.content?.map(serializeJsonContent).join('') ?? ''
  if (node.type === 'doc') {
    return node.content?.map(serializeJsonContent).join('\n') ?? ''
  }
  if (node.type === 'paragraph') {
    return children
  }
  return children
}

function pushTextPart(parts: MessagePart[], text: string): void {
  if (!text) return
  const previous = parts.at(-1)
  if (previous?.type === 'text') {
    previous.text += text
    return
  }
  parts.push({ id: createMessagePartId(), type: 'text', text })
}

function workspaceLinkPartFromAttrs(value: unknown): WorkspaceLinkMessagePart | null {
  const attrs = workspaceLinkAttrsFromUnknown(value)
  const id = stringAttr(attrs.id)
  const url = stringAttr(attrs.url)
  const href = stringAttr(attrs.href)
  if (!id || !url || !href) return null

  const resourceType =
    attrs.resourceType === 'doc' ||
    attrs.resourceType === 'docx' ||
    attrs.resourceType === 'sheet' ||
    attrs.resourceType === 'bitable' ||
    attrs.resourceType === 'wiki' ||
    attrs.resourceType === 'file' ||
    attrs.resourceType === 'minutes'
      ? attrs.resourceType
      : 'unknown'
  const enrichmentStatus =
    attrs.enrichmentStatus === 'pending' ||
    attrs.enrichmentStatus === 'resolved' ||
    attrs.enrichmentStatus === 'failed'
      ? attrs.enrichmentStatus
      : undefined
  const part: WorkspaceLinkMessagePart = {
    id,
    type: 'workspaceLink',
    url,
    href,
    resourceType,
    model: {
      visibility: 'include',
      text: url
    },
    ui: {
      visibility: 'inline'
    }
  }
  const token = stringAttr(attrs.token)
  const title = stringAttr(attrs.title)
  const subtitle = stringAttr(attrs.subtitle)
  const iconUrl = stringAttr(attrs.iconUrl)
  if (token) part.token = token
  if (title) part.title = title
  if (subtitle) part.subtitle = subtitle
  if (iconUrl) part.iconUrl = iconUrl
  if (enrichmentStatus) {
    part.enrichment = { status: enrichmentStatus }
    const fetchedAt = stringAttr(attrs.enrichmentFetchedAt)
    const errorCode = stringAttr(attrs.enrichmentErrorCode)
    if (fetchedAt) part.enrichment.fetchedAt = fetchedAt
    if (errorCode) part.enrichment.errorCode = errorCode
  }
  return part
}

function textToMessageParts(text: string): MessagePart[] {
  return text ? [{ id: createMessagePartId(), type: 'text', text }] : []
}

function messagePartsFromJsonContent(node: JSONContent): MessagePart[] {
  if (node.type === 'text') {
    return node.text ? textToMessageParts(node.text) : []
  }

  if (node.type === 'hardBreak') {
    return [{ id: createMessagePartId(), type: 'text', text: '\n' }]
  }

  if (node.type === 'contextMention') {
    const tag = contextTagFromMentionAttrs(node.attrs)
    if (tag) return [contextTagToMessagePart(tag)]
    const text = contextMentionTextFromAttrs(node.attrs)
    return text ? [{ id: createMessagePartId(), type: 'text', text }] : []
  }

  if (node.type === 'skillMention') {
    const skill = skillFromMentionAttrs(node.attrs)
    return skill ? [skillToMessagePart(skill)] : []
  }

  if (node.type === 'workspaceLink') {
    const part = workspaceLinkPartFromAttrs(node.attrs)
    return part ? [part] : []
  }

  if (node.type === 'doc') {
    const parts: MessagePart[] = []
    node.content?.forEach((child, index) => {
      if (index > 0) pushTextPart(parts, '\n')
      for (const part of messagePartsFromJsonContent(child)) {
        if (part.type === 'text') pushTextPart(parts, part.text)
        else parts.push(part)
      }
    })
    return parts
  }

  const parts: MessagePart[] = []
  for (const child of node.content ?? []) {
    for (const part of messagePartsFromJsonContent(child)) {
      if (part.type === 'text') pushTextPart(parts, part.text)
      else parts.push(part)
    }
  }
  return parts
}

function serializeJsonAgentContent(node: JSONContent): string {
  if (node.type === 'text') {
    return node.text ?? ''
  }

  if (node.type === 'hardBreak') {
    return '\n'
  }

  if (node.type === 'contextMention') {
    const tag = contextTagFromMentionAttrs(node.attrs)
    return tag ? serializeContextTagForAgent(tag) : contextMentionTextFromAttrs(node.attrs)
  }

  if (node.type === 'skillMention') {
    return ''
  }

  if (node.type === 'workspaceLink') {
    return workspaceLinkPartFromAttrs(node.attrs)?.url ?? ''
  }

  const children = node.content?.map(serializeJsonAgentContent).join('') ?? ''
  if (node.type === 'doc') {
    return node.content?.map(serializeJsonAgentContent).join('\n') ?? ''
  }
  if (node.type === 'paragraph') {
    return children
  }
  return children
}

export function serializeEditorContext(doc: JSONContent | null): string {
  return doc ? serializeJsonContent(doc).trim() : ''
}

export function serializeEditorAgentContext(doc: JSONContent | null): string {
  return doc ? serializeJsonAgentContent(doc).trim() : ''
}

export function buildEditorMessageParts(doc: JSONContent | null): MessagePart[] {
  return doc ? messagePartsFromJsonContent(doc) : []
}

export function extractContextTagsFromEditor(doc: JSONContent | null): ComposerContextTag[] {
  const tags: ComposerContextTag[] = []

  function visit(node: JSONContent): void {
    if (node.type === 'contextMention') {
      const tag = contextTagFromMentionAttrs(node.attrs)
      if (tag) tags.push(tag)
    }
    for (const child of node.content ?? []) {
      visit(child)
    }
  }

  if (doc) visit(doc)
  return tags
}

export function extractSkillMentionsFromEditor(doc: JSONContent | null): SkillMentionLike[] {
  const skills: SkillMentionLike[] = []

  function visit(node: JSONContent): void {
    if (node.type === 'skillMention') {
      const skill = skillFromMentionAttrs(node.attrs)
      if (skill) skills.push(skill)
    }
    for (const child of node.content ?? []) {
      visit(child)
    }
  }

  if (doc) visit(doc)
  return skills
}
