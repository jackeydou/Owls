export const MESSAGE_PART_MODEL_VISIBILITIES = ['include', 'exclude'] as const
export const MESSAGE_PART_UI_VISIBILITIES = ['inline', 'block', 'hidden'] as const

export type MessagePartModelVisibility = (typeof MESSAGE_PART_MODEL_VISIBILITIES)[number]
export type MessagePartUiVisibility = (typeof MESSAGE_PART_UI_VISIBILITIES)[number]

export type MessagePartSource = {
  text: string
  start: number
  end: number
}

export type MessagePartModelProjection = {
  visibility?: MessagePartModelVisibility
  text?: string
}

export type MessagePartUiProjection = {
  visibility?: MessagePartUiVisibility
}

export type MessagePartBase = {
  id: string
  source?: MessagePartSource
  model?: MessagePartModelProjection
  ui?: MessagePartUiProjection
}

export type TextMessagePart = MessagePartBase & {
  type: 'text'
  text: string
}

export type MentionTarget =
  | {
      kind: 'plugin'
      id: string
      name: string
      path: string
      description?: string
      iconUrl?: string
    }
  | {
      kind: 'workspaceUser'
      id: string
      name: string
      identifier: string
      email?: string
      userId?: string
      openId?: string
      subtitle?: string
      avatarURL?: string
    }
  | {
      kind: 'workspaceGroup'
      id: string
      name: string
      identifier: string
      chatId?: string
      subtitle?: string
      avatarURL?: string
      memberCount?: number
    }

export type MentionMessagePart = MessagePartBase & {
  type: 'mention'
  text: string
  target: MentionTarget
}

export type SkillTarget = {
  name: string
  qualifiedName?: string
  filePath?: string
  sourceLabel?: string
}

export type SkillMessagePart = MessagePartBase & {
  type: 'skill'
  text: string
  target: SkillTarget
}

export type WorkspaceLinkMessagePart = MessagePartBase & {
  type: 'workspaceLink'
  url: string
  href: string
  resourceType: 'doc' | 'docx' | 'sheet' | 'bitable' | 'wiki' | 'file' | 'minutes' | 'unknown'
  token?: string
  title?: string
  subtitle?: string
  iconUrl?: string
  enrichment?: {
    status: 'pending' | 'resolved' | 'failed'
    fetchedAt?: string
    errorCode?: string
  }
}

export type SelectionContextMessagePart = MessagePartBase & {
  type: 'selectionContext'
  title: string
  text: string
  preview: string
  sourceMessageId?: string
}

export type ArtifactContextMessagePart = MessagePartBase & {
  type: 'artifactContext'
  artifactId: string
  artifactKind: string
  title: string
  text: string
  preview: string
}

export type CommentPoint = { x: number; y: number }
export type CommentSize = { width: number; height: number }
export type CommentRect = { x: number; y: number; width: number; height: number }

export type CommentContentBlock = {
  content_type: 'text'
  text: string
}

export type BrowserCommentContext = {
  pageUrl: string
  pageTitle?: string
  framePath?: number[] | string[] | string
  frameUrl?: string
  targetDescription?: string
  targetImmediateText?: string
  targetRole?: string
  targetName?: string
  targetSelector?: string
  targetPath?: string
  nearbyText?: string
  documentContext?: string
  isFixed?: true
  scrollContainers?: Array<{
    selector: string
    scrollLeft: number
    scrollTop: number
  }>
}

export type BrowserCommentMetadata = {
  browserTabId?: string
  kind: string
  markerViewportPoint?: CommentPoint
  themeVariant?: 'light' | 'dark' | string
  viewportSize?: CommentSize
}

export type LocalBrowserScreenshot = {
  path: string
  mimeType: 'image/png'
  width: number
  height: number
  commentId: string
  isCompact?: true
  annotationViewportRect?: CommentRect
  cropViewportRect?: CommentRect
  cropPaddingPx?: number
  markerViewportPoint?: CommentPoint
}

export type ArtifactAnnotationTarget =
  | {
      type: 'presentation-element-selection'
      slideIndex?: number
      elementIds: string[]
    }
  | {
      type: 'presentation-region'
      slideIndex?: number
      rect: CommentRect
    }
  | {
      type: 'workbook-floating-element'
      sheetName?: string
      elementId: string
    }
  | {
      type: 'workbook-range'
      sheetName?: string
      range: string
    }

export type ArtifactAnnotationContext = {
  annotationId: string
  artifactKind: string
  path: string
  label?: number
  target: ArtifactAnnotationTarget
}

export type CommentAttachmentMessagePart = MessagePartBase & {
  type: 'comment'
  commentId: string
  content: CommentContentBlock[]
  origin: 'browser' | 'artifact'
  title: string
  preview: string
  localBrowserContext?: BrowserCommentContext
  localBrowserCommentMetadata?: BrowserCommentMetadata
  localBrowserScreenshot?: LocalBrowserScreenshot
  localArtifactAnnotationContext?: ArtifactAnnotationContext
}

export type MessagePart =
  | TextMessagePart
  | MentionMessagePart
  | SkillMessagePart
  | WorkspaceLinkMessagePart
  | SelectionContextMessagePart
  | ArtifactContextMessagePart
  | CommentAttachmentMessagePart

export type StoredMessagePart = MessagePart

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalPositiveNumber(value: unknown): number | undefined {
  const number = optionalNumber(value)
  return number !== undefined && number > 0 ? number : undefined
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function optionalBooleanTrue(value: unknown): true | undefined {
  return value === true ? true : undefined
}

function parsePoint(value: unknown): CommentPoint | undefined {
  if (!isRecord(value)) return undefined
  const x = optionalNumber(value.x)
  const y = optionalNumber(value.y)
  return x === undefined || y === undefined ? undefined : { x, y }
}

function parseSize(value: unknown): CommentSize | undefined {
  if (!isRecord(value)) return undefined
  const width = optionalPositiveNumber(value.width)
  const height = optionalPositiveNumber(value.height)
  return width === undefined || height === undefined ? undefined : { width, height }
}

function parseRect(value: unknown): CommentRect | undefined {
  if (!isRecord(value)) return undefined
  const x = optionalNumber(value.x)
  const y = optionalNumber(value.y)
  const width = optionalPositiveNumber(value.width)
  const height = optionalPositiveNumber(value.height)
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : { x, y, width, height }
}

function parseCommentContentBlocks(value: unknown): CommentContentBlock[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): CommentContentBlock[] => {
    if (!isRecord(item) || item.content_type !== 'text') return []
    const text = stringValue(item.text)
    return text ? [{ content_type: 'text', text }] : []
  })
}

function parseBrowserContext(value: unknown): BrowserCommentContext | undefined {
  if (!isRecord(value)) return undefined
  const pageUrl = stringValue(value.pageUrl)
  if (!pageUrl) return undefined
  const context: BrowserCommentContext = { pageUrl }
  const pageTitle = optionalString(value.pageTitle)
  if (pageTitle) context.pageTitle = pageTitle
  if (Array.isArray(value.framePath)) {
    const numericFramePath = value.framePath.filter(
      (item): item is number => typeof item === 'number' && Number.isInteger(item)
    )
    const selectorFramePath = value.framePath
      .map((item) => optionalString(item))
      .filter((item): item is string => Boolean(item))
    if (numericFramePath.length === value.framePath.length) {
      context.framePath = numericFramePath
    } else if (selectorFramePath.length === value.framePath.length) {
      context.framePath = selectorFramePath
    }
  } else {
    const framePath = optionalString(value.framePath)
    if (framePath) context.framePath = framePath
  }
  const frameUrl = optionalString(value.frameUrl)
  const targetDescription = optionalString(value.targetDescription)
  const targetImmediateText = optionalString(value.targetImmediateText)
  const targetRole = optionalString(value.targetRole)
  const targetName = optionalString(value.targetName)
  const targetSelector = optionalString(value.targetSelector)
  const targetPath = optionalString(value.targetPath)
  const nearbyText = optionalString(value.nearbyText)
  const documentContext = optionalString(value.documentContext)
  const rawScrollContainers = value.scrollContainers
  const scrollContainers = Array.isArray(rawScrollContainers)
    ? rawScrollContainers
        .map((item) => {
          if (!isRecord(item)) return null
          const selector = optionalString(item.selector)
          const scrollLeft = optionalNumber(item.scrollLeft)
          const scrollTop = optionalNumber(item.scrollTop)
          return selector && scrollLeft !== undefined && scrollTop !== undefined
            ? { selector, scrollLeft, scrollTop }
            : null
        })
        .filter(
          (
            item
          ): item is {
            selector: string
            scrollLeft: number
            scrollTop: number
          } => item !== null
        )
    : undefined
  if (frameUrl) context.frameUrl = frameUrl
  if (targetDescription) context.targetDescription = targetDescription
  if (targetImmediateText) context.targetImmediateText = targetImmediateText
  if (targetRole) context.targetRole = targetRole
  if (targetName) context.targetName = targetName
  if (targetSelector) context.targetSelector = targetSelector
  if (targetPath) context.targetPath = targetPath
  if (nearbyText) context.nearbyText = nearbyText
  if (documentContext) context.documentContext = documentContext
  if (value.isFixed === true) context.isFixed = true
  if (
    scrollContainers &&
    Array.isArray(rawScrollContainers) &&
    scrollContainers.length === rawScrollContainers.length
  ) {
    context.scrollContainers = scrollContainers
  }
  return context
}

function parseBrowserMetadata(value: unknown): BrowserCommentMetadata | undefined {
  if (!isRecord(value)) return undefined
  const kind = stringValue(value.kind)
  if (!kind) return undefined
  const metadata: BrowserCommentMetadata = { kind }
  const browserTabId = optionalString(value.browserTabId)
  const themeVariant = optionalString(value.themeVariant)
  const markerViewportPoint = parsePoint(value.markerViewportPoint)
  const viewportSize = parseSize(value.viewportSize)
  if (browserTabId) metadata.browserTabId = browserTabId
  if (themeVariant) metadata.themeVariant = themeVariant
  if (markerViewportPoint) metadata.markerViewportPoint = markerViewportPoint
  if (viewportSize) metadata.viewportSize = viewportSize
  return metadata
}

function parseBrowserScreenshot(
  value: unknown,
  commentId: string
): LocalBrowserScreenshot | undefined {
  if (!isRecord(value)) return undefined
  const path = stringValue(value.path)
  const width = optionalPositiveNumber(value.width)
  const height = optionalPositiveNumber(value.height)
  if (!path || value.mimeType !== 'image/png' || width === undefined || height === undefined) {
    return undefined
  }
  const screenshot: LocalBrowserScreenshot = {
    path,
    mimeType: 'image/png',
    width,
    height,
    commentId
  }
  const annotationViewportRect = parseRect(value.annotationViewportRect)
  const cropViewportRect = parseRect(value.cropViewportRect)
  const cropPaddingPx = optionalNumber(value.cropPaddingPx)
  const markerViewportPoint = parsePoint(value.markerViewportPoint)
  const isCompact = optionalBooleanTrue(value.isCompact)
  if (isCompact) screenshot.isCompact = isCompact
  if (annotationViewportRect) screenshot.annotationViewportRect = annotationViewportRect
  if (cropViewportRect) screenshot.cropViewportRect = cropViewportRect
  if (cropPaddingPx !== undefined) screenshot.cropPaddingPx = cropPaddingPx
  if (markerViewportPoint) screenshot.markerViewportPoint = markerViewportPoint
  return screenshot
}

function parseArtifactAnnotationTarget(value: unknown): ArtifactAnnotationTarget | undefined {
  if (!isRecord(value)) return undefined
  if (value.type === 'presentation-element-selection') {
    if (!Array.isArray(value.elementIds)) return undefined
    const elementIds = value.elementIds
      .map((item) => optionalString(item))
      .filter((item): item is string => Boolean(item))
    if (elementIds.length === 0 || elementIds.length !== value.elementIds.length) return undefined
    const target: ArtifactAnnotationTarget = {
      type: 'presentation-element-selection',
      elementIds
    }
    const slideIndex = optionalNonNegativeInteger(value.slideIndex)
    if (slideIndex !== undefined) target.slideIndex = slideIndex
    return target
  }
  if (value.type === 'presentation-region') {
    const rect = parseRect(value.rect)
    if (!rect) return undefined
    const target: ArtifactAnnotationTarget = { type: 'presentation-region', rect }
    const slideIndex = optionalNonNegativeInteger(value.slideIndex)
    if (slideIndex !== undefined) target.slideIndex = slideIndex
    return target
  }
  if (value.type === 'workbook-floating-element') {
    const elementId = stringValue(value.elementId)
    if (!elementId) return undefined
    const target: ArtifactAnnotationTarget = { type: 'workbook-floating-element', elementId }
    const sheetName = optionalString(value.sheetName)
    if (sheetName) target.sheetName = sheetName
    return target
  }
  if (value.type === 'workbook-range') {
    const range = stringValue(value.range)
    if (!range) return undefined
    const target: ArtifactAnnotationTarget = { type: 'workbook-range', range }
    const sheetName = optionalString(value.sheetName)
    if (sheetName) target.sheetName = sheetName
    return target
  }
  return undefined
}

function parseArtifactAnnotationContext(value: unknown): ArtifactAnnotationContext | undefined {
  if (!isRecord(value)) return undefined
  const annotationId = stringValue(value.annotationId)
  const artifactKind = stringValue(value.artifactKind)
  const path = stringValue(value.path)
  const target = parseArtifactAnnotationTarget(value.target)
  if (!annotationId || !artifactKind || !path || !target) return undefined
  const context: ArtifactAnnotationContext = {
    annotationId,
    artifactKind,
    path,
    target
  }
  const label = optionalPositiveInteger(value.label)
  if (label !== undefined) context.label = label
  return context
}

function parseSource(value: unknown): MessagePartSource | undefined {
  if (!isRecord(value)) return undefined
  const text = stringValue(value.text)
  const start = optionalNumber(value.start)
  const end = optionalNumber(value.end)
  if (text === undefined || start === undefined || end === undefined || end < start)
    return undefined
  return { text, start, end }
}

function parseModelProjection(value: unknown): MessagePartModelProjection | undefined {
  if (!isRecord(value)) return undefined
  const visibility =
    value.visibility === 'include' || value.visibility === 'exclude' ? value.visibility : undefined
  const text = typeof value.text === 'string' ? value.text : undefined
  return visibility || text !== undefined ? { visibility, text } : undefined
}

function parseUiProjection(value: unknown): MessagePartUiProjection | undefined {
  if (!isRecord(value)) return undefined
  const visibility =
    value.visibility === 'inline' || value.visibility === 'block' || value.visibility === 'hidden'
      ? value.visibility
      : undefined
  return visibility ? { visibility } : undefined
}

function parseBase(value: Record<string, unknown>): MessagePartBase | null {
  const id = stringValue(value.id)
  if (!id) return null
  return {
    id,
    source: parseSource(value.source),
    model: parseModelProjection(value.model),
    ui: parseUiProjection(value.ui)
  }
}

function parseMentionTarget(value: unknown): MentionTarget | null {
  if (!isRecord(value)) return null
  if (value.kind === 'plugin') {
    const id = stringValue(value.id)
    const name = stringValue(value.name)
    const path = stringValue(value.path)
    if (!id || !name || !path) return null
    const target: MentionTarget = {
      kind: 'plugin',
      id,
      name,
      path
    }
    const description = optionalString(value.description)
    const iconUrl = optionalString(value.iconUrl)
    if (description) target.description = description
    if (iconUrl) target.iconUrl = iconUrl
    return target
  }

  if (value.kind === 'workspaceUser') {
    const id = stringValue(value.id)
    const name = stringValue(value.name)
    const identifier = stringValue(value.identifier)
    if (!id || !name || !identifier) return null
    const target: MentionTarget = {
      kind: 'workspaceUser',
      id,
      name,
      identifier
    }
    const email = optionalString(value.email)
    const userId = optionalString(value.userId)
    const openId = optionalString(value.openId)
    const subtitle = optionalString(value.subtitle)
    const avatarURL = optionalString(value.avatarURL)
    if (email) target.email = email
    if (userId) target.userId = userId
    if (openId) target.openId = openId
    if (subtitle) target.subtitle = subtitle
    if (avatarURL) target.avatarURL = avatarURL
    return target
  }

  if (value.kind === 'workspaceGroup') {
    const id = stringValue(value.id)
    const name = stringValue(value.name)
    const identifier = stringValue(value.identifier)
    if (!id || !name || !identifier) return null
    const target: MentionTarget = {
      kind: 'workspaceGroup',
      id,
      name,
      identifier
    }
    const chatId = optionalString(value.chatId)
    const subtitle = optionalString(value.subtitle)
    const avatarURL = optionalString(value.avatarURL)
    const memberCount = optionalNumber(value.memberCount)
    if (chatId) target.chatId = chatId
    if (subtitle) target.subtitle = subtitle
    if (avatarURL) target.avatarURL = avatarURL
    if (memberCount !== undefined) target.memberCount = memberCount
    return target
  }

  return null
}

function parseSkillTarget(value: unknown): SkillTarget | null {
  if (!isRecord(value)) return null
  const name = stringValue(value.name)
  if (!name) return null

  const target: SkillTarget = { name }
  const qualifiedName = optionalString(value.qualifiedName)
  const filePath = optionalString(value.filePath)
  const sourceLabel = optionalString(value.sourceLabel)
  if (qualifiedName) target.qualifiedName = qualifiedName
  if (filePath) target.filePath = filePath
  if (sourceLabel) target.sourceLabel = sourceLabel
  return target
}

function parseWorkspaceLinkResourceType(value: unknown): WorkspaceLinkMessagePart['resourceType'] {
  return value === 'doc' ||
    value === 'docx' ||
    value === 'sheet' ||
    value === 'bitable' ||
    value === 'wiki' ||
    value === 'file' ||
    value === 'minutes'
    ? value
    : 'unknown'
}

function parseWorkspaceLinkEnrichment(
  value: unknown
): WorkspaceLinkMessagePart['enrichment'] | undefined {
  if (!isRecord(value)) return undefined
  const status =
    value.status === 'pending' || value.status === 'resolved' || value.status === 'failed'
      ? value.status
      : undefined
  if (!status) return undefined
  const enrichment: NonNullable<WorkspaceLinkMessagePart['enrichment']> = { status }
  const fetchedAt = optionalString(value.fetchedAt)
  const errorCode = optionalString(value.errorCode)
  if (fetchedAt) enrichment.fetchedAt = fetchedAt
  if (errorCode) enrichment.errorCode = errorCode
  return enrichment
}

export function normalizeMessagePart(value: unknown): MessagePart | null {
  if (!isRecord(value)) return null
  const base = parseBase(value)
  if (!base) return null

  if (value.type === 'text') {
    const text = stringValue(value.text)
    return text === undefined ? null : { ...base, type: 'text', text }
  }

  if (value.type === 'mention') {
    const text = stringValue(value.text)
    const target = parseMentionTarget(value.target)
    if (!text || !target) return null
    return { ...base, type: 'mention', text, target }
  }

  if (value.type === 'skill') {
    const text = stringValue(value.text)
    const target = parseSkillTarget(value.target)
    if (!text || !target) return null
    return { ...base, type: 'skill', text, target }
  }

  if (value.type === 'workspaceLink') {
    const url = stringValue(value.url)
    const href = stringValue(value.href)
    if (!url || !href) return null
    const part: WorkspaceLinkMessagePart = {
      ...base,
      type: 'workspaceLink',
      url,
      href,
      resourceType: parseWorkspaceLinkResourceType(value.resourceType)
    }
    const token = optionalString(value.token)
    const title = optionalString(value.title)
    const subtitle = optionalString(value.subtitle)
    const iconUrl = optionalString(value.iconUrl)
    const enrichment = parseWorkspaceLinkEnrichment(value.enrichment)
    if (token) part.token = token
    if (title) part.title = title
    if (subtitle) part.subtitle = subtitle
    if (iconUrl) part.iconUrl = iconUrl
    if (enrichment) part.enrichment = enrichment
    return part
  }

  if (value.type === 'selectionContext') {
    const title = stringValue(value.title)
    const text = stringValue(value.text)
    const preview = stringValue(value.preview)
    if (!title || !text || !preview) return null
    const part: SelectionContextMessagePart = {
      ...base,
      type: 'selectionContext',
      title,
      text,
      preview
    }
    const sourceMessageId = optionalString(value.sourceMessageId)
    if (sourceMessageId) part.sourceMessageId = sourceMessageId
    return part
  }

  if (value.type === 'artifactContext') {
    const artifactId = stringValue(value.artifactId)
    const artifactKind = stringValue(value.artifactKind)
    const title = stringValue(value.title)
    const text = stringValue(value.text)
    const preview = stringValue(value.preview)
    if (!artifactId || !artifactKind || !title || !text || !preview) return null
    return {
      ...base,
      type: 'artifactContext',
      artifactId,
      artifactKind,
      title,
      text,
      preview
    }
  }

  if (value.type === 'comment') {
    const commentId = stringValue(value.commentId)
    const title = stringValue(value.title)
    const preview = stringValue(value.preview)
    const content = parseCommentContentBlocks(value.content)
    const origin = value.origin === 'browser' || value.origin === 'artifact' ? value.origin : null
    if (!commentId || !title || !preview || content.length === 0 || !origin) return null

    const part: CommentAttachmentMessagePart = {
      ...base,
      type: 'comment',
      commentId,
      content,
      origin,
      title,
      preview
    }

    const browserContext = parseBrowserContext(value.localBrowserContext)
    const browserMetadata = parseBrowserMetadata(value.localBrowserCommentMetadata)
    const browserScreenshot = parseBrowserScreenshot(value.localBrowserScreenshot, commentId)
    const artifactAnnotationContext = parseArtifactAnnotationContext(
      value.localArtifactAnnotationContext
    )

    if (origin === 'browser') {
      if (!browserContext) return null
      part.localBrowserContext = browserContext
      if (browserMetadata) part.localBrowserCommentMetadata = browserMetadata
      if (browserScreenshot) part.localBrowserScreenshot = browserScreenshot
      return part
    }

    if (origin === 'artifact') {
      if (!artifactAnnotationContext) return null
      part.localArtifactAnnotationContext = artifactAnnotationContext
      return part
    }

    return null
  }

  return null
}

export function normalizeMessageParts(value: unknown): MessagePart[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((part) => {
    const normalized = normalizeMessagePart(part)
    return normalized ? [normalized] : []
  })
}

export function parseMessagePartJson(value: string): MessagePart | null {
  try {
    return normalizeMessagePart(JSON.parse(value) as unknown)
  } catch {
    return null
  }
}

export function stringifyMessagePart(part: MessagePart): string {
  return JSON.stringify(part)
}

function truncatePartText(value: string | undefined, maxLength = 1000): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized
}

function commentContentText(part: CommentAttachmentMessagePart): string {
  return part.content
    .map((block) => block.text)
    .join('\n')
    .trim()
}

export function formatCommentAttachmentForModel(part: CommentAttachmentMessagePart): string {
  const lines = [
    `Comment attachment:`,
    `<comment id="${part.commentId}" origin="${part.origin}">`,
    '<content>',
    commentContentText(part),
    '</content>',
    '<context>'
  ]

  if (part.origin === 'browser') {
    const context = part.localBrowserContext
    const metadata = part.localBrowserCommentMetadata
    const screenshot = part.localBrowserScreenshot
    lines.push(`Page: ${context?.pageUrl ?? 'unknown'}`)
    if (context?.pageTitle) lines.push(`Page title: ${context.pageTitle}`)
    if (context?.framePath) {
      lines.push(
        `Frame path: ${Array.isArray(context.framePath) ? context.framePath.join('.') : context.framePath}`
      )
    }
    if (context?.frameUrl) lines.push(`Frame URL: ${context.frameUrl}`)
    if (context?.isFixed) lines.push('Anchor positioning: fixed')
    if (context?.scrollContainers?.length) {
      lines.push(
        `Scroll containers: ${context.scrollContainers
          .map(
            (container) => `${container.selector}(${container.scrollLeft},${container.scrollTop})`
          )
          .join(' > ')}`
      )
    }
    const target = [
      context?.targetRole,
      context?.targetName ? `"${context.targetName}"` : null,
      context?.targetSelector ? `selector=${context.targetSelector}` : null,
      context?.targetPath ? `path=${context.targetPath}` : null
    ]
      .filter(Boolean)
      .join(' ')
    if (target) lines.push(`Target: ${target}`)
    const targetDescription = truncatePartText(context?.targetDescription)
    const immediateText = truncatePartText(context?.targetImmediateText)
    const nearbyText = truncatePartText(context?.nearbyText)
    const documentContext = truncatePartText(context?.documentContext)
    if (targetDescription) lines.push(`Target description: ${targetDescription}`)
    if (immediateText) lines.push(`Immediate text: ${immediateText}`)
    if (nearbyText) lines.push(`Nearby text: ${nearbyText}`)
    if (documentContext) lines.push(`Document context: ${documentContext}`)
    if (metadata?.markerViewportPoint) {
      lines.push(`Marker: x=${metadata.markerViewportPoint.x} y=${metadata.markerViewportPoint.y}`)
    }
    if (screenshot) {
      lines.push(
        `Screenshot: path=${screenshot.path} width=${screenshot.width} height=${screenshot.height} compact=${screenshot.isCompact === true}`
      )
    }
  } else if (part.origin === 'artifact') {
    const context = part.localArtifactAnnotationContext
    lines.push(
      `Artifact: ${context?.path ?? 'unknown'} (kind=${context?.artifactKind ?? 'unknown'})`
    )
    if (context?.label !== undefined) lines.push(`Label: ${context.label}`)
    const target = context?.target
    if (target?.type === 'presentation-element-selection') {
      lines.push(
        `Target: presentation-element-selection elements=${target.elementIds.join(',')}${
          target.slideIndex !== undefined ? ` slide=${target.slideIndex}` : ''
        }`
      )
    } else if (target?.type === 'presentation-region') {
      lines.push(
        `Target: presentation-region x=${target.rect.x} y=${target.rect.y} width=${target.rect.width} height=${target.rect.height}${
          target.slideIndex !== undefined ? ` slide=${target.slideIndex}` : ''
        }`
      )
    } else if (target?.type === 'workbook-floating-element') {
      lines.push(
        `Target: workbook-floating-element element=${target.elementId}${
          target.sheetName ? ` sheet=${target.sheetName}` : ''
        }`
      )
    } else if (target?.type === 'workbook-range') {
      lines.push(
        `Target: workbook-range range=${target.range}${
          target.sheetName ? ` sheet=${target.sheetName}` : ''
        }`
      )
    }
  }

  lines.push('</context>', '</comment>')
  return lines.filter((line) => line.trim()).join('\n')
}

export function partsToDisplayText(parts: readonly MessagePart[]): string {
  return parts
    .flatMap((part) => {
      if (part.ui?.visibility === 'hidden') return []
      if (part.type === 'text') return [part.text]
      if (part.type === 'mention') return [part.text]
      if (part.type === 'skill') return [part.text]
      if (part.type === 'workspaceLink') return [part.url]
      if (part.type === 'selectionContext') return [part.preview]
      if (part.type === 'artifactContext') return [part.preview]
      if (part.type === 'comment') return [part.preview]
      return []
    })
    .join('')
    .trim()
}

export function partsToModelText(parts: readonly MessagePart[]): string {
  return parts
    .flatMap((part) => {
      if (part.model?.visibility === 'exclude') return []
      if (part.type === 'mention' && part.target.kind !== 'plugin') return [part.text]
      if (part.model?.text !== undefined) return [part.model.text]
      if (part.type === 'text') return [part.text]
      if (part.type === 'mention') return [part.text]
      if (part.type === 'skill') return [part.text]
      if (part.type === 'workspaceLink') return [part.url]
      if (part.type === 'selectionContext') return [part.text]
      if (part.type === 'artifactContext') return [part.text]
      if (part.type === 'comment') return [`\n\n${formatCommentAttachmentForModel(part)}`]
      return []
    })
    .join('')
    .trim()
}

const MARKDOWN_LINK_PATTERN = /\[([^\]\n]+)\]\(https?:\/\/[^\s)]+\)/giu
const RAW_URL_PATTERN = /\bhttps?:\/\/[^\s<>()]+/giu

export function textToTitleFallbackText(text: string): string {
  return text
    .replace(MARKDOWN_LINK_PATTERN, '$1')
    .replace(RAW_URL_PATTERN, '')
    .replace(/\s+([,.;:!?，。！？；：])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function partsToTitleText(parts: readonly MessagePart[]): string {
  return parts
    .flatMap((part) => {
      if (part.model?.visibility === 'exclude') return []
      if (part.type === 'mention' && part.target.kind !== 'plugin') return [part.text]
      if (part.type === 'workspaceLink') {
        const title = part.title?.trim()
        return title ? [`${title} (${part.url})`] : [part.model?.text ?? part.url]
      }
      if (part.model?.text !== undefined) return [part.model.text]
      if (part.type === 'text') return [part.text]
      if (part.type === 'mention') return [part.text]
      if (part.type === 'skill') return [part.text]
      if (part.type === 'selectionContext') return [`${part.title}: ${part.preview}`]
      if (part.type === 'artifactContext') return [`${part.title}: ${part.preview}`]
      if (part.type === 'comment') return [`${part.title}: ${part.preview}`]
      return []
    })
    .join('')
    .trim()
}

export function partsToTitleFallbackText(parts: readonly MessagePart[]): string {
  return parts
    .flatMap((part) => {
      if (part.model?.visibility === 'exclude') return []
      if (part.type === 'text') return [textToTitleFallbackText(part.text)]
      if (part.type === 'workspaceLink') {
        const title = part.title?.trim()
        if (title) return [title]
        return [part.resourceType === 'minutes' ? 'Workspace minutes' : 'Workspace link']
      }
      if (part.type === 'mention') return [part.text]
      if (part.type === 'skill') return [part.text]
      if (part.type === 'selectionContext') return [`${part.title}: ${part.preview}`]
      if (part.type === 'artifactContext') return [`${part.title}: ${part.preview}`]
      if (part.type === 'comment') return [`${part.title}: ${part.preview}`]
      return []
    })
    .join('')
    .trim()
}
