import { cn } from '@renderer/lib/utils'
import { ChevronDown } from 'lucide-react'

export function SessionSectionHeader({
  label,
  collapsed,
  onToggle,
  actions
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="group/section-header flex h-7 shrink-0 items-center justify-between pr-4 pl-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 items-center gap-1 rounded-md px-0 py-0 text-[14px] font-normal text-muted-foreground/85 transition hover:text-foreground"
        aria-expanded={!collapsed}
      >
        <span className="min-w-0 truncate text-[14px] font-normal text-inherit">{label}</span>
        <ChevronDown
          className={cn('size-3.5 shrink-0 transition-transform', collapsed && '-rotate-90')}
          strokeWidth={1.8}
        />
      </button>
      {actions ? (
        <div className="flex w-[76px] items-center justify-end gap-0.5">{actions}</div>
      ) : null}
    </div>
  )
}
