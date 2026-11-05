import type { MapEdge, MapNode, WorkerMap } from '../../../../shared/worker-map'
import { isWaitingOnUser, isWorking, workerTone } from '../activity'
import type { WorkerProject } from './projects'

function edgePath(from: MapNode, to: MapNode): string {
  const right = to.side > 0
  const x1 = right ? from.x + from.width : from.x
  const y1 = from.y + from.height / 2
  const x2 = right ? to.x : to.x + to.width
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
        return (
          <path
            key={edge.id}
            className={`map-edge ${state} d${depthOf(edge, parents)}${dim}`}
            style={{ '--owl-c': hueOf(to) } as React.CSSProperties}
            d={edgePath(from, to)}
          />
        )
      })}
    </svg>
  )
}
