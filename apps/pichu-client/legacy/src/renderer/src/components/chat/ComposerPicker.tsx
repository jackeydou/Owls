import { cn } from '@renderer/lib/utils'
import type { MouseEvent, ReactNode, RefObject } from 'react'

type PickerIndexAttribute = 'data-mention-index' | 'data-skill-index'

function indexProps(attribute: PickerIndexAttribute, index: number): Record<string, number> {
  return { [attribute]: index }
}

export function ComposerPickerPopup({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="absolute bottom-full left-0 z-50 mb-2 w-full overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-lg">
      {children}
    </div>
  )
}

export function ComposerPickerScrollArea({
  scrollRef,
  children
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}): React.JSX.Element {
  return (
    <div
      ref={scrollRef}
      className="pichu-mention-scrollbar max-h-72 overflow-x-hidden overflow-y-auto"
    >
      {children}
    </div>
  )
}

export function ComposerPickerSection({
  title,
  children
}: {
  title: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="pb-0.5">
      <div className="sticky top-0 z-10 -mx-1.5 bg-card px-3 pb-0.5 pt-1 text-[12px] leading-4 text-muted-foreground">
        {title}
      </div>
      {children}
    </section>
  )
}

export function ComposerPickerRow({
  index,
  highlightedIndex,
  indexAttribute,
  ariaLabel,
  disabled,
  trailing,
  onHighlight,
  onMouseDown,
  children
}: {
  index: number
  highlightedIndex: number
  indexAttribute: PickerIndexAttribute
  ariaLabel?: string
  disabled?: boolean
  trailing?: ReactNode
  onHighlight: (index: number) => void
  onMouseDown: () => void
  children: ReactNode
}): React.JSX.Element {
  const rowClassName = cn(
    'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left transition disabled:cursor-wait disabled:opacity-70',
    index === highlightedIndex ? 'bg-card-muted' : 'hover:bg-card-muted',
    disabled && 'cursor-default opacity-70'
  )

  const buttonProps = {
    type: 'button' as const,
    disabled,
    'aria-label': ariaLabel,
    onMouseEnter: () => onHighlight(index),
    onMouseDown: (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      onMouseDown()
    },
    ...indexProps(indexAttribute, index)
  }

  if (!trailing) {
    return (
      <button {...buttonProps} className={rowClassName}>
        {children}
      </button>
    )
  }

  return (
    <div className={rowClassName}>
      <button {...buttonProps} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {children}
      </button>
      {trailing}
    </div>
  )
}

export function ComposerPickerIcon({
  children,
  rounded = 'rounded-[4px]'
}: {
  children: ReactNode
  rounded?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex size-[22px] shrink-0 items-center justify-center overflow-hidden text-[10px] font-semibold text-foreground/75',
        rounded
      )}
    >
      {children}
    </div>
  )
}

export function ComposerPickerText({
  title,
  subtitle,
  meta
}: {
  title: ReactNode
  subtitle: ReactNode
  meta?: string
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
      <span className="min-w-0 shrink truncate text-[13px] leading-4 text-foreground">{title}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] leading-4 text-muted-foreground">
        {subtitle}
      </span>
      {meta ? (
        <span className="ml-2 max-w-[8rem] shrink-0 truncate text-[13px] leading-4 text-muted-foreground">
          {meta}
        </span>
      ) : null}
    </div>
  )
}
