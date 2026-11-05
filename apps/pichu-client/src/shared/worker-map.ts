import type { RouterWorker } from './router.js'

/** Which side of the center a project branches to. */
export type MapSide = 1 | -1
export type MapFilter = 'active' | 'all'
export type MapProject = {
  id: string
  name: string
  /** False until the project has a Router conversation; such projects draw small. */
  hasConversation: boolean
  workers: RouterWorker[]
}
export type WorkerMapInput = {
  projects: MapProject[]
  /** Workers with an approval drawn on their node, which makes the node taller. */
  approvals: ReadonlySet<string>
  filter: MapFilter
  /** Projects whose finished workers are expanded while filtering to active work. */
  openDone: ReadonlySet<string>
  /** Workers whose children are hidden. */
  collapsed: ReadonlySet<string>
  /** Sides from the previous layout, so live changes never swap a project's side. */
  sides: ReadonlyMap<string, MapSide>
}
type Box = { id: string; x: number; y: number; width: number; height: number; side: MapSide | 0 }
export type MapNode =
  | (Box & { kind: 'root' })
  | (Box & { kind: 'project'; projectId: string; quiet: boolean })
  | (Box & {
      kind: 'worker'
      projectId: string
      worker: RouterWorker
      /** Direct children, shown or not. */
      childCount: number
      collapsed: boolean
    })
  | (Box & { kind: 'done'; projectId: string; count: number; open: boolean })
  | (Box & { kind: 'kept'; projectId: string; worker: RouterWorker })
export type MapEdge = { id: string; from: string; to: string }
export type WorkerMap = { nodes: MapNode[]; edges: MapEdge[]; sides: Map<string, MapSide> }

const ROOT_SIZE = 92
const PROJECT = { width: 224, height: 92 }
const QUIET_PROJECT = { width: 150, height: 42 }
const WORKER_WIDTH = 216
const HEIGHT = { approval: 118, twoLines: 52, oneLine: 34 }
const DONE = { width: 104, height: 30 }
const KEPT = { width: 132, height: 30 }
const GAP_X = 54
const GAP_Y = 12
const GAP_PROJECT = 34

const running = (w: RouterWorker) =>
  w.status === 'starting' || w.status === 'running' || w.status === 'waiting'
const undecided = (w: RouterWorker) =>
  (w.status === 'reported' || w.status === 'idle') &&
  (w.report?.status === 'blocked' || w.report?.status === 'needs_input')
/** Work still moving or stuck on someone. Failed and undecided work never folds away. */
export const isInPlay = (w: RouterWorker) =>
  running(w) || w.status === 'queued' || w.status === 'failed' || undecided(w)

type Tree = {
  id: string
  kind: 'project' | 'worker' | 'done' | 'kept'
  width: number
  height: number
  children: Tree[]
  build(box: Box): MapNode
}
const byAge = (a: RouterWorker, b: RouterWorker) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)

/** Children by parent, skipping removed workers so their children move up a level. */
function childrenByParent(workers: RouterWorker[]): Map<string | null, RouterWorker[]> {
  const byId = new Map(workers.map((w) => [w.id, w]))
  const live = workers.filter((w) => w.status !== 'removed').sort(byAge)
  const parentOf = (worker: RouterWorker): string | null => {
    const seen = new Set([worker.id])
    let id = worker.parentId
    while (id) {
      const parent = byId.get(id)
      if (!parent || seen.has(id)) return null
      if (parent.status !== 'removed') return id
      seen.add(id)
      id = parent.parentId
    }
    return null
  }
  const children = new Map<string | null, RouterWorker[]>()
  for (const worker of live) {
    const parent = parentOf(worker)
    children.set(parent, [...(children.get(parent) ?? []), worker])
  }
  return children
}

function projectTree(project: MapProject, input: WorkerMapInput): Tree {
  const children = childrenByParent(project.workers)
  const kids = (w: RouterWorker) => children.get(w.id) ?? []
  const subtreeInPlay = (w: RouterWorker): boolean => isInPlay(w) || kids(w).some(subtreeInPlay)
  const workerTree = (worker: RouterWorker): Tree => {
    const all = kids(worker)
    const collapsed = input.collapsed.has(worker.id)
    const shown = collapsed
      ? []
      : all.filter((c) => input.filter === 'all' || isInPlay(worker) || subtreeInPlay(c))
    const twoLines = isInPlay(worker) && worker.status !== 'queued'
    return {
      id: worker.id,
      kind: 'worker',
      width: WORKER_WIDTH,
      height: input.approvals.has(worker.id)
        ? HEIGHT.approval
        : twoLines
          ? HEIGHT.twoLines
          : HEIGHT.oneLine,
      children: shown.map(workerTree),
      build: (box) => ({
        ...box,
        kind: 'worker',
        projectId: project.id,
        worker,
        childCount: all.length,
        collapsed
      })
    }
  }
  const roots = children.get(null) ?? []
  const inPlay = roots.filter(subtreeInPlay)
  const done = roots.filter((w) => !subtreeInPlay(w))
  const trees = inPlay.map(workerTree)
  if (done.length) {
    const open = input.filter === 'all' || input.openDone.has(project.id)
    trees.push({
      id: `done:${project.id}`,
      kind: 'done',
      ...DONE,
      children: open ? done.map(workerTree) : [],
      build: (box) => ({ ...box, kind: 'done', projectId: project.id, count: done.length, open })
    })
  }
  const kept = project.workers
    .filter(
      (w) =>
        w.status === 'removed' && w.workspace.kind === 'worktree' && w.workspace.state === 'kept'
    )
    .sort(byAge)
  for (const worker of kept)
    trees.push({
      id: `kept:${worker.id}`,
      kind: 'kept',
      ...KEPT,
      children: [],
      build: (box) => ({ ...box, kind: 'kept', projectId: project.id, worker })
    })
  const quiet = !project.hasConversation && !project.workers.length
  const size = quiet ? QUIET_PROJECT : PROJECT
  return {
    id: `project:${project.id}`,
    kind: 'project',
    ...size,
    children: trees,
    build: (box) => ({ ...box, kind: 'project', projectId: project.id, quiet })
  }
}

function bandOf(tree: Tree): number {
  const children = tree.children.reduce((sum, c) => sum + bandOf(c), 0)
  return Math.max(tree.height, children + Math.max(0, tree.children.length - 1) * GAP_Y)
}

/**
 * Lays every project and worker out as a two-sided mind map around the origin.
 * Output depends only on the input, so a map can be compared across renders
 * and tested without a DOM. Node heights are fixed by kind for the same reason.
 */
export function buildWorkerMap(input: WorkerMapInput): WorkerMap {
  const projects = [...input.projects].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  )
  const trees = projects.map((p) => projectTree(p, input))
  const sides = new Map<string, MapSide>()
  const load = { 1: 0, [-1]: 0 }
  const claim = (id: string, side: MapSide, tree: Tree) => {
    sides.set(id, side)
    load[side] += bandOf(tree) + GAP_PROJECT
  }
  // Known sides count first, so a new project balances against all of them.
  projects.forEach((project, i) => {
    const known = input.sides.get(project.id)
    if (known) claim(project.id, known, trees[i])
  })
  projects.forEach((project, i) => {
    if (!sides.has(project.id)) claim(project.id, load[1] <= load[-1] ? 1 : -1, trees[i])
  })

  const half = ROOT_SIZE / 2
  const nodes: MapNode[] = [
    { id: 'root', kind: 'root', x: -half, y: -half, width: ROOT_SIZE, height: ROOT_SIZE, side: 0 }
  ]
  const edges: MapEdge[] = []
  const place = (tree: Tree, x: number, top: number, side: MapSide, parent: string) => {
    const band = bandOf(tree)
    nodes.push(
      tree.build({
        id: tree.id,
        x,
        y: top + band / 2 - tree.height / 2,
        width: tree.width,
        height: tree.height,
        side
      })
    )
    edges.push({ id: tree.id, from: parent, to: tree.id })
    const inner =
      tree.children.reduce((sum, c) => sum + bandOf(c), 0) +
      Math.max(0, tree.children.length - 1) * GAP_Y
    let cursor = top + (band - inner) / 2
    for (const child of tree.children) {
      const childX = side > 0 ? x + tree.width + GAP_X : x - GAP_X - child.width
      place(child, childX, cursor, side, tree.id)
      cursor += bandOf(child) + GAP_Y
    }
  }
  for (const side of [1, -1] as const) {
    const branch = trees.filter((_, i) => sides.get(projects[i].id) === side)
    const total =
      branch.reduce((sum, t) => sum + bandOf(t), 0) + Math.max(0, branch.length - 1) * GAP_PROJECT
    let cursor = -total / 2
    for (const tree of branch) {
      const x = side > 0 ? half + GAP_X : -half - GAP_X - tree.width
      place(tree, x, cursor, side, 'root')
      cursor += bandOf(tree) + GAP_PROJECT
    }
  }
  return { nodes, edges, sides }
}
