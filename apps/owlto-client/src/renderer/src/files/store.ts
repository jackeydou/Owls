import { create } from 'zustand'
import type { Failure } from '../../../shared/app'
import type { FilePreviewResult, FileTarget } from '../../../shared/file-preview'
import { useAppStore } from '../app/store'

/** Past this many open files, opening another closes the oldest. */
const TAB_LIMIT = 8

/** One open file in the viewer's tab row. */
export type FileTab = {
  id: number
  target: FileTarget
  /** The file, or why it is not shown; null while the first read runs. */
  preview: FilePreviewResult | null
  /** Why the read itself failed; the preview is null then. */
  error: Failure | null
  loading: boolean
}

type FileViewer = {
  tabs: FileTab[]
  activeId: number | null
  /** Shows a file in the right sidebar's viewer, in its tab if it is open, else a new one. */
  openFile(target: FileTarget): void
  activate(id: number): void
  close(id: number): void
  /** Reads the active file again, e.g. after an agent changed it. Resolves true on success. */
  reload(): Promise<boolean>
}

const sameTarget = (a: FileTarget, b: FileTarget) =>
  a.ref === b.ref && JSON.stringify(a.base) === JSON.stringify(b.base)

let nextId = 1

export const useFilesStore = create<FileViewer>((set, get) => {
  /** The latest read per tab, so a slow read never overwrites a newer one. */
  const requests = new Map<number, number>()
  const patch = (id: number, change: Partial<FileTab>) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...change } : tab))
    }))
  const load = async (id: number, target: FileTarget): Promise<boolean> => {
    const request = (requests.get(id) ?? 0) + 1
    requests.set(id, request)
    patch(id, { loading: true })
    const reply = await window.owlto.previewFile(target).catch(
      (error: unknown) =>
        ({
          ok: false,
          error: {
            code: 'native_error',
            message: error instanceof Error ? error.message : String(error)
          }
        }) as const
    )
    if (requests.get(id) !== request) return false
    patch(
      id,
      reply.ok
        ? { preview: reply.value, error: null, loading: false }
        : { preview: null, error: reply.error, loading: false }
    )
    return reply.ok
  }
  return {
    tabs: [],
    activeId: null,
    openFile: (target) => {
      useAppStore.getState().showRightPanel('files')
      const open = get().tabs.find((tab) => sameTarget(tab.target, target))
      if (open) {
        set({ activeId: open.id })
        void load(open.id, target)
        return
      }
      const tab: FileTab = { id: nextId++, target, preview: null, error: null, loading: true }
      const tabs = [...get().tabs, tab]
      for (const dropped of tabs.splice(0, Math.max(0, tabs.length - TAB_LIMIT)))
        requests.delete(dropped.id)
      set({ tabs, activeId: tab.id })
      void load(tab.id, target)
    },
    activate: (id) => set({ activeId: id }),
    close: (id) => {
      const { tabs, activeId } = get()
      const index = tabs.findIndex((tab) => tab.id === id)
      if (index < 0) return
      requests.delete(id)
      const rest = tabs.filter((tab) => tab.id !== id)
      // Closing the active tab moves to its neighbor, as editors do.
      const next =
        activeId === id ? ((rest[index] ?? rest[index - 1] ?? null)?.id ?? null) : activeId
      set({ tabs: rest, activeId: next })
    },
    reload: async () => {
      const { tabs, activeId } = get()
      const tab = tabs.find((t) => t.id === activeId)
      return tab ? load(tab.id, tab.target) : false
    }
  }
})
