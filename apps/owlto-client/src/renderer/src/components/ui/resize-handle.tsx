import { cn } from '@renderer/lib/utils'
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

export type ResizeHandleProps = {
  /** The pane edge the handle sits on; dragging away from the pane widens it. */
  edge: 'left' | 'right'
  label: string
  width: number
  min: number
  max: number
  /** Restored on double-click. */
  initial: number
  /** Called on every move while dragging, with a clamped width. */
  onPreview(width: number): void
  /** Called once a drag or a key press settles on a width. */
  onCommit(width: number): void
  className?: string
}

const KEY_STEP = 16
const DRAGGING_CLASS = 'pane-resizing'

/**
 * A vertical separator on one edge of a pane. Its parent must be positioned. While a drag
 * runs, the document gets a class that pins the resize cursor and stops text selection.
 */
export function ResizeHandle({
  edge,
  label,
  width,
  min,
  max,
  initial,
  onPreview,
  onCommit,
  className
}: ResizeHandleProps) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; last: number }>(null)
  const [dragging, setDragging] = useState(false)
  const clamp = useCallback(
    (value: number) => Math.round(Math.min(max, Math.max(min, value))),
    [min, max]
  )
  const end = useCallback(() => {
    drag.current = null
    setDragging(false)
    document.documentElement.classList.remove(DRAGGING_CLASS)
  }, [])
  useEffect(() => end, [end])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      last: width
    }
    setDragging(true)
    document.documentElement.classList.add(DRAGGING_CLASS)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const delta = event.clientX - current.startX
    const next = clamp(current.startWidth + (edge === 'right' ? delta : -delta))
    if (next === current.last) return
    current.last = next
    onPreview(next)
  }
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const moved = current.last !== current.startWidth
    end()
    if (moved) onCommit(current.last)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const grow = edge === 'right' ? 'ArrowRight' : 'ArrowLeft'
    const shrink = edge === 'right' ? 'ArrowLeft' : 'ArrowRight'
    let next: number | null = null
    if (event.key === grow) next = width + KEY_STEP
    else if (event.key === shrink) next = width - KEY_STEP
    else if (event.key === 'Home') next = min
    else if (event.key === 'End') next = max
    if (next === null) return
    event.preventDefault()
    onCommit(clamp(next))
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> can't take focus or pointer drags.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-dragging={dragging || undefined}
      className={cn(
        'group absolute inset-y-0 z-20 w-[7px] cursor-col-resize touch-none outline-none [-webkit-app-region:no-drag]',
        edge === 'right' ? 'right-0' : 'left-0',
        className
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={() => onCommit(clamp(initial))}
      onKeyDown={onKeyDown}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 w-[2px] bg-transparent transition-colors duration-150',
          'group-hover:bg-[var(--color-border-strong)] group-focus-visible:bg-[var(--color-accent)] group-data-[dragging]:bg-[var(--color-accent)]',
          edge === 'right' ? 'right-0' : 'left-0'
        )}
      />
    </div>
  )
}
