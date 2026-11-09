import { create } from 'zustand'
import type { CodexReply } from '../../../shared/codex'
import type {
  MemoryCategoryAction,
  MemoryExportFormat,
  MemoryOverview,
  MemoryRun,
  MemorySave,
  MemoryStore,
  MemoryView,
  ProjectMemoryKind
} from '../../../shared/memory'

/** What the memory tab's error line says, as an i18n key. */
export type MemoryError =
  | 'memory.error.stale'
  | 'memory.error.invalid'
  | 'memory.error.learnOff'
  | 'memory.error.generic'

type Filter = {
  store: MemoryStore
  projectId: string | null
  categoryId: string | null
  kind: ProjectMemoryKind | null
  query: string
  archived: boolean
}

type State = Filter & {
  status: 'loading' | 'ready' | 'failed'
  items: MemoryView[]
  overview: MemoryOverview | null
  runs: MemoryRun[]
  error: MemoryError | null
  setFilter(filter: Partial<Filter>): void
  refresh(): Promise<void>
  save(input: MemorySave): Promise<boolean>
  remove(memory: MemoryView): Promise<boolean>
  category(input: MemoryCategoryAction): Promise<boolean>
  runNow(): Promise<void>
  exportAs(format: MemoryExportFormat): Promise<void>
  clearError(): void
}

function errorOf(reply: Extract<CodexReply<unknown>, { ok: false }>): MemoryError {
  if (reply.error.code === 'request_unavailable') return 'memory.error.stale'
  if (reply.error.code === 'invalid_request' || reply.error.code === 'project_required')
    return 'memory.error.invalid'
  return 'memory.error.generic'
}

/** Newer refreshes win, so a slow reply cannot overwrite a newer filter's list. */
let generation = 0

export const useMemoryStore = create<State>((set, get) => {
  /** Runs a write, reloads the tab, and keeps a refusal on screen. */
  async function write(
    call: () => Promise<CodexReply<unknown>>,
    refused: (reply: Extract<CodexReply<unknown>, { ok: false }>) => MemoryError = errorOf
  ): Promise<boolean> {
    set({ error: null })
    const reply = await call()
    if (!reply.ok) set({ error: refused(reply) })
    await get().refresh()
    return reply.ok
  }
  return {
    store: 'personal',
    projectId: null,
    categoryId: null,
    kind: null,
    query: '',
    archived: false,
    status: 'loading',
    items: [],
    overview: null,
    runs: [],
    error: null,
    setFilter(filter) {
      set(filter)
      void get().refresh()
    },
    async refresh() {
      const mine = ++generation
      const { store, projectId, categoryId, kind, query, archived } = get()
      if (store === 'project' && !projectId) {
        const [overview, runs] = await Promise.all([
          window.codex.memory.overview(),
          window.codex.memory.runs()
        ])
        if (mine !== generation) return
        set({
          status: 'ready',
          items: [],
          overview: overview.ok ? overview.value : get().overview,
          runs: runs.ok ? runs.value : get().runs
        })
        return
      }
      const [list, overview, runs] = await Promise.all([
        window.codex.memory.list({ store, projectId, categoryId, kind, query, archived }),
        window.codex.memory.overview(),
        window.codex.memory.runs()
      ])
      if (mine !== generation) return
      set({
        status: list.ok ? 'ready' : 'failed',
        items: list.ok ? list.value : [],
        overview: overview.ok ? overview.value : get().overview,
        runs: runs.ok ? runs.value : get().runs
      })
    },
    save: (input) => write(() => window.codex.memory.save(input)),
    remove: (memory) =>
      write(() => window.codex.memory.remove({ id: memory.id, baseRev: memory.rev })),
    category: (input) => write(() => window.codex.memory.category(input)),
    async runNow() {
      // The only refusal here is learning being off.
      await write(
        () => window.codex.memory.runNow(),
        (reply) =>
          reply.error.code === 'request_unavailable' ? 'memory.error.learnOff' : errorOf(reply)
      )
    },
    async exportAs(format) {
      set({ error: null })
      const reply = await window.codex.memory.export(format)
      if (!reply.ok) set({ error: errorOf(reply) })
    },
    clearError: () => set({ error: null })
  }
})

/** A short random id in the shape main expects for new records. */
export function newRecordId(prefix: 'm' | 'mc'): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`
}
