import { CheckIcon } from '@renderer/components/ui/icons'
import { useTranslation } from 'react-i18next'
import type { Card } from '../../../shared/cards'
import { CardBody } from './CardBody'

/** Where a card came from, in a few words. */
export function useSourceLabel(card: Card): string {
  const { t } = useTranslation()
  if (!card.source) return t('cards.sourceManual')
  const title = card.source.threadTitle ?? t('thread.untitled')
  return t(card.source.kind === 'worker' ? 'cards.sourceWorker' : 'cards.sourceMessage', { title })
}

/**
 * One card in the list: its title and body, nothing else. The whole tile opens
 * the card; the check, shown on hover or once picked, picks it for sending.
 */
export function CardTile({
  card,
  selected,
  open,
  onToggle,
  onOpen
}: {
  card: Card
  selected: boolean
  open: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const { t } = useTranslation()
  return (
    <article
      className="card-tile"
      aria-current={open || undefined}
      data-selected={selected || undefined}
    >
      <h4>{card.title}</h4>
      {card.body ? <CardBody body={card.body} /> : null}
      <button
        type="button"
        className="card-tile-open"
        aria-label={t('cards.openCard', { title: card.title })}
        onClick={onOpen}
      />
      <button
        type="button"
        aria-pressed={selected}
        className="card-tile-check"
        aria-label={t('cards.pick', { title: card.title })}
        onClick={onToggle}
      >
        {selected ? <CheckIcon size={12} /> : null}
      </button>
    </article>
  )
}
