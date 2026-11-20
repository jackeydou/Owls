import { create } from 'zustand'
import type { Failure, Reply } from '../../../shared/app'
import type { RemoteOverview, RemotePair, RemotePaired } from '../../../shared/remote'
import { UIError, uiFailure } from '../app/failures'
import { useAppStore } from '../app/store'
import { viewingDevice } from './viewing'

type RemoteState = {
  overview: RemoteOverview | null
  /** The last failure of a settings action, shown inline on the Devices page. */
  error: Failure | null
  load(): Promise<void>
  setAccess(enabled: boolean): Promise<void>
  setRelay(enabled: boolean): Promise<void>
  setKeepAwake(enabled: boolean): Promise<void>
  dismissJustPaired(): Promise<void>
  startPairing(): Promise<void>
  cancelPairing(): Promise<void>
  revokeClient(deviceId: string): Promise<void>
  /** Resolves to the paired device with its safety code, or the failure for the form to show. */
  pair(input: RemotePair): Promise<{ paired: RemotePaired } | { failure: Failure }>
  removeDevice(deviceId: string): Promise<void>
  clearError(): void
}

function unwrap<T>(reply: Reply<T>): T {
  if (!reply.ok) throw new UIError(reply.error)
  return reply.value
}

export const useRemoteStore = create<RemoteState>((set, get) => {
  async function update(fn: () => Promise<Reply<RemoteOverview>>): Promise<void> {
    try {
      set({ error: null })
      set({ overview: unwrap(await fn()) })
    } catch (error) {
      set({ error: uiFailure(error) })
    }
  }
  return {
    overview: null,
    error: null,
    load: () => update(() => window.owlto.remote.overview()),
    setAccess: (enabled) => update(() => window.owlto.remote.setAccess(enabled)),
    setRelay: (enabled) => update(() => window.owlto.remote.setRelay(enabled)),
    setKeepAwake: (enabled) => update(() => window.owlto.remote.setKeepAwake(enabled)),
    dismissJustPaired: () => update(() => window.owlto.remote.dismissJustPaired()),
    startPairing: () => update(() => window.owlto.remote.startPairing()),
    cancelPairing: () => update(() => window.owlto.remote.cancelPairing()),
    revokeClient: (deviceId) => update(() => window.owlto.remote.revokeClient(deviceId)),
    pair: async (input) => {
      try {
        const paired = unwrap(await window.owlto.remote.pair(input))
        await get().load()
        return { paired }
      } catch (error) {
        return { failure: uiFailure(error) }
      }
    },
    removeDevice: async (deviceId) => {
      if (viewingDevice() === deviceId) await useAppStore.getState().viewDevice(null)
      await update(() => window.owlto.remote.removeDevice(deviceId))
    },
    clearError: () => set({ error: null })
  }
})

/** Keeps the overview current while mounted; returns the cleanup. */
export function watchRemote(): () => void {
  void useRemoteStore.getState().load()
  return window.owlto.remote.onChanged((overview) => useRemoteStore.setState({ overview }))
}
