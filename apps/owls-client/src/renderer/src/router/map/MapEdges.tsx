import type { MapEdge, MapNode, WorkerMap } from '../../../../shared/worker-map'
import { isWaitingOnUser, isWorking, workerTone } from '../activity'
import type { WorkerProject } from './projects'

/** Where a branch leaves its parent. */
export function edgeStart(from: MapNode, to: MapNode): { x: number; y: number } {
  return { x: to.side > 0 ? from.x + from.width : from.x, y: from.y + from.height / 2 }
}
export function edgePath(from: MapNode, to: MapNode): string {
  const { x: x1, y: y1 } = edgeStart(from, to)
  const x2 = to.side > 0 ? to.x : to.x + to.width
  const y2 = to.y + to.height / 2
  const mid = (x1 + x2) / 2
  return `M${x1} ${y1} C${mid} ${y1},${mid} ${y2},${x2} ${y2}`
}
function edgeState(to: MapNode, projects: WorkerProject[], hasChildren: boolean): string {
  if (to.kind === 'worker') {
    const tone = workerTone(to.worker)
    if (tone === 'done' && hasChildren) return 'trunk'
    return tone
  }
  if (to.kind === 'project') {
    const workers = projects.find((p) => p.id === to.projectId)?.workers ?? []
    const live = workers.filter((w) => w.status !== 'removed')
    if (live.some(isWaitingOnUser)) return 'wait'
    if (live.some(isWorking)) return 'run'
    return live.length ? 'trunk' : 'done'
  }
  return 'done'
}
function depthOf(edge: MapEdge, parents: Map<string, string>): number {
  let depth = 1
  for (let id = parents.get(edge.from); id; id = parents.get(id)) depth++
  return Math.min(depth, 3)
}
export function MapEdges({
  map,
  projects,
  lit,
  hueOf
}: {
  map: WorkerMap
  projects: WorkerProject[]
  /** Node ids on the focused path; every other branch dims. Null when nothing is focused. */
  lit: ReadonlySet<string> | null
  hueOf(node: MapNode): string
}) {
  const nodes = new Map(map.nodes.map((n) => [n.id, n]))
  const parents = new Map(map.edges.map((e) => [e.to, e.from]))
  const hasChildren = new Set(map.edges.map((e) => e.from))
  return (
    <svg className="map-edges" aria-hidden="true">
      {map.edges.map((edge) => {
        const from = nodes.get(edge.from)
        const to = nodes.get(edge.to)
        if (!from || !to) return null
        const state = edgeState(to, projects, hasChildren.has(to.id))
        const dim = lit && !lit.has(edge.to) ? ' dim' : ''
        const depth = depthOf(edge, parents)
        const d = edgePath(from, to)
        return (
          <g key={edge.id} data-edge={edge.id}>
            <path
              className={`map-edge ${state} d${depth}${dim}`}
              style={{ '--owl-c': hueOf(to) } as React.CSSProperties}
              d={d}
            />
            {state === 'run' ? <path className={`map-flow d${depth}${dim}`} d={d} /> : null}
          </g>
        )
      })}
    </svg>
  )
}
