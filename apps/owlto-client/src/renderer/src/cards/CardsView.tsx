import { IconButton } from '@renderer/components/ui/icon-button'
import { LoaderIcon, XIcon } from '@renderer/components/ui/icons'
import { useTranslation } from 'react-i18next'
import { failureMessage } from '../app/failures'
import { BoardCanvas } from './BoardCanvas'
import { CardEditor } from './CardEditor'
import { CardsBar } from './CardsBar'
import { CardTile } from './CardTile'
import { useFilteredCards } from './filter'
import { useCardsStore } from './store'
import './cards.css'

function CardList() {
  const { t } = useTranslation()
  const status = useCardsStore((s) => s.status)
  const total = useCardsStore((s) => s.cards.length)
  const cards = useFilteredCards()
  const selected = useCardsStore((s) => s.selected)
  const openCardId = useCardsStore((s) => s.openCardId)
  const { toggleSelected, openCard } = useCardsStore()
  if (status === 'loading' || status === 'idle')
    return (
      <p className="cards-empty">
        <LoaderIcon size={16} className="animate-spin" />
        {t('cards.loading')}
      </p>
    )
  if (!total) return <p className="cards-empty">{t('cards.emptyLibrary')}</p>
  if (!cards.length) return <p className="cards-empty">{t('cards.noMatch')}</p>
  return (
    <div className="cards-scroll">
      <ul className="cards-grid" aria-label={t('cards.list')}>
        {cards.map((card) => (
          <li key={card.id}>
            <CardTile
              card={card}
              selected={selected.includes(card.id)}
              open={openCardId === card.id}
              onToggle={() => toggleSelected(card.id)}
              onOpen={() => openCard(card.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

function CardsError() {
  const { t } = useTranslation()
  const error = useCardsStore((s) => s.error)
  const clearError = useCardsStore((s) => s.clearError)
  if (!error) return null
  return (
    <div className="cards-error" role="alert">
      <span>{failureMessage(error)}</span>
      <IconButton
        size="sm"
        label={t('dismissError')}
        icon={<XIcon size={14} />}
        onClick={clearError}
      />
    </div>
  )
}

/** The knowledge library: the cards or a board, and the open card. */
export function CardsView() {
  const boardId = useCardsStore((s) => s.boardId)
  const openCardId = useCardsStore((s) => s.openCardId)
  const editorSession = useCardsStore((s) => s.editorSession)
  return (
    <main className="cards-view">
      <section className="cards-main">
        <CardsBar />
        <CardsError />
        {boardId ? <BoardCanvas key={boardId} boardId={boardId} /> : <CardList />}
      </section>
      {openCardId ? <CardEditor key={editorSession} cardId={openCardId} /> : null}
    </main>
  )
}
