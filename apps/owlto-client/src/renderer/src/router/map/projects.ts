import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Router } from '../../../../shared/app'
import type { MapProject } from '../../../../shared/worker-map'
import { WORKSPACE_ID } from '../../../../shared/workspace'
import { useAppStore } from '../../app/store'
import { byRecent } from '../activity'
import { threadHome, useWorkerHomes } from '../homes'
import { useRouterStore } from '../store'

export type WorkerProject = MapProject & { router: Router | undefined }

/**
 * The Workspace and every project, each with its workers and its latest thread.
 * Threads are global, workers are not; a thread with no default project is the
 * Workspace's, and workers count where `useWorkerHomes` puts them.
 */
export function useWorkerProjects(): WorkerProject[] {
  const { t } = useTranslation()
  const projects = useAppStore((s) => s.projects)
  const routers = useRouterStore((s) => s.routers)
  const workers = useRouterStore((s) => s.workers)
  const homes = useWorkerHomes()
  const workspaceName = t('workspace.name')
  return useMemo(
    () =>
      [{ id: WORKSPACE_ID, name: workspaceName }, ...projects].map((project) => {
        const threads = routers.filter((r) => threadHome(r.projectId) === project.id).sort(byRecent)
        const own = workers.filter((w) => homes.get(w.id) === project.id)
        return {
          id: project.id,
          name: project.name,
          router: threads[0],
          hasConversation: own.length > 0 || threads.some((r) => r.itemCount > 0),
          workers: own
        }
      }),
    [projects, routers, workers, homes, workspaceName]
  )
}
