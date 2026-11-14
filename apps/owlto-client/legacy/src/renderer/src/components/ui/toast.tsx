import { cn } from '@renderer/lib/utils'
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ToastVariant = 'info' | 'success' | 'error' | 'loading'

type ToastProps = {
  title: ReactNode
  description?: ReactNode
  variant?: ToastVariant
  icon?: ReactNode
  className?: string
  descriptionClassName?: string
} & (
  | {
      onClose: () => void
      closeLabel: string
    }
  | {
      onClose?: undefined
      closeLabel?: string
    }
)

type SystemToastProps = {
  message: ReactNode
  detail?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  onClose: () => void
  closeLabel: string
  className?: string
  messageClassName?: string
}

const toastIconClassName = 'size-3.5 shrink-0'

function defaultToastIcon(variant: ToastVariant): ReactNode {
  switch (variant) {
    case 'success':
      return (
        <CheckCircle2
          className={cn(toastIconClassName, 'text-emerald-600 dark:text-emerald-400')}
          strokeWidth={2}
        />
      )
    case 'error':
      return (
        <AlertCircle className={cn(toastIconClassName, 'text-destructive')} strokeWidth={1.9} />
      )
    case 'loading':
      return (
        <Loader2
          className={cn(toastIconClassName, 'animate-spin text-muted-foreground')}
          strokeWidth={1.9}
        />
      )
    default:
      return <Info className={cn(toastIconClassName, 'text-muted-foreground')} strokeWidth={1.9} />
  }
}

export function ToastViewport({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return createPortal(
    <div
      className={cn(
        'pointer-events-none fixed left-1/2 top-[calc(var(--titlebar-height)+4px)] z-[220] flex w-[calc(100vw-24px)] -translate-x-1/2 flex-col items-center gap-1.5',
        className
      )}
    >
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </div>,
    document.body
  )
}

export function Toast({
  title,
  description,
  variant = 'info',
  icon,
  onClose,
  closeLabel,
  className,
  descriptionClassName
}: ToastProps): React.JSX.Element {
  const isAlert = variant === 'error'
  const resolvedIcon = icon === undefined ? defaultToastIcon(variant) : icon

  return (
    <motion.div
      initial={{ y: -6, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -6, opacity: 0 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'pointer-events-auto w-fit max-w-[min(360px,calc(100vw-24px))] rounded-xl border border-border/60 bg-card px-3 py-2.5 text-foreground shadow-sm shadow-black/5 dark:border-white/12 dark:bg-card',
        className
      )}
      role={isAlert ? 'alert' : 'status'}
    >
      <div className={cn('flex gap-2.5', description ? 'items-start' : 'items-center')}>
        {resolvedIcon ? (
          <div
            className={cn(
              'flex size-5 shrink-0 items-center justify-center',
              description ? 'mt-0.5' : ''
            )}
          >
            {resolvedIcon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium leading-5 text-foreground">{title}</div>
          {description ? (
            <div
              className={cn(
                'line-clamp-2 text-[12px] leading-5 text-muted-foreground',
                descriptionClassName
              )}
            >
              {description}
            </div>
          ) : null}
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-sidebar-hover hover:text-foreground"
            aria-label={closeLabel}
          >
            <X className="size-3.5" strokeWidth={1.8} />
          </button>
        ) : null}
      </div>
    </motion.div>
  )
}

export function SystemToast({
  message,
  detail,
  action,
  icon,
  onClose,
  closeLabel,
  className,
  messageClassName
}: SystemToastProps): React.JSX.Element {
  const resolvedIcon =
    icon === undefined ? (
      <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.9} />
    ) : (
      icon
    )

  return (
    <motion.div
      initial={{ y: -6, opacity: 0, scale: 0.98 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -6, opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'pointer-events-auto flex w-fit max-w-[min(360px,calc(100vw-24px))] items-start gap-2 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-foreground shadow-sm shadow-black/5 dark:border-white/12 dark:bg-card',
        className
      )}
      role="status"
    >
      {resolvedIcon}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate text-[13px] font-medium leading-5 text-foreground',
            messageClassName
          )}
        >
          {message}
        </div>
        {detail ? (
          <div className="line-clamp-2 min-w-0 text-[12px] leading-5 text-muted-foreground">
            {detail}
          </div>
        ) : null}
      </div>
      {action ? <div className="min-w-0 shrink text-[13px] leading-5">{action}</div> : null}
      <button
        type="button"
        onClick={onClose}
        className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-sidebar-hover hover:text-foreground"
        aria-label={closeLabel}
      >
        <X className="size-3.5" strokeWidth={1.8} />
      </button>
    </motion.div>
  )
}
