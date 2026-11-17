import { type FeatureFlagEvaluations, PostHog, type PostHogOptions } from 'posthog-node'
import type { FeatureFlagValue } from '../../shared/analytics.js'

export type PostHogConfig = {
  /** The project API key (`phc_…`). It is public by design: it can only write events. */
  key: string
  /** The ingestion host, such as `https://us.i.posthog.com`. */
  host: string
}
export type EventProperties = Record<string, string | number | boolean | null>
/** A launch's flag values; reading one reports the exposure PostHog experiments count. */
export type FlagSnapshot = { get(key: string): FeatureFlagValue | undefined }
/** What `Analytics` needs from PostHog, so tests can stand in for the SDK. */
export type AnalyticsSink = {
  capture(message: {
    distinctId: string
    event: string
    properties: EventProperties
    timestamp: Date
  }): void
  /** Every flag for this install; null when PostHog could not be reached. */
  flags(distinctId: string, personProperties: EventProperties): Promise<FlagSnapshot | null>
  /** Stops taking events, for when the user turns usage data off. */
  pause(): Promise<void>
  resume(): Promise<void>
  /** Sends what is queued, waiting at most `timeoutMs`, and stops the client. */
  shutdown(timeoutMs: number): Promise<void>
}

/** Queued events go out on this beat, or once `FLUSH_AT` are waiting. */
const FLUSH_INTERVAL_MS = 30_000
const FLUSH_AT = 20

/** The PostHog Node SDK as Owlto's analytics sink. `options` lets tests pass a fake `fetch`. */
export function posthogSink(config: PostHogConfig, options: PostHogOptions = {}): AnalyticsSink {
  const client = new PostHog(config.key, {
    host: config.host,
    flushAt: FLUSH_AT,
    flushInterval: FLUSH_INTERVAL_MS,
    // A desktop app talks to PostHog from the user's own network, so country stats work.
    disableGeoip: false,
    ...options
  })
  return {
    capture: (message) => client.capture(message),
    flags: async (distinctId, personProperties) => {
      try {
        const flags: FeatureFlagEvaluations = await client.evaluateFlags(distinctId, {
          personProperties: stringProperties(personProperties)
        })
        // An unreachable PostHog yields an empty snapshot; null lets the next read try again.
        if (!flags.keys.length) return null
        return { get: (key) => flags.getFlag(key) }
      } catch {
        return null
      }
    },
    pause: () => client.optOut(),
    resume: () => client.optIn(),
    shutdown: (timeoutMs) => client.shutdown(timeoutMs)
  }
}

/** Flag targeting matches on string properties. */
function stringProperties(properties: EventProperties): Record<string, string> {
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) =>
      value === null ? [] : [[key, String(value)]]
    )
  )
}
