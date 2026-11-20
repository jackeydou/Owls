import { Dialog } from '@renderer/components/ui/dialog'
import { IconButton } from '@renderer/components/ui/icon-button'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  XIcon
} from '@renderer/components/ui/icons'
import { useTranslation } from 'react-i18next'

export type ViewerImage = { key: string; name: string; src: string }

/**
 * A message's images at full size, one at a time. Arrow keys and the side buttons
 * step through them; Escape or the backdrop closes it.
 */
export function ImageViewer({
  images,
  index,
  onIndex,
  onClose,
  onOpen
}: {
  images: ViewerImage[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
  /** Opens the shown image in the system's default app; left out for a draft. */
  onOpen?: () => void
}) {
  const { t } = useTranslation()
  const image = images[index]
  if (!image) return null
  const many = images.length > 1
  const step = (by: number) => onIndex((index + by + images.length) % images.length)
  return (
    <Dialog
      className="image-viewer"
      aria-label={t('imageViewer.label', { name: image.name })}
      onClose={onClose}
      // A click on the backdrop lands on the dialog itself.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      // Replaces the Dialog's own handler, so Escape is kept from the window here too.
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation()
        if (!many) return
        if (event.key === 'ArrowLeft') step(-1)
        else if (event.key === 'ArrowRight') step(1)
      }}
    >
      <header className="image-viewer-head">
        <span className="image-viewer-name">{image.name}</span>
        {many ? (
          <span className="image-viewer-count">
            {t('imageViewer.count', { index: index + 1, total: images.length })}
          </span>
        ) : null}
        {onOpen ? (
          <IconButton
            size="sm"
            label={t('imageViewer.open')}
            tooltip={t('imageViewer.open')}
            icon={<ExternalLinkIcon size={15} />}
            onClick={onOpen}
          />
        ) : null}
        <IconButton
          size="sm"
          label={t('imageViewer.close')}
          tooltip={t('imageViewer.close')}
          icon={<XIcon size={15} />}
          onClick={onClose}
        />
      </header>
      {/* Opening focuses the picture, not the first button, so no focus ring flashes on. */}
      {/* biome-ignore lint/a11y/noAutofocus: the native dialog moves focus inside anyway. */}
      <div className="image-viewer-stage" tabIndex={-1} autoFocus>
        <img src={image.src} alt={image.name} />
        {many ? (
          <>
            <IconButton
              variant="outline"
              className="image-viewer-step"
              data-side="previous"
              label={t('imageViewer.previous')}
              icon={<ArrowLeftIcon size={16} />}
              onClick={() => step(-1)}
            />
            <IconButton
              variant="outline"
              className="image-viewer-step"
              data-side="next"
              label={t('imageViewer.next')}
              icon={<ArrowRightIcon size={16} />}
              onClick={() => step(1)}
            />
          </>
        ) : null}
      </div>
    </Dialog>
  )
}
