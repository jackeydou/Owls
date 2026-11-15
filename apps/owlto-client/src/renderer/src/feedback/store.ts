import { create } from 'zustand'
import type { FeedbackDiagnostics, FeedbackInput, FeedbackResult } from '../../../shared/feedback'

type Draft = Pick<FeedbackInput, 'title' | 'body'>
const emptyDraft: Draft = { title: '', body: '' }

type State = {
  open: boolean
  /** Kept while the dialog is closed, so Escape or a stray click loses nothing; cleared once sent. */
  draft: Draft
  includeDiagnostics: boolean
  /** Null until the main process answers, or when it cannot. */
  diagnostics: FeedbackDiagnostics | null
  show(): void
  close(): void
  edit(draft: Partial<Draft>): void
  setIncludeDiagnostics(include: boolean): void
  /** Resolves to what happened; a failed request reads as `failed`, never a throw. */
  send(): Promise<FeedbackResult>
}

export const useFeedbackStore = create<State>((set, get) => ({
  open: false,
  draft: emptyDraft,
  includeDiagnostics: true,
  diagnostics: null,
  show: () => {
    set({ open: true })
    if (get().diagnostics) return
    void window.owlto
      .feedbackDiagnostics()
      .then((reply) => {
        if (reply.ok) set({ diagnostics: reply.value })
      })
      .catch(() => {
        /* The preview line stays hidden; sending still attaches what main reads. */
      })
  },
  close: () => set({ open: false }),
  edit: (draft) => set((state) => ({ draft: { ...state.draft, ...draft } })),
  setIncludeDiagnostics: (includeDiagnostics) => set({ includeDiagnostics }),
  send: async () => {
    const { draft, includeDiagnostics } = get()
    const reply = await window.owlto
      .sendFeedback({ ...draft, includeDiagnostics })
      .catch(() => null)
    const result: FeedbackResult = reply?.ok ? reply.value : { kind: 'failed' }
    if (result.kind !== 'failed') set({ draft: emptyDraft })
    return result
  }
}))
