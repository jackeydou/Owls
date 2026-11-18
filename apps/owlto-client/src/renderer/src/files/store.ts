import { create } from 'zustand'
import type { Failure } from '../../../shared/app'
import type { FilePreviewResult, FileTarget } from '../../../shared/file-preview'
import { useAppStore } from '../app/store'

/** How many files Back can step through. */
const HISTORY_LIMIT = 30

type FileViewer = {
  /** The file on screen, or null before any file was opened. */
  target: FileTarget | null
  /** The file, or why it is not shown; null while the first read runs. */
  preview: FilePreviewResult | null
  /** Why the read itself failed; the preview is null then. */
  error: Failure | null
  loading: boolean
  /** Files opened before this one, newest last. */
  history: FileTarget[]
  /** Shows a file in the right sidebar's viewer tab, opening the sidebar on that tab. */
  openFile(target: FileTarget): void
  back(): void
  /** Reads the file on screen again, e.g. after an agent changed it. */
  reload(): Promise<boolean>
}

const sameTarget = (a: FileTarget | null, b: FileTarget) =>
  a !== null && a.ref === b.ref && JSON.stringify(a.base) === JSON.stringify(b.base)

export const useFilesStore = create<FileViewer>((set, get) => {
  let request = 0
  /** Reads a file; a reload keeps the file on screen until the new read lands. Resolves true on success. */
  const load = async (target: FileTarget, keep = false): Promise<boolean> => {
    const id = ++request
    set(keep ? { loading: true } : { target, preview: null, loading: true, error: null })
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
    // A later click wins over a slow read.
    if (id !== request) return false
    set(
      reply.ok
        ? { preview: reply.value, error: null, loading: false }
        : { preview: null, error: reply.error, loading: false }
    )
    return reply.ok
  }
  return {
    target: null,
    preview: null,
    error: null,
    loading: false,
    history: [],
    openFile: (target) => {
      useAppStore.getState().showRightPanel('files')
      const { target: current, history } = get()
      if (sameTarget(current, target)) return void load(target, true)
      set({ history: current ? [...history, current].slice(-HISTORY_LIMIT) : history })
      void load(target)
    },
    back: () => {
      const { history } = get()
      const previous = history.at(-1)
      if (!previous) return
      set({ history: history.slice(0, -1) })
      void load(previous)
    },
    reload: async () => {
      const { target } = get()
      return target ? load(target, true) : false
    }
  }
})
