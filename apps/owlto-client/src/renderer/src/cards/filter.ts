import { useMemo } from 'react'
import type { Card } from '../../../shared/cards'
import { type CardFilter, useCardsStore } from './store'

export function matches(card: Card, filter: CardFilter): boolean {
  if (filter.tag && !card.tags.includes(filter.tag)) return false
  const needle = filter.query.trim().toLocaleLowerCase()
  return (
    !needle ||
    card.title.toLocaleLowerCase().includes(needle) ||
    card.body.toLocaleLowerCase().includes(needle) ||
    card.tags.some((tag) => tag.toLocaleLowerCase().includes(needle))
  )
}

/** Cards that pass the library's filter, in the store's order (most recently changed first). */
export function useFilteredCards(): Card[] {
  const cards = useCardsStore((s) => s.cards)
  const filter = useCardsStore((s) => s.filter)
  return useMemo(() => cards.filter((card) => matches(card, filter)), [cards, filter])
}
