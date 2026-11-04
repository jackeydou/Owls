import { useMemo } from 'react'
import { create } from 'zustand'
import type { CodexFailure, CodexReply, CodexRouter } from '../../../shared/codex'
import type { OwlsProviderId, RouterProviderInfo, RouterWorker } from '../../../shared/router'
import { CodexUIError, uiFailure } from '../codex/failures'

function unwrap<T>(reply: CodexReply<T>): T {
  if (!reply.ok) throw new CodexUIError(reply.error)
  return reply.value
}
type State = {
  routers: CodexRouter[]
  workers: RouterWorker[]
  providers: RouterProviderInfo[]
  sending: boolean
  error: CodexFailure | null
  hydrate(routers: CodexRouter[], workers: RouterWorker[]): void
  router(router: CodexRouter): void
  worker(worker: RouterWorker): void
  open(projectId: string): Promise<CodexRouter | null>
  send(routerId: string, text: string): Promise<boolean>
  interrupt(routerId: string): Promise<void>
  resolveBatch(routerId: string, batchId: string, decision: 'retry' | 'ignore'): Promise<void>
  discardWorktree(routerId: string, workerId: string): Promise<void>
  loadProviders(): Promise<void>
  setKey(providerId: OwlsProviderId, key: string): Promise<boolean>
  removeKey(providerId: OwlsProviderId): Promise<void>
  clearError(): void
}
/**
 * Project directory of each worker session that runs in its own worktree,
 * by session ID. Other sessions run in their project, so their `cwd` is it.
 */
export function useWorktreeProjects(): Map<string, string> {
  const workers = useRouterStore((s) => s.workers)
  const routers = useRouterStore((s) => s.routers)
  return useMemo(() => {
    const projects = new Map<string, string>()
    for (const worker of workers) {
      const router = routers.find((r) => r.id === worker.routerId)
      if (router && worker.workspace.kind === 'worktree') projects.set(worker.sessionId, router.cwd)
    }
    return projects
  }, [workers, routers])
}
const newer = <T extends { id: string; updatedAt: string }>(list: T[], next: T) => {
  const current = list.find((x) => x.id === next.id)
  if (current && current.updatedAt > next.updatedAt) return list
  return [next, ...list.filter((x) => x.id !== next.id)]
}
export const useRouterStore = create<State>((set, get) => {
  async function action<T>(fn: () => Promise<CodexReply<T>>): Promise<T | undefined> {
    try {
      set({ error: null })
      return unwrap(await fn())
    } catch (error) {
      set({ error: uiFailure(error) })
      return undefined
    }
  }
  return {
    routers: [],
    workers: [],
    providers: [],
    sending: false,
    error: null,
    hydrate: (routers, workers) =>
      set((state) => ({
        routers: routers.reduce(newer, state.routers),
        workers: workers.reduce(newer, state.workers)
      })),
    router: (router) => set((state) => ({ routers: newer(state.routers, router) })),
    worker: (worker) => set((state) => ({ workers: newer(state.workers, worker) })),
    open: async (projectId) => {
      const router = await action(() => window.codex.openRouter(projectId))
      if (!router) return null
      get().router(router)
      return router
    },
    send: async (routerId, text) => {
      if (get().sending) return false
      set({ sending: true, error: null })
      try {
        unwrap(await window.codex.sendRouter({ routerId, commandId: crypto.randomUUID(), text }))
        return true
      } catch (error) {
        set({ error: uiFailure(error) })
        return false
      } finally {
        set({ sending: false })
      }
    },
    interrupt: async (routerId) => {
      await action(() => window.codex.interruptRouter(routerId))
    },
    resolveBatch: async (routerId, batchId, decision) => {
      await action(() => window.codex.resolveBatch({ routerId, batchId, decision }))
    },
    discardWorktree: async (routerId, workerId) => {
      await action(() => window.codex.discardWorktree({ routerId, workerId }))
    },
    loadProviders: async () => {
      const providers = await action(() => window.codex.routerProviders())
      if (providers) set({ providers })
    },
    setKey: async (providerId, key) => {
      try {
        set({ error: null })
        unwrap(await window.codex.setRouterKey({ providerId, key }))
      } catch (error) {
        set({ error: uiFailure(error) })
        return false
      }
      await get().loadProviders()
      return true
    },
    removeKey: async (providerId) => {
      await action(() => window.codex.removeRouterKey(providerId))
      await get().loadProviders()
    },
    clearError: () => set({ error: null })
  }
})
