import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { ToolWidgetComponentProps } from './types'

function formatValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function statusLabel(widget: ToolWidgetComponentProps['widget'], isStreaming: boolean): string {
  if (widget.status === 'error') return 'failed'
  if (isStreaming) return 'running…'
  if (widget.result !== undefined) return 'done'
  return 'pending'
}

export function DefaultToolWidget({
  widget,
  isStreaming
}: ToolWidgetComponentProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const hasDetails =
    Object.keys(widget.args).length > 0 || widget.result !== undefined || widget.isError

  return (
    <div className="py-0.5">
      <button
        type="button"
        onClick={() => hasDetails && setOpen(!open)}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition ${
          hasDetails ? 'hover:bg-card-muted hover:text-foreground' : 'cursor-default'
        }`}
      >
        {isStreaming && (
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-foreground/30" />
        )}
        <span className="font-medium">{widget.toolName}</span>
        <span className="text-muted-foreground/50">·</span>
        <span className={widget.isError ? 'text-destructive' : ''}>
          {statusLabel(widget, isStreaming)}
        </span>
        {hasDetails && (
          <ChevronRight
            className={`size-3 text-muted-foreground/40 transition-transform ${open ? 'rotate-90' : ''}`}
            strokeWidth={2}
          />
        )}
      </button>

      {open && hasDetails && (
        <div className="mt-1 space-y-2 pl-2">
          {Object.keys(widget.args).length > 0 && (
            <pre className="max-h-48 overflow-auto rounded-md bg-card-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {formatValue(widget.args)}
            </pre>
          )}

          {widget.isError ? (
            <p className="px-1 text-[12px] text-destructive">
              {typeof widget.result === 'string' && widget.result
                ? widget.result
                : 'The tool returned an error.'}
            </p>
          ) : widget.result !== undefined ? (
            <pre className="max-h-48 overflow-auto rounded-md bg-card-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {formatValue(widget.result)}
            </pre>
          ) : null}
        </div>
      )}
    </div>
  )
}
