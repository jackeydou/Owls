import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'
import { useArtifactsStore } from '@renderer/stores/artifacts-store'
import { Bookmark, BookmarkCheck, FileText, ImageIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MessageAttachment } from '../../../../preload/index.d'
import { MAX_ATTACHMENT_PREVIEW_BYTES } from '../../../../shared/attachments'
import { ImagePreviewDialog } from './ImagePreviewDialog'

export function AttachmentCard({
  attachment,
  onRemove,
  artifactSessionId,
  artifactMessageId,
  display = 'pill',
  imageSize = 'thumbnail'
}: {
  attachment: MessageAttachment
  onRemove?: () => void
  artifactSessionId?: string | null
  artifactMessageId?: string | null
  display?: 'pill' | 'image'
  imageSize?: 'thumbnail' | 'large'
}): React.JSX.Element {
  const { t } = useI18n()
  const artifacts = useArtifactsStore((state) => state.artifacts)
  const deleteArtifact = useArtifactsStore((state) => state.deleteArtifact)
  const saveAttachment = useArtifactsStore((state) => state.saveAttachment)
  const isImage = attachment.kind === 'image'
  const [imageSrc, setImageSrc] = useState<string | null>(attachment.previewDataUrl ?? null)
  const [previewState, setPreviewState] = useState<'loading' | 'ready' | 'unavailable'>(() =>
    attachment.previewDataUrl ? 'ready' : isImage ? 'loading' : 'unavailable'
  )
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const isPreviewUnavailable = isImage && previewState === 'unavailable'
  const imageTooLarge = isImage && (attachment.size ?? 0) > MAX_ATTACHMENT_PREVIEW_BYTES
  const unavailableLabel = imageTooLarge
    ? t('chat.attachment.previewTooLarge')
    : t('chat.attachment.previewUnavailableShort')
  const sourceToolCallId = `attachment:${attachment.id}`
  const savedArtifact = artifacts.find(
    (artifact) =>
      artifact.sourceSessionId === artifactSessionId &&
      artifact.sourceToolCallId === sourceToolCallId
  )

  useEffect(() => {
    let cancelled = false
    setImageSrc(attachment.previewDataUrl ?? null)
    if (!isImage) {
      setPreviewState('unavailable')
      return
    }
    if (attachment.previewDataUrl) {
      setPreviewState('ready')
      return
    }
    setPreviewState('loading')

    void window.api.attachments
      .readImageDataUrl(attachment.path)
      .then((dataUrl) => {
        if (cancelled) return
        setImageSrc(dataUrl)
        setPreviewState(dataUrl ? 'ready' : 'unavailable')
      })
      .catch((error) => {
        console.error('Failed to load attachment preview', error)
        if (!cancelled) setPreviewState('unavailable')
      })

    return () => {
      cancelled = true
    }
  }, [attachment.path, attachment.previewDataUrl, isImage])

  const handleOpen = (): void => {
    if (isImage) {
      setPreviewOpen(true)
      return
    }
    void window.api.attachments.reveal(attachment.path)
  }

  const canSaveArtifact = Boolean(artifactSessionId && artifactMessageId && !onRemove)
  const artifactLabel = t(
    savedArtifact ? 'artifacts.removeFromArtifacts' : 'artifacts.saveToArtifacts'
  )

  const handleSaveArtifact = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()
    if (!artifactSessionId || !artifactMessageId || saving) return

    setSaving(true)
    try {
      if (savedArtifact) {
        await deleteArtifact(savedArtifact.id)
        return
      }

      await saveAttachment({
        sessionId: artifactSessionId,
        messageId: artifactMessageId,
        attachment: {
          ...attachment,
          previewDataUrl: imageSrc ?? attachment.previewDataUrl ?? null
        }
      })
    } catch (error) {
      console.error('Failed to save attachment artifact', error)
    } finally {
      setSaving(false)
    }
  }

  const saveButton = canSaveArtifact ? (
    <Tooltip>
      <TooltipTrigger
        disabled={saving}
        onClick={(event) => void handleSaveArtifact(event)}
        className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-sm transition hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60"
        aria-label={artifactLabel}
      >
        {savedArtifact ? (
          <BookmarkCheck className="size-3.5 text-accent" />
        ) : (
          <Bookmark className="size-3.5" />
        )}
      </TooltipTrigger>
      <TooltipContent>{artifactLabel}</TooltipContent>
    </Tooltip>
  ) : null

  if (display === 'image') {
    const isLarge = imageSize === 'large'

    return (
      <div
        className={
          isLarge
            ? 'group/attachment-card relative max-w-full'
            : 'group/attachment-card relative size-24'
        }
      >
        <button
          type="button"
          className={
            isLarge
              ? 'flex max-w-[480px] items-center justify-center overflow-hidden rounded-[10px] border border-border/60 bg-card-muted text-muted-foreground shadow-none transition hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              : 'flex size-full items-center justify-center overflow-hidden rounded-[14px] border border-border/60 bg-card-muted text-muted-foreground shadow-none transition hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          }
          onClick={handleOpen}
          aria-label={t('chat.attachment.preview')}
          title={attachment.name}
        >
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={attachment.name}
              className={
                isLarge ? 'max-h-[480px] max-w-full object-contain' : 'size-full object-cover'
              }
              draggable={false}
            />
          ) : isPreviewUnavailable ? (
            <span
              className={
                isLarge
                  ? 'flex h-60 w-[400px] max-w-full flex-col items-center justify-center gap-1 px-3 text-center'
                  : 'flex size-full flex-col items-center justify-center gap-1 px-2 text-center'
              }
            >
              <ImageIcon className="size-5 shrink-0" strokeWidth={1.8} aria-hidden />
              <span className="line-clamp-2 text-[11px] leading-3 text-muted-foreground">
                {unavailableLabel}
              </span>
            </span>
          ) : (
            <ImageIcon className="size-6" strokeWidth={1.8} aria-hidden />
          )}
        </button>
        {onRemove ? (
          <button
            type="button"
            className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 shadow-sm transition group-hover/attachment-card:opacity-100 focus-visible:opacity-100"
            onClick={onRemove}
            aria-label={t('chat.attachment.remove')}
            title={t('chat.attachment.remove')}
          >
            <X className="size-3.5" strokeWidth={1.9} />
          </button>
        ) : null}
        {saveButton ? (
          <div className="absolute right-1.5 top-1.5 opacity-0 transition group-hover/attachment-card:opacity-100 group-focus-within/attachment-card:opacity-100">
            {saveButton}
          </div>
        ) : null}
        {previewOpen ? (
          <ImagePreviewDialog
            imageName={attachment.name}
            imageSrc={imageSrc}
            sourcePath={attachment.path}
            sourceSize={attachment.size}
            onClose={() => setPreviewOpen(false)}
          />
        ) : null}
      </div>
    )
  }

  const icon = (
    <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card-muted text-muted-foreground">
      {isImage && imageSrc ? (
        <img src={imageSrc} alt="" className="size-full object-cover" draggable={false} />
      ) : isPreviewUnavailable ? (
        <ImageIcon className="size-4 text-muted-foreground/70" strokeWidth={1.8} aria-hidden />
      ) : isImage ? (
        <ImageIcon className="size-4" strokeWidth={1.8} aria-hidden />
      ) : (
        <FileText className="size-4" strokeWidth={1.8} aria-hidden />
      )}
    </span>
  )

  return (
    <div
      className="group/attachment-pill relative inline-flex h-9 w-[188px] max-w-full min-w-0 items-center rounded-full border border-border/70 bg-background/80 px-2 pr-2.5 text-left shadow-none transition hover:bg-card-muted/30"
      title={attachment.path}
    >
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
        onClick={handleOpen}
        aria-label={isImage ? t('chat.attachment.preview') : t('chat.attachment.reveal')}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-5 text-foreground">
            {attachment.name}
          </span>
        </span>
      </button>
      {onRemove ? (
        <button
          type="button"
          className="ml-1 flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition hover:bg-card-muted hover:text-foreground group-hover/attachment-pill:opacity-100 focus-visible:opacity-100"
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          aria-label={t('chat.attachment.remove')}
          title={t('chat.attachment.remove')}
        >
          <X className="size-3.5" strokeWidth={1.9} aria-hidden />
        </button>
      ) : null}
      {saveButton ? (
        <div className="absolute right-1 top-1 opacity-0 transition group-hover/attachment-pill:opacity-100 group-focus-within/attachment-pill:opacity-100">
          {saveButton}
        </div>
      ) : null}
      {previewOpen ? (
        <ImagePreviewDialog
          imageName={attachment.name}
          imageSrc={imageSrc}
          sourcePath={attachment.path}
          sourceSize={attachment.size}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
  )
}
