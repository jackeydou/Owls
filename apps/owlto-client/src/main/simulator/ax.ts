/**
 * The device's accessibility tree, cut down for a model: one line per element that has words
 * or can be tapped, each with a ref (`@e3`) the worker can tap instead of guessing a point.
 */

type Rect = { x: number; y: number; width: number; height: number }

/** A node as the serve-sim addon's `axDescribe` returns it (the shape of `axe describe-ui`). */
type RawNode = {
  AXUniqueId?: unknown
  AXLabel?: unknown
  AXValue?: unknown
  enabled?: unknown
  frame?: unknown
  type?: unknown
  role_description?: unknown
  children?: unknown
}

/** Where a ref points: the element's center, as 0..1 of the screen. */
export type AxTarget = { x: number; y: number }

export type AxScreen = {
  /** The screen in points, the unit the worker's coordinates use. */
  width: number
  height: number
  lines: string[]
  refs: Map<string, AxTarget>
  /** True when elements past the limit were left out. */
  truncated: boolean
}

const MAX_ELEMENTS = 300
const MAX_TEXT = 80
/** Element types worth listing even without a label, because they take input. */
const INPUT_TYPES = new Set(['Button', 'TextField', 'SecureTextField', 'Switch', 'Slider', 'Link'])

function rectOf(value: unknown): Rect | null {
  if (!value || typeof value !== 'object') return null
  const { x, y, width, height } = value as Record<string, unknown>
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return { x: x as number, y: y as number, width: width as number, height: height as number }
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : ''

const sameRect = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5

/** Builds the worker's view of the screen from the addon's JSON. */
export function describeScreen(json: string): AxScreen {
  const parsed = JSON.parse(json) as unknown
  const roots = (Array.isArray(parsed) ? parsed : [parsed]) as RawNode[]
  const screen = rectOf(roots[0]?.frame) ?? { x: 0, y: 0, width: 1, height: 1 }
  const lines: string[] = []
  const refs = new Map<string, AxTarget>()
  let truncated = false
  const visit = (node: RawNode) => {
    const frame = rectOf(node.frame)
    const type = text(node.type) || 'Element'
    const label = text(node.AXLabel)
    const value = text(node.AXValue)
    const visible =
      frame &&
      frame.width > 0 &&
      frame.height > 0 &&
      frame.x + frame.width > screen.x &&
      frame.y + frame.height > screen.y &&
      frame.x < screen.x + screen.width &&
      frame.y < screen.y + screen.height
    if (visible && !sameRect(frame, screen) && (label || value || INPUT_TYPES.has(type))) {
      if (refs.size >= MAX_ELEMENTS) truncated = true
      else {
        const ref = `@e${refs.size + 1}`
        const cx = frame.x + frame.width / 2
        const cy = frame.y + frame.height / 2
        refs.set(ref, {
          x: (cx - screen.x) / screen.width,
          y: (cy - screen.y) / screen.height
        })
        const words = [
          label && JSON.stringify(label),
          value && value !== label && `value ${JSON.stringify(value)}`
        ]
          .filter(Boolean)
          .join(' ')
        const disabled = node.enabled === false ? ' disabled' : ''
        lines.push(
          `${ref} ${type}${words ? ` ${words}` : ''}${disabled} at (${Math.round(cx - screen.x)}, ${Math.round(cy - screen.y)})`
        )
      }
    }
    if (Array.isArray(node.children)) for (const child of node.children) visit(child as RawNode)
  }
  for (const root of roots) visit(root)
  return { width: screen.width, height: screen.height, lines, refs, truncated }
}
