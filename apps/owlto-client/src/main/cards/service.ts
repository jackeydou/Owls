import { randomBytes } from 'node:crypto'
import type { z } from 'zod'
import type { Project } from '../../shared/app.js'
import {
  ATTACHED_TEXT_LIMIT,
  type AttachedCard,
  type Board,
  type boardSaveSchema,
  type Card,
  type CardLibrary,
  type CardSource,
  type cardCaptureSchema,
  type cardSaveSchema
} from '../../shared/cards.js'
import { OwltoError } from '../app/errors.js'
import type { CardStore } from './store.js'

type CardSaveInput = z.infer<typeof cardSaveSchema>
type CardCaptureInput = z.infer<typeof cardCaptureSchema>
type BoardSaveInput = z.infer<typeof boardSaveSchema>
/** The frozen text of a thread message or worker result, and where it came from. */
export type CapturedContent = { text: string; source: CardSource }

const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`
const missingCard = () => new OwltoError('request_unavailable', 'This card no longer exists.')
const missingBoard = () => new OwltoError('request_unavailable', 'This board no longer exists.')

/**
 * The user's knowledge cards and boards. Only the user writes them: agents read a
 * card only when the user attaches it to a message, as a frozen copy.
 */
export class CardService {
  constructor(
    private readonly deps: {
      store: CardStore
      projects: () => Project[]
      /** Reads a thread message or worker result; throws when it is gone. */
      content: (source: CardCaptureInput['source']) => CapturedContent
      changed: () => void
      now?: () => Date
    }
  ) {}
  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
  library(): CardLibrary {
    return { cards: this.deps.store.cards(), boards: this.deps.store.boards() }
  }
  save(input: CardSaveInput): Card {
    const projectId = this.projectId(input.projectId)
    const now = this.now()
    const fields = { title: input.title, body: input.body, tags: input.tags, projectId }
    const card =
      input.action === 'add'
        ? this.deps.store.putCard({
            id: newId('c'),
            ...fields,
            status: 'active',
            source: null,
            createdAt: now,
            updatedAt: now
          })
        : this.deps.store.putCard({ ...this.liveCard(input.id), ...fields, updatedAt: now })
    this.deps.changed()
    return card
  }
  capture(input: CardCaptureInput): Card {
    const projectId = this.projectId(input.projectId)
    const content = this.deps.content(input.source)
    const now = this.now()
    const card = this.deps.store.putCard({
      id: newId('c'),
      title: input.title,
      body: content.text,
      tags: input.tags,
      projectId,
      status: 'active',
      source: content.source,
      createdAt: now,
      updatedAt: now
    })
    this.deps.changed()
    return card
  }
  remove(id: string): void {
    const card = this.liveCard(id)
    const now = this.now()
    const boards = this.deps.store
      .boards()
      .filter((board) => board.placements.some((p) => p.cardId === id))
      .map((board) => ({
        ...board,
        placements: board.placements.filter((p) => p.cardId !== id),
        updatedAt: now
      }))
    this.deps.store.deleteCard(
      { ...card, title: '', body: '', tags: [], source: null, status: 'deleted', updatedAt: now },
      boards
    )
    this.deps.changed()
  }
  saveBoard(input: BoardSaveInput): Board {
    const now = this.now()
    let board: Board
    if (input.action === 'add') {
      board = this.deps.store.putBoard({
        id: newId('bd'),
        name: input.name,
        projectId: this.projectId(input.projectId),
        status: 'active',
        placements: [],
        createdAt: now,
        updatedAt: now
      })
    } else if (input.action === 'rename') {
      board = this.deps.store.putBoard({
        ...this.liveBoard(input.id),
        name: input.name,
        projectId: this.projectId(input.projectId),
        updatedAt: now
      })
    } else {
      const live = new Set(this.deps.store.cards().map((card) => card.id))
      // One place per card: a later entry wins, and cards deleted meanwhile drop out.
      const placed = new Map(
        input.placements.filter((p) => live.has(p.cardId)).map((p) => [p.cardId, p])
      )
      board = this.deps.store.putBoard({
        ...this.liveBoard(input.id),
        placements: [...placed.values()],
        updatedAt: now
      })
    }
    this.deps.changed()
    return board
  }
  removeBoard(id: string): void {
    const board = this.liveBoard(id)
    this.deps.store.putBoard({ ...board, placements: [], status: 'deleted', updatedAt: this.now() })
    this.deps.changed()
  }
  /**
   * Freezes the cards a message carries, in the order given. Refuses a card that
   * is gone, or cards whose text together would crowd out the model's context.
   */
  attach(ids: string[]): AttachedCard[] {
    const cards = [...new Set(ids)].map((id) => {
      const card = this.liveCard(id)
      return { id: card.id, rev: card.rev, title: card.title, body: card.body }
    })
    const size = cards.reduce((sum, card) => sum + card.title.length + card.body.length, 0)
    if (size > ATTACHED_TEXT_LIMIT)
      throw new OwltoError('invalid_request', 'These cards are too long to send together.')
    return cards
  }
  private liveCard(id: string): Card {
    const card = this.deps.store.card(id)
    if (card?.status !== 'active') throw missingCard()
    return card
  }
  private liveBoard(id: string): Board {
    const board = this.deps.store.board(id)
    if (board?.status !== 'active') throw missingBoard()
    return board
  }
  private projectId(id: string | null): string | null {
    if (id && !this.deps.projects().some((project) => project.id === id))
      throw new OwltoError('project_required', 'This project no longer exists.')
    return id
  }
}
