import type { CommentAttachmentMessagePart } from './message-parts.js'

export const BROWSER_ANNOTATION_HOST_COMMAND_CHANNEL = 'embedded-browser:annotation-host-command'
export const BROWSER_ANNOTATION_RUNTIME_EVENT_CHANNEL = 'embedded-browser:annotation-runtime-event'
export const BROWSER_ANNOTATION_SCREENSHOT_CROP_PADDING_PX = 96

export type BrowserAnnotationMode = 'browse' | 'comment'

export type BrowserAnnotationPoint = { x: number; y: number }
export type BrowserAnnotationRect = { x: number; y: number; width: number; height: number }
export type BrowserAnnotationSize = { width: number; height: number }
export type BrowserAnnotationScrollContainer = {
  selector: string
  scrollLeft: number
  scrollTop: number
}

export type BrowserAnnotationAnchor = {
  kind: 'element' | 'region'
  pageUrl: string
  title?: string
  framePath?: string[]
  frameUrl?: string
  selector?: string
  targetPath?: string
  targetRole?: string
  targetName?: string
  targetDescription?: string
  targetImmediateText?: string
  nearbyText?: string
  documentContext?: string
  isFixed?: boolean
  scrollContainers?: BrowserAnnotationScrollContainer[]
  viewportPoint: BrowserAnnotationPoint
  viewportRect?: BrowserAnnotationRect
  viewportSize: BrowserAnnotationSize
}

export type BrowserAnnotationRuntimeEvent =
  | { type: 'ready'; url: string; title?: string }
  | { type: 'draft-created'; annotation: BrowserAnnotationDraft }
  | { type: 'submit'; annotation: BrowserAnnotationSubmission }
  | { type: 'exit-comment-mode' }
  | { type: 'cancel-draft' }

export type BrowserAnnotationHostCommand =
  | { type: 'set-mode'; mode: BrowserAnnotationMode; labels: BrowserAnnotationLabels }
  | { type: 'discard' }
  | { type: 'cancel-draft' }
  | { type: 'commit'; annotationId: string; label: number; comment: string }
  | { type: 'sync-comments'; comments: BrowserAnnotationCommitted[] }
  | { type: 'select'; annotationId: string | null }

export type BrowserAnnotationLabels = {
  placeholder: string
  add: string
  cancel: string
  hint: string
}

export type BrowserAnnotationSubmission = {
  annotationId: string
  comment: string
  anchor: BrowserAnnotationAnchor
  pastedImages?: BrowserAnnotationPastedImage[]
}

export type BrowserAnnotationPastedImage = {
  name?: string
  mimeType: string
  data: ArrayBuffer
}

export type BrowserAnnotationDraft = {
  annotationId: string
  anchor: BrowserAnnotationAnchor
}

export type BrowserAnnotationCommitted = BrowserAnnotationSubmission & {
  label: number
}

export type BrowserAnnotationComposerPayload = CommentAttachmentMessagePart

export function browserCommentPartToCommittedAnnotation(
  part: CommentAttachmentMessagePart,
  label: number
): BrowserAnnotationCommitted | null {
  if (part.origin !== 'browser' || !part.localBrowserContext || !part.localBrowserCommentMetadata) {
    return null
  }
  const metadata = part.localBrowserCommentMetadata
  const context = part.localBrowserContext
  const viewportPoint = metadata.markerViewportPoint
  const viewportSize = metadata.viewportSize
  if (!viewportPoint || !viewportSize) return null
  const comment = part.content
    .map((block) => block.text)
    .join('\n')
    .trim()
  if (!comment) return null
  return {
    annotationId: part.commentId,
    label,
    comment,
    anchor: {
      kind: metadata.kind === 'region' ? 'region' : 'element',
      pageUrl: context.pageUrl,
      title: context.pageTitle,
      framePath: Array.isArray(context.framePath)
        ? context.framePath.every((item) => typeof item === 'string')
          ? [...context.framePath]
          : undefined
        : typeof context.framePath === 'string'
          ? [context.framePath]
          : undefined,
      frameUrl: context.frameUrl,
      selector: context.targetSelector,
      targetPath: context.targetPath,
      targetRole: context.targetRole,
      targetName: context.targetName,
      targetDescription: context.targetDescription,
      targetImmediateText: context.targetImmediateText,
      nearbyText: context.nearbyText,
      documentContext: context.documentContext,
      isFixed: context.isFixed,
      scrollContainers: context.scrollContainers,
      viewportPoint,
      viewportRect:
        part.localBrowserScreenshot?.annotationViewportRect ??
        part.localBrowserScreenshot?.cropViewportRect,
      viewportSize
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function positiveNumberValue(value: unknown): number | undefined {
  const number = numberValue(value)
  return number !== undefined && number > 0 ? number : undefined
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.map((item) => stringValue(item))
  return strings.every((item): item is string => Boolean(item)) ? strings : undefined
}

function parsePoint(value: unknown): BrowserAnnotationPoint | undefined {
  if (!isRecord(value)) return undefined
  const x = numberValue(value.x)
  const y = numberValue(value.y)
  return x === undefined || y === undefined ? undefined : { x, y }
}

function parseRect(value: unknown): BrowserAnnotationRect | undefined {
  if (!isRecord(value)) return undefined
  const x = numberValue(value.x)
  const y = numberValue(value.y)
  const width = positiveNumberValue(value.width)
  const height = positiveNumberValue(value.height)
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined
  }
  return { x, y, width, height }
}

function parseViewportSize(value: unknown): BrowserAnnotationSize | undefined {
  const rect = parseRect({ x: 0, y: 0, ...(isRecord(value) ? value : {}) })
  return rect ? { width: rect.width, height: rect.height } : undefined
}

function arrayBufferValue(value: unknown): ArrayBuffer | undefined {
  return value instanceof ArrayBuffer ? value : undefined
}

function parsePastedImages(value: unknown): BrowserAnnotationPastedImage[] | undefined {
  if (!Array.isArray(value)) return undefined
  const images = value.flatMap((item): BrowserAnnotationPastedImage[] => {
    if (!isRecord(item)) return []
    const data = arrayBufferValue(item.data)
    const mimeType = stringValue(item.mimeType)
    if (!data || !mimeType?.startsWith('image/')) return []
    const name = stringValue(item.name)
    return [
      {
        ...(name ? { name } : {}),
        mimeType,
        data
      }
    ]
  })
  return images.length > 0 ? images : undefined
}

export function browserAnnotationCompactScreenshotRect(
  annotationViewportRect: BrowserAnnotationRect | undefined,
  viewportSize: BrowserAnnotationSize | undefined,
  paddingPx = BROWSER_ANNOTATION_SCREENSHOT_CROP_PADDING_PX
): BrowserAnnotationRect | undefined {
  if (!annotationViewportRect || !viewportSize) return undefined
  if (viewportSize.width <= 0 || viewportSize.height <= 0 || paddingPx < 0) return undefined

  const left = Math.max(0, Math.floor(annotationViewportRect.x - paddingPx))
  const top = Math.max(0, Math.floor(annotationViewportRect.y - paddingPx))
  const right = Math.min(
    viewportSize.width,
    Math.ceil(annotationViewportRect.x + annotationViewportRect.width + paddingPx)
  )
  const bottom = Math.min(
    viewportSize.height,
    Math.ceil(annotationViewportRect.y + annotationViewportRect.height + paddingPx)
  )
  const width = right - left
  const height = bottom - top
  return width > 0 && height > 0 ? { x: left, y: top, width, height } : undefined
}

function parseScrollContainers(value: unknown): BrowserAnnotationScrollContainer[] | undefined {
  if (!Array.isArray(value)) return undefined
  const containers = value.map((item): BrowserAnnotationScrollContainer | null => {
    if (!isRecord(item)) return null
    const selector = stringValue(item.selector)
    const scrollLeft = numberValue(item.scrollLeft)
    const scrollTop = numberValue(item.scrollTop)
    if (!selector || scrollLeft === undefined || scrollTop === undefined) return null
    return { selector, scrollLeft, scrollTop }
  })
  return containers.every((item): item is BrowserAnnotationScrollContainer => item !== null)
    ? containers
    : undefined
}

function parsedUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function browserAnnotationUrlsMatch(expected: string, actual: string): boolean {
  const expectedUrl = parsedUrl(expected)
  const actualUrl = parsedUrl(actual)
  if (!expectedUrl || !actualUrl) return expected === actual

  const expectedProtocol = expectedUrl.protocol
  const actualProtocol = actualUrl.protocol
  if (
    (expectedProtocol === 'http:' || expectedProtocol === 'https:') &&
    (actualProtocol === 'http:' || actualProtocol === 'https:')
  ) {
    return (
      expectedUrl.origin === actualUrl.origin &&
      expectedUrl.pathname === actualUrl.pathname &&
      expectedUrl.search === actualUrl.search
    )
  }

  if (expectedProtocol === 'file:' && actualProtocol === 'file:') {
    return expectedUrl.pathname === actualUrl.pathname && expectedUrl.search === actualUrl.search
  }

  return expected === actual
}

export function parseBrowserAnnotationSubmission(
  value: unknown
): BrowserAnnotationSubmission | null {
  if (!isRecord(value)) return null
  const annotationId = stringValue(value.annotationId)
  const comment = stringValue(value.comment)
  if (!annotationId || !comment || !isRecord(value.anchor)) return null

  const pageUrl = stringValue(value.anchor.pageUrl)
  const kind =
    value.anchor.kind === 'region' ? 'region' : value.anchor.kind === 'element' ? 'element' : null
  const viewportPoint = parsePoint(value.anchor.viewportPoint)
  const viewportSize = parseViewportSize(value.anchor.viewportSize)
  if (!pageUrl || !kind || !viewportPoint || !viewportSize) return null

  const anchor: BrowserAnnotationAnchor = {
    kind,
    pageUrl,
    viewportPoint,
    viewportSize
  }
  const title = stringValue(value.anchor.title)
  const framePath = stringArrayValue(value.anchor.framePath)
  const frameUrl = stringValue(value.anchor.frameUrl)
  const selector = stringValue(value.anchor.selector)
  const targetPath = stringValue(value.anchor.targetPath)
  const targetRole = stringValue(value.anchor.targetRole)
  const targetName = stringValue(value.anchor.targetName)
  const targetDescription = stringValue(value.anchor.targetDescription)
  const targetImmediateText = stringValue(value.anchor.targetImmediateText)
  const nearbyText = stringValue(value.anchor.nearbyText)
  const documentContext = stringValue(value.anchor.documentContext)
  const scrollContainers = parseScrollContainers(value.anchor.scrollContainers)
  const viewportRect = parseRect(value.anchor.viewportRect)
  if (title) anchor.title = title
  if (framePath) anchor.framePath = framePath
  if (frameUrl) anchor.frameUrl = frameUrl
  if (selector) anchor.selector = selector
  if (targetPath) anchor.targetPath = targetPath
  if (targetRole) anchor.targetRole = targetRole
  if (targetName) anchor.targetName = targetName
  if (targetDescription) anchor.targetDescription = targetDescription
  if (targetImmediateText) anchor.targetImmediateText = targetImmediateText
  if (nearbyText) anchor.nearbyText = nearbyText
  if (documentContext) anchor.documentContext = documentContext
  if (value.anchor.isFixed === true) anchor.isFixed = true
  if (scrollContainers && scrollContainers.length > 0) anchor.scrollContainers = scrollContainers
  if (viewportRect) anchor.viewportRect = viewportRect
  const pastedImages = parsePastedImages(value.pastedImages)
  return { annotationId, comment, anchor, ...(pastedImages ? { pastedImages } : {}) }
}

export function parseBrowserAnnotationDraft(value: unknown): BrowserAnnotationDraft | null {
  if (!isRecord(value)) return null
  const annotationId = stringValue(value.annotationId)
  if (!annotationId || !isRecord(value.anchor)) return null
  const parsed = parseBrowserAnnotationSubmission({
    annotationId,
    comment: 'draft',
    anchor: value.anchor
  })
  return parsed ? { annotationId: parsed.annotationId, anchor: parsed.anchor } : null
}

export function parseBrowserAnnotationCommitted(value: unknown): BrowserAnnotationCommitted | null {
  const submission = parseBrowserAnnotationSubmission(value)
  if (!submission || !isRecord(value)) return null
  const label = numberValue(value.label)
  if (label === undefined || label <= 0 || !Number.isInteger(label)) return null
  return { ...submission, label }
}
