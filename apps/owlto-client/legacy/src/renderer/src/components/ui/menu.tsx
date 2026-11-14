import { cn } from '@renderer/lib/utils'
import {
  type ButtonHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type RefObject,
  useEffect
} from 'react'

export function useDismissableMenu({
  open,
  ref,
  onClose
}: {
  open: boolean
  ref: RefObject<HTMLElement | null>
  onClose: () => void
}): void {
  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose, ref])
}

export function clampMenuPosition({
  x,
  y,
  width,
  height,
  margin = 8
}: {
  x: number
  y: number
  width: number
  height: number
  margin?: number
}): { x: number; y: number } {
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - height - margin))
  }
}

export const MenuSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'w-fit max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border/60 bg-card p-1 text-[13px] text-foreground shadow-sm shadow-black/5 dark:border-white/12 dark:bg-card',
          className
        )}
        {...props}
      />
    )
  }
)
MenuSurface.displayName = 'MenuSurface'

export const MenuItem = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    danger?: boolean
    selected?: boolean
  }
>(({ className, danger, selected, type = 'button', ...props }, ref) => {
  return (
    <button
      ref={ref}
      type={type}
      role="menuitem"
      className={cn(
        'flex h-8 w-full min-w-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-left leading-none outline-none transition hover:bg-card-muted focus-visible:bg-card-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        selected && 'bg-card-muted',
        danger && 'text-red-600 hover:bg-red-500/10 focus-visible:bg-red-500/10 dark:text-red-300',
        className
      )}
      {...props}
    />
  )
})
MenuItem.displayName = 'MenuItem'

export function MenuLabel({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn('px-2.5 pt-1.5 pb-1 text-[11px] leading-none text-muted-foreground', className)}
      {...props}
    />
  )
}

export function MenuSeparator({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('my-1 h-px bg-foreground/10 dark:bg-white/10', className)} {...props} />
}
