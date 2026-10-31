import { cn } from '@renderer/lib/utils'
import { forwardRef, type SelectHTMLAttributes } from 'react'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
)
Select.displayName = 'Select'
