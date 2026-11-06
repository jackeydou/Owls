import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

export function RawJsonViewer({ data }: { data: unknown }): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-2 max-w-full overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground/60 transition hover:bg-card-muted hover:text-muted-foreground"
      >
        <ChevronRight
          className={`size-3 transition-transform ${open ? 'rotate-90' : ''}`}
          strokeWidth={2}
        />
        Raw JSON
      </button>
      {open && (
        <pre className="mt-1.5 max-h-80 max-w-full overflow-auto whitespace-pre-wrap wrap-break-word rounded-md border border-border/60 bg-card-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}
