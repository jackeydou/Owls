import { cn } from '@renderer/lib/utils'
import { forwardRef, type ReactNode } from 'react'

const tokenClassName =
  'inline-flex max-w-56 shrink-0 items-baseline gap-0.5 rounded px-0.5 align-baseline text-[14px] font-medium leading-[var(--pichu-composer-line-height)] text-codex-blue-400 transition'

export function composerInlineTokenClassName({
  interactive,
  className
}: {
  interactive?: boolean
  className?: string
} = {}): string {
  return cn(
    tokenClassName,
    interactive ? 'cursor-pointer hover:bg-codex-blue-100/30 dark:hover:bg-codex-blue-400/10' : '',
    className
  )
}

type ComposerInlineTokenProps = {
  children: ReactNode
  title?: string
  ariaLabel?: string
  onClick?: () => void
  className?: string
}

export const ComposerInlineToken = forwardRef<HTMLButtonElement, ComposerInlineTokenProps>(
  function ComposerInlineToken({ children, title, ariaLabel, onClick, className }, ref) {
    const resolvedClassName = composerInlineTokenClassName({
      interactive: Boolean(onClick),
      className
    })

    if (!onClick) {
      return (
        <span title={title} className={resolvedClassName}>
          {children}
        </span>
      )
    }

    return (
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        title={title}
        onClick={onClick}
        className={resolvedClassName}
      >
        {children}
      </button>
    )
  }
)

export function ComposerInlineTokenLabel({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="max-w-44 truncate">{children}</span>
}

export function ComposerInlineTokenTextIcon({
  children
}: {
  children: ReactNode
}): React.JSX.Element {
  return <span className="text-[13px] font-medium text-codex-blue-400">{children}</span>
}
