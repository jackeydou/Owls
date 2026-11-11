import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { cn } from '@renderer/lib/utils'
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef, useRef } from 'react'

/**
 * A dropdown menu built on Radix, which brings keyboard navigation, typeahead,
 * focus return, and dismissal. Compose `Menu`, `MenuTrigger`, and `MenuContent`
 * with `MenuItem`, `MenuSeparator`, and `MenuLabel` inside.
 *
 * The content opts out of window dragging: Electron gives a window drag region
 * every click over it, whatever is stacked on top, and the sidebars a menu
 * opens from are drag regions.
 *
 * Closing after a pointer choice leaves focus off the trigger. Chromium counts
 * Radix's focus return as keyboard focus, so the trigger would light up its
 * focus ring (and focus-opened tooltip) after a plain click. A keyboard choice
 * or Escape still returns focus with its ring.
 */
export const Menu = DropdownMenu.Root
export const MenuTrigger = DropdownMenu.Trigger

export const MenuContent = forwardRef<
  ElementRef<typeof DropdownMenu.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenu.Content>
>(
  (
    {
      className,
      sideOffset = 6,
      collisionPadding = 8,
      onPointerDown,
      onKeyDown,
      onCloseAutoFocus,
      ...props
    },
    ref
  ) => {
    const pointerChoice = useRef(false)
    return (
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          ref={ref}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          className={cn(
            'z-[90] min-w-[220px] [-webkit-app-region:no-drag] max-w-[320px] rounded-xl border border-border/70 bg-card p-1 text-(length:--owl-text-sm) text-foreground shadow-[0_8px_28px_rgb(0_0_0_/_0.12)] outline-none dark:border-white/12',
            className
          )}
          onPointerDown={(event) => {
            pointerChoice.current = true
            onPointerDown?.(event)
          }}
          onKeyDown={(event) => {
            pointerChoice.current = false
            onKeyDown?.(event)
          }}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event)
            if (pointerChoice.current) event.preventDefault()
          }}
          {...props}
        />
      </DropdownMenu.Portal>
    )
  }
)
MenuContent.displayName = 'MenuContent'

export const MenuItem = forwardRef<
  ElementRef<typeof DropdownMenu.Item>,
  ComponentPropsWithoutRef<typeof DropdownMenu.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenu.Item
    ref={ref}
    className={cn(
      'flex h-8 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-card-muted data-[disabled]:opacity-50 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
      className
    )}
    {...props}
  />
))
MenuItem.displayName = 'MenuItem'

export const MenuSeparator = forwardRef<
  ElementRef<typeof DropdownMenu.Separator>,
  ComponentPropsWithoutRef<typeof DropdownMenu.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenu.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-border', className)}
    {...props}
  />
))
MenuSeparator.displayName = 'MenuSeparator'

export const MenuLabel = forwardRef<
  ElementRef<typeof DropdownMenu.Label>,
  ComponentPropsWithoutRef<typeof DropdownMenu.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenu.Label
    ref={ref}
    className={cn(
      'px-2.5 pt-1.5 pb-1 text-(length:--owl-text-xs) font-medium text-muted-foreground',
      className
    )}
    {...props}
  />
))
MenuLabel.displayName = 'MenuLabel'

export const MenuGroup = DropdownMenu.Group
