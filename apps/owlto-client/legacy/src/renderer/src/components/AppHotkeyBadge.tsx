import { cn } from '@renderer/lib/utils'
import { Command } from 'lucide-react'

export function AppHotkeyBadge({
  shortcut,
  className,
  iconClassName
}: {
  shortcut: string
  className?: string
  iconClassName?: string
}): React.JSX.Element {
  const usesCommand = shortcut.startsWith('⌘')
  const rest = usesCommand ? shortcut.slice(1) : shortcut

  return (
    <kbd className={className} aria-label={usesCommand ? `Command ${rest}` : shortcut}>
      {usesCommand ? (
        <Command className={cn('size-3', iconClassName)} strokeWidth={2} aria-hidden="true" />
      ) : null}
      {rest ? <span>{rest}</span> : null}
    </kbd>
  )
}
