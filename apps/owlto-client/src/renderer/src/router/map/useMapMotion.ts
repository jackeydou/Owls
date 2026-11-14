import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'
import type { WorkerStatus } from '../../../../shared/router'
import {
  type MapNode,
  type MapProject,
  signalRoute,
  type WorkerMap,
  type WorkerSignal,
  workerSignals
} from '../../../../shared/worker-map'
import { EASE_OUT, prefersCalm } from '../motion'
import { edgePath, edgeStart } from './MapEdges'

const GROW_MS = 340
const SIGNAL_MS_PER_EDGE = 340
const PING_MS = 700
/** A new node starts this small, on its parent's edge. */
const SEED_SCALE = 0.4

const nodeSelector = (id: string) => `[data-node="${CSS.escape(id)}"]`

function grow(world: HTMLElement, from: MapNode, to: MapNode) {
  const options = { duration: GROW_MS, easing: EASE_OUT }
  const start = edgeStart(from, to)
  world.querySelector(nodeSelector(to.id))?.animate(
    {
      transform: [
        `translate(${start.x - to.width / 2}px, ${start.y - to.height / 2}px) scale(${SEED_SCALE})`,
        `translate(${to.x}px, ${to.y}px)`
      ],
      opacity: [0, 1]
    },
    options
  )
  const point = `${start.x} ${start.y}`
  const seed = `M${point} C${point},${point},${point}`
  for (const path of world.querySelectorAll(`[data-edge="${CSS.escape(to.id)}"] path`))
    path.animate({ d: [`path("${seed}")`, `path("${edgePath(from, to)}")`] }, options)
}
/** A report takes its project's hue; an answer keeps the waiting color from CSS. */
function tint(mark: HTMLElement, node: HTMLElement | null, signal: WorkerSignal) {
  if (signal.kind === 'report' && node)
    mark.style.setProperty('--owl-c', node.style.getPropertyValue('--owl-c'))
}
function ping(world: HTMLElement, node: MapNode, signal: WorkerSignal) {
  const layer = world.querySelector('.map-signals')
  const element = world.querySelector<HTMLElement>(nodeSelector(node.id))
  if (!layer || !element) return
  const ring = document.createElement('i')
  ring.className = `map-ping ${signal.kind}`
  tint(ring, element, signal)
  ring.style.width = `${node.width}px`
  ring.style.height = `${node.height}px`
  ring.style.borderRadius = getComputedStyle(element).borderRadius
  layer.append(ring)
  const at = `translate(${node.x}px, ${node.y}px)`
  ring.animate(
    { transform: [`${at} scale(1)`, `${at} scale(1.1)`], opacity: [0.9, 0] },
    { duration: PING_MS, easing: EASE_OUT }
  ).onfinish = () => ring.remove()
}
function send(world: HTMLElement, map: WorkerMap, signal: WorkerSignal) {
  const layer = world.querySelector('.map-signals')
  const nodes = new Map(map.nodes.map((n) => [n.id, n]))
  const route = signalRoute(map, signal).flatMap((id) => nodes.get(id) ?? [])
  if (!layer || route.length < 2) return
  const report = signal.kind === 'report'
  const segments = route.slice(1).map((node, i) => edgePath(route[i], node))
  const dot = document.createElement('i')
  dot.className = `map-signal ${signal.kind}`
  // Joined with lines, so the dot crosses under each node between branches.
  dot.style.offsetPath = `path("${segments.map((d, i) => (i ? d.replace('M', 'L') : d)).join(' ')}")`
  tint(dot, world.querySelector<HTMLElement>(nodeSelector(route[1].id)), signal)
  layer.append(dot)
  const target = report ? route[0] : route[route.length - 1]
  dot.animate(
    { offsetDistance: report ? ['100%', '0%'] : ['0%', '100%'] },
    { duration: SIGNAL_MS_PER_EDGE * segments.length, easing: EASE_OUT }
  ).onfinish = () => {
    dot.remove()
    ping(world, target, signal)
  }
}
/** Grows new nodes out of their parents and sends signals along branches. */
export function useMapMotion(
  map: WorkerMap,
  projects: MapProject[],
  world: RefObject<HTMLDivElement | null>
): void {
  const known = useRef<ReadonlySet<string> | null>(null)
  const statuses = useRef<ReadonlyMap<string, WorkerStatus> | null>(null)
  // A layout effect, so a new node never paints in place before it grows.
  useLayoutEffect(() => {
    const seen = known.current
    known.current = new Set(map.nodes.map((n) => n.id))
    if (!seen || !world.current || prefersCalm()) return
    const nodes = new Map(map.nodes.map((n) => [n.id, n]))
    for (const edge of map.edges) {
      const from = nodes.get(edge.from)
      const to = nodes.get(edge.to)
      if (from && to && !seen.has(to.id)) grow(world.current, from, to)
    }
  }, [map, world])
  useEffect(() => {
    const previous = statuses.current
    statuses.current = new Map(projects.flatMap((p) => p.workers).map((w) => [w.id, w.status]))
    if (!previous || !world.current || prefersCalm()) return
    for (const signal of workerSignals(previous, projects)) send(world.current, map, signal)
  }, [map, projects, world])
}
