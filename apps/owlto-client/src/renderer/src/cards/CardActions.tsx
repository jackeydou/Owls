import { IconButton } from '@renderer/components/ui/icon-button'
import { CardPlusIcon, CardsIcon, CheckIcon } from '@renderer/components/ui/icons'
import { useTranslation } from 'react-i18next'
import type { CardCapture, CardRef } from '../../../shared/cards'
import { useAppStore } from '../app/store'
import { useCardsStore } from './store'

const TITLE_LIMIT = 60

/** A default card title: the first line with text, on one line. */
export function titleFrom(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? text
  const plain = line
    .replace(/^[#>*\-\s]+/, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > TITLE_LIMIT ? `${plain.slice(0, TITLE_LIMIT)}…` : plain
}

/** Opens a card in the library. */
function useOpenCard(): (cardId: string) => void {
  const showCards = useAppStore((s) => s.showCards)
  const { openCard, showBoard } = useCardsStore()
  return (cardId) => {
    showBoard(null)
    openCard(cardId)
    showCards()
  }
}

/**
 * Saves a message or worker result as a card. Once saved, it opens that card
 * instead, so the same text is not saved twice by accident.
 */
export function SaveCardAction({
  source,
  text,
  title,
  projectId
}: {
  source: CardCapture['source']
  text: string
  /** A better default title than the text's first line, such as a worker's title. */
  title?: string
  projectId: string | null
}) {
  const { t } = useTranslation()
  const saved = useCardsStore((s) =>
    s.cards.find((card) =>
      source.kind === 'item'
        ? card.source?.kind === 'message' && card.source.itemId === source.itemId
        : card.source?.kind === 'worker' && card.source.workerId === source.workerId
    )
  )
  const startCapture = useCardsStore((s) => s.startCapture)
  const open = useOpenCard()
  if (saved)
    return (
      <IconButton
        size="sm"
        label={t('cards.saved', { title: saved.title })}
        tooltip={t('cards.saved', { title: saved.title })}
        icon={<CheckIcon size={15} />}
        onClick={() => open(saved.id)}
      />
    )
  return (
    <IconButton
      size="sm"
      label={t('cards.saveAction')}
      tooltip={t('cards.saveAction')}
      icon={<CardPlusIcon size={15} />}
      onClick={() =>
        startCapture({ source, title: title ?? titleFrom(text), preview: text, projectId })
      }
    />
  )
}

/** The cards a user message carried, as they were named when it was sent. */
export function MessageCards({ cards }: { cards: CardRef[] }) {
  const { t } = useTranslation()
  const live = useCardsStore((s) => s.cards)
  const open = useOpenCard()
  return (
    <ul className="message-cards" aria-label={t('cards.attached')}>
      {cards.map((card) => {
        const exists = live.some((c) => c.id === card.id)
        return (
          <li key={card.id}>
            <button
              type="button"
              disabled={!exists}
              onClick={() => open(card.id)}
              aria-label={t('cards.openCard', { title: card.title })}
            >
              <CardsIcon size={13} />
              <span>{card.title}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
