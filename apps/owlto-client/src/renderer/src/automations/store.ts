import { create } from 'zustand'
import type { Reply } from '../../../shared/app'
import type { Automation, AutomationSave } from '../../../shared/automations'
import { UIError, uiFailure } from '../app/failures'
import { useRouterStore } from '../router/store'

function unwrap<T>(reply: Reply<T>): T {
  if (!reply.ok) throw new UIError(reply.error)
  return reply.value
}

/** What the automation dialog edits: a new automation, or an existing one. */
export type Editing = { kind: 'new' } | { kind: 'edit'; automation: Automation }

type State = {
  /** Null until the first read answers. */
  automations: Automation[] | null
  failed: boolean
  editing: Editing | null
  refresh(): Promise<void>
  edit(editing: Editing | null): void
  /** Throws a UIError the caller shows; the list refreshes from the change event. */
  save(input: AutomationSave): Promise<Automation>
  /** Flips the switch at once; a failure puts it back and shows the error toast. */
  setEnabled(id: string, enabled: boolean): Promise<void>
  /** A failure shows the error toast. */
  remove(id: string): Promise<void>
  runNow(id: string): Promise<Automation>
}

/** Newer reads win, so a slow reply cannot replace a newer one. */
let generation = 0

/** Shows a failure in the shared error toast. */
const toast = (error: unknown) => useRouterStore.setState({ error: uiFailure(error) })

export const useAutomationsStore = create<State>((set, get) => ({
  automations: null,
  failed: false,
  editing: null,
  refresh: async () => {
    const current = ++generation
    const reply = await window.owlto.automations.list().catch(() => null)
    if (current !== generation) return
    if (reply?.ok) set({ automations: reply.value, failed: false })
    else set({ failed: true })
  },
  edit: (editing) => set({ editing }),
  save: async (input) => unwrap(await window.owlto.automations.save(input)),
  setEnabled: async (id, enabled) => {
    const flip = (value: boolean) =>
      set({
        automations:
          get().automations?.map((a) => (a.id === id ? { ...a, enabled: value } : a)) ?? null
      })
    flip(enabled)
    try {
      unwrap(await window.owlto.automations.setEnabled({ id, enabled }))
    } catch (error) {
      flip(!enabled)
      toast(error)
    }
  },
  remove: async (id) => {
    try {
      unwrap(await window.owlto.automations.remove(id))
    } catch (error) {
      toast(error)
    }
  },
  runNow: async (id) => unwrap(await window.owlto.automations.runNow(id))
}))

/** Reads now and again on every change while the page is open; the return stops it. */
export function watchAutomations(): () => void {
  const { refresh } = useAutomationsStore.getState()
  void refresh()
  const stop = window.owlto.automations.onChanged(() => void refresh())
  return () => {
    stop()
    generation++
  }
}
