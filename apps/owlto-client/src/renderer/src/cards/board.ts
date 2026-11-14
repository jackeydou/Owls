import type { BoardPlacement, Card } from '../../../shared/cards'

/** A card's width on a board, in board units. */
export const BOARD_CARD_WIDTH = 280
const GAP = 32
const COLUMN = BOARD_CARD_WIDTH + GAP
const COLUMNS = 4
/** Matches `.board-card .card-body { max-height }`. */
const BODY_MAX = 320
const TEXT_WIDTH = BOARD_CARD_WIDTH - 36

/** Rough rendered width of a line: wide (CJK) characters count double. */
const lineUnits = (line: string) =>
  [...line].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)

/**
 * A card's height on a board, guessed from its text. Cards show their body
 * clipped at BODY_MAX, so the guess only has to be close for short cards.
 */
export function estimateCardHeight(card: Pick<Card, 'title' | 'body'> | undefined): number {
  if (!card) return 160
  const lines = (text: string, unit: number) =>
    text
      .split('\n')
      .filter((line) => line.trim())
      .reduce((sum, line) => sum + Math.max(1, Math.ceil((lineUnits(line) * unit) / TEXT_WIDTH)), 0)
  const title = Math.max(1, lines(card.title, 8.5)) * 22
  const body = card.body ? Math.min(BODY_MAX, lines(card.body, 6.6) * 20 + 8) : 0
  return 30 + title + (body ? 8 + body : 0)
}

/**
 * Where a card added without a drop point goes: under the shortest of four
 * columns, so cards of different heights never land on each other.
 */
export function nextSlot(placements: BoardPlacement[], cards: Card[]): { x: number; y: number } {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const bottoms = Array.from({ length: COLUMNS }, () => 0)
  for (const p of placements) {
    const bottom = p.y + estimateCardHeight(byId.get(p.cardId)) + GAP
    for (let c = 0; c < COLUMNS; c++) {
      const x = c * COLUMN
      if (p.x < x + BOARD_CARD_WIDTH && p.x + BOARD_CARD_WIDTH > x)
        bottoms[c] = Math.max(bottoms[c], bottom)
    }
  }
  const column = bottoms.indexOf(Math.min(...bottoms))
  return { x: column * COLUMN, y: bottoms[column] }
}
