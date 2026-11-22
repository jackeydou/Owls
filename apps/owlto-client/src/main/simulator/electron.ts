import { dirname, join } from 'node:path'
import type { SimulatorSnapshot } from '../../shared/simulator.js'
import { hostCalls } from './host-calls.js'
import { SimulatorHostClient } from './host-client.js'
import { SimulatorService, type SimulatorServiceDeps } from './service.js'
import {
  bootDevice,
  copyToDevice,
  installApp,
  launchApp,
  listDevices,
  openUrl,
  recentLogs,
  shutdownDevice
} from './simctl.js'

/**
 * Where serve-sim keeps its native addon and Duo helper. Its package exports only its
 * middleware, so the files are found beside that. A packaged app runs the addon from
 * app.asar.unpacked, where electron-builder puts every `.node` file.
 */
function serveSimPaths(): { addon: string; duoHelper: string } {
  const dist = dirname(require.resolve('serve-sim/middleware')).replace(
    /app\.asar([/\\])/,
    'app.asar.unpacked$1'
  )
  return {
    addon: join(dist, 'native', 'serve-sim-native.node'),
    duoHelper: join(dist, 'simduo', 'serve-sim-duo-hid')
  }
}

export type SimulatorDeps = Pick<
  SimulatorServiceDeps,
  'settings' | 'worker' | 'needs' | 'shotsDir'
> & {
  /** The built `simulator/host.js` entry. */
  entry: string
  changed(snapshot: SimulatorSnapshot): void
}

/** The iOS Simulator panel's service, backed by Xcode's tools and the host utility process. */
export function createSimulator(deps: SimulatorDeps): {
  service: SimulatorService
  host: SimulatorHostClient
} {
  let service: SimulatorService | null = null
  const host = new SimulatorHostClient(deps.entry, serveSimPaths(), () => service?.hostExited())
  service = new SimulatorService({
    platform: process.platform,
    simctl: {
      list: listDevices,
      boot: bootDevice,
      shutdown: shutdownDevice,
      install: installApp,
      launch: launchApp,
      openUrl,
      copy: copyToDevice,
      logs: recentLogs
    },
    host: hostCalls(host),
    settings: deps.settings,
    worker: deps.worker,
    changed: deps.changed,
    needs: deps.needs,
    shotsDir: deps.shotsDir
  })
  return { service, host }
}
