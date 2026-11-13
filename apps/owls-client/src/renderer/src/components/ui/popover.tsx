import {
  autoUpdate,
  flip,
  inline,
  offset,
  type Placement,
  shift,
  useFloating
} from '@floating-ui/react-dom'
import { cn } from '@renderer/lib/utils'
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export type PopoverPoint = { x: number; y: number }

/**
 * An opaque card anchored to an element that the caller owns, such as an inline link.
 * It flips and shifts to stay inside the window, and closes on Escape or a press
 * outside both the card and its anchor (the anchor's own click toggles it).
 *
 * `point` is where the anchor was pressed. An inline anchor that wraps over several
 * lines then anchors to the line under the pointer instead of the whole box.
 * Focus moves to the child marked `data-autofocus` once the card is placed.
 */
export function AnchoredPopover({
  anchor,
  point,
  open,
  onClose,
  label,
  placement = 'bottom-start',
  className,
  children
}: {
  anchor: HTMLElement | null
  point?: PopoverPoint | null
  open: boolean
  onClose: (reason: 'escape' | 'outside') => void
  label: string
  placement?: Placement
  className?: string
  children: ReactNode
}) {
  const floatingRef = useRef<HTMLDivElement | null>(null)
  const { refs, floatingStyles, isPositioned } = useFloating({
    open,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      inline(point ? { x: point.x, y: point.y, padding: 2 } : { padding: 2 }),
      offset(6),
      flip({ padding: 8 }),
      shift({ padding: 8 })
    ]
  })
  useLayoutEffect(() => {
    refs.setReference(anchor)
  }, [anchor, refs])

  useEffect(() => {
    if (!open || !isPositioned) return
    floatingRef.current
      ?.querySelector<HTMLElement>('[data-autofocus]')
      ?.focus({ preventScroll: true })
  }, [open, isPositioned])

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (floatingRef.current?.contains(target) || anchor?.contains(target)) return
      onCloseRef.current('outside')
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCloseRef.current('escape')
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, anchor])

  if (!open || !anchor) return null
  return createPortal(
    <div
      ref={(node) => {
        floatingRef.current = node
        refs.setFloating(node)
      }}
      role="dialog"
      aria-label={label}
      style={{ ...floatingStyles, visibility: isPositioned ? 'visible' : 'hidden' }}
      className={cn(
        'z-[90] [-webkit-app-region:no-drag] rounded-(--owl-radius-md) border border-border/70 bg-card text-(length:--owl-text-sm) text-foreground shadow-[0_8px_28px_rgb(0_0_0_/_0.12)] outline-none dark:border-white/12 dark:shadow-[0_8px_28px_rgb(0_0_0_/_0.45)]',
        className
      )}
    >
      {children}
    </div>,
    document.body
  )
}
