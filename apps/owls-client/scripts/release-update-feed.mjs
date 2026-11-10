// Builds the macOS update feed for a release: one JSON file per channel and architecture, in
// Squirrel.Mac's update format, plus a Sparkle BinaryDelta patch from the build each channel
// served before. Run by .github/workflows/release-macos.yml after the ZIP is signed, notarized,
// and verified; the workflow uploads the patches with the release and the feed files to the
// fixed `update-feed` release afterwards.
//
// node --experimental-strip-types scripts/release-update-feed.mjs \
//   --version <version> --dist dist --notes <release notes> --binary-delta <BinaryDelta> --out <dir>

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import {
  isNewerRelease,
  parseReleaseVersion,
  releaseChannel,
  UPDATE_FEED_REPOSITORY,
  updateFeedEntrySchema,
  updateFeedFileName,
  updateFeedUrl
} from '../src/shared/updates.ts'

export function releaseAssetUrl(version, name) {
  return `https://github.com/${UPDATE_FEED_REPOSITORY}/releases/download/${version}/${name}`
}

/**
 * The channels whose feed this release replaces, each with the entry it replaces. A beta only
 * moves the beta feed; a stable release moves stable, and beta when it is newer than the beta
 * there, so beta users move on to stable releases. A release older than its own channel's
 * current entry is refused rather than rolling users back.
 */
export function planFeedUpdates(version, current) {
  const own = releaseChannel(version)
  const ownEntry = current[own]
  if (ownEntry && !isNewerRelease(version, ownEntry.version)) {
    throw new Error(
      `${version} is not newer than ${ownEntry.version}, the current ${own} feed release.`
    )
  }
  const channels = own === 'beta' ? ['beta'] : ['stable', 'beta']
  return channels
    .filter((channel) => !current[channel] || isNewerRelease(version, current[channel].version))
    .map((channel) => ({ channel, previous: current[channel] ?? null }))
}

/** The earlier releases to make patches from, one per version, in a stable order. */
export function deltaBases(updates) {
  const byVersion = new Map()
  for (const { previous } of updates) if (previous) byVersion.set(previous.version, previous)
  return [...byVersion.values()].sort((a, b) => a.version.localeCompare(b.version))
}

/** Squirrel.Mac parses `pub_date` without fractional seconds. */
export function feedDate(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function feedEntry({ version, zip, notes, pubDate, delta }) {
  return updateFeedEntrySchema.parse({
    version,
    name: `Owls ${version}`,
    notes,
    pub_date: pubDate,
    url: releaseAssetUrl(version, zip.name),
    sha256: zip.sha256,
    size: zip.size,
    ...(delta ? { delta } : {})
  })
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`)
  }
  return result.stdout
}

async function digest(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return { sha256: hash.digest('hex'), size: (await stat(path)).size }
}

async function fetchFeed(channel, arch) {
  const response = await fetch(updateFeedUrl(channel, arch), { cache: 'no-store' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Reading the ${channel} feed answered ${response.status}.`)
  return updateFeedEntrySchema.parse(await response.json())
}

async function download(url, path, expected) {
  const response = await fetch(url)
  if (!response.ok || !response.body)
    throw new Error(`Downloading ${url} answered ${response.status}.`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path))
  const actual = await digest(path)
  if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) {
    throw new Error(`${url} does not match the sha256 and size its feed entry records.`)
  }
}

/** Unpacks a ZIP the way Squirrel.Mac does and returns the app bundle inside. */
async function unpackApp(zipPath, directory) {
  await mkdir(directory, { recursive: true })
  run('/usr/bin/ditto', ['-x', '-k', zipPath, directory])
  const app = (await readdir(directory)).find((name) => name.endsWith('.app'))
  if (!app) throw new Error(`${zipPath} has no app bundle.`)
  return join(directory, app)
}

function bundleVersion(app) {
  return run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleVersion',
    join(app, 'Contents', 'Info.plist')
  ]).trim()
}

/**
 * Squirrel.Mac's installer strips group and other write bits, and a patch only applies to a
 * byte-identical bundle with the same modes, so a bundle carrying them cannot be patched.
 */
function groupWritable(app) {
  return run('/usr/bin/find', [app, '(', '-perm', '-g+w', '-o', '-perm', '-o+w', ')']).trim()
}

async function makeDelta({ base, newApp, version, arch, dist, binaryDelta, work }) {
  const baseZip = join(work, `${base.version}.zip`)
  await download(base.url, baseZip, base)
  const baseApp = await unpackApp(baseZip, join(work, base.version))
  if (groupWritable(baseApp)) {
    throw new Error(`${base.version} has group or other writable files and cannot be patched.`)
  }
  const name = `Owls-${base.version}-to-${version}-${arch}.delta`
  const deltaPath = join(dist, name)
  run(binaryDelta, [
    'create',
    '--version',
    '4',
    '--compression',
    'lzma',
    baseApp,
    newApp,
    deltaPath
  ])
  // Applying checks the result against the new bundle's recorded hashes.
  run(binaryDelta, ['apply', baseApp, join(work, `${base.version}-applied.app`), deltaPath])
  return {
    from_version: bundleVersion(baseApp),
    url: releaseAssetUrl(version, name),
    ...(await digest(deltaPath))
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      dist: { type: 'string' },
      notes: { type: 'string' },
      'binary-delta': { type: 'string' },
      out: { type: 'string' }
    }
  })
  const { version, notes: notesPath, out } = values
  const binaryDelta = values['binary-delta']
  if (!version || !values.dist || !notesPath || !binaryDelta || !out) {
    throw new Error('Pass --version, --dist, --notes, --binary-delta, and --out.')
  }
  if (!parseReleaseVersion(version)) throw new Error(`Unsupported release version: ${version}`)
  const dist = resolve(values.dist)
  const notes = (await readFile(notesPath, 'utf8')).trim()
  const pubDate = feedDate(new Date())
  const zipPattern = new RegExp(`^Owls-${version.replaceAll('.', '\\.')}-([a-z0-9]+)-mac\\.zip$`)
  const zips = (await readdir(dist)).filter((name) => zipPattern.test(name)).sort()
  if (!zips.length) throw new Error(`No Owls-${version}-<arch>-mac.zip in ${dist}.`)
  await mkdir(out, { recursive: true })
  const work = await mkdtemp(join(tmpdir(), 'owls-update-feed-'))
  try {
    for (const zipName of zips) {
      const arch = zipPattern.exec(zipName)[1]
      const zip = { name: zipName, ...(await digest(join(dist, zipName))) }
      const current = {
        stable: await fetchFeed('stable', arch),
        beta: await fetchFeed('beta', arch)
      }
      const updates = planFeedUpdates(version, current)
      const newApp = await unpackApp(join(dist, zipName), join(work, `${version}-${arch}`))
      if (groupWritable(newApp)) {
        console.log(
          `::warning::${zipName} has group or other writable files; patches from ${version} will not apply.`
        )
      }
      const deltas = new Map()
      for (const base of deltaBases(updates)) {
        try {
          deltas.set(
            base.version,
            await makeDelta({ base, newApp, version, arch, dist, binaryDelta, work })
          )
        } catch (error) {
          // Squirrel downloads the full ZIP when there is no patch, so a failed patch is a warning.
          console.log(
            `::warning::No ${base.version} -> ${version} patch for ${arch}: ${error.message}`
          )
        }
      }
      for (const { channel, previous } of updates) {
        const delta = previous ? deltas.get(previous.version) : undefined
        const entry = feedEntry({ version, zip, notes, pubDate, delta })
        const file = join(out, updateFeedFileName(channel, arch))
        await writeFile(file, `${JSON.stringify(entry, null, 2)}\n`)
        console.log(
          `${channel} ${arch}: ${previous?.version ?? 'none'} -> ${version}` +
            (delta ? `, ${delta.size} byte patch (ZIP ${zip.size} bytes)` : ', no patch')
        )
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
