import { cn } from '@renderer/lib/utils'
import type { ElementType } from 'react'
import { AppHotkeyBadge } from '../AppHotkeyBadge'

export function AppNavItem({
  label,
  icon: Icon,
  active,
  collapsed,
  shortcut,
  onClick
}: {
  label: string
  icon: ElementType
  active: boolean
  collapsed: boolean
  shortcut?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        'group flex items-center rounded-lg transition',
        collapsed ? 'mx-auto size-8 justify-center' : 'h-8 w-full gap-3 px-3 text-left text-[14px]',
        active
          ? 'bg-sidebar-active font-medium text-foreground'
          : 'text-foreground/92 hover:bg-sidebar-hover hover:text-foreground'
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {shortcut ? (
            <AppHotkeyBadge
              shortcut={shortcut}
              className="flex h-[22px] shrink-0 items-center gap-0.5 rounded-full bg-foreground/7 px-2 font-sans text-[12px] font-medium leading-none text-foreground/80 opacity-0 transition-opacity group-hover:opacity-100"
              iconClassName="size-[11px]"
            />
          ) : null}
        </>
      ) : null}
    </button>
  )
}
