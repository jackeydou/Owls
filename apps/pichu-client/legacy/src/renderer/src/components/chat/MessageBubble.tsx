import { AttachmentCard } from '@renderer/components/chat/AttachmentCard'
import { ContextTag } from '@renderer/components/chat/ContextTag'
import {
  type ParsedMessageContextSegment,
  parseMessageContext
} from '@renderer/components/chat/context-tags'
import { MarkdownRenderer, MarkdownWebLinkIcon } from '@renderer/components/chat/MarkdownRenderer'
import { SkillTag } from '@renderer/components/chat/SkillTag'
import { InlineExternalLink } from '@renderer/components/ui/inline-external-link'
import { RawJsonViewer } from '@renderer/components/ui/raw-json-viewer'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { copyTextToClipboard } from '@renderer/lib/clipboard'
import { type I18nKey, useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { useArtifactsStore } from '@renderer/stores/artifacts-store'
import type { ChatMessage, ModelReconnectStatus } from '@renderer/stores/session-store'
import {
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronRight,
  Copy,
  MessageCircle,
  MessageSquare,
  MessageSquarePlus
} from 'lucide-react'
import { AnimatePresence, motion, type Transition, useReducedMotion } from 'motion/react'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MessageAttachment } from '../../../../preload/index.d'
import { parseContextCompactionMarker } from '../../../../shared/context-compaction'
import type {
  ArtifactContextMessagePart,
  CommentAttachmentMessagePart,
  MessagePart,
  SelectionContextMessagePart
} from '../../../../shared/message-parts'
import workspaceGlyphUrl from '../../assets/workspace-glyph.svg?asset'
import type { OpenSideChatEventDetail } from './chat-composer-types'
import {
  COMPOSER_ADD_TEXT_EVENT,
  SIDE_CHAT_OPEN_EVENT,
  selectCommentAttachment
} from './composer-events'
import { ImagePreviewDialog } from './ImagePreviewDialog'
import { SelectionContextPill } from './SelectionContextPill'
import type { ChatLinkOpener } from './useChatExternalLink'

const MOTION_FADE_INITIAL = { opacity: 0 }
const MOTION_FADE_ANIMATE = { opacity: 1 }
const MESSAGE_INITIAL = { opacity: 0, y: 6 }
const MESSAGE_ANIMATE = { opacity: 1, y: 0 }
const MESSAGE_TRANSITION: Transition = { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
const USER_MESSAGE_COPY_SCOPE_ATTRIBUTE = 'data-pichu-user-message-copy-scope'
const INLINE_COPY_TEXT_ATTRIBUTE = 'data-pichu-copy-text'
const USER_MESSAGE_COLLAPSED_LINES = 20
const USER_MESSAGE_MARKDOWN_LINK_PATTERN = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/giu
const USER_MESSAGE_URL_PATTERN = /https?:\/\/[^\s<>()]+/giu

type InlineTextSegment =
  | {
      kind: 'text'
      key: string
      text: string
    }
  | {
      kind: 'webLink'
      key: string
      text: string
      href: string
      copyText: string
    }

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatMessageTimeShort(createdAt?: string): string | null {
  if (!createdAt) return null

  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return null

  if (isSameLocalDay(date, new Date())) {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    }).format(date)
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(date)
}

function formatMessageTimeFull(createdAt?: string): string | null {
  if (!createdAt) return null

  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

function userMessageCopyText(content: string, parts?: readonly MessagePart[]): string {
  if (parts && parts.length > 0) {
    const text = parts
      .flatMap((part) => {
        if (part.ui?.visibility === 'hidden') return []
        if (part.type === 'text') return [part.text]
        if (part.type === 'mention') return [part.text]
        if (part.type === 'skill') return [part.text]
        if (part.type === 'workspaceLink') return [part.url]
        return []
      })
      .join('')
      .trim()
    if (text) return text
  }
  return content
}

function trimTrailingUrlPunctuation(value: string): {
  url: string
  trailing: string
} {
  const url = value.replace(/[.,!?;:)\]}]+$/u, '')
  return {
    url,
    trailing: value.slice(url.length)
  }
}

function parsePlainTextLinks(text: string, keyPrefix: string): InlineTextSegment[] {
  const segments: InlineTextSegment[] = []
  let cursor = 0
  let index = 0
  USER_MESSAGE_URL_PATTERN.lastIndex = 0

  for (const match of text.matchAll(USER_MESSAGE_URL_PATTERN)) {
    const start = match.index ?? 0
    const rawUrl = match[0]
    const { url, trailing } = trimTrailingUrlPunctuation(rawUrl)
    if (!url) continue

    if (start > cursor) {
      segments.push({
        kind: 'text',
        key: `${keyPrefix}:text:${index}`,
        text: text.slice(cursor, start)
      })
      index += 1
    }

    segments.push({
      kind: 'webLink',
      key: `${keyPrefix}:link:${index}`,
      text: url,
      href: url,
      copyText: url
    })
    index += 1

    if (trailing) {
      segments.push({
        kind: 'text',
        key: `${keyPrefix}:text:${index}`,
        text: trailing
      })
      index += 1
    }

    cursor = start + rawUrl.length
  }

  if (cursor < text.length) {
    segments.push({
      kind: 'text',
      key: `${keyPrefix}:text:${index}`,
      text: text.slice(cursor)
    })
  }

  return segments
}

function parseInlineTextLinks(text: string, keyPrefix: string): InlineTextSegment[] {
  const segments: InlineTextSegment[] = []
  let cursor = 0
  let index = 0
  USER_MESSAGE_MARKDOWN_LINK_PATTERN.lastIndex = 0

  for (const match of text.matchAll(USER_MESSAGE_MARKDOWN_LINK_PATTERN)) {
    const start = match.index ?? 0
    const raw = match[0]
    const label = match[1]
    const href = match[2]

    if (start > cursor) {
      segments.push(
        ...parsePlainTextLinks(text.slice(cursor, start), `${keyPrefix}:plain:${index}`)
      )
      index += 1
    }

    segments.push({
      kind: 'webLink',
      key: `${keyPrefix}:markdown-link:${index}`,
      text: label,
      href,
      copyText: raw
    })
    index += 1
    cursor = start + raw.length
  }

  if (cursor < text.length) {
    segments.push(...parsePlainTextLinks(text.slice(cursor), `${keyPrefix}:plain:${index}`))
  }

  return segments
}

function serializeClipboardNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ''
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element
    const copyText = element.getAttribute(INLINE_COPY_TEXT_ATTRIBUTE)
    if (copyText !== null) return copyText
    if (element.getAttribute('aria-hidden') === 'true') return ''
    if (element.tagName === 'BR') return '\n'
  }

  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return ''
  }

  return Array.from(node.childNodes).map(serializeClipboardNode).join('')
}

function closestUserMessageCopyScope(node: Node): Element | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return element?.closest(`[${USER_MESSAGE_COPY_SCOPE_ATTRIBUTE}]`) ?? null
}

export function handleUserMessageSelectionCopy(event: ClipboardEvent): void {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return

  const range = selection.getRangeAt(0)
  const startScope = closestUserMessageCopyScope(range.startContainer)
  const endScope = closestUserMessageCopyScope(range.endContainer)
  if (!startScope || startScope !== endScope) return

  const cloned = range.cloneContents()
  if (!cloned.querySelector(`[${INLINE_COPY_TEXT_ATTRIBUTE}]`)) return

  const text = serializeClipboardNode(cloned).trim()
  if (!text) return

  event.clipboardData?.setData('text/plain', text)
  event.preventDefault()
}

export function getEmptyChatGreetingKey(hour: number): I18nKey {
  let timeScopedKeys: I18nKey[]

  if (hour >= 5 && hour < 12) {
    timeScopedKeys = ['chat.greeting.goodMorning', 'chat.greeting.whatCanIDo']
  } else if (hour >= 12 && hour < 17) {
    timeScopedKeys = ['chat.greeting.goodAfternoon', 'chat.greeting.whatCanIDo']
  } else if (hour >= 17 && hour < 22) {
    timeScopedKeys = ['chat.greeting.goodEvening', 'chat.greeting.whatCanIDo']
  } else {
    timeScopedKeys = [
      'chat.greeting.lateNight',
      'chat.greeting.nightOwl',
      'chat.greeting.whatCanIDo'
    ]
  }

  return timeScopedKeys[Math.floor(Math.random() * timeScopedKeys.length)]
}

function MessageAttachments({
  attachments,
  align,
  sessionId,
  messageId,
  imageSize = 'thumbnail'
}: {
  attachments?: MessageAttachment[]
  align: 'start' | 'end'
  sessionId?: string | null
  messageId: string
  imageSize?: 'thumbnail' | 'large'
}): React.JSX.Element | null {
  if (!attachments || attachments.length === 0) return null

  const images = attachments.filter((attachment) => attachment.kind === 'image')
  const files = attachments.filter((attachment) => attachment.kind !== 'image')
  const justify = align === 'end' ? 'justify-end' : 'justify-start'
  const items = align === 'end' ? 'items-end' : 'items-start'

  return (
    <div className={cn('mb-2 flex w-full flex-col gap-2', items)}>
      {files.length > 0 ? (
        <div className={cn('flex max-w-full flex-wrap gap-2', justify)}>
          {files.map((attachment) => (
            <AttachmentCard
              key={attachment.id}
              attachment={attachment}
              artifactSessionId={sessionId}
              artifactMessageId={messageId}
            />
          ))}
        </div>
      ) : null}
      {images.length > 0 ? (
        <div className={cn('flex max-w-full flex-wrap gap-2', justify)}>
          {images.map((attachment) => (
            <AttachmentCard
              key={attachment.id}
              attachment={attachment}
              artifactSessionId={sessionId}
              artifactMessageId={messageId}
              display="image"
              imageSize={imageSize}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function InlineMessageContext({
  segments
}: {
  segments: ParsedMessageContextSegment[]
}): React.JSX.Element {
  return (
    <span className="whitespace-pre-wrap wrap-break-word">
      {segments.map((segment) => {
        if (segment.kind === 'text') {
          return (
            <InlineTextWithLinks key={segment.key} text={segment.text} segmentKey={segment.key} />
          )
        }
        if (segment.kind === 'workspaceLink') {
          return (
            <span key={segment.key} data-pichu-copy-text={segment.url}>
              <InlineExternalLink
                href={segment.href}
                iconMaskSrc={workspaceGlyphUrl}
                tooltip={segment.url}
              >
                {segment.text}
              </InlineExternalLink>
            </span>
          )
        }
        if (segment.kind === 'skill') {
          return <SkillTag key={segment.key} skill={segment.skill} />
        }
        return <ContextTag key={segment.key} tag={segment.tag} />
      })}
    </span>
  )
}

function InlineTextWithLinks({
  text,
  segmentKey
}: {
  text: string
  segmentKey: string
}): React.JSX.Element {
  return (
    <>
      {parseInlineTextLinks(text, segmentKey).map((segment) => {
        if (segment.kind === 'text') {
          return <span key={segment.key}>{segment.text}</span>
        }

        return (
          <span key={segment.key} data-pichu-copy-text={segment.copyText}>
            <InlineExternalLink
              href={segment.href}
              tooltip={segment.href}
              className="pichu-inline-link-with-icon"
            >
              <MarkdownWebLinkIcon href={segment.href} />
              {segment.text}
            </InlineExternalLink>
          </span>
        )
      })}
    </>
  )
}

function selectionContextParts(parts?: MessagePart[]): SelectionContextMessagePart[] {
  return (parts ?? []).filter(
    (part): part is SelectionContextMessagePart =>
      part.type === 'selectionContext' && part.ui?.visibility !== 'hidden'
  )
}

function artifactContextParts(parts?: MessagePart[]): ArtifactContextMessagePart[] {
  return (parts ?? []).filter(
    (part): part is ArtifactContextMessagePart =>
      part.type === 'artifactContext' && part.ui?.visibility !== 'hidden'
  )
}

function UserSelectionContextBlocks({
  parts
}: {
  parts?: MessagePart[]
}): React.JSX.Element | null {
  const selections = selectionContextParts(parts)
  if (selections.length === 0) return null

  return (
    <div className="mb-2 flex max-w-full justify-end">
      <SelectionContextPill selections={selections} />
    </div>
  )
}

function MessageArtifactContextBlocks({
  parts
}: {
  parts?: MessagePart[]
}): React.JSX.Element | null {
  const blocks = artifactContextParts(parts)
  if (blocks.length === 0) return null

  return (
    <div className="mt-2 flex w-full flex-col gap-1.5">
      {blocks.map((part) => (
        <div
          key={part.id}
          className="max-w-full rounded-lg border border-border/60 bg-background/60 px-2.5 py-2 text-left"
        >
          <div className="truncate text-[11px] font-medium text-muted-foreground">{part.title}</div>
          <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-foreground/80">
            {part.preview}
          </div>
        </div>
      ))}
    </div>
  )
}

function commentPartsFrom(parts?: MessagePart[]): CommentAttachmentMessagePart[] {
  return (parts ?? []).filter(
    (part): part is CommentAttachmentMessagePart => part.type === 'comment'
  )
}

function commentOnlyParts(
  content: string,
  parts?: MessagePart[]
): CommentAttachmentMessagePart[] | null {
  const comments = commentPartsFrom(parts)
  if (comments.length === 0) return null

  const hasOtherVisibleParts = (parts ?? []).some(
    (part) => part.type !== 'comment' && part.ui?.visibility !== 'hidden'
  )
  if (hasOtherVisibleParts) return null

  const trimmedContent = content.trim()
  if (!trimmedContent) return comments

  const commentDisplayText = comments
    .map((part) => part.preview)
    .join('')
    .trim()
  return trimmedContent === commentDisplayText ? comments : null
}

function commentScreenshotPath(parts: readonly CommentAttachmentMessagePart[]): string | null {
  for (const part of parts) {
    const path = part.localBrowserScreenshot?.path
    if (path) return path
  }
  return null
}

function commentContentText(part: CommentAttachmentMessagePart): string {
  return part.content
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function CommentAnnotationSummary({
  parts
}: {
  parts: CommentAttachmentMessagePart[]
}): React.JSX.Element {
  const { t } = useI18n()
  const screenshotPath = commentScreenshotPath(parts)
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setThumbnailSrc(null)
    if (!screenshotPath) return

    void window.api.attachments
      .readImageDataUrl(screenshotPath)
      .then((dataUrl) => {
        if (!cancelled) setThumbnailSrc(dataUrl)
      })
      .catch((error) => {
        console.error('Failed to load annotation thumbnail', error)
      })

    return () => {
      cancelled = true
    }
  }, [screenshotPath])

  const label = t(
    parts.length === 1 ? 'chat.comment.annotationSingular' : 'chat.comment.annotationPlural',
    { count: parts.length }
  )
  const firstBrowserComment = parts.find((part) => part.origin === 'browser') ?? null
  const firstBrowserCommentLabel = firstBrowserComment
    ? parts.filter((part) => part.origin === 'browser').indexOf(firstBrowserComment) + 1
    : undefined
  const commentPreviews = parts
    .map((part) => ({
      id: part.id,
      title: part.title,
      text: commentContentText(part) || part.preview
    }))
    .filter((part) => part.text.trim())

  return (
    <div
      data-pichu-user-message-copy-scope=""
      className="flex max-w-full flex-col items-end gap-1.5"
    >
      {thumbnailSrc ? (
        <button
          type="button"
          className="h-11 w-[68px] overflow-hidden rounded-lg border border-border/70 bg-background shadow-[0_6px_16px_-14px_rgba(15,23,42,0.8)] transition hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setPreviewOpen(true)}
          aria-label={t('chat.comment.previewAnnotationImage')}
        >
          <img src={thumbnailSrc} alt="" className="size-full object-cover" draggable={false} />
        </button>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          className="inline-flex h-[30px] max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 text-[13px] font-medium tracking-[-0.01em] text-foreground shadow-[0_6px_18px_-16px_rgba(15,23,42,0.85)] transition-colors hover:bg-card-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          aria-label={label}
          onClick={() => {
            if (firstBrowserComment) {
              selectCommentAttachment({
                comment: firstBrowserComment,
                label: firstBrowserCommentLabel
              })
            }
          }}
        >
          <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.9} />
          <span className="truncate">{label}</span>
        </TooltipTrigger>
        {commentPreviews.length > 0 ? (
          <TooltipContent side="top" className="max-w-[320px] px-3 py-2 text-left">
            <div className="space-y-2">
              {commentPreviews.slice(0, 3).map((comment) => (
                <div key={comment.id}>
                  {parts.length > 1 ? (
                    <div className="mb-0.5 truncate text-[11px] font-medium text-muted-foreground">
                      {comment.title}
                    </div>
                  ) : null}
                  <div className="line-clamp-4 whitespace-pre-wrap text-[12px] leading-5">
                    {comment.text}
                  </div>
                </div>
              ))}
            </div>
          </TooltipContent>
        ) : null}
      </Tooltip>
      {previewOpen && screenshotPath ? (
        <ImagePreviewDialog
          imageName={t('chat.comment.annotationImage')}
          imageSrc={thumbnailSrc}
          sourcePath={screenshotPath}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
  )
}

function UserMessageContent({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { t } = useI18n()
  const contentRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [canToggle, setCanToggle] = useState(false)

  useEffect(() => {
    if (expanded) return

    const element = contentRef.current
    if (!element) return

    const updateOverflowing = (): void => {
      setCanToggle(element.scrollHeight > element.clientHeight + 1)
    }

    updateOverflowing()

    const resizeObserver = new ResizeObserver(updateOverflowing)
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [expanded])

  const constrained = !expanded
  const toggleLabel = expanded ? t('chat.message.showLess') : t('chat.message.showMore')

  return (
    <div>
      <div
        ref={contentRef}
        data-pichu-user-message-copy-scope=""
        className={cn(constrained && 'overflow-hidden')}
        style={
          constrained
            ? {
                maxHeight: `calc(${USER_MESSAGE_COLLAPSED_LINES} * 1.35em)`
              }
            : undefined
        }
      >
        {children}
      </div>
      {canToggle ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-2 inline-flex items-center gap-1 text-[13px] leading-none text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        >
          {toggleLabel}
          <ChevronRight
            className={cn('size-3.5', expanded ? '-rotate-90' : 'rotate-90')}
            strokeWidth={1.9}
          />
        </button>
      ) : null}
    </div>
  )
}

function MessageFooterBase({
  align,
  copyText,
  createdAt,
  order,
  persistentCopyIcon = false,
  showTime = true
}: {
  align: 'start' | 'end'
  copyText: string
  createdAt?: string
  order: 'copy-time' | 'time-copy'
  persistentCopyIcon?: boolean
  showTime?: boolean
}): React.JSX.Element | null {
  const { t } = useI18n()
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const formattedTime = showTime ? formatMessageTimeShort(createdAt) : null
  const fullTime = showTime ? formatMessageTimeFull(createdAt) : null
  const canCopy = copyText.trim().length > 0

  if (!formattedTime && !canCopy) return null

  const revealOnMessageHover =
    'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'

  const copyButton = canCopy ? (
    <span
      key="copy"
      className={cn(
        'transition-opacity duration-150',
        persistentCopyIcon ? 'pointer-events-auto opacity-100' : revealOnMessageHover
      )}
    >
      <Tooltip>
        <TooltipTrigger
          aria-label={t(copyState === 'copied' ? 'chat.copiedMessage' : 'chat.copyMessage')}
          onClick={async () => {
            try {
              await copyTextToClipboard(copyText)
              setCopyState('copied')
              window.setTimeout(() => setCopyState('idle'), 1100)
            } catch (error) {
              console.error('Failed to copy message', error)
            }
          }}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-card-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        >
          {copyState === 'copied' ? (
            <Check className="size-3.5" strokeWidth={1.9} />
          ) : (
            <Copy className="size-3.5" strokeWidth={1.9} />
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('chat.copyMessage')}</TooltipContent>
      </Tooltip>
    </span>
  ) : null

  const timeLabel = formattedTime ? (
    <span key="time" className={cn('transition-opacity duration-150', revealOnMessageHover)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex h-6 -translate-y-0.5 cursor-text select-text items-center text-[12px] leading-none text-muted-foreground">
            {formattedTime}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{fullTime ?? formattedTime}</TooltipContent>
      </Tooltip>
    </span>
  ) : null

  const items = order === 'time-copy' ? [timeLabel, copyButton] : [copyButton, timeLabel]

  return (
    <div
      className={cn(
        'mt-0.5 flex h-7 select-none items-center gap-1 overflow-visible',
        align === 'end' ? 'justify-end' : 'justify-start'
      )}
    >
      {items}
    </div>
  )
}

const MessageFooter = memo(MessageFooterBase)
MessageFooter.displayName = 'MessageFooter'

type TextSelectionToolbarState = {
  text: string
  x: number
  y: number
}

const TEXT_SELECTION_TOOLBAR_VIEWPORT_MARGIN = 8

function clampSelectionToolbarLeft(anchorX: number, toolbarWidth: number): number {
  const margin = TEXT_SELECTION_TOOLBAR_VIEWPORT_MARGIN
  const viewportWidth = window.innerWidth
  if (toolbarWidth <= 0) {
    return Math.min(Math.max(anchorX, margin), viewportWidth - margin)
  }

  const halfWidth = Math.min(toolbarWidth, viewportWidth - margin * 2) / 2
  return Math.min(Math.max(anchorX, margin + halfWidth), viewportWidth - margin - halfWidth)
}

function selectionBelongsToElement(selection: Selection, element: HTMLElement): boolean {
  const anchorNode = selection.anchorNode
  const focusNode = selection.focusNode
  return Boolean(
    anchorNode && focusNode && element.contains(anchorNode) && element.contains(focusNode)
  )
}

function getSelectionToolbarAnchor(range: Range): { x: number; y: number } | null {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.top <= window.innerHeight &&
      rect.right >= 0 &&
      rect.left <= window.innerWidth
  )

  if (rects.length === 0) return null

  const weighted = rects.reduce(
    (acc, rect) => {
      const area = Math.max(1, rect.width * rect.height)
      return {
        x: acc.x + (rect.left + rect.width / 2) * area,
        area: acc.area + area
      }
    },
    { x: 0, area: 0 }
  )
  const top = Math.min(...rects.map((rect) => rect.top))

  return {
    x: weighted.area > 0 ? weighted.x / weighted.area : rects[0].left + rects[0].width / 2,
    y: Math.max(8, top - 10)
  }
}

function AssistantTextActions({
  sessionId,
  messageId,
  children
}: {
  sessionId: string | null
  messageId: string
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const deleteArtifact = useArtifactsStore((state) => state.deleteArtifact)
  const saveTextSelection = useArtifactsStore((state) => state.saveTextSelection)
  const [toolbar, setToolbar] = useState<TextSelectionToolbarState | null>(null)
  const [toolbarWidth, setToolbarWidth] = useState(0)
  const [saving, setSaving] = useState(false)
  const [savedArtifactId, setSavedArtifactId] = useState<string | null>(null)

  const updateSelection = useCallback((): void => {
    if (!sessionId) {
      setToolbar(null)
      return
    }

    const container = containerRef.current
    const selection = window.getSelection()
    if (
      !container ||
      !selection ||
      selection.isCollapsed ||
      !selectionBelongsToElement(selection, container)
    ) {
      setToolbar(null)
      return
    }

    const text = selection.toString().trim()
    if (!text) {
      setToolbar(null)
      return
    }

    const range = selection.getRangeAt(0)
    const anchor = getSelectionToolbarAnchor(range)
    if (!anchor) {
      setToolbar(null)
      return
    }

    setSavedArtifactId(null)
    setToolbar({
      text,
      x: anchor.x,
      y: anchor.y
    })
  }, [sessionId])

  useEffect(() => {
    if (!toolbar) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target && containerRef.current?.contains(target)) return
      if (target && toolbarRef.current?.contains(target)) return
      setToolbar(null)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [toolbar])

  useLayoutEffect(() => {
    if (!toolbar) {
      setToolbarWidth(0)
      return
    }

    const element = toolbarRef.current
    if (!element) return

    const updateToolbarWidth = (): void => {
      const nextWidth = Math.ceil(element.getBoundingClientRect().width)
      setToolbarWidth((current) => (current === nextWidth ? current : nextWidth))
    }

    updateToolbarWidth()
    const resizeObserver = new ResizeObserver(updateToolbarWidth)
    resizeObserver.observe(element)
    window.addEventListener('resize', updateToolbarWidth)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateToolbarWidth)
    }
  }, [toolbar])

  useEffect(() => {
    const handleSelectionUpdate = (): void => {
      window.setTimeout(updateSelection, 0)
    }

    document.addEventListener('mouseup', handleSelectionUpdate)
    document.addEventListener('keyup', handleSelectionUpdate)
    return () => {
      document.removeEventListener('mouseup', handleSelectionUpdate)
      document.removeEventListener('keyup', handleSelectionUpdate)
    }
  }, [updateSelection])

  const addToChat = (): void => {
    if (!toolbar) return
    window.dispatchEvent(
      new CustomEvent(COMPOSER_ADD_TEXT_EVENT, {
        detail: {
          text: toolbar.text,
          sourceMessageId: messageId
        }
      })
    )
    setToolbar(null)
  }

  const askInSideChat = (): void => {
    if (!toolbar) return
    window.dispatchEvent(
      new CustomEvent<OpenSideChatEventDetail>(SIDE_CHAT_OPEN_EVENT, {
        detail: {
          forceNew: false,
          selectionText: toolbar.text,
          sourceMessageId: messageId
        }
      })
    )
    setToolbar(null)
  }

  const saveSelection = async (): Promise<void> => {
    if (!sessionId || !toolbar || saving) return

    setSaving(true)
    try {
      if (savedArtifactId) {
        await deleteArtifact(savedArtifactId)
        setSavedArtifactId(null)
        return
      }

      const saved = await saveTextSelection({
        sessionId,
        text: toolbar.text,
        messageId,
        sourceLabel: messageId
      })
      setSavedArtifactId(saved.id)
    } catch (error) {
      console.error('Failed to save selected text artifact', error)
    } finally {
      setSaving(false)
    }
  }

  const toolbarLeft = toolbar ? clampSelectionToolbarLeft(toolbar.x, toolbarWidth) : 0

  return (
    <div ref={containerRef}>
      {children}
      {toolbar
        ? createPortal(
            <div
              ref={toolbarRef}
              role="toolbar"
              aria-label={t('chat.selection.toolbar')}
              className="fixed z-70 flex w-max max-w-[calc(100vw-16px)] -translate-x-1/2 -translate-y-[calc(100%+6px)] flex-nowrap items-center gap-0.5 rounded-full border border-black/10 bg-white/95 p-0.5 text-[12px] font-medium text-neutral-950 shadow-[0_5px_18px_rgb(0_0_0/0.13)] backdrop-blur-xl dark:border-white/12 dark:bg-neutral-950/95 dark:text-neutral-50"
              style={{ left: toolbarLeft, top: toolbar.y }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <button
                type="button"
                onClick={addToChat}
                className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-neutral-950 transition hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:text-neutral-50 dark:hover:bg-white/10"
                aria-label={t('chat.selection.addToChat')}
              >
                <MessageCircle className="size-3.5" strokeWidth={1.9} />
                {t('chat.selection.addToChat')}
              </button>
              <button
                type="button"
                onClick={askInSideChat}
                className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-neutral-950 transition hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:text-neutral-50 dark:hover:bg-white/10"
                aria-label={t('chat.selection.askInSideChat')}
              >
                <MessageSquarePlus className="size-3.5" strokeWidth={1.9} />
                {t('chat.selection.askInSideChat')}
              </button>
              <Tooltip>
                <TooltipTrigger
                  onClick={() => void saveSelection()}
                  disabled={saving}
                  className="inline-flex size-7 items-center justify-center rounded-full text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-neutral-50"
                  aria-label={t(
                    savedArtifactId ? 'artifacts.removeFromArtifacts' : 'artifacts.saveToArtifacts'
                  )}
                >
                  {savedArtifactId ? (
                    <BookmarkCheck className="size-3.5 text-accent" />
                  ) : (
                    <Bookmark className="size-3.5" strokeWidth={1.9} />
                  )}
                </TooltipTrigger>
                <TooltipContent side="top">
                  {t(
                    savedArtifactId ? 'artifacts.removeFromArtifacts' : 'artifacts.saveToArtifacts'
                  )}
                </TooltipContent>
              </Tooltip>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

export function ReconnectStatusBlock({
  status,
  defaultExpanded = false
}: {
  status: ModelReconnectStatus
  defaultExpanded?: boolean
}): React.JSX.Element | null {
  const reduceMotion = useReducedMotion()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const summary = status.lines.at(-1) ?? status.error ?? 'Reconnecting...'
  const details = [...status.lines, status.error].filter(
    (line): line is string => typeof line === 'string' && line.trim().length > 0
  )
  const canExpand = details.length > 1 || Boolean(status.error)

  if (!summary.trim()) return null

  return (
    <motion.div
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="py-1 text-muted-foreground"
    >
      <button
        type="button"
        onClick={() => canExpand && setExpanded((value) => !value)}
        disabled={!canExpand}
        aria-expanded={canExpand ? expanded : undefined}
        className="flex max-w-full items-center gap-1.5 rounded-md px-0 py-0.5 text-left text-[14px] leading-[1.45] text-muted-foreground/85 transition-colors enabled:hover:text-foreground disabled:cursor-default"
      >
        <span className="min-w-0 truncate">{summary}</span>
        {canExpand ? (
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground/60 transition-transform',
              expanded && 'rotate-90'
            )}
            strokeWidth={1.8}
          />
        ) : null}
      </button>

      <AnimatePresence initial={false}>
        {canExpand && expanded ? (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-1 space-y-1 text-[14px] leading-[1.45] text-muted-foreground/80">
              {details.map((line) => (
                <div key={line} className="whitespace-pre-wrap wrap-break-word">
                  {line}
                </div>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}

function MessageBubbleBase({
  message,
  sessionId,
  debugMode,
  onOpenLink,
  suppressedAttachmentPaths,
  persistentCopyIcon,
  showFooter
}: {
  message: ChatMessage
  sessionId: string | null
  debugMode: boolean
  onOpenLink: ChatLinkOpener
  suppressedAttachmentPaths?: Set<string>
  persistentCopyIcon: boolean
  showFooter: boolean
}): React.JSX.Element | null {
  const reduceMotion = useReducedMotion()
  const { t } = useI18n()
  const saveImageUrl = useArtifactsStore((state) => state.saveImageUrl)
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const visibleAttachments =
    !isUser && suppressedAttachmentPaths && message.attachments
      ? message.attachments.filter((attachment) => !suppressedAttachmentPaths.has(attachment.path))
      : message.attachments
  const handleSaveMarkdownImage = useCallback(
    async (request: { url: string; title?: string; alt?: string | null }) => {
      if (!sessionId) return null
      return saveImageUrl({ sessionId, messageId: message.id, ...request })
    },
    [message.id, saveImageUrl, sessionId]
  )

  const debugBlock = debugMode ? <RawJsonViewer data={message} /> : null

  if (isSystem) {
    const compactionMarker = parseContextCompactionMarker(message.content)
    if (compactionMarker) {
      return (
        <motion.div
          data-message-id={message.id}
          layout
          initial={reduceMotion ? false : MOTION_FADE_INITIAL}
          animate={MOTION_FADE_ANIMATE}
          className="mx-auto w-full max-w-(--pichu-chat-content-max-width) py-3"
        >
          <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
            <div className="h-px min-w-8 flex-1 bg-border" />
            <span className="shrink-0">{t('chat.contextCompacted')}</span>
            <div className="h-px min-w-8 flex-1 bg-border" />
          </div>
          {debugBlock}
        </motion.div>
      )
    }

    return (
      <motion.div
        data-message-id={message.id}
        layout
        initial={reduceMotion ? false : MOTION_FADE_INITIAL}
        animate={MOTION_FADE_ANIMATE}
        className="mx-auto w-full max-w-(--pichu-chat-content-max-width) rounded-xl border border-border/60 bg-card-muted/60 p-3 text-[12px] text-muted-foreground/80"
      >
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
          System Prompt
        </div>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap wrap-break-word font-mono leading-relaxed">
          {message.content}
        </pre>
        {debugBlock}
      </motion.div>
    )
  }

  if (isUser) {
    const parsed = parseMessageContext(message.content, message.parts)
    const annotationParts = commentOnlyParts(message.content, message.parts)
    const hasArtifactContextBlocks = artifactContextParts(message.parts).length > 0
    const hasBubbleContent =
      !annotationParts &&
      (parsed.segments.length > 0 ||
        Boolean(parsed.text) ||
        Boolean(debugBlock) ||
        hasArtifactContextBlocks)
    const copyText = userMessageCopyText(message.content, message.parts) || parsed.displayText
    return (
      <motion.div
        data-message-id={message.id}
        layout
        initial={reduceMotion ? false : MESSAGE_INITIAL}
        animate={MESSAGE_ANIMATE}
        transition={MESSAGE_TRANSITION}
        className="group mx-auto flex w-full max-w-(--pichu-chat-content-max-width) justify-end"
      >
        <div className="flex min-w-0 max-w-[70%] flex-col items-end">
          <MessageAttachments
            attachments={visibleAttachments}
            align="end"
            sessionId={sessionId}
            messageId={message.id}
          />
          <UserSelectionContextBlocks parts={message.parts} />
          {annotationParts ? (
            <div className="flex max-w-full flex-col items-end">
              <CommentAnnotationSummary parts={annotationParts} />
              {debugBlock}
            </div>
          ) : null}
          {hasBubbleContent ? (
            <div className="w-fit max-w-full rounded-[14px] bg-user px-3.5 py-2.5 text-[14px] leading-[1.35] text-foreground">
              <UserMessageContent>
                <InlineMessageContext segments={parsed.segments} />
                <MessageArtifactContextBlocks parts={message.parts} />
                {debugBlock}
              </UserMessageContent>
            </div>
          ) : null}
          {showFooter ? (
            <MessageFooter
              align="end"
              copyText={copyText}
              createdAt={message.createdAt}
              order="time-copy"
              persistentCopyIcon={persistentCopyIcon}
            />
          ) : null}
        </div>
      </motion.div>
    )
  }

  if (
    !message.content.trim() &&
    !message.reconnectStatus &&
    !debugBlock &&
    (!visibleAttachments || visibleAttachments.length === 0)
  ) {
    return null
  }

  return (
    <motion.div
      data-message-id={message.id}
      layout
      initial={reduceMotion ? false : MESSAGE_INITIAL}
      animate={MESSAGE_ANIMATE}
      transition={MESSAGE_TRANSITION}
      className="group mx-auto mb-1 w-full max-w-(--pichu-chat-content-max-width)"
    >
      <div className="min-w-0 text-foreground">
        <MessageAttachments
          attachments={visibleAttachments}
          align="start"
          sessionId={sessionId}
          messageId={message.id}
          imageSize="large"
        />
        {message.reconnectStatus ? (
          <ReconnectStatusBlock
            status={message.reconnectStatus}
            defaultExpanded={Boolean(message.reconnectStatus.error)}
          />
        ) : null}
        {message.content.trim() ? (
          <AssistantTextActions sessionId={sessionId} messageId={message.id}>
            <MarkdownRenderer
              content={message.content}
              onOpenLink={onOpenLink}
              onSaveImage={sessionId ? handleSaveMarkdownImage : undefined}
            />
          </AssistantTextActions>
        ) : null}
        {debugBlock}
        {showFooter ? (
          <MessageFooter
            align="start"
            copyText={message.content}
            createdAt={message.createdAt}
            order="copy-time"
            persistentCopyIcon={persistentCopyIcon}
          />
        ) : null}
      </div>
    </motion.div>
  )
}

export const MessageBubble = memo(MessageBubbleBase)
MessageBubble.displayName = 'MessageBubble'

export function StreamingAssistantMessage({
  text,
  reduceMotion,
  onOpenLink
}: {
  text: string
  reduceMotion: boolean
  onOpenLink: ChatLinkOpener
}): React.JSX.Element {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12 }}
      className="mx-auto w-full max-w-(--pichu-chat-content-max-width)"
    >
      <div className="min-w-0 text-foreground/90">
        <MarkdownRenderer content={text} isStreaming onOpenLink={onOpenLink} />
      </div>
    </motion.div>
  )
}
