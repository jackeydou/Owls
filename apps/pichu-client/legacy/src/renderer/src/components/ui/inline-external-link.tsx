import { cn } from '@renderer/lib/utils'
import type { CSSProperties, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

type InlineExternalLinkProps = {
  href: string
  children: ReactNode
  iconMaskSrc?: string
  iconClassName?: string
  tooltip?: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
  contentClassName?: string
  tooltipClassName?: string
  onOpen?: (href: string) => void
}

export function InlineExternalLink({
  href,
  children,
  iconMaskSrc,
  iconClassName,
  tooltip = href,
  side = 'top',
  className,
  contentClassName,
  tooltipClassName,
  onOpen
}: InlineExternalLinkProps): React.JSX.Element {
  const linkStyle = iconMaskSrc
    ? ({
        '--pichu-inline-link-icon': `url("${iconMaskSrc}")`
      } as CSSProperties)
    : undefined

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn('pichu-inline-link', iconMaskSrc && 'pichu-inline-link-with-icon', className)}
        style={linkStyle}
        onClick={() => {
          if (onOpen) {
            onOpen(href)
            return
          }
          void window.api.app.openExternal(href).catch(console.error)
        }}
      >
        {iconMaskSrc ? <span className={cn('pichu-inline-link-icon', iconClassName)} /> : null}
        <span className={cn('min-w-0 wrap-anywhere', contentClassName)}>{children}</span>
      </TooltipTrigger>
      {tooltip ? (
        <TooltipContent
          side={side}
          className={cn('max-w-96 whitespace-normal wrap-anywhere', tooltipClassName)}
        >
          {tooltip}
        </TooltipContent>
      ) : null}
    </Tooltip>
  )
}
