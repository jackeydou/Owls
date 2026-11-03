import { cn } from '@renderer/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'

const badgeVariants = cva(
  'inline-flex h-[20px] shrink-0 items-center rounded-md border px-1.5 text-[10.5px] font-medium leading-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-foreground text-background',
        secondary: 'border-border/65 bg-foreground/[0.035] text-muted-foreground',
        outline: 'border-border/70 bg-transparent text-muted-foreground',
        info: 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300',
        success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        warning: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        destructive: 'border-destructive/20 bg-destructive/10 text-destructive'
      }
    },
    defaultVariants: {
      variant: 'secondary'
    }
  }
)

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>

export function Badge({
  variant,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>): React.JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { badgeVariants }
