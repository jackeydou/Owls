import { IconButton } from '@renderer/components/ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'
import { MessageSquare, X } from 'lucide-react'

export type SelectionPillItem = {
  id: string
  text: string
}

function selectionPreview(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function SelectionContextPill({
  onRemoveAll,
  selections
}: {
  onRemoveAll?: () => void
  selections: readonly SelectionPillItem[]
}): React.JSX.Element | null {
  const { t } = useI18n()

  if (selections.length === 0) return null

  const label = t('chat.selection.contextCount', { count: selections.length })

  return (
    <Tooltip>
      <div className="group/selection-chip relative inline-flex max-w-full min-w-0 items-center rounded-[14px] border border-border/70 bg-white text-left shadow-[0_8px_18px_-18px_rgba(15,23,42,0.9)] dark:bg-background">
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-default items-center gap-1.5 rounded-[14px] px-2.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            aria-label={`${label}: ${selections.map((selection) => selection.text).join(' ')}`}
          >
            <MessageSquare className="size-3 shrink-0 text-muted-foreground" strokeWidth={1.8} />
            <span className="truncate text-[14px] font-medium leading-5 text-foreground">
              {label}
            </span>
          </button>
        </TooltipTrigger>
        {onRemoveAll ? (
          <IconButton
            label={t('chat.selection.removeContext')}
            icon={<X className="size-3.5" strokeWidth={1.9} aria-hidden />}
            variant="unstyled"
            size="custom"
            className="absolute top-1/2 right-1 size-5 -translate-y-1/2 rounded-full border border-border/70 bg-white text-muted-foreground opacity-0 transition hover:bg-white hover:text-foreground group-hover/selection-chip:opacity-100 focus-visible:opacity-100 dark:bg-background dark:hover:bg-background"
            onClick={(event) => {
              event.stopPropagation()
              onRemoveAll()
            }}
          />
        ) : null}
      </div>
      <TooltipContent
        side="top"
        className="max-h-56 max-w-[420px] overflow-auto bg-white px-3.5 py-2.5 text-left text-[13px] leading-5 dark:bg-background"
      >
        <div className="space-y-2">
          {selections.map((selection) => (
            <div key={selection.id} className="whitespace-pre-wrap wrap-break-word">
              <span aria-hidden="true" className="text-muted-foreground">
                "
              </span>
              {selectionPreview(selection.text)}
              <span aria-hidden="true" className="text-muted-foreground">
                "
              </span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
