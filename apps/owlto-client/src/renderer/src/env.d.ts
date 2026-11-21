/// <reference types="vite/client" />

/** True only in release builds that carry a PostHog key; see electron.vite.config.ts. */
declare const __OWLTO_ANALYTICS__: boolean
/** `debug` in debug packages and `pnpm dev`, `release` in releases; see electron.vite.config.ts. */
declare const __OWLTO_BUILD_MODE__: 'debug' | 'release'
/** Remote Router ships: debug builds, `pnpm dev` and beta releases; see electron.vite.config.ts. */
declare const __OWLTO_REMOTE_ROUTER__: boolean
