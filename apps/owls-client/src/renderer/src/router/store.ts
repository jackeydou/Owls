import { create } from 'zustand'
import type { Failure, Reply, Router, ThreadItem } from '../../../shared/app'
import type { WorkerGitHubStatus } from '../../../shared/github'
import type {
  ForwardMessage,
  OwlsProviderId,
  RouterProviderInfo,
  RouterWorker
} from '../../../shared/router'
import type { MapFilter } from '../../../shared/worker-map'
import { UIError, uiFailure } from '../app/failures'

function unwrap<T>(reply: Reply<T>): T {
  if (!reply.ok) throw new UIError(reply.error)
  return reply.value
}
/** What the right-hand panel shows. Never persisted; a restart opens the conversation. */
export type RouterPanel =
  | { kind: 'worker'; workerId: string }
  | { kind: 'router'; routerId: string }
/** What the forward dialog is sending; `preview` and `projectId` only fill it in. */
export type Forwarding = {
  source: ForwardMessage['source']
  preview: string
  projectId: string | null
}
const toggled = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}
type State = {
  routers: Router[]
  workers: RouterWorker[]
  /** Items by thread, kept in position order. */
  items: Record<string, ThreadItem[]>
  /** Threads whose whole history has arrived, as opposed to only live changes. */
  itemsLoaded: Record<string, boolean>
  forwarding: Forwarding | null
  /** GitHub status by worker, for the workers whose panels have been open. */
  gitHub: Record<string, WorkerGitHubStatus>
  providers: RouterProviderInfo[]
  sending: boolean
  error: Failure | null
  panel: RouterPanel | null
  mapFilter: MapFilter
  /** Projects whose finished workers are open on the map. */
  openDone: ReadonlySet<string>
  /** Workers whose children are folded on the map. */
  collapsed: ReadonlySet<string>
  /** Projects whose active workers are folded away in the sidebar. */
  foldedProjects: ReadonlySet<string>
  hydrate(routers: Router[], workers: RouterWorker[]): void
  router(router: Router): void
  worker(worker: RouterWorker): void
  threadItems(routerId: string, items: ThreadItem[]): void
  loadItems(routerId: string): Promise<void>
  createThread(projectId: string | null): Promise<Router | null>
  startForward(forwarding: Forwarding): void
  cancelForward(): void
  /** Sends what the dialog holds and resolves to the thread that received it. */
  forward(target: ForwardMessage['target'], note: string): Promise<Router | null>
  workerGitHub(workerId: string, status: WorkerGitHubStatus): void
  /** Follows a worker's GitHub status until the returned function is called. */
  watchGitHub(routerId: string, workerId: string): () => void
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
const newerThread = (list: Router[], next: Router) => {
  const current = list.find((x) => x.id === next.id)
  if (current && current.rev > next.rev) return list
  return [next, ...list.filter((x) => x.id !== next.id)]
}
/**
 * Applies items over what is held. `live` changes always win. A loaded page can
 * be older than a change that arrived while it was on its way, so it never
 * replaces an unsaved item or a higher version.
 */
function mergeItems(held: ThreadItem[], next: ThreadItem[], live: boolean): ThreadItem[] {
  const merged = [...held]
  const at = new Map(merged.map((entry, index) => [entry.item.id, index]))
  let appended = false
  for (const entry of next) {
    const index = at.get(entry.item.id)
    if (index === undefined) {
      at.set(entry.item.id, merged.length)
      merged.push(entry)
      appended = true
      continue
    }
    const current = merged[index]
    const stale = !live && (current.rev === null || (entry.rev !== null && entry.rev < current.rev))
    if (!stale) merged[index] = entry
  }
  return appended ? merged.sort((a, b) => a.position - b.position) : merged
}
export const useRouterStore = create<State>((set, get) => {
  async function action<T>(fn: () => Promise<Reply<T>>): Promise<T | undefined> {
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
    items: {},
    itemsLoaded: {},
    forwarding: null,
    gitHub: {},
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
        routers: routers.reduce(newerThread, state.routers),
        workers: workers.reduce(newer, state.workers)
      })),
    router: (router) => set((state) => ({ routers: newerThread(state.routers, router) })),
    worker: (worker) =>
      set((state) => {
        const closing =
          worker.status === 'removed' &&
          state.panel?.kind === 'worker' &&
          state.panel.workerId === worker.id
        return { workers: newer(state.workers, worker), panel: closing ? null : state.panel }
      }),
    workerGitHub: (workerId, status) =>
      set((state) => ({ gitHub: { ...state.gitHub, [workerId]: status } })),
    watchGitHub: (routerId, workerId) => {
      void window.owls.watchWorkerGitHub({ routerId, workerId })
      return () => void window.owls.unwatchWorkerGitHub({ routerId, workerId })
    },
    threadItems: (routerId, items) =>
      set((state) => ({
        items: {
          ...state.items,
          [routerId]: mergeItems(state.items[routerId] ?? [], items, true)
        }
      })),
    loadItems: async (routerId) => {
      if (get().itemsLoaded[routerId]) return
      const items = await action(() => window.owls.threadItems({ routerId }))
      if (!items) return
      set((state) => ({
        items: {
          ...state.items,
          [routerId]: mergeItems(state.items[routerId] ?? [], items, false)
        },
        itemsLoaded: { ...state.itemsLoaded, [routerId]: true }
      }))
    },
    createThread: async (projectId) => {
      const router = await action(() => window.owls.createThread({ projectId }))
      if (!router) return null
      get().router(router)
      return router
    },
    startForward: (forwarding) => set({ forwarding }),
    cancelForward: () => set({ forwarding: null }),
    forward: async (target, note) => {
      const { forwarding } = get()
      if (!forwarding) return null
      const router = await action(() =>
        window.owls.forward({
          commandId: crypto.randomUUID(),
          source: forwarding.source,
          target,
          note: note.trim() || null
        })
      )
      if (!router) return null
      get().router(router)
      set({ forwarding: null })
      return router
    },
    guideSkipped: false,
    skipGuide: () => set({ guideSkipped: true }),
    send: async (routerId, text, workerId) => {
      if (get().sending) return false
      set({ sending: true, error: null })
      try {
        unwrap(
          await window.owls.sendRouter({
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
      await action(() => window.owls.interruptRouter(routerId))
    },
    resolveBatch: async (routerId, batchId, decision) => {
      await action(() => window.owls.resolveBatch({ routerId, batchId, decision }))
    },
    stopWorker: async (routerId, workerId) => {
      await action(() => window.owls.stopWorker({ routerId, workerId }))
    },
    removeWorker: async (routerId, workerId) => {
      await action(() => window.owls.removeWorker({ routerId, workerId }))
    },
    discardWorktree: async (routerId, workerId) => {
      await action(() => window.owls.discardWorktree({ routerId, workerId }))
    },
    showPanel: (panel) => set({ panel }),
    setMapFilter: (mapFilter) => set({ mapFilter }),
    toggleDone: (projectId) => set((state) => ({ openDone: toggled(state.openDone, projectId) })),
    toggleCollapsed: (workerId) =>
      set((state) => ({ collapsed: toggled(state.collapsed, workerId) })),
    toggleProjectFold: (projectId) =>
      set((state) => ({ foldedProjects: toggled(state.foldedProjects, projectId) })),
    loadProviders: async () => {
      const providers = await action(() => window.owls.routerProviders())
      if (providers) set({ providers })
    },
    setKey: async (providerId, key) => {
      try {
        set({ error: null })
        unwrap(await window.owls.setRouterKey({ providerId, key }))
      } catch (error) {
        set({ error: uiFailure(error) })
        return false
      }
      await get().loadProviders()
      return true
    },
    removeKey: async (providerId) => {
      await action(() => window.owls.removeRouterKey(providerId))
      await get().loadProviders()
    },
    clearError: () => set({ error: null })
  }
})
