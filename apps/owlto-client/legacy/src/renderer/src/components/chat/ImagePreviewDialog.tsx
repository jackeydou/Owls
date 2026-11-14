import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'
import { useUiOverlayStore } from '@renderer/stores/ui-overlay-store'
import { Download, Minus, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MAX_ATTACHMENT_PREVIEW_BYTES } from '../../../../shared/attachments'

export function ImagePreviewDialog({
  imageName,
  imageSrc,
  sourcePath,
  sourceSize,
  onClose
}: {
  imageName: string
  imageSrc: string | null
  sourcePath: string
  sourceSize?: number | null
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const overlayIdRef = useRef(
    `chat-image-preview-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`
  )
  const [zoom, setZoom] = useState(1)
  const imageTooLarge = (sourceSize ?? 0) > MAX_ATTACHMENT_PREVIEW_BYTES
  const pushBlockingOverlay = useUiOverlayStore((state) => state.pushBlockingOverlay)
  const popBlockingOverlay = useUiOverlayStore((state) => state.popBlockingOverlay)

  useEffect(() => {
    const overlayId = overlayIdRef.current
    pushBlockingOverlay(overlayId)
    return () => popBlockingOverlay(overlayId)
  }, [popBlockingOverlay, pushBlockingOverlay])

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
      aria-label={t('chat.attachment.previewTitle', { name: imageName })}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="no-drag absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => void window.api.attachments.saveCopy(sourcePath)}
              className="group no-drag flex size-12 items-center justify-center rounded-full text-black transition"
              aria-label={t('chat.attachment.saveCopy')}
              data-no-drag="true"
            >
              <span className="pointer-events-none flex size-10 items-center justify-center rounded-full bg-white shadow-lg transition group-hover:bg-white/90">
                <Download className="size-4" strokeWidth={2} aria-hidden />
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('chat.attachment.saveCopy')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onClose}
              className="group no-drag flex size-12 items-center justify-center rounded-full text-black transition"
              aria-label={t('chat.attachment.closePreview')}
              data-no-drag="true"
            >
              <span className="pointer-events-none flex size-10 items-center justify-center rounded-full bg-white shadow-lg transition group-hover:bg-white/90">
                <X className="size-4" strokeWidth={2} aria-hidden />
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('chat.attachment.closePreview')}</TooltipContent>
        </Tooltip>
      </div>

      {imageSrc ? (
        <img
          src={imageSrc}
          alt={imageName}
          className="max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl"
          style={{ transform: `scale(${zoom})` }}
          draggable={false}
        />
      ) : (
        <div className="max-w-sm rounded-xl border border-white/15 bg-white/10 px-5 py-4 text-center text-white">
          <div className="text-[13px] font-medium">
            {imageTooLarge
              ? t('chat.attachment.previewTooLarge')
              : t('chat.attachment.previewUnavailable')}
          </div>
          <div className="mt-1 text-[12px] leading-5 text-white/70">
            {t('chat.attachment.previewUnavailableDescription')}
          </div>
        </div>
      )}

      {imageSrc ? (
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-1.5 py-1.5 text-black shadow-xl">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() =>
                  setZoom((current) => Math.max(0.25, Number((current - 0.25).toFixed(2))))
                }
                className="flex size-8 items-center justify-center rounded-full bg-black/5 transition hover:bg-black/10"
                aria-label={t('chat.attachment.zoomOut')}
              >
                <Minus className="size-4" strokeWidth={2} aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('chat.attachment.zoomOut')}</TooltipContent>
          </Tooltip>
          <span className="min-w-12 text-center text-[12px] tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() =>
                  setZoom((current) => Math.min(3, Number((current + 0.25).toFixed(2))))
                }
                className="flex size-8 items-center justify-center rounded-full bg-black/5 transition hover:bg-black/10"
                aria-label={t('chat.attachment.zoomIn')}
              >
                <Plus className="size-4" strokeWidth={2} aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('chat.attachment.zoomIn')}</TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </div>,
    document.body
  )
}
