import { isInlineImage } from '../../shared/attachments.js'
import type { RuntimeTurn } from '../app/agent-runtime.js'
import { turnText } from '../app/attachments.js'

/** The text part of a turn: the user's text and the paths of non-image files. */
export function codexText(turn: RuntimeTurn): string {
  return turnText(
    turn.text,
    (turn.attachments ?? []).filter((f) => !isInlineImage(f))
  )
}

/**
 * A turn's `UserInput` items. Codex reads images from disk itself (`localImage`),
 * so only other files go into the text as paths.
 */
export function codexInput(turn: RuntimeTurn): Record<string, unknown>[] {
  const files = turn.attachments ?? []
  const images = files.filter(isInlineImage)
  const text = codexText(turn)
  return [
    ...(text ? [{ type: 'text', text, text_elements: [] }] : []),
    ...images.map((image) => ({ type: 'localImage', path: image.path }))
  ]
}
