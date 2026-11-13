import { flushSync } from 'react-dom'

/** The app's ease-out curve, shared with the map's CSS transitions. */
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const ZOOM_MS = 420
/** How far the map moves toward the project while the conversation opens over it. */
const MAP_ZOOM = 1.5

export const prefersCalm = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches

type Rect = { x: number; y: number; width: number; height: number }
const SMALL_RADIUS = '60px'

/** The project's node, relative to the stage both views fill. */
function projectRect(projectId: string | null): Rect | null {
  const stage = document.querySelector('.router-stage')?.getBoundingClientRect()
  const node =
    projectId &&
    document
      .querySelector(`[data-node="${CSS.escape(`project:${projectId}`)}"]`)
      ?.getBoundingClientRect()
  if (!stage || !node) return null
  return { x: node.x - stage.x, y: node.y - stage.y, width: node.width, height: node.height }
}
function animateZoom(to: 'map' | 'chat', rect: Rect | null) {
  const root = document.documentElement
  const stage = document.querySelector('.router-stage')?.getBoundingClientRect()
  // Hold the end frame until the transition removes its pseudo-elements. Without a
  // fill, the old snapshot snaps back to full opacity for a frame after the
  // animation ends, and the map flashes through the conversation's clear background.
  const options = { duration: ZOOM_MS, easing: EASE_OUT, fill: 'forwards' } as const
  const [chat, map] =
    to === 'map'
      ? ['::view-transition-old(router-stage)', '::view-transition-new(router-stage)']
      : ['::view-transition-new(router-stage)', '::view-transition-old(router-stage)']
  /** Keyframes are written for opening the map, and play backward for the conversation. */
  const steps = <T>(opening: T, closing: T): [T, T] =>
    to === 'map' ? [opening, closing] : [closing, opening]
  if (!rect || !stage) {
    root.animate({ opacity: steps(1, 0) }, { ...options, pseudoElement: chat })
    root.animate({ opacity: steps(0, 1) }, { ...options, pseudoElement: map })
    return
  }
  const scale = `scale(${rect.width / stage.width}, ${rect.height / stage.height})`
  root.animate(
    {
      // Above the map in both directions, so the two read as one object.
      zIndex: [1, 1],
      transformOrigin: ['0 0', '0 0'],
      transform: steps('none', `translate(${rect.x}px, ${rect.y}px) ${scale}`),
      borderRadius: steps('0px', SMALL_RADIUS),
      opacity: steps(1, 0)
    },
    { ...options, pseudoElement: chat }
  )
  const center = `${rect.x + rect.width / 2}px ${rect.y + rect.height / 2}px`
  root.animate(
    {
      transformOrigin: [center, center],
      transform: steps(`scale(${MAP_ZOOM})`, 'none'),
      opacity: steps(0, 1)
    },
    { ...options, pseudoElement: map }
  )
}
/**
 * Switches between the conversation and the map as one zoom: the conversation
 * shrinks into its project's node. The reduced-motion path is a direct switch.
 */
export function zoomBetweenViews(
  to: 'map' | 'chat',
  projectId: string | null,
  show: () => void
): void {
  if (prefersCalm()) {
    show()
    return
  }
  // Leaving the map, the node is gone once the chat renders, so it is measured now.
  const leaving = to === 'chat' ? projectRect(projectId) : null
  const transition = document.startViewTransition(() => flushSync(show))
  // `ready` rejects when the browser skips the transition; the view has still changed.
  transition.ready.then(
    () => animateZoom(to, to === 'map' ? projectRect(projectId) : leaving),
    () => {}
  )
}
