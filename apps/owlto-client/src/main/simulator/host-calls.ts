import type { SimulatorHostClient } from './host-client.js'
import type { SimulatorHostCalls } from './service.js'

/** The service's view of the host: typed calls over the host client. */
export function hostCalls(client: SimulatorHostClient): SimulatorHostCalls {
  return {
    attach: async (udid) => {
      await client.call({ type: 'attach', udid })
    },
    detach: async (udid) => {
      await client.call({ type: 'detach', udid })
    },
    touch: async (udid, phase, x, y) => {
      await client.call({ type: 'touch', udid, phase, x, y })
    },
    key: async (udid, phase, usage) => {
      await client.call({ type: 'key', udid, phase, usage })
    },
    button: async (udid, name) => {
      await client.call({ type: 'button', udid, name })
    },
    snapshot: async (udid, path) => String(await client.call({ type: 'snapshot', udid, path })),
    ax: async (udid) => String(await client.call({ type: 'ax', udid }))
  }
}
