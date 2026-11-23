import { z } from 'zod'

/**
 * Pure update contracts shared by the main process, the renderer, and the release scripts
 * (`scripts/release-update-feed.mjs` imports this file), so the app and the published feed
 * agree on version order, channel names, and feed file names.
 */

export const updateChannelSchema = z.enum(['stable', 'beta'])
/** The channels a user picks between in Settings → Updates. */
export type UpdateChannel = z.infer<typeof updateChannelSchema>
/**
 * Every published feed. `debug` serves only debug packages ("Owlto Debug", internal testing),
 * which always follow it and never the user-facing channels.
 */
export type FeedChannel = UpdateChannel | 'debug'
/** Every install updates from stable until the user picks beta in Settings → Updates. */
export const DEFAULT_UPDATE_CHANNEL: UpdateChannel = 'stable'

/** Where the release workflow publishes the update feeds: assets of one fixed release. */
export const UPDATE_FEED_REPOSITORY = 'jackeydou/Owls'
export const UPDATE_FEED_TAG = 'update-feed'
/** Debug packages are not releases: their files are assets of this one fixed prerelease. */
export const DEBUG_BUILDS_TAG = 'debug-builds'

export function updateFeedFileName(channel: FeedChannel, arch: string): string {
  return `owlto-${channel}-darwin-${arch}.json`
}

export function updateFeedUrl(channel: FeedChannel, arch: string): string {
  return `https://github.com/${UPDATE_FEED_REPOSITORY}/releases/download/${UPDATE_FEED_TAG}/${updateFeedFileName(channel, arch)}`
}

const releaseVersionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/
const debugVersionPattern = /^\d+\.\d+\.\d+-debug\.(\d+)$/

/**
 * A debug package's version, `YYYY.M.PATCH-debug.N`: the branch's release version with the
 * workflow run number stamped on in CI (never committed). N alone orders debug packages, so the
 * latest build wins whichever branch it came from.
 */
export function debugBuildNumber(version: string): number | null {
  const match = debugVersionPattern.exec(version)
  return match ? Number(match[1]) : null
}

/** `YYYY.M.PATCH` or `YYYY.M.PATCH-beta.N` (docs/reference/RELEASING.md); null otherwise. */
export function parseReleaseVersion(version: string): number[] | null {
  const match = releaseVersionPattern.exec(version)
  if (!match) return null
  // A stable release sorts after every beta of the same version.
  const beta = match[4] === undefined ? Number.POSITIVE_INFINITY : Number(match[4])
  return [Number(match[1]), Number(match[2]), Number(match[3]), beta]
}

/**
 * Whether `candidate` is a later release than `current`. Squirrel.Mac's own JSON feed mode
 * compares versions as plain strings with numeric runs, which ranks `2026.11.900-beta.1` above
 * `2026.11.900`, so Owlto decides the order itself.
 */
export function isNewerRelease(candidate: string, current: string): boolean {
  const nextDebug = debugBuildNumber(candidate)
  const nowDebug = debugBuildNumber(current)
  // Debug packages and releases are separate apps and never update into each other.
  if (nextDebug !== null || nowDebug !== null)
    return nextDebug !== null && nowDebug !== null && nextDebug > nowDebug
  const next = parseReleaseVersion(candidate)
  const now = parseReleaseVersion(current)
  if (!next || !now) return false
  for (let index = 0; index < next.length; index++) {
    if (next[index] !== now[index]) return next[index] > now[index]
  }
  return false
}

export function releaseChannel(version: string): FeedChannel {
  if (debugBuildNumber(version) !== null) return 'debug'
  return version.includes('-beta.') ? 'beta' : 'stable'
}

/**
 * One feed file. Its fields are Squirrel.Mac's update response, so the same URL is handed to
 * Electron's `autoUpdater`; `version` is Owlto's own and ignored by Squirrel.
 */
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
export const updateFeedEntrySchema = z.object({
  version: z
    .string()
    .refine((value) => parseReleaseVersion(value) !== null || debugBuildNumber(value) !== null),
  name: z.string(),
  notes: z.string(),
  pub_date: z.string(),
  url: z.string().url(),
  sha256: sha256Schema,
  size: z.number().int().positive(),
  delta: z
    .object({
      from_version: z.string().min(1),
      url: z.string().url(),
      sha256: sha256Schema,
      size: z.number().int().positive()
    })
    .optional()
})
export type UpdateFeedEntry = z.infer<typeof updateFeedEntrySchema>

export type UpdateFailure = 'network' | 'feed' | 'download'
export type UpdateState =
  /**
   * `development` is an unpackaged dev app; `platform` is anything but macOS; `debug` is a
   * debug package built locally, which has no feed and is replaced by hand.
   */
  | { status: 'unsupported'; reason: 'development' | 'platform' | 'debug' }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; checkedAt: string }
  /** `notes` is the feed's Markdown release notes for `version` (`release-notes/<version>.md`). */
  | { status: 'downloading'; version: string; notes: string }
  /** Installed when the app quits, or right away through `install`. */
  | { status: 'ready'; version: string; notes: string }
  | { status: 'failed'; failure: UpdateFailure; checkedAt: string }
export type UpdateSnapshot = {
  currentVersion: string
  /** The channel in effect: the saved choice, or stable; always `debug` in a debug package. */
  channel: FeedChannel
  state: UpdateState
}
