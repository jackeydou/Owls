import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'

/**
 * The main window's size and place, kept in its own file in the data root rather than in
 * settings: the renderer saves settings as a whole, so a main-process write there would race it.
 */
export const WINDOW_STATE_FILENAME = 'window-state.json'

const rectSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive()
})
export type WindowRect = z.infer<typeof rectSchema>
const windowStateSchema = z.object({
  /** The window's bounds when it is not maximized, so un-maximizing returns there. */
  bounds: rectSchema,
  maximized: z.boolean()
})
export type WindowState = z.infer<typeof windowStateSchema>

/** How much of a saved window must still be on a display for Owlto to put it back there. */
const MIN_VISIBLE = 80

/** The saved state, or null when there is none or the file is not one Owlto wrote. */
export function readWindowState(path: string): WindowState | null {
  try {
    const parsed = windowStateSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeWindowState(path: string, state: WindowState): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(windowStateSchema.parse(state))}\n`)
  renameSync(temporary, path)
}

function overlap(a: WindowRect, b: WindowRect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  }
}

/**
 * Saved bounds fitted to the display they mostly sit on, or null when no connected display
 * shows enough of them (the display was unplugged or rearranged).
 */
export function restorableBounds(
  bounds: WindowRect,
  workAreas: readonly WindowRect[],
  minimum: { width: number; height: number }
): WindowRect | null {
  let best: { area: WindowRect; size: number } | null = null
  for (const area of workAreas) {
    const { width, height } = overlap(bounds, area)
    if (width < MIN_VISIBLE || height < MIN_VISIBLE) continue
    const size = width * height
    if (!best || size > best.size) best = { area, size }
  }
  if (!best) return null
  const { area } = best
  const width = Math.min(Math.max(bounds.width, minimum.width), area.width)
  const height = Math.min(Math.max(bounds.height, minimum.height), area.height)
  return {
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
    width,
    height
  }
}
