import type { PostHogConfig } from './posthog.js'

// Set by electron.vite.config.ts. Only a release build given `OWLTO_POSTHOG_KEY` (the
// Release macOS workflow) gets a key; every other build compiles in an empty one.
declare const __OWLTO_POSTHOG_KEY__: string
declare const __OWLTO_POSTHOG_HOST__: string

/** This build's PostHog project, or null when the build ships without analytics. */
export function analyticsBuildConfig(): PostHogConfig | null {
  const key = typeof __OWLTO_POSTHOG_KEY__ === 'string' ? __OWLTO_POSTHOG_KEY__ : ''
  const host = typeof __OWLTO_POSTHOG_HOST__ === 'string' ? __OWLTO_POSTHOG_HOST__ : ''
  return key && host ? { key, host } : null
}
