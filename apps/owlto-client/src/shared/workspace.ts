import type { Project } from './app.js'
import type { RouterWorker } from './router.js'

/**
 * The Workspace's id where views list it beside projects. It is never a stored
 * project id, and never sent to the main process as one: a thread or worker in
 * the workspace has a null project id.
 */
export const WORKSPACE_ID = 'owlto:workspace'

/** One top-level folder of the workspace, as the Workspace page and the promote prompt see it. */
export type WorkspaceFolder = {
  name: string
  path: string
  /** True when the folder is the top of a git repository. */
  git: boolean
  /** The registered project at this folder; null while it is part of the workspace. */
  projectId: string | null
  /** True once the user waved off the prompt to make this repository a project. */
  dismissed: boolean
}

/** The workspace as views list it: its real path and its top-level folders. */
export type WorkspaceListing = { root: string; folders: WorkspaceFolder[] }

/** Forward slashes, no trailing slash, `.` and `..` resolved. */
export function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const drive = /^[A-Za-z]:\//.test(slashed) ? slashed.slice(0, 2) : ''
  const absolute = drive !== '' || slashed.startsWith('/')
  const parts: string[] = []
  for (const part of slashed.slice(drive.length).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  const body = parts.join('/')
  return absolute ? `${drive}/${body}` : body
}

const isAbsolute = (path: string) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)

/** True when `path` is `folder` or anywhere below it. */
export function isWithin(path: string, folder: string): boolean {
  const child = normalizePath(path)
  const parent = normalizePath(folder)
  return child === parent || child.startsWith(parent.endsWith('/') ? parent : `${parent}/`)
}

/** The files a workspace worker reported, as absolute paths inside the workspace. */
function reportedPaths(worker: RouterWorker, workspacePath: string): string[] {
  const paths: string[] = []
  for (const artifact of worker.report?.artifacts ?? []) {
    if (artifact.kind !== 'file') continue
    const ref = artifact.ref.trim().replace(/^file:\/\//, '')
    if (!ref) continue
    const path = normalizePath(isAbsolute(ref) ? ref : `${workspacePath}/${ref}`)
    if (isWithin(path, workspacePath) && path !== normalizePath(workspacePath)) paths.push(path)
  }
  return paths
}

/** The deepest registered project inside the workspace that holds a path; null for none. */
export function nearestWorkspaceProject(
  path: string,
  projects: readonly Project[],
  workspacePath: string
): Project | null {
  const root = normalizePath(workspacePath)
  let best: Project | null = null
  for (const project of projects) {
    const at = normalizePath(project.path)
    if (at === root || !isWithin(at, root) || !isWithin(path, at)) continue
    if (!best || at.length > normalizePath(best.path).length) best = project
  }
  return best
}

/**
 * Where a worker counts in the Projects list, the map, and pull requests: the
 * project it ran in; else, for a workspace worker, the nearest project
 * registered inside the workspace that holds every file it reported; else the
 * workspace itself. Promoting a workspace folder to a project therefore moves
 * the workers that worked there, and nothing else. A project that no longer
 * exists was merged back into the workspace, so its workers count there again.
 */
export function workerHome(
  worker: RouterWorker,
  projects: readonly Project[],
  workspacePath: string | null
): string {
  if (worker.projectId !== null)
    return projects.some((p) => p.id === worker.projectId) ? worker.projectId : WORKSPACE_ID
  if (!workspacePath) return WORKSPACE_ID
  const homes = new Set(
    reportedPaths(worker, workspacePath).map(
      (path) => nearestWorkspaceProject(path, projects, workspacePath)?.id ?? WORKSPACE_ID
    )
  )
  return homes.size === 1 ? [...homes][0] : WORKSPACE_ID
}

/** Folders the promote prompt offers: git repositories that are not projects and not waved off. */
export function promotableFolders(folders: readonly WorkspaceFolder[]): WorkspaceFolder[] {
  return folders.filter((f) => f.git && f.projectId === null && !f.dismissed)
}
