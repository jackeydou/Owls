import { useMemo } from 'react'
import type { CodexRouter } from '../../../../shared/codex'
import type { MapProject } from '../../../../shared/worker-map'
import { useCodexStore } from '../../codex/store'
import { useRouterStore } from '../store'

export type WorkerProject = MapProject & { router: CodexRouter | undefined }

/** Every project with its Router and workers. A project has no Router until it is first opened. */
export function useWorkerProjects(): WorkerProject[] {
  const projects = useCodexStore((s) => s.projects)
  const routers = useRouterStore((s) => s.routers)
  const workers = useRouterStore((s) => s.workers)
  return useMemo(
    () =>
      projects.map((project) => {
        const router = routers.find((r) => r.projectId === project.id)
        return {
          id: project.id,
          name: project.name,
          router,
          hasConversation: Boolean(router?.items.length),
          workers: workers.filter((w) => w.routerId === router?.id)
        }
      }),
    [projects, routers, workers]
  )
}
