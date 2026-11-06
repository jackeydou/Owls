import {
  autoUpdate,
  flip,
  inline,
  offset,
  type Placement,
  type ReferenceElement,
  shift,
  size,
  useFloating
} from '@floating-ui/react-dom'
import { cn } from '@renderer/lib/utils'
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  cloneElement,
  createContext,
  type FocusEvent,
  type ForwardedRef,
  forwardRef,
  type HTMLAttributes,
  isValidElement,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

type TooltipSide = 'top' | 'right' | 'bottom' | 'left'

type RefProp<T> = ForwardedRef<T> | undefined

type TooltipContextValue = {
  open: boolean
  setOpen: (v: boolean) => void
  setPlacement: (placement: Placement) => void
  setSideOffset: (offset: number) => void
  refs: ReturnType<typeof useFloating>['refs']
  floatingStyles: CSSProperties
}

const TooltipContext = createContext<TooltipContextValue | null>(null)

const tooltipSurfaceClassName =
  'z-[100] rounded-xl border border-border/70 bg-card/95 px-3 py-1.5 text-xs leading-snug text-foreground shadow-[0_2px_10px_rgb(0_0_0_/_0.08)] backdrop-blur-xl dark:border-white/12'

function sideToPlacement(side: TooltipSide): Placement {
  switch (side) {
    case 'right':
      return 'right'
    case 'bottom':
      return 'bottom'
    case 'left':
      return 'left'
    default:
      return 'top'
  }
}

function setForwardedRef<T>(ref: RefProp<T>, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value)
    return
  }
  if (ref) {
    ref.current = value
  }
}

function getElementRef<T>(element: ReactElement): RefProp<T> {
  return (element.props as { ref?: RefProp<T> }).ref
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function Tooltip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement>('top')
  const [sideOffset, setSideOffset] = useState(8)
  const { refs, floatingStyles } = useFloating({
    open,
    placement,
    strategy: 'fixed',
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [offset(sideOffset), flip({ padding: 8 }), shift({ padding: 8 })]
  })

  return (
    <TooltipContext.Provider
      value={{ open, setOpen, setPlacement, setSideOffset, refs, floatingStyles }}
    >
      {children}
    </TooltipContext.Provider>
  )
}

export const TooltipTrigger = forwardRef<
  HTMLButtonElement,
  { children: ReactNode; asChild?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>
>(
  (
    {
      children,
      asChild,
      onBlur,
      onClick,
      onFocus,
      onMouseEnter,
      onMouseLeave,
      onPointerDown,
      ...props
    },
    ref
  ) => {
    const context = useContext(TooltipContext)
    if (!context) {
      throw new Error('TooltipTrigger must be used within Tooltip.')
    }
    const suppressNextFocusOpenRef = useRef(false)

    const setReference = useCallback(
      (node: HTMLButtonElement | null) => {
        context.refs.setReference(node)
        setForwardedRef(ref, node)
      },
      [context.refs, ref]
    )

    const handleMouseEnter = (event: MouseEvent<HTMLButtonElement>) => {
      context.setOpen(true)
      onMouseEnter?.(event)
    }
    const handleMouseLeave = (event: MouseEvent<HTMLButtonElement>) => {
      context.setOpen(false)
      onMouseLeave?.(event)
    }
    const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
      if (suppressNextFocusOpenRef.current || !event.currentTarget.matches(':focus-visible')) {
        suppressNextFocusOpenRef.current = false
        onFocus?.(event)
        return
      }
      context.setOpen(true)
      onFocus?.(event)
    }
    const handleBlur = (event: FocusEvent<HTMLButtonElement>) => {
      context.setOpen(false)
      onBlur?.(event)
    }
    const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
      suppressNextFocusOpenRef.current = true
      context.setOpen(false)
      window.setTimeout(() => {
        suppressNextFocusOpenRef.current = false
      }, 0)
      onPointerDown?.(event)
    }
    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      context.setOpen(false)
      onClick?.(event)
    }

    if (asChild && isValidElement<ButtonHTMLAttributes<HTMLButtonElement>>(children)) {
      const childProps = children.props
      const childRef = getElementRef<HTMLButtonElement>(children)
      const triggerProps = {
        ...props,
        ref: (node: HTMLButtonElement | null) => {
          setReference(node)
          setForwardedRef(childRef, node)
        },
        onMouseEnter: (event: MouseEvent<HTMLButtonElement>) => {
          handleMouseEnter(event)
          childProps.onMouseEnter?.(event)
        },
        onMouseLeave: (event: MouseEvent<HTMLButtonElement>) => {
          handleMouseLeave(event)
          childProps.onMouseLeave?.(event)
        },
        onFocus: (event: FocusEvent<HTMLButtonElement>) => {
          handleFocus(event)
          childProps.onFocus?.(event)
        },
        onBlur: (event: FocusEvent<HTMLButtonElement>) => {
          handleBlur(event)
          childProps.onBlur?.(event)
        },
        onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
          handlePointerDown(event)
          childProps.onPointerDown?.(event)
        },
        onClick: (event: MouseEvent<HTMLButtonElement>) => {
          handleClick(event)
          childProps.onClick?.(event)
        }
      } as ButtonHTMLAttributes<HTMLButtonElement> & {
        ref: (node: HTMLButtonElement | null) => void
      }
      return cloneElement(children, triggerProps)
    }

    return (
      <button
        ref={setReference}
        type="button"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        {...props}
      >
        {children}
      </button>
    )
  }
)
TooltipTrigger.displayName = 'TooltipTrigger'

export const TooltipContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & {
    side?: TooltipSide
    sideOffset?: number
  }
>(({ className, children, side = 'top', sideOffset = 8, style, ...props }, ref) => {
  const context = useContext(TooltipContext)
  if (!context) {
    throw new Error('TooltipContent must be used within Tooltip.')
  }

  useEffect(() => {
    context.setPlacement(sideToPlacement(side))
    context.setSideOffset(sideOffset)
  }, [context, side, sideOffset])

  const setFloating = useCallback(
    (node: HTMLDivElement | null) => {
      context.refs.setFloating(node)
      setForwardedRef(ref, node)
    },
    [context.refs, ref]
  )

  if (!context.open) return null

  return createPortal(
    <div
      ref={setFloating}
      role="tooltip"
      className={cn(tooltipSurfaceClassName, 'max-w-xs whitespace-normal', className)}
      style={{ ...context.floatingStyles, ...style }}
      {...props}
    >
      {children}
    </div>,
    document.body
  )
})
TooltipContent.displayName = 'TooltipContent'

export function AnchoredTooltip({
  children,
  className,
  maxWidth = 320,
  open,
  placement = 'top-start',
  reference,
  sideOffset = 8
}: {
  children: ReactNode
  className?: string
  maxWidth?: number
  open: boolean
  placement?: Placement
  reference: ReferenceElement | null
  sideOffset?: number
}): React.JSX.Element | null {
  const { refs, floatingStyles } = useFloating({
    elements: { reference },
    open,
    placement,
    strategy: 'fixed',
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(sideOffset),
      inline(),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableWidth, elements }) {
          elements.floating.style.maxWidth = `${Math.min(maxWidth, availableWidth)}px`
        }
      })
    ]
  })

  if (!open || !reference) return null

  return createPortal(
    <div
      ref={refs.setFloating}
      role="tooltip"
      className={cn(tooltipSurfaceClassName, className)}
      style={{ ...floatingStyles }}
    >
      {children}
    </div>,
    document.body
  )
}
