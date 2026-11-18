import { z } from 'zod'
import { CARD_BODY_LIMIT, CARD_TAG_LIMIT, CARD_TITLE_LIMIT } from '../../shared/cards.js'
import { defineTool, type RouterTool } from '../router/tools.js'
import { type WorkerTool, workerTool } from '../router/worker-tools.js'

export const saveNoteInput = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(CARD_TITLE_LIMIT)
      .describe("Short title the user sees in their Notes list, in the user's language."),
    body: z
      .string()
      .trim()
      .min(1)
      .max(CARD_BODY_LIMIT)
      .describe(
        'The note text, in Markdown. Complete enough to read later without this conversation.'
      ),
    tags: z
      .array(z.string().trim().min(1).max(32))
      .max(CARD_TAG_LIMIT)
      .optional()
      .describe('A few short tags to file the note under. Leave out when none fit.')
  })
  .strict()
export type SaveNoteInput = z.infer<typeof saveNoteInput>

const DESCRIPTION =
  "Save text as a new note in the user's Notes, a Markdown file they can read, edit, and attach to later messages. Save one only when the user asks to save, keep, or note something down, and tell them its title. Each call adds a new note; it never changes an existing one."

/** The Router's note tool. */
export function routerNoteTools(save: (input: SaveNoteInput) => unknown): RouterTool[] {
  return [defineTool('save_note', 'Save note', DESCRIPTION, saveNoteInput, save)]
}

/** A worker's note tool, the same one every agent gets next to `report`. */
export function workerNoteTools(save: (input: SaveNoteInput) => unknown): WorkerTool[] {
  return [workerTool('save_note', DESCRIPTION, saveNoteInput, save)]
}
