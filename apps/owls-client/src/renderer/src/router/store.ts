import { create } from 'zustand'
import type { CodexFailure, CodexReply, CodexRouter } from '../../../shared/codex'
import type { OwlsProviderId, RouterProviderInfo, RouterWorker } from '../../../shared/router'
import type { MapFilter } from '../../../shared/worker-map'
import { CodexUIError, uiFailure } from '../codex/failures'

function unwrap<T>(reply: CodexReply<T>): T {
  if (!reply.ok) throw new CodexUIError(reply.error)
  return reply.value
}
/** What the right-hand panel shows. Never persisted; a restart opens the conversation. */
export type RouterPanel = { kind: 'worker'; workerId: string } | { kind: 'router' }
const toggled = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}
type State = {
  routers: CodexRouter[]
  workers: RouterWorker[]
  providers: RouterProviderInfo[]
  sending: boolean
  error: CodexFailure | null
  panel: RouterPanel | null
  mapFilter: MapFilter
  /** Projects whose finished workers are open on the map. */
  openDone: ReadonlySet<string>
  /** Workers whose children are folded on the map. */
  collapsed: ReadonlySet<string>
  /** Projects whose active workers are folded away in the sidebar. */
  foldedProjects: ReadonlySet<string>
  hydrate(routers: CodexRouter[], workers: RouterWorker[]): void
  router(router: CodexRouter): void
  worker(worker: RouterWorker): void
  open(projectId: string): Promise<CodexRouter | null>
  /** Lasts until the app restarts: the guide comes back while setup is incomplete. */
  guideSkipped: boolean
  skipGuide(): void
  send(routerId: string, text: string, workerId?: string): Promise<boolean>
  interrupt(routerId: string): Promise<void>
  resolveBatch(routerId: string, batchId: string, decision: 'retry' | 'ignore'): Promise<void>
  stopWorker(routerId: string, workerId: string): Promise<void>
  removeWorker(routerId: string, workerId: string): Promise<void>
  discardWorktree(routerId: string, workerId: string): Promise<void>
  showPanel(panel: RouterPanel | null): void
  setMapFilter(filter: MapFilter): void
  toggleDone(projectId: string): void
  toggleCollapsed(workerId: string): void
  toggleProjectFold(projectId: string): void
  loadProviders(): Promise<void>
  setKey(providerId: OwlsProviderId, key: string): Promise<boolean>
  removeKey(providerId: OwlsProviderId): Promise<void>
  clearError(): void
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
    panel: null,
    mapFilter: 'active',
    openDone: new Set(),
    collapsed: new Set(),
    foldedProjects: new Set(),
    hydrate: (routers, workers) =>
      set((state) => ({
        routers: routers.reduce(newer, state.routers),
        workers: workers.reduce(newer, state.workers)
      })),
    router: (router) => set((state) => ({ routers: newer(state.routers, router) })),
    worker: (worker) =>
      set((state) => {
        const closing =
          worker.status === 'removed' &&
          state.panel?.kind === 'worker' &&
          state.panel.workerId === worker.id
        return { workers: newer(state.workers, worker), panel: closing ? null : state.panel }
      }),
    open: async (projectId) => {
      const router = await action(() => window.codex.openRouter(projectId))
      if (!router) return null
      get().router(router)
      return router
    },
    guideSkipped: false,
    skipGuide: () => set({ guideSkipped: true }),
    send: async (routerId, text, workerId) => {
      if (get().sending) return false
      set({ sending: true, error: null })
      try {
        unwrap(
          await window.codex.sendRouter({
            routerId,
            commandId: crypto.randomUUID(),
            text,
            ...(workerId ? { workerId } : {})
          })
        )
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
    stopWorker: async (routerId, workerId) => {
      await action(() => window.codex.stopWorker({ routerId, workerId }))
    },
    removeWorker: async (routerId, workerId) => {
      await action(() => window.codex.removeWorker({ routerId, workerId }))
    },
    discardWorktree: async (routerId, workerId) => {
      await action(() => window.codex.discardWorktree({ routerId, workerId }))
    },
    showPanel: (panel) => set({ panel }),
    setMapFilter: (mapFilter) => set({ mapFilter }),
    toggleDone: (projectId) => set((state) => ({ openDone: toggled(state.openDone, projectId) })),
    toggleCollapsed: (workerId) =>
      set((state) => ({ collapsed: toggled(state.collapsed, workerId) })),
    toggleProjectFold: (projectId) =>
      set((state) => ({ foldedProjects: toggled(state.foldedProjects, projectId) })),
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
