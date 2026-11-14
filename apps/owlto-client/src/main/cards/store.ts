import { eq } from 'drizzle-orm'
import { type Board, boardSchema, type Card, cardSchema } from '../../shared/cards.js'
import { boardsTable, cardsTable } from '../app/schema.js'
import type { OwltoStore } from '../app/store.js'
import { nextRev } from '../app/sync-state.js'
import { logChange } from '../sync/sync-log.js'

type Tx = Pick<OwltoStore['db'], 'insert'>
type Unsaved<T> = Omit<T, 'rev'>

/** Card and board persistence in `owlto.db`. Every write takes the next change version. */
export class CardStore {
  constructor(private readonly store: OwltoStore) {}
  private get db() {
    return this.store.db
  }
  /** Live cards, most recently changed first. */
  cards(): Card[] {
    return this.db
      .select()
      .from(cardsTable)
      .where(eq(cardsTable.status, 'active'))
      .all()
      .map((row) => cardSchema.parse(row.value))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  }
  /** Live boards, oldest first, so the list keeps its order as boards change. */
  boards(): Board[] {
    return this.db
      .select()
      .from(boardsTable)
      .where(eq(boardsTable.status, 'active'))
      .all()
      .map((row) => boardSchema.parse(row.value))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }
  card(id: string): Card | null {
    const row = this.db.select().from(cardsTable).where(eq(cardsTable.id, id)).get()
    return row ? cardSchema.parse(row.value) : null
  }
  board(id: string): Board | null {
    const row = this.db.select().from(boardsTable).where(eq(boardsTable.id, id)).get()
    return row ? boardSchema.parse(row.value) : null
  }
  putCard(card: Unsaved<Card>): Card {
    return this.db.transaction((tx) => this.writeCard(tx, card))
  }
  putBoard(board: Unsaved<Board>): Board {
    return this.db.transaction((tx) => this.writeBoard(tx, board))
  }
  /** Writes a card's tombstone and takes it off every board, in one transaction. */
  deleteCard(card: Unsaved<Card>, boards: Unsaved<Board>[]): void {
    this.db.transaction((tx) => {
      this.writeCard(tx, card)
      for (const board of boards) this.writeBoard(tx, board)
    })
  }
  private writeCard(tx: Tx, card: Unsaved<Card>): Card {
    const rev = nextRev(tx)
    const value = cardSchema.parse({ ...card, rev })
    const row = {
      rev,
      projectId: value.projectId,
      status: value.status,
      updatedAt: value.updatedAt,
      value
    }
    tx.insert(cardsTable)
      .values({ id: value.id, ...row })
      .onConflictDoUpdate({ target: cardsTable.id, set: row })
      .run()
    logChange(tx, 'card', value.id)
    return value
  }
  private writeBoard(tx: Tx, board: Unsaved<Board>): Board {
    const rev = nextRev(tx)
    const value = boardSchema.parse({ ...board, rev })
    const row = { rev, status: value.status, updatedAt: value.updatedAt, value }
    tx.insert(boardsTable)
      .values({ id: value.id, ...row })
      .onConflictDoUpdate({ target: boardsTable.id, set: row })
      .run()
    logChange(tx, 'board', value.id)
    return value
  }
}
