import { cn } from '@renderer/lib/utils'
import {
  createContext,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
  useMemo
} from 'react'

type SidebarContextValue = {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {}
})
SidebarContext.displayName = 'SidebarContext'

export function useSidebar() {
  return useContext(SidebarContext)
}

export function SidebarProvider({
  children,
  collapsed,
  onCollapsedChange
}: {
  children: ReactNode
  collapsed: boolean
  onCollapsedChange: (v: boolean) => void
}) {
  const toggle = useCallback(() => onCollapsedChange(!collapsed), [collapsed, onCollapsedChange])
  const value = useMemo(
    () => ({
      collapsed,
      setCollapsed: onCollapsedChange,
      toggle
    }),
    [collapsed, onCollapsedChange, toggle]
  )

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export const Sidebar = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const { collapsed } = useSidebar()
    return (
      <aside
        ref={ref}
        data-collapsed={collapsed}
        className={cn(
          'flex h-full flex-col border-r border-border/60 bg-sidebar pt-[var(--titlebar-height)] transition-[width] duration-200 ease-in-out',
          collapsed ? 'w-[48px]' : 'w-full',
          className
        )}
        {...props}
      >
        {children}
      </aside>
    )
  }
)
Sidebar.displayName = 'Sidebar'

export const SidebarHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex shrink-0 items-center px-2 py-1.5', className)} {...props} />
  )
)
SidebarHeader.displayName = 'SidebarHeader'

export const SidebarContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto', className)}
      {...props}
    />
  )
)
SidebarContent.displayName = 'SidebarContent'

export const SidebarFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex shrink-0 flex-col border-t border-border/60 px-1.5 py-1.5', className)}
      {...props}
    />
  )
)
SidebarFooter.displayName = 'SidebarFooter'

export const SidebarGroup = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-0.5 px-1.5 py-1', className)} {...props} />
  )
)
SidebarGroup.displayName = 'SidebarGroup'

export const SidebarGroupLabel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { collapsed } = useSidebar()
    if (collapsed) return null
    return (
      <div
        ref={ref}
        className={cn(
          'px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60',
          className
        )}
        {...props}
      />
    )
  }
)
SidebarGroupLabel.displayName = 'SidebarGroupLabel'

export const SidebarMenuItem = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { active?: boolean }
>(({ className, active, ...props }, ref) => (
  <div
    ref={ref}
    data-active={active || undefined}
    className={cn(
      'group flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition cursor-pointer',
      active
        ? 'bg-sidebar-active text-foreground'
        : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground',
      className
    )}
    {...props}
  />
))
SidebarMenuItem.displayName = 'SidebarMenuItem'
