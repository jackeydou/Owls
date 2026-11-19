import { app } from 'electron'

declare const __OWLTO_BUILD_MODE__: 'debug' | 'release'

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
