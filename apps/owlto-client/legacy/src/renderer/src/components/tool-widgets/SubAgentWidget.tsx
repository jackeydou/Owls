import { Bot, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ToolWidgetComponentProps } from './types'

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function SubAgentWidget({
  widget,
  isStreaming
}: ToolWidgetComponentProps): React.JSX.Element {
  const [open, setOpen] = useState(true)

  const detail = useMemo(() => {
    if (
      widget.result &&
      typeof widget.result === 'object' &&
      'details' in widget.result &&
      typeof widget.result.details === 'object' &&
      widget.result.details !== null &&
      'detail' in widget.result.details &&
      typeof widget.result.details.detail === 'string'
    ) {
      return widget.result.details.detail
    }
    if (
      widget.result &&
      typeof widget.result === 'object' &&
      'output' in widget.result &&
      typeof widget.result.output === 'string'
    ) {
      return widget.result.output
    }
    return null
  }, [widget.result])

  return (
    <div className="rounded-xl border border-border/70 bg-card/70 px-3.5 py-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-left"
      >
        <Bot className="size-4 text-foreground/70" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-foreground">{widget.title}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {widget.isError
              ? 'Delegated agent failed'
              : isStreaming
                ? 'Delegated agent is working...'
                : 'Delegated agent finished'}
          </div>
        </div>
        <ChevronRight
          className={`size-3.5 text-muted-foreground/50 transition-transform ${open ? 'rotate-90' : ''}`}
          strokeWidth={1.8}
        />
      </button>

      {open ? (
        <div className="mt-3 space-y-2">
          {detail ? (
            <div className="rounded-lg bg-card-muted/70 px-3 py-2 text-[12px] leading-relaxed text-foreground/85">
              {detail}
            </div>
          ) : null}
          <pre className="max-h-72 overflow-auto rounded-lg bg-card-muted/70 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            {stringify({
              args: widget.args,
              result: widget.result
            })}
          </pre>
        </div>
      ) : null}
    </div>
  )
}
