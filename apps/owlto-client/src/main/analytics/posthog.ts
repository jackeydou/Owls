import type { FeatureFlagValue } from '../../shared/analytics.js'

/**
 * A minimal PostHog client over its public HTTP API (`/batch/` and `/flags`). Owlto sends
 * a handful of events, so a dependency-free client keeps the PostHog SDK out of every build,
 * including the release build that turns analytics on.
 */
export type PostHogConfig = {
  /** The project API key (`phc_…`). It is public by design: it can only write events. */
  key: string
  /** The ingestion host, such as `https://us.i.posthog.com`. */
  host: string
}
export type EventProperties = Record<string, string | number | boolean | null>
export type PostHogEvent = {
  event: string
  properties: EventProperties
  /** ISO time the event happened, so batched events keep their real order. */
  timestamp: string
}
export type PostHogTransport = (
  url: string,
  body: unknown,
  timeoutMs: number
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

/** Events past this wait in memory are dropped, oldest first, while PostHog is unreachable. */
const MAX_QUEUE = 500
const BATCH_SIZE = 50
const REQUEST_TIMEOUT_MS = 10_000

export const fetchTransport: PostHogTransport = async (url, body, timeoutMs) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })
  return { ok: response.ok, json: () => response.json() }
}

export class PostHogClient {
  private queue: PostHogEvent[] = []
  private flushing: Promise<void> | null = null
  constructor(
    private readonly config: PostHogConfig,
    private readonly transport: PostHogTransport = fetchTransport
  ) {}
  get pending(): number {
    return this.queue.length
  }
  enqueue(event: PostHogEvent): void {
    this.queue.push(event)
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE)
  }
  /** Forgets events not sent yet, for when the user turns usage data off. */
  clear(): void {
    this.queue = []
  }
  /** Sends queued events; a failed batch goes back to the front of the queue for the next try. */
  flush(distinctId: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<void> {
    if (!this.flushing)
      this.flushing = this.send(distinctId, timeoutMs).finally(() => {
        this.flushing = null
      })
    return this.flushing
  }
  private async send(distinctId: string, timeoutMs: number): Promise<void> {
    while (this.queue.length) {
      const batch = this.queue.splice(0, BATCH_SIZE)
      const sent = await this.transport(
        endpoint(this.config.host, '/batch/'),
        {
          api_key: this.config.key,
          batch: batch.map((event) => ({
            event: event.event,
            distinct_id: distinctId,
            timestamp: event.timestamp,
            properties: { ...event.properties, distinct_id: distinctId }
          }))
        },
        timeoutMs
      )
        .then((response) => response.ok)
        .catch(() => false)
      if (!sent) {
        this.queue.unshift(...batch)
        if (this.queue.length > MAX_QUEUE) this.queue.splice(MAX_QUEUE)
        return
      }
    }
  }
  /** Every flag's value for this install; null when PostHog could not be reached. */
  async flags(
    distinctId: string,
    personProperties: EventProperties
  ): Promise<Record<string, FeatureFlagValue> | null> {
    try {
      const response = await this.transport(
        endpoint(this.config.host, '/flags?v=2'),
        {
          api_key: this.config.key,
          distinct_id: distinctId,
          person_properties: personProperties
        },
        REQUEST_TIMEOUT_MS
      )
      if (!response.ok) return null
      return parseFlags(await response.json())
    } catch {
      return null
    }
  }
}

function endpoint(host: string, path: string): string {
  return `${host.replace(/\/+$/, '')}${path}`
}

/**
 * Reads a `/flags?v=2` reply (`flags: { key: { enabled, variant } }`), and the older
 * `featureFlags: { key: value }` shape, keeping only well-formed values.
 */
export function parseFlags(body: unknown): Record<string, FeatureFlagValue> | null {
  if (!isRecord(body)) return null
  const values: Record<string, FeatureFlagValue> = {}
  if (isRecord(body.flags)) {
    for (const [key, flag] of Object.entries(body.flags)) {
      if (!isRecord(flag) || typeof flag.enabled !== 'boolean') continue
      values[key] = flag.enabled && typeof flag.variant === 'string' ? flag.variant : flag.enabled
    }
    return values
  }
  if (isRecord(body.featureFlags)) {
    for (const [key, value] of Object.entries(body.featureFlags)) {
      if (typeof value === 'string' || typeof value === 'boolean') values[key] = value
    }
    return values
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
