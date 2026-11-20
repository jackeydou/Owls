import { app } from 'electron'
import { DEBUG_RELAY_URL, DEFAULT_RELAY_URL } from '../shared/remote.js'

declare const __OWLTO_BUILD_MODE__: 'debug' | 'release'

/**
 * Remote Router is still being tried out, so only debug packages and `pnpm dev` listen for or
 * connect to other devices. The renderer hides its UI the same way (remote/enabled.ts).
 */
export const REMOTE_ROUTER_ENABLED = __OWLTO_BUILD_MODE__ === 'debug'

/** Debug builds talk to the debug relay, so relay changes can be tried before production. */
export const RELAY_URL = __OWLTO_BUILD_MODE__ === 'debug' ? DEBUG_RELAY_URL : DEFAULT_RELAY_URL

/** Matches `productName` for debug packages in scripts/electron-builder-config.cjs. */
export const DEBUG_APP_NAME = 'Owlto Debug'

/**
 * An installed debug package ("Owlto Debug"), built for internal testing by the Release macOS
 * workflow or `build:mac:debug`. It installs beside the released app with its own data and never
 * auto-updates. `pnpm dev` is not a package, so it keeps the normal data root.
 */
export function isDebugPackage(): boolean {
  return app.isPackaged && __OWLTO_BUILD_MODE__ === 'debug'
}
