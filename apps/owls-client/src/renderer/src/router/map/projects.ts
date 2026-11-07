import { useMemo } from 'react'
import type { CodexRouter } from '../../../../shared/codex'
import type { MapProject } from '../../../../shared/worker-map'
import { useCodexStore } from '../../codex/store'
import { byRecent } from '../activity'
import { useRouterStore } from '../store'

export type WorkerProject = MapProject & { router: CodexRouter | undefined }

/** Every project with its workers and its latest thread. Threads are global, workers are not. */
export function useWorkerProjects(): WorkerProject[] {
  const projects = useCodexStore((s) => s.projects)
  const routers = useRouterStore((s) => s.routers)
  const workers = useRouterStore((s) => s.workers)
  return useMemo(
    () =>
      projects.map((project) => {
        const threads = routers.filter((r) => r.projectId === project.id).sort(byRecent)
        const own = workers.filter((w) => w.projectId === project.id)
        return {
          id: project.id,
          name: project.name,
          router: threads[0],
          hasConversation: own.length > 0 || threads.some((r) => r.itemCount > 0),
          workers: own
        }
      }),
    [projects, routers, workers]
  )
}
