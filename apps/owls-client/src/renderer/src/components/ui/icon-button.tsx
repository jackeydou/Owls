import { cn } from '@renderer/lib/utils'
import { forwardRef, type ReactNode } from 'react'
import { Button, type ButtonProps } from './button'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

export type IconButtonProps = Omit<ButtonProps, 'children' | 'aria-label' | 'title'> & {
  icon: ReactNode
  label: string
  tooltip?: ReactNode
  tooltipClassName?: string
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  tooltipSideOffset?: number
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      className,
      icon,
      label,
      size = 'icon',
      tooltip,
      tooltipClassName,
      tooltipSide = 'top',
      tooltipSideOffset,
      type = 'button',
      variant = 'ghost',
      ...props
    },
    ref
  ) => {
    const button = (
      <Button
        ref={ref}
        type={type}
        variant={variant}
        size={size}
        className={cn('rounded-full', className)}
        aria-label={label}
        {...props}
      >
        {icon}
      </Button>
    )

    if (tooltip === undefined) {
      return button
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent
          side={tooltipSide}
          sideOffset={tooltipSideOffset}
          className={tooltipClassName}
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    )
  }
)
IconButton.displayName = 'IconButton'
