import { cn } from '@renderer/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { LoaderIcon } from './icons'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-(--owl-radius-sm) text-(length:--owl-text-sm) font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-100 active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50 [&[aria-busy=true]>svg:not([data-spinner])]:hidden [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-foreground shadow-sm hover:bg-accent/90',
        destructive: 'bg-destructive text-white shadow-sm hover:bg-destructive/90',
        outline: 'border border-border bg-card shadow-sm hover:bg-card-muted hover:text-foreground',
        secondary: 'bg-card-muted text-foreground shadow-sm hover:bg-card-muted/80',
        ghost: 'hover:bg-card-muted hover:text-foreground',
        link: 'text-accent underline-offset-4 hover:underline',
        unstyled: ''
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-(--owl-radius-sm) px-3 text-(length:--owl-text-xs)',
        lg: 'h-12 rounded-(--owl-radius-md) px-6',
        icon: 'size-9',
        custom: ''
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /**
   * The click started work that has not finished: the button is disabled, marked busy, and
   * shows a spinner in place of its icon. See "Click feedback" in AGENTS.md.
   */
  pending?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, pending = false, disabled, children, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        {...props}
      >
        {pending ? (
          <LoaderIcon size={15} className="animate-spin" data-spinner aria-hidden />
        ) : null}
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
