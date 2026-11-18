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
/** A note an agent saves: its text, the thread's project, and where it was saved from. */
export type AgentNoteInput = {
  title: string
  body: string
  tags: string[]
  projectId: string | null
  source: CardSource
}

const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`
const missingCard = () => new OwltoError('request_unavailable', 'This note no longer exists.')
const missingBoard = () => new OwltoError('request_unavailable', 'This board no longer exists.')

/**
 * The user's notes (cards internally) and boards. Notes are Markdown files; see
 * `CardStore`. Agents read a note only when the user attaches it to a message,
 * as a frozen copy.
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
  private stopWatching: (() => void) | null = null
  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
  /** Picks up notes added, edited, or deleted in the notes folder by other apps. */
  watch(): void {
    this.stopWatching ??= this.deps.store.watch(() => this.deps.changed())
  }
  close(): void {
    this.stopWatching?.()
    this.stopWatching = null
  }
  library(): CardLibrary {
    const cards = this.deps.store.cards()
    const live = new Set(cards.map((card) => card.id))
    // A note deleted while the app was closed may still sit on a board.
    const boards = this.deps.store.boards().map((board) => ({
      ...board,
      placements: board.placements.filter((p) => live.has(p.cardId))
    }))
    return { cards, boards }
  }
  /** Where a live note's Markdown file is, to show it in Finder. */
  filePath(id: string): string {
    this.liveCard(id)
    const path = this.deps.store.filePath(id)
    if (!path) throw missingCard()
    return path
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
  /**
   * Adds a note an agent wrote through its save_note tool. A project removed
   * since the thread started files the note under no project instead of failing.
   */
  addFromAgent(input: AgentNoteInput): Card {
    const projectId =
      input.projectId && this.deps.projects().some((project) => project.id === input.projectId)
        ? input.projectId
        : null
    const now = this.now()
    const card = this.deps.store.putCard({
      id: newId('c'),
      title: input.title,
      body: input.body,
      tags: [...new Set(input.tags)].sort((a, b) => a.localeCompare(b)),
      projectId,
      status: 'active',
      source: input.source,
      createdAt: now,
      updatedAt: now
    })
    this.deps.changed()
    return card
  }
  remove(id: string): void {
    this.liveCard(id)
    const now = this.now()
    const boards = this.deps.store
      .boards()
      .filter((board) => board.placements.some((p) => p.cardId === id))
      .map((board) => ({
        ...board,
        placements: board.placements.filter((p) => p.cardId !== id),
        updatedAt: now
      }))
    this.deps.store.deleteCard(id, boards)
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
      throw new OwltoError('invalid_request', 'These notes are too long to send together.')
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
