import { create } from 'zustand'
import type { Reply } from '../../../shared/app'
import type { SimulatorAnswer, SimulatorSnapshot } from '../../../shared/simulator'
import { UIError, uiFailure } from '../app/failures'
import { useAppStore } from '../app/store'
import { useRouterStore } from '../router/store'

/** The simulator panel's state as main last reported it; main owns the devices. */
export const useSimulatorStore = create<SimulatorSnapshot & { loaded: boolean }>(() => ({
  loaded: false,
  availability: 'ready',
  devices: [],
  activeUdid: null,
  attached: [],
  leases: {},
  ask: null,
  inputBlocked: []
}))

/**
 * Follows main's devices for as long as the shell is mounted. A new ask opens the panel, so
 * a worker never waits on the user out of sight; a worker taking a device does not, so the
 * panel never steals the sidebar while the user works in another tab.
 */
export function watchSimulator(): () => void {
  const apply = (snapshot: SimulatorSnapshot) => {
    const before = useSimulatorStore.getState().ask?.id ?? null
    useSimulatorStore.setState({ ...snapshot, loaded: true })
    if (snapshot.ask && snapshot.ask.id !== before)
      useAppStore.getState().showRightPanel('simulator')
  }
  void window.owlto.simulator.snapshot().then((reply) => {
    if (reply.ok) apply(reply.value)
  })
  return window.owlto.simulator.onChanged(apply)
}

async function call<T>(run: () => Promise<Reply<T>>): Promise<T | undefined> {
  try {
    const reply = await run()
    if (!reply.ok) throw new UIError(reply.error)
    return reply.value
  } catch (error) {
    useRouterStore.setState({ error: uiFailure(error) })
    return undefined
  }
}

const api = () => window.owlto.simulator

export const simulatorActions = {
  refresh: () => call(() => api().refresh()),
  attach: (udid: string) => call(() => api().attach(udid)),
  detach: (udid: string) => call(() => api().detach(udid)),
  shutdown: (udid: string) => call(() => api().shutdown(udid)),
  /** Resolves true when the repair ran, so the button can show it finished. */
  repairInput: async (udid: string) =>
    (await call(async () => {
      const reply = await api().repairInput(udid)
      return reply.ok ? { ok: true as const, value: true } : reply
    })) ?? false,
  answer: async (input: SimulatorAnswer) => {
    const saved = await call(() => api().answer(input))
    // Allowing a device saved it in Settings; keep the store in step so a later save keeps it.
    if (saved) useAppStore.setState({ settings: saved })
  }
}
