import { cn } from '@renderer/lib/utils'
import { Fragment, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { IconButton } from './icon-button'
import { EllipsisIcon } from './icons'
import { Menu, MenuContent, MenuTrigger } from './menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

export type OverflowAction = {
  id: string
  /** The control shown in the bar while it fits. */
  bar: ReactNode
  /** The same action as menu items, for when it moves into the More menu. */
  menu: ReactNode
}

/** Room left for the More button and the gap before it. */
const MORE_WIDTH = 32
const GAP = 4

/**
 * A row of actions that keeps as many as fit, in order, and moves the rest into a More menu.
 * The room is the parent's width less `reserve`, the pixels the parent's other content needs.
 * Each action's width is read from a hidden copy of the row, so a hidden one never jumps back
 * in at the wrong size.
 */
export function OverflowBar({
  actions,
  reserve,
  moreLabel,
  className
}: {
  actions: OverflowAction[]
  reserve: number
  moreLabel: string
  className?: string
}) {
  const bar = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const [fitting, setFitting] = useState(actions.length)
  const ids = actions.map((action) => action.id).join(' ')

  // biome-ignore lint/correctness/useExhaustiveDependencies: `ids` re-measures a changed set.
  useLayoutEffect(() => {
    const parent = bar.current?.parentElement
    const row = measure.current
    if (!parent || !row) return
    const fit = () => {
      const widths = [...row.children].map((child) => (child as HTMLElement).offsetWidth)
      const room = parent.clientWidth - reserve
      const total = (count: number) =>
        widths.slice(0, count).reduce((sum, width) => sum + width + GAP, 0)
      let count = widths.length
      if (total(count) > room) {
        count = 0
        while (count < widths.length && total(count + 1) + MORE_WIDTH <= room) count++
      }
      setFitting(count)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(parent)
    observer.observe(row)
    return () => observer.disconnect()
  }, [reserve, ids])

  const shown = actions.slice(0, fitting)
  const hidden = actions.slice(fitting)
  return (
    <div ref={bar} className={cn('owlto-overflow-bar', className)}>
      {shown.map((action) => (
        <Fragment key={action.id}>{action.bar}</Fragment>
      ))}
      {hidden.length ? (
        <Menu>
          <Tooltip>
            <TooltipTrigger asChild>
              <MenuTrigger asChild>
                <IconButton size="sm" label={moreLabel} icon={<EllipsisIcon size={16} />} />
              </MenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">{moreLabel}</TooltipContent>
          </Tooltip>
          <MenuContent align="end" className="min-w-[200px]">
            {hidden.map((action) => (
              <Fragment key={action.id}>{action.menu}</Fragment>
            ))}
          </MenuContent>
        </Menu>
      ) : null}
      <div ref={measure} className="owlto-overflow-measure" aria-hidden inert>
        {actions.map((action) => (
          <Fragment key={action.id}>{action.bar}</Fragment>
        ))}
      </div>
    </div>
  )
}
