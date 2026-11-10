import { z } from 'zod'

/**
 * Pure update contracts shared by the main process, the renderer, and the release scripts
 * (`scripts/release-update-feed.mjs` imports this file), so the app and the published feed
 * agree on version order, channel names, and feed file names.
 */

export const updateChannelSchema = z.enum(['stable', 'beta'])
export type UpdateChannel = z.infer<typeof updateChannelSchema>

/** Where the release workflow publishes the update feeds: assets of one fixed release. */
export const UPDATE_FEED_REPOSITORY = 'jackeydou/Owls'
export const UPDATE_FEED_TAG = 'update-feed'

export function updateFeedFileName(channel: UpdateChannel, arch: string): string {
  return `owls-${channel}-darwin-${arch}.json`
}

export function updateFeedUrl(channel: UpdateChannel, arch: string): string {
  return `https://github.com/${UPDATE_FEED_REPOSITORY}/releases/download/${UPDATE_FEED_TAG}/${updateFeedFileName(channel, arch)}`
}

const releaseVersionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/

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
 * `2026.11.900`, so Owls decides the order itself.
 */
export function isNewerRelease(candidate: string, current: string): boolean {
  const next = parseReleaseVersion(candidate)
  const now = parseReleaseVersion(current)
  if (!next || !now) return false
  for (let index = 0; index < next.length; index++) {
    if (next[index] !== now[index]) return next[index] > now[index]
  }
  return false
}

export function releaseChannel(version: string): UpdateChannel {
  return version.includes('-beta.') ? 'beta' : 'stable'
}

/**
 * One feed file. Its fields are Squirrel.Mac's update response, so the same URL is handed to
 * Electron's `autoUpdater`; `version` is Owls' own and ignored by Squirrel.
 */
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
export const updateFeedEntrySchema = z.object({
  version: z.string().refine((value) => parseReleaseVersion(value) !== null),
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
  /** `development` is an unpackaged dev app; `platform` is anything but macOS. */
  | { status: 'unsupported'; reason: 'development' | 'platform' }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; checkedAt: string }
  | { status: 'downloading'; version: string }
  /** Installed when the app quits, or right away through `install`. */
  | { status: 'ready'; version: string }
  | { status: 'failed'; failure: UpdateFailure; checkedAt: string }
export type UpdateSnapshot = {
  currentVersion: string
  /** The channel in effect: the saved choice, or the installed build's own channel. */
  channel: UpdateChannel
  state: UpdateState
}
