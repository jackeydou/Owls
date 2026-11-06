import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { useArtifactsStore } from '@renderer/stores/artifacts-store'
import { Bookmark, BookmarkCheck, Download, Minus, Plus, X } from 'lucide-react'
import { type ComponentPropsWithoutRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ArtifactRecord } from '../../../../../shared/artifacts'
import { localPathFromImageSrc } from './MarkdownLinks'

export type MarkdownImageSaveRequest = {
  url: string
  title?: string
  alt?: string | null
}

function MarkdownImagePreviewDialog({
  imageSrc,
  title,
  localPath,
  onClose
}: {
  imageSrc: string
  title: string
  localPath: string | null
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/88 px-12 pt-16 pb-28"
      role="dialog"
      aria-modal="true"
      aria-label={t('chat.attachment.previewTitle', { name: title })}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="no-drag absolute top-3 right-3 z-10 flex items-center gap-1.5">
        {localPath ? (
          <button
            type="button"
            onClick={() => void window.api.attachments.saveCopy(localPath)}
            className="group no-drag flex size-12 items-center justify-center rounded-full text-black transition"
            aria-label={t('chat.attachment.saveCopy')}
            title={t('chat.attachment.saveCopy')}
            data-no-drag="true"
          >
            <span className="pointer-events-none flex size-10 items-center justify-center rounded-full bg-white shadow-lg transition group-hover:bg-white/90">
              <Download className="size-4" strokeWidth={2} aria-hidden />
            </span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="group no-drag flex size-12 items-center justify-center rounded-full text-black transition"
          aria-label={t('chat.attachment.closePreview')}
          title={t('chat.attachment.closePreview')}
          data-no-drag="true"
        >
          <span className="pointer-events-none flex size-10 items-center justify-center rounded-full bg-white shadow-lg transition group-hover:bg-white/90">
            <X className="size-4" strokeWidth={2} aria-hidden />
          </span>
        </button>
      </div>

      <img
        src={imageSrc}
        alt={title}
        className="max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl"
        style={{ transform: `scale(${zoom})` }}
        draggable={false}
      />

      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-1.5 py-1.5 text-black shadow-xl">
        <button
          type="button"
          onClick={() => setZoom((current) => Math.max(0.25, Number((current - 0.25).toFixed(2))))}
          className="flex size-8 items-center justify-center rounded-full bg-black/5 transition hover:bg-black/10"
          aria-label={t('chat.attachment.zoomOut')}
          title={t('chat.attachment.zoomOut')}
        >
          <Minus className="size-4" strokeWidth={2} aria-hidden />
        </button>
        <span className="min-w-12 text-center text-[12px] tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((current) => Math.min(3, Number((current + 0.25).toFixed(2))))}
          className="flex size-8 items-center justify-center rounded-full bg-black/5 transition hover:bg-black/10"
          aria-label={t('chat.attachment.zoomIn')}
          title={t('chat.attachment.zoomIn')}
        >
          <Plus className="size-4" strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>,
    document.body
  )
}

export function MarkdownImageWithSave({
  src,
  alt,
  className,
  node: _node,
  onSaveImage,
  ...props
}: ComponentPropsWithoutRef<'img'> & {
  node?: unknown
  onSaveImage?: (request: MarkdownImageSaveRequest) => Promise<ArtifactRecord | null>
}): React.JSX.Element {
  const { t } = useI18n()
  const deleteArtifact = useArtifactsStore((state) => state.deleteArtifact)
  const [saving, setSaving] = useState(false)
  const [savedArtifactId, setSavedArtifactId] = useState<string | null>(null)
  const source = typeof src === 'string' ? src : ''
  const localPath = localPathFromImageSrc(source)
  const [resolvedSource, setResolvedSource] = useState<string | null>(localPath ? null : source)
  const [loadFailed, setLoadFailed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const label = t(savedArtifactId ? 'artifacts.removeFromArtifacts' : 'artifacts.saveToArtifacts')

  useEffect(() => {
    if (!localPath) {
      setResolvedSource(source)
      setLoadFailed(false)
      return
    }

    let cancelled = false
    setResolvedSource(null)
    setLoadFailed(false)

    void window.api.attachments
      .readImageDataUrl(localPath)
      .then((dataUrl) => {
        if (cancelled) return
        setResolvedSource(dataUrl)
        setLoadFailed(!dataUrl)
      })
      .catch((error) => {
        console.error('Failed to load markdown attachment image', error)
        if (!cancelled) setLoadFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [localPath, source])

  if (!source) {
    return <img src={src} alt={alt ?? ''} {...props} />
  }

  const displaySource = resolvedSource
  const canSave = Boolean(onSaveImage)
  const title = typeof alt === 'string' && alt.trim() ? alt : (localPath ?? source)

  if (!displaySource) {
    return (
      <span className="my-3 inline-flex h-60 w-[400px] max-w-[480px] max-w-full items-center justify-center rounded-[10px] border border-border/60 bg-card-muted px-4 py-3 text-center text-[13px] text-muted-foreground">
        {loadFailed ? title : ''}
      </span>
    )
  }

  return (
    <span className="group/markdown-image relative my-3 inline-block max-w-[480px] max-w-full align-top">
      <button
        type="button"
        onClick={() => setPreviewOpen(true)}
        className="block max-w-full cursor-zoom-in rounded-lg text-left transition hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('chat.attachment.preview')}
      >
        <img
          src={displaySource}
          alt={alt ?? ''}
          className={cn('max-h-[480px] object-contain', className)}
          data-markdown-attachment-image="true"
          {...props}
        />
      </button>
      {canSave ? (
        <button
          type="button"
          disabled={saving}
          onClick={async (event) => {
            event.preventDefault()
            event.stopPropagation()
            setSaving(true)
            try {
              if (savedArtifactId) {
                await deleteArtifact(savedArtifactId)
                setSavedArtifactId(null)
                return
              }

              const saved = await onSaveImage?.({
                url: localPath ?? source,
                title,
                alt: typeof alt === 'string' ? alt : null
              })
              setSavedArtifactId(saved?.id ?? null)
            } catch (error) {
              console.error('Failed to save markdown image artifact', error)
            } finally {
              setSaving(false)
            }
          }}
          className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition hover:bg-card hover:text-foreground group-hover/markdown-image:opacity-100 group-focus-within/markdown-image:opacity-100 disabled:opacity-60"
          aria-label={label}
        >
          {savedArtifactId ? (
            <BookmarkCheck className="size-3.5 text-accent" />
          ) : (
            <Bookmark className="size-3.5" />
          )}
        </button>
      ) : null}
      {previewOpen ? (
        <MarkdownImagePreviewDialog
          imageSrc={displaySource}
          title={title}
          localPath={localPath}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </span>
  )
}
