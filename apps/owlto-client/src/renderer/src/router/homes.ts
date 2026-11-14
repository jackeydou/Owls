import { useMemo } from 'react'
import { WORKSPACE_ID, workerHome } from '../../../shared/workspace'
import { useAppStore } from '../app/store'
import { useWorkspaceStore } from '../app/workspace'
import { useRouterStore } from './store'

/**
 * Where each worker counts in the Projects list and on the map (`workerHome`):
 * its project, the workspace project holding its files, or the Workspace.
 */
export function useWorkerHomes(): ReadonlyMap<string, string> {
  const workers = useRouterStore((s) => s.workers)
  const projects = useAppStore((s) => s.projects)
  const root = useWorkspaceStore((s) => s.listing?.root ?? null)
  return useMemo(
    () => new Map(workers.map((w) => [w.id, workerHome(w, projects, root)])),
    [workers, projects, root]
  )
}

/** The map and list id a thread belongs to: its default project, else the Workspace. */
export const threadHome = (projectId: string | null): string => projectId ?? WORKSPACE_ID
