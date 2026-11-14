import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@renderer/lib/utils'
import { Check, ChevronRight } from 'lucide-react'
import { forwardRef } from 'react'

const contentClassName =
  'z-50 min-w-[8rem] overflow-hidden rounded-xl border border-border/60 bg-card p-1 text-[13px] text-foreground shadow-sm shadow-black/5 dark:border-white/12 dark:bg-card'

const itemClassName =
  'flex min-h-7 w-full min-w-0 select-none items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1 text-left leading-[18px] outline-none transition data-[highlighted]:bg-card-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-40'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group
export const DropdownMenuSub = DropdownMenuPrimitive.Sub
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal

export const DropdownMenuContent = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, collisionPadding = 8, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(contentClassName, className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

export const DropdownMenuSubContent = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent> & {
    verticalAlign?: 'top' | 'bottom'
  }
>(
  (
    {
      className,
      sideOffset = 5,
      alignOffset,
      collisionPadding = 8,
      verticalAlign = 'top',
      ...props
    },
    ref
  ) => {
    const resolvedAlignOffset = alignOffset ?? (verticalAlign === 'bottom' ? 0 : -4)

    return (
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.SubContent
          ref={ref}
          sideOffset={sideOffset}
          alignOffset={resolvedAlignOffset}
          collisionPadding={collisionPadding}
          className={cn(
            contentClassName,
            verticalAlign === 'bottom' &&
              'translate-y-[calc(var(--radix-dropdown-menu-trigger-height,28px)-100%)]',
            className
          )}
          {...props}
        />
      </DropdownMenuPrimitive.Portal>
    )
  }
)
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName

export const DropdownMenuItem = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    danger?: boolean
    selected?: boolean
  }
>(({ className, danger, selected, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      itemClassName,
      selected && 'bg-card-muted',
      danger && 'text-red-600 data-[highlighted]:bg-red-500/10 dark:text-red-300',
      className
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

export const DropdownMenuSubTrigger = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(itemClassName, 'justify-between', className)}
    {...props}
  >
    {children}
    <ChevronRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName

export const DropdownMenuLabel = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn('px-2.5 pt-1.5 pb-1 text-[11px] leading-none text-muted-foreground', className)}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

export const DropdownMenuSeparator = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('my-1 h-px bg-foreground/10 dark:bg-white/10', className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

export function DropdownMenuItemCheck({ visible }: { visible: boolean }): React.JSX.Element {
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center">
      {visible ? <Check className="size-3.5 text-muted-foreground" strokeWidth={1.8} /> : null}
    </span>
  )
}
