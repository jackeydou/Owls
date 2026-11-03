import { cn } from '@renderer/lib/utils'
import type { ButtonHTMLAttributes, MouseEvent } from 'react'

type SwitchSize = 'sm' | 'md'

const SWITCH_SIZE_CLASSES: Record<
  SwitchSize,
  { track: string; thumb: string; checkedTranslate: string }
> = {
  sm: {
    track: 'h-4 w-[30px] p-0.5',
    thumb: 'size-3',
    checkedTranslate: 'translate-x-3.5'
  },
  md: {
    track: 'h-[22px] w-9 p-0.5',
    thumb: 'size-[18px]',
    checkedTranslate: 'translate-x-3.5'
  }
}

export function Switch({
  checked,
  onCheckedChange,
  size = 'md',
  className,
  onClick,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role'> & {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  size?: SwitchSize
}): React.JSX.Element {
  const sizeClasses = SWITCH_SIZE_CLASSES[size]

  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    onClick?.(event)
    if (!event.defaultPrevented) {
      onCheckedChange(!checked)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        'relative inline-flex shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/10 disabled:cursor-wait disabled:opacity-60',
        sizeClasses.track,
        checked ? 'bg-blue-600' : 'bg-foreground/10',
        className
      )}
      onClick={handleClick}
      {...props}
    >
      <span
        className={cn(
          'block rounded-full bg-white shadow-sm transition-transform',
          sizeClasses.thumb,
          checked ? sizeClasses.checkedTranslate : 'translate-x-0'
        )}
      />
    </button>
  )
}
