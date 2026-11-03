import {
  PENDING_CHAT_ARTIFACTS_STORAGE_KEY,
  PENDING_CHAT_ATTACHMENTS_STORAGE_KEY
} from '@renderer/components/chat/composer-events'
import type { ToolWidgetState } from '@renderer/components/tool-widgets/types'
import { WidgetRenderer } from '@renderer/components/WidgetRenderer'
import { type I18nKey, useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { useArtifactsStore } from '@renderer/stores/artifacts-store'
import { useSessionStore } from '@renderer/stores/session-store'
import {
  Check,
  Code2,
  File,
  FileText,
  Image,
  Link2,
  Loader2,
  MessageCircle,
  Music,
  Play,
  Plus,
  Search,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  ArtifactPayload,
  ArtifactRecord,
  FileArtifactPayload,
  ImageArtifactPayload,
  StreamingUiArtifactPayload,
  TextArtifactPayload
} from '../../../shared/artifacts'
import type { AttachmentInput } from '../../../shared/attachments'

type ArtifactFilter =
  | 'all'
  | 'streamingUi'
  | 'text'
  | 'image'
  | 'file'
  | 'code'
  | 'doc'
  | 'video'
  | 'audio'
  | 'link'

type ArtifactDisplayType = Exclude<ArtifactFilter, 'all'>
type ArtifactChatContext = {
  id: string
  artifactId: string
  kind: string
  title: string
  body: string
  preview: string
}

const FILTERS: ArtifactFilter[] = [
  'all',
  'streamingUi',
  'text',
  'image',
  'file',
  'code',
  'doc',
  'video',
  'audio',
  'link'
]

const TYPE_META: Record<
  ArtifactDisplayType,
  {
    labelKey: I18nKey
    className: string
    icon: typeof File
  }
> = {
  streamingUi: {
    labelKey: 'artifacts.type.streamingUi',
    className: 'bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-200',
    icon: FileText
  },
  text: {
    labelKey: 'artifacts.type.text',
    className: 'bg-lime-100 text-lime-700 dark:bg-lime-400/15 dark:text-lime-200',
    icon: FileText
  },
  image: {
    labelKey: 'artifacts.type.image',
    className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-200',
    icon: Image
  },
  file: {
    labelKey: 'artifacts.type.file',
    className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-400/15 dark:text-zinc-200',
    icon: File
  },
  code: {
    labelKey: 'artifacts.type.code',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200',
    icon: Code2
  },
  doc: {
    labelKey: 'artifacts.type.doc',
    className: 'bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-200',
    icon: File
  },
  video: {
    labelKey: 'artifacts.type.video',
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-200',
    icon: Play
  },
  audio: {
    labelKey: 'artifacts.type.audio',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200',
    icon: Music
  },
  link: {
    labelKey: 'artifacts.type.link',
    className: 'bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-200',
    icon: Link2
  }
}

function formatArtifactTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatBytes(size: number | null | undefined): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return ''
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function parseArtifactPayload(artifact: ArtifactRecord): ArtifactPayload | null {
  try {
    return JSON.parse(artifact.payloadJson) as ArtifactPayload
  } catch {
    return null
  }
}

function parseStreamingUiPayload(artifact: ArtifactRecord): StreamingUiArtifactPayload | null {
  const payload = parseArtifactPayload(artifact) as Partial<StreamingUiArtifactPayload> | null
  if (
    payload &&
    payload.toolName === 'streamingUITool' &&
    typeof payload.title === 'string' &&
    typeof payload.html === 'string'
  ) {
    return {
      toolName: 'streamingUITool',
      title: payload.title,
      html: payload.html
    }
  }
  return null
}

function parseTextPayload(artifact: ArtifactRecord): TextArtifactPayload | null {
  const payload = parseArtifactPayload(artifact) as Partial<TextArtifactPayload> | null
  return payload && typeof payload.text === 'string' ? { text: payload.text } : null
}

function parseFilePayload(artifact: ArtifactRecord): FileArtifactPayload | null {
  const payload = parseArtifactPayload(artifact) as Partial<FileArtifactPayload> | null
  if (!payload || typeof payload.name !== 'string' || typeof payload.path !== 'string') return null
  return {
    name: payload.name,
    path: payload.path,
    mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : null,
    size: typeof payload.size === 'number' ? payload.size : null
  }
}

function isLocalArtifactPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//')
}

function nameFromLocalPath(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function parseImagePayload(artifact: ArtifactRecord): ImageArtifactPayload | null {
  const payload = parseArtifactPayload(artifact) as Record<string, unknown> | null
  if (!payload || (payload.source !== 'file' && payload.source !== 'url')) return null
  if (payload.source === 'file') {
    if (typeof payload.name !== 'string' || typeof payload.path !== 'string') return null
    return {
      source: 'file',
      name: payload.name,
      path: payload.path,
      mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : null,
      size: typeof payload.size === 'number' ? payload.size : null,
      previewDataUrl: typeof payload.previewDataUrl === 'string' ? payload.previewDataUrl : null
    }
  }
  if (typeof payload.url !== 'string' || typeof payload.title !== 'string') return null
  if (isLocalArtifactPath(payload.url)) {
    return {
      source: 'file',
      name: payload.title || nameFromLocalPath(payload.url),
      path: payload.url,
      mimeType: null,
      size: null,
      previewDataUrl: null
    }
  }
  return {
    source: 'url',
    title: payload.title,
    url: payload.url,
    alt: typeof payload.alt === 'string' ? payload.alt : null
  }
}

function artifactToWidget(
  artifact: ArtifactRecord,
  payload: StreamingUiArtifactPayload
): ToolWidgetState {
  return {
    toolCallId: artifact.sourceToolCallId ?? artifact.id,
    toolName: payload.toolName,
    title: artifact.title || payload.title,
    args: {
      title: payload.title,
      html: payload.html
    },
    status: 'complete',
    isError: false
  }
}

function getArtifactType(artifact: ArtifactRecord): ArtifactDisplayType {
  if (artifact.kind === 'streaming-ui') return 'streamingUi'
  if (artifact.kind === 'text') return 'text'
  if (artifact.kind === 'image') return 'image'
  if (artifact.kind === 'file') {
    const payload = parseFilePayload(artifact)
    const mimeType = payload?.mimeType?.toLowerCase() ?? ''
    if (mimeType.startsWith('video/')) return 'video'
    if (mimeType.startsWith('audio/')) return 'audio'
    if (
      mimeType.includes('javascript') ||
      mimeType.includes('json') ||
      mimeType.includes('typescript') ||
      mimeType.includes('xml')
    ) {
      return 'code'
    }
    if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text/')) {
      return 'doc'
    }
    return 'file'
  }
  return 'file'
}

function getArtifactHtml(artifact: ArtifactRecord): string | null {
  const payload = artifact.kind === 'streaming-ui' ? parseStreamingUiPayload(artifact) : null
  return payload?.html ?? null
}

function getArtifactSearchText(artifact: ArtifactRecord): string {
  const type = getArtifactType(artifact)
  const parts: string[] = [
    artifact.title,
    artifact.kind,
    type,
    artifact.sourceSessionTitle ?? '',
    artifact.sourceSessionId ?? ''
  ]

  if (artifact.kind === 'streaming-ui') {
    const payload = parseStreamingUiPayload(artifact)
    if (payload) parts.push(payload.title, payload.html)
  } else if (artifact.kind === 'text') {
    const payload = parseTextPayload(artifact)
    if (payload) parts.push(payload.text)
  } else if (artifact.kind === 'file') {
    const payload = parseFilePayload(artifact)
    if (payload) {
      parts.push(payload.name, payload.path, payload.mimeType ?? '', formatBytes(payload.size))
    }
  } else if (artifact.kind === 'image') {
    const payload = parseImagePayload(artifact)
    if (payload?.source === 'file') {
      parts.push(payload.name, payload.path, payload.mimeType ?? '', formatBytes(payload.size))
    } else if (payload?.source === 'url') {
      parts.push(payload.title, payload.url, payload.alt ?? '')
    }
  }

  return parts.filter(Boolean).join('\n').toLowerCase()
}

function artifactToChatContext(artifact: ArtifactRecord): ArtifactChatContext | null {
  if (artifact.kind === 'streaming-ui') {
    const payload = parseStreamingUiPayload(artifact)
    if (!payload) return null
    return {
      id: crypto.randomUUID(),
      artifactId: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      body: [`Title: ${payload.title}`, 'HTML:', payload.html].join('\n'),
      preview: payload.title
    }
  }

  if (artifact.kind === 'text') {
    const payload = parseTextPayload(artifact)
    if (!payload) return null
    return {
      id: crypto.randomUUID(),
      artifactId: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      body: payload.text,
      preview: payload.text.replace(/\s+/g, ' ').slice(0, 80)
    }
  }

  if (artifact.kind === 'file') {
    return null
  }

  const payload = parseImagePayload(artifact)
  if (!payload) return null
  if (payload.source === 'file') {
    return null
  }

  return {
    id: crypto.randomUUID(),
    artifactId: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    body: [`Image URL: ${payload.url}`, payload.alt ? `Alt: ${payload.alt}` : '']
      .filter(Boolean)
      .join('\n'),
    preview: payload.url
  }
}

function artifactToAttachmentInput(artifact: ArtifactRecord): AttachmentInput | null {
  if (artifact.kind === 'file') {
    const payload = parseFilePayload(artifact)
    if (!payload) return null
    return {
      path: payload.path,
      name: payload.name,
      mimeType: payload.mimeType ?? null
    }
  }

  if (artifact.kind === 'image') {
    const payload = parseImagePayload(artifact)
    if (!payload || payload.source !== 'file') return null
    return {
      path: payload.path,
      name: payload.name,
      mimeType: payload.mimeType ?? null
    }
  }

  return null
}

function artifactsToChatInputs(artifacts: ArtifactRecord[]): {
  contexts: ArtifactChatContext[]
  attachments: AttachmentInput[]
} {
  const contexts: ArtifactChatContext[] = []
  const attachments: AttachmentInput[] = []

  for (const artifact of artifacts) {
    const attachment = artifactToAttachmentInput(artifact)
    if (attachment) {
      attachments.push(attachment)
      continue
    }

    const context = artifactToChatContext(artifact)
    if (context) contexts.push(context)
  }

  return { contexts, attachments }
}

function TypeBadge({ type }: { type: ArtifactDisplayType }): React.JSX.Element {
  const { t } = useI18n()
  const meta = TYPE_META[type]

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
        meta.className
      )}
    >
      {t(meta.labelKey)}
    </span>
  )
}

function ArtifactImagePreview({
  payload,
  title,
  compact = false
}: {
  payload: ImageArtifactPayload
  title: string
  compact?: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  const [imageSrc, setImageSrc] = useState<string | null>(() => {
    if (payload.source === 'url') return payload.url
    return payload.previewDataUrl ?? null
  })

  useEffect(() => {
    let cancelled = false
    if (payload.source === 'url') {
      setImageSrc(payload.url)
      return
    }
    if (payload.previewDataUrl) {
      setImageSrc(payload.previewDataUrl)
      return
    }

    void window.api.attachments
      .readImageDataUrl(payload.path)
      .then((dataUrl) => {
        if (!cancelled) setImageSrc(dataUrl)
      })
      .catch((error) => {
        console.error('Failed to load artifact image preview', error)
        if (!cancelled) setImageSrc(null)
      })

    return () => {
      cancelled = true
    }
  }, [payload])

  if (!imageSrc) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-linear-to-br from-card-muted to-background text-muted-foreground">
        <Image className="size-10 opacity-55" strokeWidth={1.5} />
        <p className="mt-3 px-5 text-center text-[12px]">{t('artifacts.noPreview')}</p>
      </div>
    )
  }

  return (
    <img
      src={imageSrc}
      alt={payload.source === 'url' ? (payload.alt ?? title) : title}
      className={compact ? 'size-full object-cover' : 'max-h-[70vh] max-w-full object-contain'}
      draggable={false}
    />
  )
}

function ArtifactThumbnail({
  artifact,
  type
}: {
  artifact: ArtifactRecord
  type: ArtifactDisplayType
}): React.JSX.Element {
  const { t } = useI18n()
  const Icon = TYPE_META[type].icon
  const html = getArtifactHtml(artifact)
  const textPayload = artifact.kind === 'text' ? parseTextPayload(artifact) : null
  const imagePayload = artifact.kind === 'image' ? parseImagePayload(artifact) : null

  if (html) {
    return (
      <iframe
        title={t('artifacts.previewTitle', { title: artifact.title })}
        sandbox=""
        srcDoc={html}
        className="h-full w-full border-0 bg-white"
      />
    )
  }

  if (imagePayload) {
    return <ArtifactImagePreview payload={imagePayload} title={artifact.title} compact />
  }

  if (textPayload) {
    return (
      <div className="h-full overflow-hidden bg-card px-4 py-4 text-[12px] leading-relaxed text-foreground/80">
        <p className="line-clamp-8 whitespace-pre-wrap wrap-break-word">{textPayload.text}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center bg-linear-to-br from-card-muted to-background text-muted-foreground">
      <Icon className="size-10 opacity-55" strokeWidth={1.5} />
      <p className="mt-3 px-5 text-center text-[12px]">{t('artifacts.noPreview')}</p>
    </div>
  )
}

function ArtifactCard({
  artifact,
  busy,
  selected,
  onOpen,
  onUseInChat,
  onToggleSelected,
  onOpenSource,
  onDelete
}: {
  artifact: ArtifactRecord
  busy: boolean
  selected: boolean
  onOpen: (artifact: ArtifactRecord) => void
  onUseInChat: (artifact: ArtifactRecord) => void
  onToggleSelected: (artifact: ArtifactRecord) => void
  onOpenSource: (artifact: ArtifactRecord) => void
  onDelete: (id: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const type = getArtifactType(artifact)
  const sourceTitle = artifact.sourceSessionTitle?.trim() || t('artifacts.sourceUntitled')

  return (
    <article
      className={cn(
        'group overflow-hidden rounded-xl border bg-card shadow-sm transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
        selected ? 'border-accent ring-2 ring-accent/20' : 'border-border'
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-card-muted">
        <button
          type="button"
          onClick={() => onOpen(artifact)}
          className="block h-full w-full text-left"
          aria-label={t('artifacts.open', { title: artifact.title })}
        >
          <div className="pointer-events-none h-full w-full">
            <ArtifactThumbnail artifact={artifact} type={type} />
          </div>
        </button>
        <div className="absolute right-2.5 top-2.5">
          <TypeBadge type={type} />
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onToggleSelected(artifact)
          }}
          className={cn(
            'absolute left-2.5 top-2.5 z-10 flex size-7 items-center justify-center rounded-full border border-border/70 bg-background/95 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition hover:bg-card hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100',
            selected && 'border-accent bg-accent text-accent-foreground opacity-100'
          )}
          aria-label={t(selected ? 'artifacts.unselect' : 'artifacts.select', {
            title: artifact.title
          })}
          aria-pressed={selected}
        >
          {selected ? <Check className="size-4" strokeWidth={2} /> : null}
        </button>
        {artifact.sourceSessionId ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onOpenSource(artifact)
            }}
            className="absolute bottom-2.5 left-2.5 z-10 inline-flex max-w-[calc(100%-1.25rem)] items-center gap-1.5 rounded-full border border-border/70 bg-background/95 px-2.5 py-1.5 text-[11px] font-medium text-foreground opacity-0 shadow-sm backdrop-blur transition hover:bg-card group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={t('artifacts.openSourceSession', { title: sourceTitle })}
            title={sourceTitle}
          >
            <MessageCircle className="size-3.5 shrink-0" strokeWidth={1.9} />
            <span className="truncate">{sourceTitle}</span>
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2.5 border-t border-border/70 px-3 py-2.5">
        <button
          type="button"
          onClick={() => onOpen(artifact)}
          className="min-w-0 flex-1 text-left"
          aria-label={t('artifacts.open', { title: artifact.title })}
        >
          <h2 className="truncate text-[13px] font-semibold text-foreground">{artifact.title}</h2>
        </button>
        <time className="shrink-0 text-[10px] text-muted-foreground" dateTime={artifact.updatedAt}>
          {formatArtifactTime(artifact.updatedAt)}
        </time>
        <button
          type="button"
          onClick={() => onUseInChat(artifact)}
          className="rounded-md p-1.5 text-muted-foreground/0 transition group-hover:text-muted-foreground hover:bg-sidebar-hover hover:text-foreground focus:text-muted-foreground"
          aria-label={t('artifacts.useInChat', { title: artifact.title })}
        >
          <Plus className="size-4" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDelete(artifact.id)}
          className="rounded-md p-1.5 text-muted-foreground/0 transition group-hover:text-muted-foreground hover:bg-sidebar-hover hover:text-destructive focus:text-muted-foreground disabled:opacity-40"
          aria-label={t('artifacts.delete', { title: artifact.title })}
        >
          <Trash2 className="size-4" strokeWidth={1.8} />
        </button>
      </div>
    </article>
  )
}

function ArtifactPreviewDialog({
  artifact,
  busy,
  onClose,
  onUseInChat,
  onOpenSource,
  onDelete
}: {
  artifact: ArtifactRecord | null
  busy: boolean
  onClose: () => void
  onUseInChat: (artifact: ArtifactRecord) => void
  onOpenSource: (artifact: ArtifactRecord) => void
  onDelete: (id: string) => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  const payload = artifact?.kind === 'streaming-ui' ? parseStreamingUiPayload(artifact) : null
  const widget = artifact && payload ? artifactToWidget(artifact, payload) : null
  const type = artifact ? getArtifactType(artifact) : null
  const textPayload = artifact?.kind === 'text' ? parseTextPayload(artifact) : null
  const filePayload = artifact?.kind === 'file' ? parseFilePayload(artifact) : null
  const imagePayload = artifact?.kind === 'image' ? parseImagePayload(artifact) : null

  useEffect(() => {
    if (!artifact) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [artifact, onClose])

  if (!artifact || !type) return null
  const sourceTitle = artifact.sourceSessionTitle?.trim() || t('artifacts.sourceUntitled')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-5 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('artifacts.previewTitle', { title: artifact.title })}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-border/70 bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
          <div className="min-w-0">
            <div className="mb-2">
              <TypeBadge type={type} />
            </div>
            <h2 className="truncate text-[16px] font-semibold text-foreground">{artifact.title}</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {t('artifacts.saved', { time: formatArtifactTime(artifact.updatedAt) })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onUseInChat(artifact)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12px] font-medium text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground"
              aria-label={t('artifacts.useInChat', { title: artifact.title })}
            >
              <Plus className="size-4" strokeWidth={1.8} />
              <span>{t('artifacts.useInChatShort')}</span>
            </button>
            {artifact.sourceSessionId ? (
              <button
                type="button"
                onClick={() => onOpenSource(artifact)}
                className="inline-flex max-w-64 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12px] font-medium text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground"
                aria-label={t('artifacts.openSourceSession', { title: sourceTitle })}
                title={sourceTitle}
              >
                <MessageCircle className="size-4 shrink-0" strokeWidth={1.8} />
                <span className="truncate">{sourceTitle}</span>
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => onDelete(artifact.id)}
              className="rounded-lg p-2 text-muted-foreground transition hover:bg-sidebar-hover hover:text-destructive disabled:opacity-40"
              aria-label={t('artifacts.delete', { title: artifact.title })}
            >
              <Trash2 className="size-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground"
              aria-label={t('artifacts.closePreview')}
            >
              <X className="size-4" strokeWidth={1.8} />
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-auto bg-card-muted/35 p-5">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            {widget ? (
              <WidgetRenderer widget={widget} />
            ) : imagePayload ? (
              <div className="flex min-h-[40vh] items-center justify-center bg-card-muted/35">
                <ArtifactImagePreview payload={imagePayload} title={artifact.title} />
              </div>
            ) : textPayload ? (
              <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap wrap-break-word rounded-xl bg-card-muted/40 p-4 text-[13px] leading-relaxed text-foreground">
                {textPayload.text}
              </pre>
            ) : filePayload ? (
              <div className="rounded-xl border border-border/70 bg-background p-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-card-muted text-muted-foreground">
                    <File className="size-5" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-foreground">
                      {filePayload.name}
                    </div>
                    <div className="mt-1 text-[12px] text-muted-foreground">
                      {[filePayload.mimeType, formatBytes(filePayload.size)]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    <div className="mt-3 whitespace-pre-wrap wrap-break-word rounded-lg bg-card-muted/50 px-3 py-2 font-mono text-[12px] text-muted-foreground">
                      {filePayload.path}
                    </div>
                    <button
                      type="button"
                      onClick={() => void window.api.attachments.reveal(filePayload.path)}
                      className="mt-4 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-card-muted"
                    >
                      {t('artifacts.revealFile')}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/70 px-4 py-14 text-center text-[13px] text-muted-foreground">
                {t('artifacts.noPreview')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ArtifactsPage(): React.JSX.Element {
  const { t } = useI18n()
  const navigate = useNavigate()
  const resetConversation = useSessionStore((state) => state.resetConversation)
  const { artifacts, loaded, busy, lastError, load, deleteArtifact } = useArtifactsStore()
  const [selectedFilter, setSelectedFilter] = useState<ArtifactFilter>('all')
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<Set<string>>(() => new Set())
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    void load()
  }, [load])

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()

  const searchedArtifacts = useMemo(() => {
    if (!normalizedSearchQuery) return artifacts
    return artifacts.filter((artifact) =>
      getArtifactSearchText(artifact).includes(normalizedSearchQuery)
    )
  }, [artifacts, normalizedSearchQuery])

  const counts = useMemo(() => {
    const next: Record<ArtifactFilter, number> = {
      all: searchedArtifacts.length,
      streamingUi: 0,
      text: 0,
      image: 0,
      file: 0,
      code: 0,
      doc: 0,
      video: 0,
      audio: 0,
      link: 0
    }

    for (const artifact of searchedArtifacts) {
      next[getArtifactType(artifact)] += 1
    }

    return next
  }, [searchedArtifacts])

  const filteredArtifacts = useMemo(
    () =>
      selectedFilter === 'all'
        ? searchedArtifacts
        : searchedArtifacts.filter((artifact) => getArtifactType(artifact) === selectedFilter),
    [searchedArtifacts, selectedFilter]
  )

  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null,
    [artifacts, selectedArtifactId]
  )
  const selectedArtifacts = useMemo(
    () => artifacts.filter((artifact) => selectedArtifactIds.has(artifact.id)),
    [artifacts, selectedArtifactIds]
  )
  const selectedFilterMeta = selectedFilter === 'all' ? null : TYPE_META[selectedFilter]
  const SelectedFilterIcon = selectedFilterMeta?.icon

  const handleDelete = async (id: string): Promise<void> => {
    if (selectedArtifactId === id) setSelectedArtifactId(null)
    setSelectedArtifactIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
    await deleteArtifact(id)
  }

  const handleOpenSource = (artifact: ArtifactRecord): void => {
    if (!artifact.sourceSessionId) return

    setSelectedArtifactId(null)

    const params = new URLSearchParams({ session: artifact.sourceSessionId })
    if (artifact.sourceMessageId) {
      params.set('message', artifact.sourceMessageId)
    }
    navigate(`/?${params.toString()}`)
  }

  const handleToggleSelected = (artifact: ArtifactRecord): void => {
    setSelectedArtifactIds((current) => {
      const next = new Set(current)
      if (next.has(artifact.id)) {
        next.delete(artifact.id)
      } else {
        next.add(artifact.id)
      }
      return next
    })
  }

  const handleUseArtifactsInChat = (nextArtifacts: ArtifactRecord[]): void => {
    const { contexts, attachments } = artifactsToChatInputs(nextArtifacts)
    if (contexts.length === 0 && attachments.length === 0) return
    if (contexts.length > 0) {
      window.sessionStorage.setItem(PENDING_CHAT_ARTIFACTS_STORAGE_KEY, JSON.stringify(contexts))
    } else {
      window.sessionStorage.removeItem(PENDING_CHAT_ARTIFACTS_STORAGE_KEY)
    }
    if (attachments.length > 0) {
      window.sessionStorage.setItem(
        PENDING_CHAT_ATTACHMENTS_STORAGE_KEY,
        JSON.stringify(attachments)
      )
    } else {
      window.sessionStorage.removeItem(PENDING_CHAT_ATTACHMENTS_STORAGE_KEY)
    }
    setSelectedArtifactId(null)
    setSelectedArtifactIds(new Set())
    resetConversation()
    navigate('/')
  }

  const handleUseInChat = (artifact: ArtifactRecord): void => {
    handleUseArtifactsInChat([artifact])
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-card">
      {lastError ? (
        <div className="w-full px-5 pt-6 sm:px-8 lg:px-10">
          <div className="w-full max-w-3xl rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
            {lastError}
          </div>
        </div>
      ) : null}

      {!loaded ? (
        <div className="flex min-h-full items-center justify-center px-6 text-[13px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            {t('artifacts.loading')}
          </div>
        </div>
      ) : artifacts.length === 0 ? (
        <div className="flex min-h-full items-center justify-center px-6">
          <p className="max-w-sm text-center text-[14px] leading-relaxed text-muted-foreground">
            {t('artifacts.emptyDescription')}
          </p>
        </div>
      ) : (
        <div className="w-full px-5 pt-6 pb-8 sm:px-8 lg:px-10">
          <div className="mb-5 max-w-3xl">
            <div className="group flex min-h-16 items-center gap-3 border-b border-border/80 py-3 transition focus-within:border-border-strong">
              <Search
                className="size-5 shrink-0 text-muted-foreground/70 transition group-focus-within:text-foreground"
                strokeWidth={1.8}
              />
              {selectedFilterMeta && SelectedFilterIcon ? (
                <button
                  type="button"
                  onClick={() => setSelectedFilter('all')}
                  className="inline-flex max-w-48 shrink-0 items-center gap-2 rounded-full bg-card-muted px-3 py-2 text-[16px] font-medium text-foreground transition hover:bg-sidebar-hover"
                  aria-label={t('artifacts.clearTypeFilter', {
                    type: t(selectedFilterMeta.labelKey)
                  })}
                >
                  <SelectedFilterIcon
                    className="size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.8}
                  />
                  <span className="truncate">{t(selectedFilterMeta.labelKey)}</span>
                  <X className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                </button>
              ) : null}
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('artifacts.searchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-[28px] font-medium leading-none text-foreground outline-none placeholder:text-muted-foreground/35"
                aria-label={t('artifacts.searchAriaLabel')}
              />
            </div>
          </div>

          <div className="relative -mx-1 mb-6">
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-linear-to-l from-card to-transparent" />
            <div className="pichu-scrollbar-none overflow-x-auto px-1 pb-1">
              <div className="flex w-max gap-2">
                {FILTERS.filter((filter) => filter === 'all' || filter !== selectedFilter).map(
                  (filter) => {
                    const labelKey =
                      filter === 'all' ? 'artifacts.filter.all' : TYPE_META[filter].labelKey
                    const active = selectedFilter === filter
                    const count = counts[filter]
                    const empty = filter !== 'all' && count === 0

                    return (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setSelectedFilter(filter)}
                        className={cn(
                          'shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition',
                          active
                            ? 'border-accent bg-accent text-accent-foreground shadow-sm'
                            : empty
                              ? 'border-border/70 bg-card text-muted-foreground/45 hover:border-border hover:text-muted-foreground'
                              : 'border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground'
                        )}
                        aria-pressed={active}
                      >
                        {t(labelKey as I18nKey)}
                        <span className="ml-1 opacity-70">{count}</span>
                      </button>
                    )
                  }
                )}
              </div>
            </div>
          </div>

          {selectedArtifacts.length > 0 ? (
            <div className="mb-4 flex w-fit items-center gap-2 rounded-full border border-border/70 bg-background px-2 py-1 shadow-sm">
              <span className="px-2 text-[12px] font-medium text-muted-foreground">
                {t('artifacts.selectedCount', { count: selectedArtifacts.length })}
              </span>
              <button
                type="button"
                onClick={() => handleUseArtifactsInChat(selectedArtifacts)}
                className="rounded-full bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition hover:opacity-90"
              >
                {t('artifacts.useSelectedInChat')}
              </button>
              <button
                type="button"
                onClick={() => setSelectedArtifactIds(new Set())}
                className="rounded-full px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground"
              >
                {t('artifacts.clearSelection')}
              </button>
            </div>
          ) : null}

          {filteredArtifacts.length === 0 ? (
            <div className="flex min-h-[18rem] items-center justify-center px-6">
              <p className="max-w-sm text-center text-[13px] leading-relaxed text-muted-foreground">
                {t(
                  normalizedSearchQuery
                    ? 'artifacts.emptySearchDescription'
                    : 'artifacts.emptyFilterDescription'
                )}
              </p>
            </div>
          ) : (
            <div
              className={cn(
                'grid grid-cols-[repeat(auto-fill,minmax(15.5rem,18rem))] justify-start gap-4',
                busy && 'opacity-80'
              )}
            >
              {filteredArtifacts.map((artifact) => (
                <ArtifactCard
                  key={artifact.id}
                  artifact={artifact}
                  busy={busy}
                  selected={selectedArtifactIds.has(artifact.id)}
                  onOpen={(nextArtifact) => setSelectedArtifactId(nextArtifact.id)}
                  onUseInChat={handleUseInChat}
                  onToggleSelected={handleToggleSelected}
                  onOpenSource={handleOpenSource}
                  onDelete={(id) => void handleDelete(id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <ArtifactPreviewDialog
        artifact={selectedArtifact}
        busy={busy}
        onClose={() => setSelectedArtifactId(null)}
        onUseInChat={handleUseInChat}
        onOpenSource={handleOpenSource}
        onDelete={(id) => void handleDelete(id)}
      />
    </div>
  )
}
