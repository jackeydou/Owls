import { IconButton } from '@renderer/components/ui/icon-button'
import { QuoteIcon, XIcon } from '@renderer/components/ui/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useTranslation } from 'react-i18next'
import type { DraftQuote } from './quotes'
import './quotes.css'

/** The quotes a draft carries, as tags above the editor; hovering one shows the whole passage. */
export function DraftQuoteTags({
  quotes,
  onRemove
}: {
  quotes: DraftQuote[]
  onRemove: (quoteId: string) => void
}) {
  const { t } = useTranslation()
  if (!quotes.length) return null
  return (
    <ul className="router-draft-quotes" aria-label={t('quote.attached')}>
      {quotes.map((quote) => (
        <li key={quote.id}>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focus reveals the whole quote in the tooltip. */}
              <span className="router-draft-quote-label" tabIndex={0}>
                <QuoteIcon size={13} />
                <span>{quote.text}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="router-quote-tooltip">
              <blockquote>{quote.text}</blockquote>
              {quote.note ? <p>{quote.note}</p> : null}
            </TooltipContent>
          </Tooltip>
          <IconButton
            size="sm"
            label={t('quote.remove')}
            icon={<XIcon size={12} />}
            onClick={() => onRemove(quote.id)}
          />
        </li>
      ))}
    </ul>
  )
}
