import { Button } from '@renderer/components/ui/button'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { centeredSquare, type SquareCrop } from './square-image'

/** Largest box the image is shown in; it keeps its shape inside. */
const BOX_WIDTH = 304
const BOX_HEIGHT = 216
/** How far one arrow key press moves the frame, in shown px (Shift moves four times as far). */
const KEY_STEP = 4

/**
 * Picks the square part of a non-square image to keep: the image is shown whole with a
 * square frame over it that slides along the long side. Drag the frame (or anywhere on the
 * image) or use the arrow keys, then save.
 */
export function ImageCropper({
  src,
  width,
  height,
  onCancel,
  onSave
}: {
  src: string
  width: number
  height: number
  onCancel: () => void
  onSave: (crop: SquareCrop) => void
}) {
  const { t } = useTranslation()
  const scale = Math.min(BOX_WIDTH / width, BOX_HEIGHT / height)
  const shownWidth = width * scale
  const shownHeight = height * scale
  const side = Math.min(shownWidth, shownHeight)
  const horizontal = shownWidth > shownHeight
  const range = (horizontal ? shownWidth : shownHeight) - side
  const [offset, setOffset] = useState(range / 2)
  const drag = useRef<{ pointer: number; start: number; from: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)

  useEffect(() => {
    frame.current?.focus({ preventScroll: true })
  }, [])

  const clamp = (value: number) => Math.min(range, Math.max(0, value))
  const percent = range > 0 ? Math.round((offset / range) * 100) : 50

  return (
    <div className="owlto-image-cropper">
      <p>{t('imageCropper.help')}</p>
      <div
        className="owlto-image-cropper-stage"
        style={{ width: shownWidth, height: shownHeight }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            pointer: event.pointerId,
            start: horizontal ? event.clientX : event.clientY,
            from: offset
          }
          frame.current?.focus({ preventScroll: true })
        }}
        onPointerMove={(event) => {
          const current = drag.current
          if (!current || current.pointer !== event.pointerId) return
          const position = horizontal ? event.clientX : event.clientY
          setOffset(clamp(current.from + position - current.start))
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <img src={src} alt="" draggable={false} />
        <div
          ref={frame}
          className="owlto-image-cropper-frame"
          role="slider"
          tabIndex={0}
          aria-label={t('imageCropper.position')}
          aria-orientation={horizontal ? 'horizontal' : 'vertical'}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${percent}%`}
          style={{
            width: side,
            height: side,
            transform: horizontal ? `translateX(${offset}px)` : `translateY(${offset}px)`
          }}
          onKeyDown={(event) => {
            const back = horizontal ? 'ArrowLeft' : 'ArrowUp'
            const forward = horizontal ? 'ArrowRight' : 'ArrowDown'
            const step = KEY_STEP * (event.shiftKey ? 4 : 1)
            let next: number | null = null
            if (event.key === back) next = offset - step
            else if (event.key === forward) next = offset + step
            else if (event.key === 'Home') next = 0
            else if (event.key === 'End') next = range
            else if (event.key === 'Enter') {
              event.preventDefault()
              onSave(cropFor(offset))
              return
            }
            if (next === null) return
            event.preventDefault()
            setOffset(clamp(next))
          }}
        />
      </div>
      <div className="owlto-image-cropper-actions">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('imageCropper.cancel')}
        </Button>
        <Button size="sm" onClick={() => onSave(cropFor(offset))}>
          {t('imageCropper.save')}
        </Button>
      </div>
    </div>
  )

  function cropFor(shownOffset: number): SquareCrop {
    const crop = centeredSquare(width, height)
    const moved = shownOffset / scale
    return horizontal ? { ...crop, x: moved } : { ...crop, y: moved }
  }
}
