import { cn } from '@renderer/lib/utils'
import { forwardRef, type SelectHTMLAttributes } from 'react'

/**
 * A native `<select>` drawn with Chromium's customizable select (`appearance: base-select`),
 * so callers keep the plain `<option>` children and `onChange` event while the trigger, chevron,
 * popover, and checkmark follow the app's design. The styles live in `.owlto-select` in
 * `assets/main.css` because they target pseudo-elements such as `::picker(select)`.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn('owlto-select', className)} {...props} />
  )
)
Select.displayName = 'Select'
