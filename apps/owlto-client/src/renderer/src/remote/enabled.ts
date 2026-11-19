/**
 * Remote Router is still being tried out: only debug packages ("Owlto Debug") and `pnpm dev`
 * show it. Releases hide Settings → Devices and the device picker, and never listen.
 */
export const REMOTE_ROUTER_ENABLED = __OWLTO_BUILD_MODE__ === 'debug'
