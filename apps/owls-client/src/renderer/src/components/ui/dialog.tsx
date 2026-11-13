import { cn } from '@renderer/lib/utils'
import { type HTMLAttributes, useEffect, useRef } from 'react'

/**
 * A modal built on the native `<dialog>`, which brings the focus trap, the
 * backdrop, and Escape. Mount it to open it. Escape stops here so a window-level
 * shortcut does not also go back a level behind the modal. It opts out of
 * window dragging so a drag region under it cannot swallow its clicks.
 */
export function Dialog({
  onClose,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDialogElement> & { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={cn(
        'm-auto w-[min(480px,calc(100vw-48px))] [-webkit-app-region:no-drag] rounded-(--owl-radius-md) border border-border bg-card p-5 text-foreground shadow-lg backdrop:bg-black/30',
        className
      )}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation()
      }}
      {...props}
    >
      {children}
    </dialog>
  )
}
