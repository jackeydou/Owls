import type { BoardPlacement } from '../../../shared/cards'

/** A card's width on a board, in board units. */
export const BOARD_CARD_WIDTH = 240
const COLUMN = BOARD_CARD_WIDTH + 32
const ROW = 220
const COLUMNS = 4

/** The next free cell of a simple grid, for a card added without a drop point. */
export function nextSlot(placements: BoardPlacement[]): { x: number; y: number } {
  const taken = new Set(placements.map((p) => `${p.x},${p.y}`))
  for (let n = 0; ; n++) {
    const x = (n % COLUMNS) * COLUMN
    const y = Math.floor(n / COLUMNS) * ROW
    if (!taken.has(`${x},${y}`)) return { x, y }
  }
}
