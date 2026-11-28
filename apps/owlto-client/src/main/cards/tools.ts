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

/** Most find-and-replace edits one edit_note call can make. */
export const NOTE_EDIT_LIMIT = 20

export const editNoteInput = z
  .object({
    noteId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .describe(
        "The note's ID: the noteId save_note returned, the id of an attached <owlto-card>, or the id field in the note file's frontmatter."
      ),
    title: z
      .string()
      .trim()
      .min(1)
      .max(CARD_TITLE_LIMIT)
      .optional()
      .describe('A new title. Leave out to keep the current one.'),
    body: z
      .string()
      .trim()
      .min(1)
      .max(CARD_BODY_LIMIT)
      .optional()
      .describe(
        'The whole new note text, in Markdown, replacing the current text. Use it only to rewrite the note; for smaller changes use edits. Cannot be combined with edits.'
      ),
    edits: z
      .array(
        z
          .object({
            oldText: z
              .string()
              .min(1)
              .max(CARD_BODY_LIMIT)
              .describe(
                "Exact text from the note's current Markdown body (not its frontmatter), including whitespace."
              ),
            newText: z
              .string()
              .max(CARD_BODY_LIMIT)
              .describe('The text that replaces it. Empty deletes it.'),
            replaceAll: z
              .boolean()
              .optional()
              .describe(
                'Replace every occurrence. Without it, oldText must occur exactly once in the note.'
              )
          })
          .strict()
      )
      .min(1)
      .max(NOTE_EDIT_LIMIT)
      .optional()
      .describe(
        "Find-and-replace changes to the note's body, applied in order, each to the result of the one before. All apply or none do."
      ),
    tags: z
      .array(z.string().trim().min(1).max(32))
      .max(CARD_TAG_LIMIT)
      .optional()
      .describe('The full new tag list, replacing the current tags. Leave out to keep them.')
  })
  .strict()
export type EditNoteInput = z.infer<typeof editNoteInput>

const SAVE_DESCRIPTION =
  "Save text as a new note in the user's Notes, a Markdown file they can read, edit, and attach to later messages. Save one only when the user asks to save, keep, or note something down, and tell them its title. Each call adds a new note; to change an existing note use edit_note."

const EDIT_DESCRIPTION =
  "Change an existing note in the user's Notes: its title, its tags, or its Markdown body, either rewritten whole or with find-and-replace edits. Edit a note only when the user asks to update, fix, or add to it, and tell them what changed. Give only the fields to change; the note keeps where it came from and its project."

/** The Router's note tools. */
export function routerNoteTools(handlers: {
  save: (input: SaveNoteInput) => unknown
  edit: (input: EditNoteInput) => unknown
}): RouterTool[] {
  return [
    defineTool('edit_note', 'Edit note', EDIT_DESCRIPTION, editNoteInput, handlers.edit),
    defineTool('save_note', 'Save note', SAVE_DESCRIPTION, saveNoteInput, handlers.save)
  ]
}

/** A worker's note tools, the same ones every agent gets next to `report`. */
export function workerNoteTools(handlers: {
  save: (input: SaveNoteInput) => unknown
  edit: (input: EditNoteInput) => unknown
}): WorkerTool[] {
  return [
    workerTool('edit_note', EDIT_DESCRIPTION, editNoteInput, handlers.edit),
    workerTool('save_note', SAVE_DESCRIPTION, saveNoteInput, handlers.save)
  ]
}
