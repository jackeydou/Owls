/**
 * Remote Router is still being tried out: only debug packages ("Owlto Debug"), `pnpm dev` and
 * beta releases show it. Stable releases hide Settings → Devices and the device picker, and
 * never listen (electron.vite.config.ts decides at build time).
 */
export const REMOTE_ROUTER_ENABLED = __OWLTO_REMOTE_ROUTER__
