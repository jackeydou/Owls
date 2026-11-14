import { z } from 'zod'

/** Longest card title. */
export const CARD_TITLE_LIMIT = 120
/** Longest card body, in characters of Markdown. */
export const CARD_BODY_LIMIT = 20_000
export const CARD_TAG_LIMIT = 12
const CARD_TAG_LENGTH = 32
/** Most cards one message can carry. */
export const ATTACHED_CARD_LIMIT = 8
/** Most characters of card text one message can carry, so cards cannot crowd out the model's context. */
export const ATTACHED_TEXT_LIMIT = 30_000

const id = z.string().min(1).max(64)
const projectId = z.string().min(1).max(200).nullable()
const title = z.string().trim().min(1).max(CARD_TITLE_LIMIT)
const body = z.string().max(CARD_BODY_LIMIT)
/** Tags are trimmed, deduplicated, and sorted so the stored list only changes when they do. */
const tags = z
  .array(z.string().trim().min(1).max(CARD_TAG_LENGTH))
  .max(CARD_TAG_LIMIT)
  .transform((list) => [...new Set(list)].sort((a, b) => a.localeCompare(b)))

/** Where a card was saved from: a record of its origin, not a live link to it. */
export const cardSourceSchema = z.object({
  kind: z.enum(['message', 'worker']),
  threadId: z.string(),
  /** The thread's title when the card was saved. */
  threadTitle: z.string().nullable(),
  itemId: z.string().nullable(),
  workerId: z.string().nullable()
})

/** A knowledge card. `deleted` is a tombstone: only the id, rev, and times stay. */
export const cardSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  /** Null for a card that belongs to no project. */
  projectId: z.string().nullable(),
  status: z.enum(['active', 'deleted']),
  /** Taken from the shared change version; every change, deletion included, takes the next one. */
  rev: z.number().int().nonnegative(),
  source: cardSourceSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})

/** Where a card sits on a board, in board coordinates. */
export const boardPlacementSchema = z.object({
  cardId: id,
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000)
})
export const BOARD_CARD_LIMIT = 500

/** A whiteboard of cards. A card can sit on several boards. */
export const boardSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string().nullable(),
  status: z.enum(['active', 'deleted']),
  rev: z.number().int().nonnegative(),
  placements: z.array(boardPlacementSchema),
  createdAt: z.string(),
  updatedAt: z.string()
})

const boardName = z.string().trim().min(1).max(60)
/** What can be saved into a card: the same sources a forward accepts. */
export const cardCaptureSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('item'),
    routerId: z.string().uuid(),
    itemId: z.string().min(1).max(200)
  }),
  z.object({ kind: z.literal('worker'), routerId: z.string().uuid(), workerId: id })
])

export const cardSaveSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), title, body, tags, projectId }),
  z.object({ action: z.literal('update'), id, title, body, tags, projectId })
])
/** Saves a thread message or worker result as a new card. Main reads the text itself. */
export const cardCaptureSchema = z.object({
  source: cardCaptureSourceSchema,
  title,
  tags,
  projectId
})
export const boardSaveSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), name: boardName, projectId }),
  z.object({ action: z.literal('rename'), id, name: boardName, projectId }),
  z.object({
    action: z.literal('place'),
    id,
    placements: z.array(boardPlacementSchema).max(BOARD_CARD_LIMIT)
  })
])
export const cardIdSchema = id

/** A card as a message carried it: frozen when sent, so later edits never change the thread. */
export const attachedCardSchema = z.object({
  id: z.string(),
  rev: z.number().int().nonnegative(),
  title: z.string(),
  body: z.string()
})
/** How a user message shows the cards it carried. */
export const cardRefSchema = attachedCardSchema.pick({ id: true, title: true })

export type Card = z.infer<typeof cardSchema>
export type CardSource = z.infer<typeof cardSourceSchema>
export type Board = z.infer<typeof boardSchema>
export type BoardPlacement = z.infer<typeof boardPlacementSchema>
export type CardSave = z.input<typeof cardSaveSchema>
export type CardCapture = z.input<typeof cardCaptureSchema>
export type BoardSave = z.input<typeof boardSaveSchema>
export type AttachedCard = z.infer<typeof attachedCardSchema>
export type CardRef = z.infer<typeof cardRefSchema>
/** Every live card and board; deleted ones stay out. */
export type CardLibrary = { cards: Card[]; boards: Board[] }
